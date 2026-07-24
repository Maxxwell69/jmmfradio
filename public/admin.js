document.getElementById('player-url').textContent = `${location.origin}/player.html`;

let state = { categories: [], rotation: [], tracks: [] };
let localRotation = [];
const DEFAULT_LAYOUT = { card: { x: 4, y: 78 }, logo: { x: 82, y: 4 } };
let localLayout = { card: { ...DEFAULT_LAYOUT.card }, logo: { ...DEFAULT_LAYOUT.logo } };

async function api(path, options) {
  const res = await fetch(`/api${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function refresh() {
  state = await api('/state');
  localRotation = [...state.rotation];
  if (state.layout) {
    localLayout = { card: { ...state.layout.card }, logo: { ...state.layout.logo } };
  }
  renderAll();
}

function categoryOptionsHtml(selectedId) {
  return state.categories
    .map((c) => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    .join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderAll() {
  renderCategoryChips();
  renderCategorySelects();
  renderRotation();
  renderLayout();
  renderTracks();
}

function renderLayout() {
  const cardEl = document.getElementById('layout-card');
  const logoEl = document.getElementById('layout-logo');
  cardEl.style.left = `${localLayout.card.x}%`;
  cardEl.style.top = `${localLayout.card.y}%`;
  logoEl.style.left = `${localLayout.logo.x}%`;
  logoEl.style.top = `${localLayout.logo.y}%`;
}

// Drag-to-reposition: the item's top-left corner follows the pointer directly within
// the canvas bounds. Simple "jump to cursor" behavior — good enough for a rough layout tool.
function makeDraggable(el, key) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const canvas = document.getElementById('layout-canvas');

    const onMove = (moveEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      const y = ((moveEvent.clientY - rect.top) / rect.height) * 100;
      localLayout[key] = {
        x: Math.round(Math.min(100, Math.max(0, x)) * 10) / 10,
        y: Math.round(Math.min(100, Math.max(0, y)) * 10) / 10,
      };
      renderLayout();
    };
    const onUp = () => {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  });
}
makeDraggable(document.getElementById('layout-card'), 'card');
makeDraggable(document.getElementById('layout-logo'), 'logo');

function renderCategoryChips() {
  const el = document.getElementById('category-list');
  const trackCounts = new Map();
  for (const t of state.tracks) trackCounts.set(t.categoryId, (trackCounts.get(t.categoryId) || 0) + 1);

  el.innerHTML = state.categories
    .map(
      (c) => `
      <span class="chip" style="background:${c.color}">
        ${escapeHtml(c.name)} (${trackCounts.get(c.id) || 0})
        <button type="button" data-delete-category="${c.id}" title="Delete category">&times;</button>
      </span>`
    )
    .join('');

  el.querySelectorAll('[data-delete-category]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/categories/${btn.dataset.deleteCategory}`, { method: 'DELETE' });
        await refresh();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

function renderCategorySelects() {
  document.getElementById('category-select').innerHTML = categoryOptionsHtml();
  document.getElementById('rotation-category-select').innerHTML = categoryOptionsHtml();
  document.getElementById('play-category-select').innerHTML = categoryOptionsHtml();

  const trackSelect = document.getElementById('play-track-select');
  trackSelect.innerHTML = state.tracks
    .map((t) => `<option value="${t.id}">${escapeHtml(t.title)}${t.artist ? ` — ${escapeHtml(t.artist)}` : ''}</option>`)
    .join('');
}

let dragFromIndex = null;

function renderRotation() {
  const el = document.getElementById('rotation-list');
  const categoryMap = new Map(state.categories.map((c) => [c.id, c]));

  el.innerHTML = localRotation
    .map((id, i) => {
      const c = categoryMap.get(id);
      if (!c) return '';
      return `
      <span class="chip drag-chip" style="background:${c.color}" draggable="true" data-index="${i}">
        <span class="drag-handle">&#8942;&#8942;</span>
        ${i + 1}. ${escapeHtml(c.name)}
        <button type="button" data-remove-rotation="${i}" title="Remove">&times;</button>
      </span>`;
    })
    .join('');

  el.querySelectorAll('[data-remove-rotation]').forEach((btn) => {
    btn.addEventListener('click', () => {
      localRotation.splice(Number(btn.dataset.removeRotation), 1);
      renderRotation();
    });
  });

  el.querySelectorAll('.drag-chip').forEach((chip) => {
    chip.addEventListener('dragstart', () => {
      dragFromIndex = Number(chip.dataset.index);
      chip.classList.add('dragging');
    });
    chip.addEventListener('dragend', () => {
      chip.classList.remove('dragging');
      dragFromIndex = null;
    });
    chip.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    chip.addEventListener('drop', (e) => {
      e.preventDefault();
      const targetIndex = Number(chip.dataset.index);
      if (dragFromIndex === null || dragFromIndex === targetIndex) return;
      const [moved] = localRotation.splice(dragFromIndex, 1);
      localRotation.splice(targetIndex, 0, moved);
      renderRotation();
    });
  });
}

function renderNowPlaying(np) {
  const categoryMap = new Map(state.categories.map((c) => [c.id, c]));
  const currentEl = document.getElementById('now-playing-current');

  if (np.current) {
    const c = categoryMap.get(np.current.categoryId);
    currentEl.innerHTML = `
      <span class="chip" style="background:${c?.color || '#888'}">${escapeHtml(c?.name || '')}</span>
      <strong>${escapeHtml(np.current.title)}</strong>
      ${np.current.artist ? `&mdash; ${escapeHtml(np.current.artist)}` : ''}
    `;
  } else {
    currentEl.textContent = 'Nothing reported yet — open the player page to start playback.';
  }

  const renderList = (el, items) => {
    el.innerHTML =
      items
        .map((t) => {
          const c = categoryMap.get(t.categoryId);
          return `<li><span class="chip" style="background:${c?.color || '#888'}">${escapeHtml(c?.name || '')}</span> ${escapeHtml(t.title)}${t.artist ? ` &mdash; ${escapeHtml(t.artist)}` : ''}</li>`;
        })
        .join('') || '<li class="np-empty">&mdash;</li>';
  };

  renderList(document.getElementById('up-next-list'), np.upNext || []);
  renderList(document.getElementById('history-list'), np.history || []);
}

async function pollNowPlaying() {
  try {
    renderNowPlaying(await api('/now-playing'));
  } catch {
    // best-effort; don't disrupt the rest of the admin UI over a missed poll
  }
}

function renderTracks() {
  const categoryMap = new Map(state.categories.map((c) => [c.id, c]));
  const tbody = document.getElementById('track-tbody');

  tbody.innerHTML = state.tracks
    .map(
      (t) => `
      <tr data-track="${t.id}">
        <td><input type="text" class="edit-title" value="${escapeHtml(t.title)}" /></td>
        <td><input type="text" class="edit-artist" value="${escapeHtml(t.artist || '')}" /></td>
        <td>
          <select class="edit-category">${categoryOptionsHtml(t.categoryId)}</select>
        </td>
        <td><button type="button" class="delete-track">Delete</button></td>
      </tr>`
    )
    .join('');

  tbody.querySelectorAll('tr').forEach((row) => {
    const id = row.dataset.track;

    row.querySelector('.edit-title').addEventListener('change', (e) =>
      api(`/tracks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: e.target.value }),
      }).catch((err) => alert(err.message))
    );
    row.querySelector('.edit-artist').addEventListener('change', (e) =>
      api(`/tracks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: e.target.value }),
      }).catch((err) => alert(err.message))
    );
    row.querySelector('.edit-category').addEventListener('change', (e) =>
      api(`/tracks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId: e.target.value }),
      })
        .then(refresh)
        .catch((err) => alert(err.message))
    );
    row.querySelector('.delete-track').addEventListener('click', async () => {
      if (!confirm('Delete this track?')) return;
      try {
        await api(`/tracks/${id}`, { method: 'DELETE' });
        await refresh();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

document.getElementById('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const statusEl = document.getElementById('upload-status');
  const formData = new FormData(form);
  if (!formData.get('file') || formData.get('file').size === 0) {
    statusEl.textContent = 'Choose a file first.';
    return;
  }
  statusEl.textContent = 'Uploading...';
  try {
    const res = await fetch('/api/tracks', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    statusEl.textContent = `Uploaded "${data.title}".`;
    form.reset();
    await refresh();
  } catch (err) {
    statusEl.textContent = err.message;
  }
});

document.getElementById('category-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-category-name').value;
  const color = document.getElementById('new-category-color').value;
  try {
    await api('/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color }),
    });
    e.target.reset();
    document.getElementById('new-category-color').value = '#4f7cff';
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('rotation-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const categoryId = document.getElementById('rotation-category-select').value;
  if (!categoryId) return;
  localRotation.push(categoryId);
  renderRotation();
});

document.getElementById('save-rotation').addEventListener('click', async () => {
  const statusEl = document.getElementById('rotation-status');
  try {
    await api('/rotation', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rotation: localRotation }),
    });
    statusEl.textContent = 'Saved.';
    await refresh();
    setTimeout(() => (statusEl.textContent = ''), 2000);
  } catch (err) {
    statusEl.textContent = err.message;
  }
});

async function sendCommand(body) {
  const statusEl = document.getElementById('command-status');
  try {
    await api('/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    statusEl.textContent = 'Sent — the player will pick it up within a couple seconds.';
    setTimeout(() => (statusEl.textContent = ''), 3000);
  } catch (err) {
    statusEl.textContent = err.message;
  }
}

document.getElementById('skip-btn').addEventListener('click', () => sendCommand({ type: 'skip' }));

document.getElementById('play-category-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const categoryId = document.getElementById('play-category-select').value;
  if (!categoryId) return;
  sendCommand({ type: 'play-category', categoryId });
});

document.getElementById('play-track-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const trackId = document.getElementById('play-track-select').value;
  if (!trackId) return;
  sendCommand({ type: 'play-track', trackId });
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' }).catch(() => {});
  location.href = '/';
});

document.getElementById('layout-reset').addEventListener('click', () => {
  localLayout = { card: { ...DEFAULT_LAYOUT.card }, logo: { ...DEFAULT_LAYOUT.logo } };
  renderLayout();
});

document.getElementById('layout-save').addEventListener('click', async () => {
  const statusEl = document.getElementById('layout-status');
  try {
    await api('/layout', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(localLayout),
    });
    statusEl.textContent = 'Saved.';
    setTimeout(() => (statusEl.textContent = ''), 2000);
  } catch (err) {
    statusEl.textContent = err.message;
  }
});

refresh().catch((err) => alert(`Failed to load: ${err.message}`));
pollNowPlaying();
setInterval(pollNowPlaying, 4000);
