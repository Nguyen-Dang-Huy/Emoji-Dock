const searchInput = document.getElementById('searchInput');
const listEl = document.getElementById('list');
const statusEl = document.getElementById('status');
const closeButton = document.getElementById('closeButton');
const settingsButton = document.getElementById('settingsButton');
const quitButton = document.getElementById('quitButton');
const favoritesListEl = document.getElementById('favoritesList');
const recentListEl = document.getElementById('recentList');
const settingsModalEl = document.getElementById('settingsModal');
const settingsRowsEl = document.getElementById('settingsRows');
const settingsAddRowEl = document.getElementById('settingsAddRow');
const settingsImportEl = document.getElementById('settingsImport');
const settingsClearImportedEl = document.getElementById('settingsClearImported');
const settingsSaveEl = document.getElementById('settingsSave');
const settingsCloseButtonEl = document.getElementById('settingsCloseButton');
const settingsStatusEl = document.getElementById('settingsStatus');

let allItems = [];
let items = [];
let activeIndex = 0;
let favorites = new Set();
let recent = [];
let baseAliases = [];
let currentPage = 0;
const itemsPerPage = 100;

const aliasDatalistId = 'base-alias-list';
const paginationEl = document.getElementById('pagination');
const pageInfoEl = document.getElementById('pageInfo');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');

function normalizeAlias(value) {
  return String(value || '').trim().replace(/^:/, '').toLowerCase();
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

function normalizeInput(value) {
  return (value || '').trim();
}

async function loadData() {
  allItems = await window.emojiApi.getAll();
  baseAliases = await window.emojiApi.getBaseAliases();

  const state = await window.emojiApi.getState();
  favorites = new Set((state.favorites || []).map(normalizeAlias));
  recent = (state.recent || []).map(normalizeAlias);

  items = allItems;
  await renderQuickLists();
  render(items);
  setStatus(`Ready: ${allItems.length} emojis indexed`);
}

function setSettingsStatus(text, isError = false) {
  settingsStatusEl.textContent = text;
  settingsStatusEl.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

function ensureAliasDatalist() {
  let datalist = document.getElementById(aliasDatalistId);
  if (datalist) {
    datalist.innerHTML = '';
  } else {
    datalist = document.createElement('datalist');
    datalist.id = aliasDatalistId;
    document.body.appendChild(datalist);
  }

  baseAliases.forEach((entry) => {
    const option = document.createElement('option');
    option.value = entry.alias;
    option.label = `${entry.name} (${entry.group})`;
    datalist.appendChild(option);
  });
}

function createSettingsRow(shortAlias = '', targetAlias = '') {
  const row = document.createElement('div');
  row.className = 'settings-row';
  row.innerHTML = `
    <input data-role="short" placeholder="short alias (ff)" value="${shortAlias}" />
    <input data-role="target" list="${aliasDatalistId}" placeholder="target alias" value="${targetAlias}" />
    <button type="button" data-role="remove">Remove</button>
  `;

  const removeBtn = row.querySelector('[data-role="remove"]');
  removeBtn.addEventListener('click', () => {
    row.remove();
    if (settingsRowsEl.children.length === 0) {
      settingsRowsEl.appendChild(createSettingsRow());
    }
  });

  return row;
}

function readSettingsForm() {
  const rows = settingsRowsEl.querySelectorAll('.settings-row');
  const mappings = {};

  rows.forEach((row) => {
    const shortInput = row.querySelector('[data-role="short"]');
    const targetInput = row.querySelector('[data-role="target"]');

    const shortAlias = normalizeAlias(shortInput.value);
    const targetAlias = normalizeAlias(targetInput.value);

    if (!shortAlias || !targetAlias) {
      return;
    }

    mappings[shortAlias] = targetAlias;
  });

  return mappings;
}

async function openSettings() {
  ensureAliasDatalist();
  settingsRowsEl.innerHTML = '';
  setSettingsStatus('Loading custom aliases...');

  const mappings = await window.emojiApi.getCustomAliases();
  const entries = Object.entries(mappings || {});

  if (entries.length === 0) {
    settingsRowsEl.appendChild(createSettingsRow());
  } else {
    entries.forEach(([shortAlias, targetAlias]) => {
      settingsRowsEl.appendChild(createSettingsRow(shortAlias, targetAlias));
    });
  }

  settingsModalEl.classList.remove('hidden');
  settingsModalEl.setAttribute('aria-hidden', 'false');
  setSettingsStatus('Edit mappings then click Save.');
}

function closeSettings() {
  settingsModalEl.classList.add('hidden');
  settingsModalEl.setAttribute('aria-hidden', 'true');
}

function restoreSearchInteraction() {
  closeSettings();
  searchInput.disabled = false;
  searchInput.style.pointerEvents = 'auto';
  setTimeout(() => {
    searchInput.focus();
  }, 0);
}

async function saveSettings() {
  const mappings = readSettingsForm();
  const result = await window.emojiApi.saveCustomAliases(mappings);
  if (!result.ok) {
    const message = Array.isArray(result.errors) && result.errors.length > 0
      ? result.errors[0]
      : 'Failed to save custom aliases';
    setSettingsStatus(message, true);
    return;
  }

  await loadData();
  await search();
  setSettingsStatus('Saved. New aliases are active now.');
}

async function importEmojis() {
  setSettingsStatus('Choosing images to import...');
  console.log('[import] Starting import...');
  const result = await window.emojiApi.importEmojis();
  console.log('[import] Result:', result);

  if (!result || result.canceled) {
    setSettingsStatus('Import canceled.');
    console.log('[import] Import was canceled');
    return;
  }

  if (!result.ok) {
    const message = Array.isArray(result.errors) && result.errors.length > 0
      ? result.errors[0]
      : 'Failed to import emojis';
    setSettingsStatus(message, true);
    console.error('[import] Error:', message);
    return;
  }

  try {
    console.log('[import] Loading data...');
    await loadData();
    console.log('[import] Data loaded, all items count:', allItems.length);
    
    await search();
    console.log('[import] Search completed');
    
    const count = result.imported ? result.imported.length : 0;
    if (count > 0) {
      setSettingsStatus(`Imported ${count} emoji(s). Modal will close...`);
      console.log('[import] Import successful, closing modal...');
    } else {
      setSettingsStatus(result.message || 'This file is already in your imported list.');
      console.log('[import] No new files imported:', result.skipped || []);
    }
    
    // Close modal after 1 second to show success message
    setTimeout(() => {
      if (count > 0) {
        closeSettings();
        setStatus(`Ready: ${allItems.length} emojis indexed`);
        restoreSearchInteraction();
      }
    }, 1000);
  } catch (error) {
    console.error('[import] Error during reload:', error);
    setSettingsStatus('Error reloading emojis: ' + String(error?.message || error), true);
  }
}

async function clearImportedEmojis() {
  const confirmed = window.confirm('Clear all imported emojis? This removes imported files and only removes favorites/recent entries that belong to those imported emojis.');
  if (!confirmed) {
    return;
  }

  const favoriteItemsBeforeClear = await window.emojiApi.getByAliases(Array.from(favorites));
  const recentItemsBeforeClear = await window.emojiApi.getByAliases(recent);
  const preservedFavorites = favoriteItemsBeforeClear
    .filter((item) => !item.isImported)
    .map((item) => normalizeAlias(item.canonicalAlias || item.alias));
  const preservedRecent = recentItemsBeforeClear
    .filter((item) => !item.isImported)
    .map((item) => normalizeAlias(item.canonicalAlias || item.alias));

  setSettingsStatus('Clearing imported emojis...');
  const result = await window.emojiApi.clearImportedEmojis();

  if (!result || !result.ok) {
    const message = result?.error || 'Failed to clear imported emojis';
    setSettingsStatus(message, true);
    return;
  }

  currentPage = 0;
  activeIndex = 0;
  await window.emojiApi.setState({
    favorites: preservedFavorites,
    recent: preservedRecent
  });
  await loadData();
  await search();
  await renderQuickLists();
  setSettingsStatus('Imported emojis cleared. You can import again from the folder you want.');
}

function createCard(item, index) {
  const card = document.createElement('div');
  card.className = `card ${index === activeIndex ? 'active' : ''}`;
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.dataset.alias = item.alias;

  const image = document.createElement('img');
  image.className = 'thumb';
  image.src = item.fileUrl;
  image.alt = item.name;
  image.loading = 'lazy';

  const meta = document.createElement('div');
  meta.className = 'meta';

  const alias = document.createElement('span');
  alias.className = 'alias';
  alias.textContent = `:${item.alias}`;

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = item.name;

  const fav = document.createElement('button');
  fav.type = 'button';
  fav.className = `fav-btn ${favorites.has(normalizeAlias(item.canonicalAlias || item.alias)) ? 'on' : ''}`;
  fav.dataset.role = 'favorite';
  fav.title = 'Toggle favorite';
  fav.textContent = '*';

  let deleteBtn = null;
  if (item.isImported) {
    deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-btn';
    deleteBtn.dataset.role = 'delete';
    deleteBtn.title = 'Delete imported emoji';
    deleteBtn.textContent = '×';
  }

  meta.appendChild(alias);
  meta.appendChild(name);
  card.appendChild(image);
  card.appendChild(meta);
  card.appendChild(fav);
  if (deleteBtn) {
    card.appendChild(deleteBtn);
  }

  card.addEventListener('click', async (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.dataset.role === 'favorite') {
      event.preventDefault();
      event.stopPropagation();
      await toggleFavorite(item);
      return;
    }

    if (target instanceof HTMLElement && target.dataset.role === 'delete') {
      event.preventDefault();
      event.stopPropagation();
      await deleteImported(item);
      return;
    }

    await pick(item.alias);
  });

  card.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      await pick(item.alias);
    }
  });

  return card;
}

async function deleteImported(item) {
  const alias = normalizeAlias(item.canonicalAlias || item.alias);
  const result = await window.emojiApi.deleteImportedEmoji(alias);
  if (!result || !result.ok) {
    const message = result?.reason === 'not_imported'
      ? 'This emoji is not imported.'
      : result?.reason === 'file_delete_failed'
        ? `Delete failed: ${result.error || 'file delete failed'}`
        : 'Delete failed.';
    setStatus(message, true);
    restoreSearchInteraction();
    return;
  }

  currentPage = 0;
  activeIndex = 0;
  await loadData();
  await search();
  setStatus(`Deleted :${alias}`);
  restoreSearchInteraction();
}

function createQuickItem(item) {
  const button = document.createElement('button');
  button.className = 'quick-item';
  button.type = 'button';
  button.title = `:${item.alias}`;
  button.innerHTML = `<img src="${item.fileUrl}" alt="${item.name}" loading="lazy" />`;
  button.addEventListener('click', async () => {
    await pick(item.alias);
  });
  return button;
}

async function renderQuickLists() {
  const favoriteItems = await window.emojiApi.getByAliases(Array.from(favorites));
  const recentItems = await window.emojiApi.getByAliases(recent);

  favoritesListEl.innerHTML = '';
  recentListEl.innerHTML = '';

  if (favoriteItems.length === 0) {
    favoritesListEl.innerHTML = '<span class="status">No favorites yet</span>';
  } else {
    const frag = document.createDocumentFragment();
    favoriteItems.forEach((item) => frag.appendChild(createQuickItem(item)));
    favoritesListEl.appendChild(frag);
  }

  if (recentItems.length === 0) {
    recentListEl.innerHTML = '<span class="status">No recent picks yet</span>';
  } else {
    const frag = document.createDocumentFragment();
    recentItems.forEach((item) => frag.appendChild(createQuickItem(item)));
    recentListEl.appendChild(frag);
  }
}

function render(list) {
  listEl.innerHTML = '';

  const totalPages = Math.max(1, Math.ceil(list.length / itemsPerPage));

  if (currentPage >= totalPages) {
    currentPage = totalPages - 1;
  }

  const startIndex = currentPage * itemsPerPage;
  const pageItems = list.slice(startIndex, startIndex + itemsPerPage);

  if (list.length === 0) {
    paginationEl.classList.add('hidden');
    pageInfoEl.textContent = 'Page 1 of 1';
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
    setStatus('No results. Try another alias keyword.');
    return;
  }

  if (list.length > itemsPerPage) {
    paginationEl.classList.remove('hidden');
    pageInfoEl.textContent = `Page ${currentPage + 1} of ${totalPages}`;
    prevPageBtn.disabled = currentPage === 0;
    nextPageBtn.disabled = currentPage === totalPages - 1;
  } else {
    paginationEl.classList.add('hidden');
  }

  const fragment = document.createDocumentFragment();
  pageItems.forEach((item, index) => {
    fragment.appendChild(createCard(item, index));
  });

  listEl.appendChild(fragment);
}

async function search() {
  const query = normalizeInput(searchInput.value);
  const result = await window.emojiApi.search(query);
  items = result;
  currentPage = 0;
  activeIndex = 0;
  render(items);
  setStatus(`${items.length} results`);
}

async function pick(alias) {
  const result = await window.emojiApi.pick(alias);
  if (!result.ok) {
    setStatus(`Cannot pick :${alias} (${result.reason})`, true);
    return;
  }

  const state = await window.emojiApi.getState();
  recent = (state.recent || []).map(normalizeAlias);
  await renderQuickLists();

  setStatus(`Copied :${result.alias} to clipboard image. Press Ctrl+V in target app.`);
}

async function toggleFavorite(item) {
  const alias = normalizeAlias(item.canonicalAlias || item.alias);
  const state = await window.emojiApi.toggleFavorite(alias);
  favorites = new Set((state.favorites || []).map(normalizeAlias));
  await renderQuickLists();
  render(items);
}

function moveActive(delta) {
  if (items.length === 0) {
    return;
  }

  const startIndex = currentPage * itemsPerPage;
  const pageItems = items.slice(startIndex, startIndex + itemsPerPage);

  if (pageItems.length === 0) {
    return;
  }

  activeIndex = (activeIndex + delta + pageItems.length) % pageItems.length;
  render(items);

  const active = listEl.querySelector('.card.active');
  if (active) {
    active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

searchInput.addEventListener('input', () => {
  void search();
});

searchInput.addEventListener('keydown', async (event) => {
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    moveActive(1);
    return;
  }

  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    moveActive(-1);
    return;
  }

  if (event.key === 'Enter' && items[activeIndex]) {
    event.preventDefault();
    const startIndex = currentPage * itemsPerPage;
    const pageItems = items.slice(startIndex, startIndex + itemsPerPage);
    if (pageItems[activeIndex]) {
      await pick(pageItems[activeIndex].alias);
    }
  }
});

closeButton.addEventListener('click', async () => {
  await window.emojiApi.hide();
});

quitButton.addEventListener('click', async () => {
  await window.emojiApi.quitApp();
});

settingsButton.addEventListener('click', () => {
  void openSettings();
});

settingsCloseButtonEl.addEventListener('click', () => {
  closeSettings();
});

settingsAddRowEl.addEventListener('click', () => {
  settingsRowsEl.appendChild(createSettingsRow());
});

prevPageBtn.addEventListener('click', () => {
  if (currentPage > 0) {
    currentPage -= 1;
    activeIndex = 0;
    render(items);
  }
});

nextPageBtn.addEventListener('click', () => {
  const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
  if (currentPage < totalPages - 1) {
    currentPage += 1;
    activeIndex = 0;
    render(items);
  }
});

settingsImportEl.addEventListener('click', () => {
  void importEmojis();
});

settingsClearImportedEl.addEventListener('click', () => {
  void clearImportedEmojis();
});

settingsSaveEl.addEventListener('click', () => {
  void saveSettings();
});

settingsModalEl.addEventListener('click', (event) => {
  if (event.target === settingsModalEl) {
    closeSettings();
  }
});

document.addEventListener('keydown', async (event) => {
  if (event.key !== 'Escape') {
    return;
  }

  if (!settingsModalEl.classList.contains('hidden')) {
    closeSettings();
    return;
  }

  await window.emojiApi.hide();
});

window.emojiApi.onExternalOpen(() => {
  closeSettings();
  searchInput.value = '';
  currentPage = 0;
  activeIndex = 0;
  void search();
  void renderQuickLists();
  setTimeout(() => searchInput.focus(), 20);
});

void loadData();
