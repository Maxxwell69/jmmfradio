import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseFile } from 'music-metadata';
import { readDb, updateDb } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = path.join(__dirname, '..', '..', 'media');
const ART_DIR = path.join(MEDIA_DIR, 'art');

const AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/flac',
  'audio/x-flac',
  'audio/mp4',
  'audio/aac',
  'audio/x-m4a',
]);

const ART_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const PICTURE_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

// Reads embedded ID3/Vorbis/etc tags so uploads don't require manual title/artist/art entry.
async function readAudioMetadata(filePath) {
  try {
    const metadata = await parseFile(filePath, { skipCovers: false });
    const picture = metadata.common.picture?.[0];
    return {
      title: metadata.common.title?.trim() || null,
      artist: metadata.common.artist?.trim() || null,
      picture: picture && PICTURE_EXT[picture.format] ? picture : null,
    };
  } catch {
    return { title: null, artist: null, picture: null };
  }
}

async function saveEmbeddedArt(picture) {
  const filename = `${crypto.randomUUID()}${PICTURE_EXT[picture.format]}`;
  await fs.writeFile(path.join(ART_DIR, filename), picture.data);
  return filename;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, file.fieldname === 'art' ? ART_DIR : MEDIA_DIR);
  },
  filename: (req, file, cb) => {
    const id = crypto.randomUUID();
    cb(null, `${id}${path.extname(file.originalname).toLowerCase()}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'art') {
      cb(null, ART_TYPES.has(file.mimetype));
    } else {
      cb(null, AUDIO_TYPES.has(file.mimetype));
    }
  },
});

async function ensureMediaDirs() {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  await fs.mkdir(ART_DIR, { recursive: true });
}
await ensureMediaDirs();

const router = express.Router();

function slugify(name) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || crypto.randomUUID().slice(0, 8)
  );
}

async function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// GET /api/state - everything the player and admin UI need
router.get('/state', async (req, res) => {
  const db = await readDb();
  res.json(db);
});

// POST /api/tracks - upload a media file (+ optional art) and register it
router.post(
  '/tracks',
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'art', maxCount: 1 },
  ]),
  async (req, res) => {
    const file = req.files?.file?.[0];
    const art = req.files?.art?.[0];
    if (!file) {
      return res.status(400).json({ error: 'A media file is required (unsupported type is rejected).' });
    }

    const { title, artist, categoryId } = req.body;
    if (!categoryId) {
      await safeUnlink(file.path);
      await safeUnlink(art?.path);
      return res.status(400).json({ error: 'categoryId is required.' });
    }

    const tags = await readAudioMetadata(file.path);
    let artFilename = art ? art.filename : null;
    if (!artFilename && tags.picture) {
      try {
        artFilename = await saveEmbeddedArt(tags.picture);
      } catch {
        artFilename = null;
      }
    }

    try {
      const db = await updateDb((db) => {
        if (!db.categories.some((c) => c.id === categoryId)) {
          throw Object.assign(new Error(`Unknown categoryId "${categoryId}"`), { status: 400 });
        }
        const track = {
          id: crypto.randomUUID(),
          filename: file.filename,
          title: title?.trim() || tags.title || path.parse(file.originalname).name,
          artist: artist?.trim() || tags.artist || '',
          categoryId,
          art: artFilename,
          addedAt: new Date().toISOString(),
        };
        db.tracks.push(track);
        return db;
      });
      const track = db.tracks[db.tracks.length - 1];
      res.status(201).json(track);
    } catch (err) {
      await safeUnlink(file.path);
      await safeUnlink(art?.path);
      if (artFilename && !art) await safeUnlink(path.join(ART_DIR, artFilename));
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

// PUT /api/tracks/:id - edit metadata (title/artist/category), not the file itself
router.put('/tracks/:id', express.json(), async (req, res) => {
  const { title, artist, categoryId } = req.body;
  try {
    const db = await updateDb((db) => {
      const track = db.tracks.find((t) => t.id === req.params.id);
      if (!track) throw Object.assign(new Error('Track not found'), { status: 404 });
      if (categoryId !== undefined) {
        if (!db.categories.some((c) => c.id === categoryId)) {
          throw Object.assign(new Error(`Unknown categoryId "${categoryId}"`), { status: 400 });
        }
        track.categoryId = categoryId;
      }
      if (title !== undefined) track.title = title.trim();
      if (artist !== undefined) track.artist = artist.trim();
      return db;
    });
    res.json(db.tracks.find((t) => t.id === req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// DELETE /api/tracks/:id
router.delete('/tracks/:id', async (req, res) => {
  let removed;
  try {
    const db = await updateDb((db) => {
      const idx = db.tracks.findIndex((t) => t.id === req.params.id);
      if (idx === -1) throw Object.assign(new Error('Track not found'), { status: 404 });
      [removed] = db.tracks.splice(idx, 1);
      return db;
    });
    await safeUnlink(path.join(MEDIA_DIR, removed.filename));
    if (removed.art) await safeUnlink(path.join(ART_DIR, removed.art));
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/categories - add a rotation category (e.g. "Weather", "Ad")
router.post('/categories', express.json(), async (req, res) => {
  const { name, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const db = await updateDb((db) => {
      let id = slugify(name);
      while (db.categories.some((c) => c.id === id)) id += '-2';
      db.categories.push({ id, name: name.trim(), color: color || '#888888' });
      return db;
    });
    res.status(201).json(db.categories[db.categories.length - 1]);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// DELETE /api/categories/:id - blocked if tracks still use it or it's in the rotation pattern
router.delete('/categories/:id', async (req, res) => {
  try {
    const db = await updateDb((db) => {
      const inUse = db.tracks.some((t) => t.categoryId === req.params.id);
      if (inUse) {
        throw Object.assign(new Error('Category still has tracks assigned to it'), { status: 409 });
      }
      const idx = db.categories.findIndex((c) => c.id === req.params.id);
      if (idx === -1) throw Object.assign(new Error('Category not found'), { status: 404 });
      db.categories.splice(idx, 1);
      db.rotation = db.rotation.filter((id) => id !== req.params.id);
      return db;
    });
    res.json({ ok: true, rotation: db.rotation });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// PUT /api/rotation - save the clock-wheel pattern, e.g. ["music","music","id","music","jingle"]
router.put('/rotation', express.json(), async (req, res) => {
  const { rotation } = req.body;
  if (!Array.isArray(rotation) || rotation.length === 0) {
    return res.status(400).json({ error: 'rotation must be a non-empty array of category ids' });
  }
  try {
    const db = await updateDb((db) => {
      const invalid = rotation.filter((id) => !db.categories.some((c) => c.id === id));
      if (invalid.length) {
        throw Object.assign(new Error(`Unknown category ids in rotation: ${invalid.join(', ')}`), { status: 400 });
      }
      db.rotation = rotation;
      return db;
    });
    res.json({ rotation: db.rotation });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// In-memory only: the player page self-reports what it's playing so the admin UI can show
// an on-air/up-next/history view without the server owning rotation state itself.
const nowPlaying = { current: null, currentSince: null, upNext: [], history: [] };

router.post('/now-playing', express.json(), (req, res) => {
  const { current, upNext } = req.body;
  if (nowPlaying.current && (!current || nowPlaying.current.id !== current.id)) {
    nowPlaying.history.unshift({ ...nowPlaying.current, playedAt: nowPlaying.currentSince });
    nowPlaying.history = nowPlaying.history.slice(0, 10);
  }
  if (current && nowPlaying.current?.id !== current.id) {
    nowPlaying.currentSince = new Date().toISOString();
  }
  nowPlaying.current = current || null;
  nowPlaying.upNext = Array.isArray(upNext) ? upNext.slice(0, 10) : [];
  res.json({ ok: true });
});

router.get('/now-playing', (req, res) => {
  res.json(nowPlaying);
});

// In-memory, single-slot queue: admin posts a command, the player picks it up on its
// next poll and the GET clears it. Good enough for one player instance at a time.
let pendingCommand = null;
const COMMAND_TYPES = new Set(['skip', 'play-category', 'play-track']);

router.post('/command', express.json(), (req, res) => {
  const { type, categoryId, trackId } = req.body;
  if (!COMMAND_TYPES.has(type)) {
    return res.status(400).json({ error: 'Invalid command type.' });
  }
  if (type === 'play-category' && !categoryId) {
    return res.status(400).json({ error: 'categoryId is required.' });
  }
  if (type === 'play-track' && !trackId) {
    return res.status(400).json({ error: 'trackId is required.' });
  }
  pendingCommand = { id: crypto.randomUUID(), type, categoryId, trackId };
  res.json({ ok: true });
});

router.get('/command', (req, res) => {
  const command = pendingCommand;
  pendingCommand = null;
  res.json({ command });
});

export default router;
