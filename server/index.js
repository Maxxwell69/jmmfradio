import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pg from 'pg';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRouter from './routes/api.js';
import { requireAuth } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;
// See server/db.js for why this reads STORAGE_DIR — same single-volume constraint on Railway.
const MEDIA_DIR = process.env.STORAGE_DIR ? path.join(process.env.STORAGE_DIR, 'media') : path.join(ROOT, 'media');

if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
  console.warn('ADMIN_EMAIL / ADMIN_PASSWORD are not set — sign-in will reject everyone until .env is configured.');
}

const app = express();

// Behind Railway/Render/etc.'s proxy, this makes secure cookies work over the
// proxy's HTTPS termination instead of the plain-HTTP hop it sees internally.
app.set('trust proxy', 1);

// Postgres-backed sessions when DATABASE_URL is set (survives redeploys, works past a
// single instance); falls back to express-session's in-memory store for local dev.
let sessionStore;
if (process.env.DATABASE_URL) {
  const PgSession = connectPgSimple(session);
  sessionStore = new PgSession({
    pool: new pg.Pool({ connectionString: process.env.DATABASE_URL }),
    createTableIfMissing: true,
  });
}

app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'jem-caster-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use('/api', apiRouter);
app.use('/media', express.static(MEDIA_DIR));

// The front page doubles as the sign-in screen for now; already-signed-in visitors
// skip straight to the admin dashboard.
app.get('/', (req, res) => {
  if (req.session?.authenticated) return res.redirect('/admin.html');
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.get('/admin.html', requireAuth, (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'admin.html'));
});

app.use(express.static(path.join(ROOT, 'public')));

// Multer errors (bad file type, too large) land here instead of crashing/HTML-erroring.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`JEM Caster running at http://localhost:${PORT}`);
  console.log(`  Player (add as OBS Browser Source): http://localhost:${PORT}/player.html`);
  console.log(`  Admin (upload + configure):          http://localhost:${PORT}/admin.html`);
});
