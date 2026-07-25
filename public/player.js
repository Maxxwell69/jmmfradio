const audio = document.getElementById('audio');
const overlay = document.getElementById('overlay');
const artEl = document.getElementById('art');
const artFallback = document.getElementById('art-fallback');
const titleEl = document.getElementById('title');
const artistEl = document.getElementById('artist');
const badgeEl = document.getElementById('category-badge');
const progressFill = document.getElementById('progress-fill');
const emptyEl = document.getElementById('empty');
const startBtn = document.getElementById('start-btn');
const muteBtn = document.getElementById('mute-btn');
const volumeSlider = document.getElementById('volume-slider');

const POS_KEY = 'jmmfradio_rotation_pos';
const LAST_KEY = 'jmmfradio_last_played';
const VOLUME_KEY = 'jmmfradio_volume';
const STATE_REFRESH_MS = 30_000;
const COMMAND_POLL_MS = 2_000;
const UP_NEXT_PREVIEW_COUNT = 3;

let state = { categories: [], rotation: [], tracks: [] };
let categoryMap = new Map();
let tracksByCategory = new Map();
let currentTrack = null;
// Set by an admin command; consumed by the next pickNextTrack() call, then cleared.
let forcedNext = null;

function loadPos() {
  return Number(localStorage.getItem(POS_KEY)) || 0;
}
function savePos(pos) {
  localStorage.setItem(POS_KEY, String(pos));
}
function loadLastPlayed() {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) || '{}');
  } catch {
    return {};
  }
}
function saveLastPlayed(map) {
  localStorage.setItem(LAST_KEY, JSON.stringify(map));
}

function indexTracks() {
  categoryMap = new Map(state.categories.map((c) => [c.id, c]));
  tracksByCategory = new Map();
  for (const track of state.tracks) {
    if (!tracksByCategory.has(track.categoryId)) tracksByCategory.set(track.categoryId, []);
    tracksByCategory.get(track.categoryId).push(track);
  }
}

async function fetchState() {
  const res = await fetch('/api/state', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load state');
  state = await res.json();
  indexTracks();
  applyLayout(state.layout);
}

// Positions are percentages anchored top-left, set via the admin's drag-and-drop
// designer, so this works whichever aspect ratio the OBS source is set up as.
function applyLayout(layout) {
  if (!layout) return;
  if (layout.card) {
    overlay.style.left = `${layout.card.x}%`;
    overlay.style.top = `${layout.card.y}%`;
    overlay.style.right = 'auto';
    overlay.style.bottom = 'auto';
  }
  const logoEl = document.querySelector('.brand-logo');
  if (logoEl && layout.logo) {
    logoEl.style.left = `${layout.logo.x}%`;
    logoEl.style.top = `${layout.logo.y}%`;
    logoEl.style.right = 'auto';
  }
}

// Pure step function: given a rotation position and per-category "last played" map,
// picks the next track without touching localStorage. Shared by pickNextTrack (which
// persists the result) and previewUpNext (which just simulates ahead for display).
function selectNext(pos, lastPlayed) {
  const attempts = Math.max(state.rotation.length, 1);
  let p = pos;

  for (let i = 0; i < attempts; i++) {
    const categoryId = state.rotation[p % state.rotation.length];
    const candidates = tracksByCategory.get(categoryId) || [];
    p += 1;

    if (candidates.length) {
      let pool = candidates;
      if (candidates.length > 1) {
        const lastId = lastPlayed[categoryId];
        const filtered = candidates.filter((t) => t.id !== lastId);
        if (filtered.length) pool = filtered;
      }
      const track = pool[Math.floor(Math.random() * pool.length)];
      return { track, pos: p, lastPlayed: { ...lastPlayed, [categoryId]: track.id } };
    }
  }

  return { track: null, pos: p, lastPlayed };
}

// Resolves a forced pick (from an admin command) without touching the rotation position,
// so the normal clock wheel picks up right where it left off afterward.
function resolveForcedNext(forced) {
  if (forced.type === 'track') {
    return state.tracks.find((t) => t.id === forced.trackId) || null;
  }
  const candidates = tracksByCategory.get(forced.categoryId) || [];
  if (!candidates.length) return null;
  const lastPlayed = loadLastPlayed();
  let pool = candidates;
  if (candidates.length > 1) {
    const filtered = candidates.filter((t) => t.id !== lastPlayed[forced.categoryId]);
    if (filtered.length) pool = filtered;
  }
  const track = pool[Math.floor(Math.random() * pool.length)];
  saveLastPlayed({ ...lastPlayed, [forced.categoryId]: track.id });
  return track;
}

function pickNextTrack() {
  if (forcedNext) {
    const forced = forcedNext;
    forcedNext = null;
    const track = resolveForcedNext(forced);
    if (track) return track;
    // Requested category/track had nothing playable (e.g. deleted) — fall through to rotation.
  }
  if (!state.rotation.length || !state.tracks.length) return null;
  const result = selectNext(loadPos(), loadLastPlayed());
  savePos(result.pos);
  if (result.track) saveLastPlayed(result.lastPlayed);
  return result.track;
}

function previewUpNext(count) {
  if (!state.rotation.length || !state.tracks.length) return [];
  let pos = loadPos();
  let lastPlayed = loadLastPlayed();
  const preview = [];
  for (let i = 0; i < count; i++) {
    const result = selectNext(pos, lastPlayed);
    if (!result.track) break;
    preview.push(result.track);
    pos = result.pos;
    lastPlayed = result.lastPlayed;
  }
  return preview;
}

function reportNowPlaying(track) {
  const upNext = previewUpNext(UP_NEXT_PREVIEW_COUNT).map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    categoryId: t.categoryId,
  }));
  fetch('/api/now-playing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      current: { id: track.id, title: track.title, artist: track.artist, categoryId: track.categoryId, art: track.art },
      upNext,
      volume: Math.round(audio.volume * 100),
    }),
  }).catch(() => {});
}

// Lets the admin's remote volume control see what's actually playing — needed because a
// browser-source embed (e.g. TikTok Live Studio) has no way to reach the on-page slider.
function reportVolume() {
  fetch('/api/now-playing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volume: Math.round(audio.volume * 100) }),
  }).catch(() => {});
}

function renderTrack(track) {
  const category = categoryMap.get(track.categoryId);
  titleEl.textContent = track.title || 'Untitled';
  artistEl.textContent = track.artist || '';
  badgeEl.textContent = category?.name || '';
  badgeEl.style.background = category?.color || '#888';

  if (track.art) {
    artEl.src = `/media/art/${track.art}`;
    artEl.classList.add('visible');
  } else {
    artEl.removeAttribute('src');
    artEl.classList.remove('visible');
  }

  overlay.classList.remove('hidden');
  requestAnimationFrame(() => overlay.classList.add('visible'));
}

async function playNext() {
  const track = pickNextTrack();
  if (!track) {
    emptyEl.classList.remove('hidden');
    overlay.classList.add('hidden');
    // Nothing playable right now (e.g. rotation categories are all empty); check again shortly.
    setTimeout(refreshAndMaybePlay, 5000);
    return;
  }
  emptyEl.classList.add('hidden');
  currentTrack = track;
  audio.src = `/media/${track.filename}`;
  renderTrack(track);
  reportNowPlaying(track);
  try {
    await audio.play();
    startBtn.classList.add('hidden');
  } catch {
    startBtn.classList.remove('hidden');
  }
}

async function refreshAndMaybePlay() {
  await fetchState();
  if (!state.tracks.length) {
    emptyEl.classList.remove('hidden');
    overlay.classList.add('hidden');
    setTimeout(refreshAndMaybePlay, 5000);
    return;
  }
  if (!currentTrack && audio.paused) {
    playNext();
  }
}

audio.addEventListener('ended', playNext);
audio.addEventListener('error', () => {
  if (currentTrack) console.warn('Playback error, skipping track:', currentTrack.filename);
  playNext();
});
audio.addEventListener('timeupdate', () => {
  if (audio.duration) {
    progressFill.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
  }
});

startBtn.addEventListener('click', async () => {
  try {
    await audio.play();
    startBtn.classList.add('hidden');
  } catch (err) {
    console.error('Playback still blocked:', err);
  }
});

function loadVolume() {
  const raw = localStorage.getItem(VOLUME_KEY);
  if (raw === null) return 0.8;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.8;
}

function updateMuteIcon() {
  muteBtn.textContent = audio.volume === 0 ? '\u{1F507}' : '\u{1F50A}';
}

let lastNonZeroVolume = loadVolume() || 0.8;
audio.volume = loadVolume();
volumeSlider.value = String(Math.round(audio.volume * 100));
updateMuteIcon();

// Shared by the on-page slider/mute button and the admin's remote volume command, so all
// three paths stay consistent (persisted, mute-restore tracked, admin kept in sync).
function applyVolume(v) {
  audio.volume = Math.min(1, Math.max(0, v));
  if (audio.volume > 0) lastNonZeroVolume = audio.volume;
  volumeSlider.value = String(Math.round(audio.volume * 100));
  localStorage.setItem(VOLUME_KEY, String(audio.volume));
  updateMuteIcon();
}

volumeSlider.addEventListener('input', () => {
  applyVolume(Number(volumeSlider.value) / 100);
  reportVolume();
});

muteBtn.addEventListener('click', () => {
  applyVolume(audio.volume > 0 ? 0 : lastNonZeroVolume || 0.8);
  reportVolume();
});

// Lets the admin page skip, force a specific category/track to play next, or (since a
// browser-source embed like TikTok Live Studio can't reach the on-page slider) set volume.
async function pollCommand() {
  try {
    const res = await fetch('/api/command', { cache: 'no-store' });
    const { command } = await res.json();
    if (!command) return;
    if (command.type === 'skip') {
      playNext();
    } else if (command.type === 'play-category') {
      forcedNext = { type: 'category', categoryId: command.categoryId };
      playNext();
    } else if (command.type === 'play-track') {
      forcedNext = { type: 'track', trackId: command.trackId };
      playNext();
    } else if (command.type === 'set-volume') {
      applyVolume(Number(command.volume) / 100);
      reportVolume();
    }
  } catch {
    // best-effort; try again on the next poll
  }
}
setInterval(pollCommand, COMMAND_POLL_MS);

// Periodically pick up newly uploaded tracks / rotation edits without needing to reload the source.
setInterval(async () => {
  const previousRotationLength = state.rotation.length;
  await fetchState();
  if (previousRotationLength && state.rotation.length !== previousRotationLength) {
    savePos(loadPos() % state.rotation.length);
  }
}, STATE_REFRESH_MS);

(async function init() {
  await fetchState();
  if (!state.tracks.length) {
    emptyEl.classList.remove('hidden');
    setTimeout(refreshAndMaybePlay, 5000);
    return;
  }
  playNext();
})();
