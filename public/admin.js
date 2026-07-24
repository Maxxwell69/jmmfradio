document.getElementById('player-url').textContent = `${location.origin}/player.html`;

let state = { categories: [], rotation: [], tracks: [] };
let localRotation = [];

async function api(path, options) {
  const res = await fetch(`/api${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function refresh() {
  state = await api('/state');
  localRotation = [...state.rotation];
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
  renderTracks();
}

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
}

function renderRotation() {
  const el = document.getElementById('rotation-list');
  const categoryMap = new Map(state.categories.map((c) => [c.id, c]));

  el.innerHTML = localRotation
    .map((id, i) => {
      const c = categoryMap.get(id);
      if (!c) return '';
      return `
      <span class="chip" style="background:${c.color}">
        ${i + 1}. ${escapeHtml(c.name)}
        <button type="button" data-move="${i}:-1" title="Move earlier" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
        <button type="button" data-move="${i}:1" title="Move later" ${i === localRotation.length - 1 ? 'disabled' : ''}>&darr;</button>
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
  el.querySelectorAll('[data-move]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [idxStr, dirStr] = btn.dataset.move.split(':');
      const idx = Number(idxStr);
      const dir = Number(dirStr);
      const target = idx + dir;
      if (target < 0 || target >= localRotation.length) return;
      [localRotation[idx], localRotation[target]] = [localRotation[target], localRotation[idx]];
      renderRotation();
    });
  });
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

refresh().catch((err) => alert(`Failed to load: ${err.message}`));
