import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// STORAGE_DIR points at a single mounted volume in production (Railway only allows one
// per service); data/ and media/ live as subfolders inside it. Falls back to the repo's
// own data/ folder for local dev, where no volume is involved.
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

let writeQueue = Promise.resolve();

async function ensureDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DB_FILE);
  } catch {
    await fs.writeFile(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2));
  }
}

// Backfills fields for db.json files written before they existed, so upgrading
// doesn't require a manual migration step.
function withDefaults(db) {
  if (!db.settings) db.settings = { crossfadeSeconds: 3 };
  if (!db.layout) db.layout = DEFAULT_LAYOUT;
  return db;
}

export async function readDb() {
  await ensureDb();
  const raw = await fs.readFile(DB_FILE, 'utf-8');
  return withDefaults(JSON.parse(raw));
}

// Serializes writes so concurrent requests (e.g. two uploads at once) can't clobber each other.
export function writeDb(db) {
  writeQueue = writeQueue.then(async () => {
    const tmpFile = `${DB_FILE}.tmp`;
    await fs.writeFile(tmpFile, JSON.stringify(db, null, 2));
    await fs.rename(tmpFile, DB_FILE);
  });
  return writeQueue;
}

// Reads, lets the mutator mutate in place (or return a new object), then persists.
// Runs on the write queue so read-modify-write sequences stay atomic under concurrency.
export function updateDb(mutator) {
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
}
