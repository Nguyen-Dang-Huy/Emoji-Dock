const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const { clipboard, nativeImage, BrowserWindow } = require('electron');
const keySender = require('node-key-sender');
const { uIOhook, UiohookKey } = require('uiohook-napi');

const TERMINATORS = new Set([
  UiohookKey.Space,
  UiohookKey.Enter,
  UiohookKey.Tab
]);

const BACKSPACE = UiohookKey.Backspace;
let decoderWindow = null;
let decoderReadyPromise = null;

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

function isTerminator(event) {
  const keycode = event?.keycode;
  const rawcode = event?.rawcode;
  const keychar = event?.keychar;

  if (TERMINATORS.has(keycode)) {
    return true;
  }

  if (rawcode === 32 || rawcode === 13 || rawcode === 9) {
    return true;
  }

  if (keychar === 32 || keychar === 13 || keychar === 9) {
    return true;
  }

  return false;
}

function keyToChar(keycode, shiftKey) {
  if (typeof keycode !== 'number') {
    return '';
  }

  if (keycode >= UiohookKey.A && keycode <= UiohookKey.Z) {
    const charCode = keycode - UiohookKey.A + 97;
    const char = String.fromCharCode(charCode);
    return shiftKey ? char.toUpperCase() : char;
  }

  if (keycode >= UiohookKey.Digit1 && keycode <= UiohookKey.Digit0) {
    const map = ['1','2','3','4','5','6','7','8','9','0'];
    return map[keycode - UiohookKey.Digit1] ?? '';
  }

  if (keycode === UiohookKey.Minus) return '-';
  if (keycode === UiohookKey.Underscore) return '_';
  if (keycode === UiohookKey.Semicolon) return shiftKey ? ':' : ';';

  return '';
}

function copyImageToClipboard(absPath) {
  return loadNativeImageTriaged(absPath).then((image) => {
    if (image.isEmpty()) {
      return false;
    }

    writeImageToClipboard(image);
    return true;
  });
}

async function eraseTypedToken(length) {
  for (let i = 0; i < length; i += 1) {
    await keySender.sendKey('backspace');
  }
}

function createExpander({ findByAlias, onExpanded }) {
  let active = false;
  let buffer = '';

  async function tryExpand() {
    if (!active || !buffer.startsWith(':') || buffer.length < 2) {
      buffer = '';
      active = false;
      return;
    }

    const alias = buffer.slice(1).toLowerCase();
    const matched = findByAlias(alias);
    if (!matched) {
      return;
    }

    const copied = await copyImageToClipboard(path.resolve(matched.absolutePath));
    if (!copied) {
      return;
    }

    await eraseTypedToken(buffer.length);
    await keySender.sendCombination(['control', 'v']);
    if (typeof onExpanded === 'function') {
      onExpanded(matched);
    }
    buffer = '';
    active = false;
  }

  function onKeyDown(event) {
    const { keycode, shiftKey } = event;

    if (keycode === BACKSPACE || event?.rawcode === 8) {
      buffer = buffer.slice(0, -1);
      if (!buffer.startsWith(':')) {
        active = false;
      }
      return;
    }

    if (isTerminator(event)) {
      void tryExpand();
      return;
    }

    let char = '';
    if (typeof event.keychar === 'number' && event.keychar > 0) {
      char = String.fromCharCode(event.keychar);
    } else {
      char = keyToChar(keycode, !!shiftKey);
    }
    if (!char) {
      if (keycode === UiohookKey.Escape || event?.rawcode === 27) {
        active = false;
        buffer = '';
      }
      return;
    }

    if (!active && char === ':') {
      active = true;
      buffer = ':';
      return;
    }

    if (!active) {
      return;
    }

    if (!/[a-zA-Z0-9_-]/.test(char)) {
      active = false;
      buffer = '';
      return;
    }

    buffer += char.toLowerCase();

    if (buffer.length > 80) {
      active = false;
      buffer = '';
    }
  }

  function start() {
    uIOhook.on('keydown', onKeyDown);
    uIOhook.start();
  }

  function stop() {
    uIOhook.off('keydown', onKeyDown);
    uIOhook.stop();
  }

  return { start, stop };
}

module.exports = { createExpander };
