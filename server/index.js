import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRouter from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;

const app = express();

app.use('/api', apiRouter);
app.use('/media', express.static(path.join(ROOT, 'media')));
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
