const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const { app, BrowserWindow, globalShortcut, ipcMain, clipboard, nativeImage, Tray, Menu, dialog } = require('electron');

const emojiIndex = require('./emoji-index');
const { createExpander } = require('./global-expander');

let mainWindow = null;
let expander = null;
let tray = null;
let pickerState = { favorites: [], recent: [] };
let activeGlobalShortcut = null;
let isQuitting = false;
let decoderWindow = null;
let decoderReadyPromise = null;

app.setPath('userData', path.join(app.getPath('appData'), 'EmojiDock'));

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
}

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  toggleWindow(true);
});

app.on('before-quit', () => {
  isQuitting = true;
});

function createTrayIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect x="6" y="6" width="52" height="52" rx="14" fill="#102735"/><circle cx="24" cy="26" r="4" fill="#63e8cb"/><circle cx="40" cy="26" r="4" fill="#63e8cb"/><path d="M20 40c3.4 4.5 7.4 6.5 12 6.5s8.6-2 12-6.5" stroke="#63e8cb" stroke-width="4" stroke-linecap="round" fill="none"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function createTray() {
  try {
    tray = new Tray(createTrayIcon());
    tray.setToolTip('Emoji Dock');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Emoji Dock', click: () => toggleWindow(true) },
      { label: 'Quit', click: () => app.quit() }
    ]));

    tray.on('double-click', () => {
      toggleWindow(true);
    });
  } catch (error) {
    console.warn('Failed to create tray icon:', error);
  }
}

function statePath() {
  return path.join(app.getPath('userData'), 'picker-state.json');
}

function normalizeAlias(value) {
  return String(value || '').trim().replace(/^:/, '').toLowerCase();
}

function loadPickerState() {
  const file = statePath();
  if (!fs.existsSync(file)) {
    return;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    pickerState = {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites.map(normalizeAlias).filter(Boolean) : [],
      recent: Array.isArray(parsed.recent) ? parsed.recent.map(normalizeAlias).filter(Boolean) : []
    };
  } catch {
    pickerState = { favorites: [], recent: [] };
  }
}

function savePickerState() {
  const file = statePath();
  fs.writeFileSync(file, JSON.stringify(pickerState, null, 2), 'utf-8');
}

function setPickerState(partial) {
  const nextFavorites = Array.isArray(partial?.favorites)
    ? partial.favorites.map(normalizeAlias).filter(Boolean)
    : pickerState.favorites;
  const nextRecent = Array.isArray(partial?.recent)
    ? partial.recent.map(normalizeAlias).filter(Boolean)
    : pickerState.recent;

  pickerState = {
    favorites: Array.from(new Set(nextFavorites)),
    recent: Array.from(new Set(nextRecent)).slice(0, 30)
  };

  savePickerState();
  return pickerState;
}

function stableAlias(item) {
  return normalizeAlias(item?.canonicalAlias || item?.alias || '');
}

function markRecent(item) {
  const alias = stableAlias(item);
  if (!alias) {
    return;
  }

  pickerState.recent = [alias, ...pickerState.recent.filter((entry) => entry !== alias)].slice(0, 30);
  savePickerState();
}

function toggleFavorite(alias) {
  const normalized = normalizeAlias(alias);
  if (!normalized) {
    return pickerState.favorites;
  }

  if (pickerState.favorites.includes(normalized)) {
    pickerState.favorites = pickerState.favorites.filter((entry) => entry !== normalized);
  } else {
    pickerState.favorites = [normalized, ...pickerState.favorites];
  }

  savePickerState();
  return pickerState.favorites;
}

function resolveWithAbsolute(item) {
  const absolutePath = emojiIndex.toAbsolutePath(item.path);
  return {
    ...item,
    absolutePath,
    fileUrl: pathToFileURL(absolutePath).href
  };
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  return 'application/octet-stream';
}

function loadNativeImageSafe(filePath) {
  let image = nativeImage.createFromPath(filePath);
  if (!image.isEmpty()) {
    return image;
  }

  if (!fs.existsSync(filePath)) {
    return image;
  }

  try {
    const data = fs.readFileSync(filePath);

    image = nativeImage.createFromBuffer(data);
    if (!image.isEmpty()) {
      return image;
    }

    const mime = mimeFromPath(filePath);
    const dataUrl = `data:${mime};base64,${data.toString('base64')}`;
    image = nativeImage.createFromDataURL(dataUrl);
  } catch {
    // Return whatever state image has after fallbacks.
  }

  return image;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createDecoderWindow() {
  if (decoderWindow && !decoderWindow.isDestroyed()) {
    return decoderWindow;
  }

  decoderWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false,
      webSecurity: false,
      offscreen: true,
      backgroundThrottling: false
    }
  });

  decoderWindow.on('closed', () => {
    decoderWindow = null;
    decoderReadyPromise = null;
  });

  const html = `<!doctype html>
  <html>
    <body>
      <script>
        window.decodeToPng = async (fileUrl) => {
          const img = new Image();
          img.decoding = 'async';
          img.src = fileUrl;
          await img.decode();

          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width || 1;
          canvas.height = img.naturalHeight || img.height || 1;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          return canvas.toDataURL('image/png');
        };
      </script>
    </body>
  </html>`;

  decoderReadyPromise = decoderWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return decoderWindow;
}

async function decodeImageViaBrowser(filePath) {
  try {
    const win = createDecoderWindow();
    if (decoderReadyPromise) {
      await decoderReadyPromise;
    }
    const fileUrl = pathToFileURL(filePath).href;
    const script = `window.decodeToPng(${JSON.stringify(fileUrl)})`;
    const dataUrl = await win.webContents.executeJavaScript(script, true);
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) {
      return nativeImage.createFromDataURL(dataUrl);
    }
  } catch (error) {
    console.warn('Browser decode fallback failed for', filePath, error);
  }

  return nativeImage.createEmpty();
}

async function loadNativeImageTriaged(filePath) {
  const primary = loadNativeImageSafe(filePath);
  if (!primary.isEmpty()) {
    return primary;
  }

  return decodeImageViaBrowser(filePath);
}

function writeImageToClipboard(image) {
  const pngBuffer = image.toPNG();
  clipboard.writeBuffer('PNG', pngBuffer);
  clipboard.writeImage(nativeImage.createFromBuffer(pngBuffer));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 640,
    show: false,
    frame: true,
    title: 'Emoji Dock',
    resizable: true,
    movable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    transparent: false,
    backgroundColor: '#0b1a25',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    toggleWindow(true);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html')).catch((error) => {
    console.error('Failed to load renderer:', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL('data:text/html,<h2>Emoji Dock failed to load UI.</h2><p>Please reinstall or run from source.</p>');
      mainWindow.show();
    }
  });
}

function toggleWindow(forceShow = false) {
  if (!mainWindow) {
    return;
  }

  if (!forceShow && mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.center();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('picker:open');
  }
}

function registerShortcuts() {
  const candidates = ['Control+Shift+Space', 'Control+Alt+Space', 'Alt+Shift+E'];
  for (const candidate of candidates) {
    const ok = globalShortcut.register(candidate, () => {
      toggleWindow();
    });

    if (ok) {
      activeGlobalShortcut = candidate;
      console.info(`Registered global shortcut: ${candidate}`);
      return;
    }
  }

  console.warn('Failed to register any global shortcut candidate');
}

function setupIpc() {
  ipcMain.handle('emoji:getAll', () => {
    return emojiIndex.getAll().map(resolveWithAbsolute);
  });

  ipcMain.handle('emoji:search', (_, query) => {
    return emojiIndex.search(query).map(resolveWithAbsolute);
  });

  ipcMain.handle('emoji:pick', async (_, alias) => {
    const normalized = normalizeAlias(alias);
    const found = emojiIndex.getByAlias(normalized);

    if (!found) {
      return { ok: false, reason: 'not_found' };
    }

    const abs = emojiIndex.toAbsolutePath(found.path);
    const image = await loadNativeImageTriaged(abs);
    if (image.isEmpty()) {
      return { ok: false, reason: 'image_load_failed' };
    }

    writeImageToClipboard(image);
    markRecent(found);
    return { ok: true, alias: found.alias, path: abs };
  });

  ipcMain.handle('emoji:getByAliases', (_, aliases) => {
    return emojiIndex.getByAliases(aliases).map(resolveWithAbsolute);
  });

  ipcMain.handle('emoji:getBaseAliases', () => {
    return emojiIndex.getBaseAliases();
  });

  ipcMain.handle('settings:getCustomAliases', () => {
    return emojiIndex.getCustomAliases();
  });

  ipcMain.handle('settings:saveCustomAliases', (_, mappings) => {
    return emojiIndex.writeCustomAliasMappings(mappings);
  });

  ipcMain.handle('emoji:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: 'Import emoji images',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [
        { name: 'Images', extensions: ['png', 'webp', 'jpg', 'jpeg', 'gif'] }
      ]
    });

    if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    return emojiIndex.importEmojiPaths(result.filePaths);
  });

  ipcMain.handle('emoji:deleteImported', (_, alias) => {
    const result = emojiIndex.deleteImportedEmoji(alias);

    if (result.ok) {
      pickerState.favorites = pickerState.favorites.filter((entry) => entry !== normalizeAlias(alias));
      pickerState.recent = pickerState.recent.filter((entry) => entry !== normalizeAlias(alias));
      savePickerState();
    }

    return result;
  });

  ipcMain.handle('emoji:clearImported', () => {
    const importedFavoriteAliases = new Set(
      pickerState.favorites
        .map((entry) => normalizeAlias(entry))
        .filter((alias) => {
          const item = emojiIndex.getByAlias(alias);
          return Boolean(item && item.isImported);
        })
    );
    const importedRecentAliases = new Set(
      pickerState.recent
        .map((entry) => normalizeAlias(entry))
        .filter((alias) => {
          const item = emojiIndex.getByAlias(alias);
          return Boolean(item && item.isImported);
        })
    );

    const result = emojiIndex.clearImportedEmojiStorage();

    if (result.ok) {
      pickerState.favorites = pickerState.favorites.filter((entry) => !importedFavoriteAliases.has(normalizeAlias(entry)));
      pickerState.recent = pickerState.recent.filter((entry) => !importedRecentAliases.has(normalizeAlias(entry)));
      savePickerState();
    }

    return result;
  });

  ipcMain.handle('state:get', () => {
    return pickerState;
  });

  ipcMain.handle('state:toggleFavorite', (_, alias) => {
    return { favorites: toggleFavorite(alias) };
  });

  ipcMain.handle('state:set', (_, partial) => {
    return setPickerState(partial || {});
  });

  ipcMain.handle('picker:hide', () => {
    mainWindow?.hide();
    return { ok: true };
  });

  ipcMain.handle('app:quit', () => {
    isQuitting = true;
    try {
      if (tray) {
        tray.destroy();
        tray = null;
      }
      if (expander) {
        expander.stop();
      }
      if (decoderWindow && !decoderWindow.isDestroyed()) {
        decoderWindow.destroy();
        decoderWindow = null;
      }
    } finally {
      app.quit();
    }
    return { ok: true };
  });
}

app.whenReady().then(() => {
  loadPickerState();
  setupIpc();
  createWindow();
  createTray();
  registerShortcuts();

  expander = createExpander({
    findByAlias: (alias) => {
      const found = emojiIndex.getByAlias(alias);
      return found ? resolveWithAbsolute(found) : null;
    },
    onExpanded: (item) => {
      markRecent(item);
    }
  });

  expander.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (expander) {
    expander.stop();
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
  if (decoderWindow && !decoderWindow.isDestroyed()) {
    decoderWindow.destroy();
    decoderWindow = null;
  }
});

app.on('window-all-closed', (event) => {
  if (!isQuitting) {
    event.preventDefault();
  }
});
