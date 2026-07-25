import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// STORAGE_DIR points at a single mounted volume in production (Railway only allows one
// per service); media/ lives as a subfolder inside it. Falls back to the repo's own
// media/ folder for local dev, where no volume is involved. (data/ is only used by the
// file-backed fallback below, when there's no DATABASE_URL.)
const DATA_DIR = process.env.STORAGE_DIR ? path.join(process.env.STORAGE_DIR, 'data') : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_CATEGORIES = [
  { id: 'music', name: 'Music', color: '#4f7cff' },
  { id: 'id', name: 'Station ID', color: '#22c55e' },
  { id: 'jingle', name: 'Jingle', color: '#eab308' },
  { id: 'ad', name: 'Ad', color: '#f97316' },
];

// Percentages (0-100) of the player viewport, anchored top-left. Works regardless of
// whether the OBS source is set up as 16:9 or a vertical 9:16 canvas.
const DEFAULT_LAYOUT = {
  card: { x: 4, y: 78 },
  logo: { x: 82, y: 4 },
};

const DEFAULT_DB = {
  categories: DEFAULT_CATEGORIES,
  rotation: ['music', 'music', 'music', 'id', 'music', 'music', 'music', 'jingle'],
  tracks: [],
  settings: { crossfadeSeconds: 3 },
  layout: DEFAULT_LAYOUT,
};

// Backfills fields for db records written before they existed, so upgrading doesn't
// require a manual migration step.
function withDefaults(db) {
  if (!db.settings) db.settings = { crossfadeSeconds: 3 };
  if (!db.layout) db.layout = DEFAULT_LAYOUT;
  return db;
}

// --- Postgres backend (used whenever DATABASE_URL is set, e.g. on Railway) ---
// The whole db object is stored as a single JSONB blob rather than a normalized schema.
// This is deliberately the smallest change that gets real, durable, properly-locked
// storage instead of a file on a volume that can be misconfigured or wiped on redeploy —
// a proper relational schema is for the later multi-tenant rebuild, not worth doing twice.
function createPgBackend(connectionString) {
  const pool = new pg.Pool({ connectionString });
  let schemaReady;

  function ensureSchema() {
    if (!schemaReady) {
      schemaReady = pool
        .query('CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY DEFAULT 1, data JSONB NOT NULL)')
        .then(() => pool.query('INSERT INTO app_state (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [JSON.stringify(DEFAULT_DB)]));
    }
    return schemaReady;
  }

  return {
    async readDb() {
      await ensureSchema();
      const { rows } = await pool.query('SELECT data FROM app_state WHERE id = 1');
      return withDefaults(rows[0].data);
    },

    // Real row-level locking via SELECT ... FOR UPDATE inside a transaction, so
    // concurrent requests (e.g. two uploads at once) serialize correctly even across
    // multiple app instances later — stronger than the single-process write queue the
    // file backend below has to use.
    async updateDb(mutator) {
      await ensureSchema();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT data FROM app_state WHERE id = 1 FOR UPDATE');
        const db = withDefaults(rows[0].data);
        const next = (await mutator(db)) || db;
        await client.query('UPDATE app_state SET data = $1 WHERE id = 1', [JSON.stringify(next)]);
        await client.query('COMMIT');
        return next;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

// --- File backend (local dev default, no DATABASE_URL required) ---
function createFileBackend() {
  let writeQueue = Promise.resolve();

  async function ensureDb() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      await fs.access(DB_FILE);
    } catch {
      await fs.writeFile(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2));
    }
  }

  return {
    async readDb() {
      await ensureDb();
      const raw = await fs.readFile(DB_FILE, 'utf-8');
      return withDefaults(JSON.parse(raw));
    },

    // Serializes writes so concurrent requests can't clobber each other. Only safe
    // within a single process — fine for local dev, not for the production backend.
    updateDb(mutator) {
      const result = writeQueue.then(async () => {
        await ensureDb();
        const raw = await fs.readFile(DB_FILE, 'utf-8');
        const db = withDefaults(JSON.parse(raw));
        const next = (await mutator(db)) || db;
        const tmpFile = `${DB_FILE}.tmp`;
        await fs.writeFile(tmpFile, JSON.stringify(next, null, 2));
        await fs.rename(tmpFile, DB_FILE);
        return next;
      });
      writeQueue = result.catch(() => {});
      return result;
    },
  };
}

const backend = process.env.DATABASE_URL ? createPgBackend(process.env.DATABASE_URL) : createFileBackend();

if (!process.env.DATABASE_URL) {
  console.warn('DATABASE_URL is not set — falling back to data/db.json. Set DATABASE_URL in production.');
}

export const readDb = backend.readDb;
export const updateDb = backend.updateDb;
