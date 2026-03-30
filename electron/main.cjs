const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');

const KV_DIR = path.join(app.getPath('userData'), 'kv');

function ensureKvDir() {
  if (!fs.existsSync(KV_DIR)) fs.mkdirSync(KV_DIR, { recursive: true });
}

// -- IPC handlers for kvStorage -----------------------------------------------

ipcMain.handle('kv:get', (_event, key) => {
  ensureKvDir();
  const filePath = path.join(KV_DIR, `${key}.bin`);
  if (!fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  return Array.from(new Uint8Array(buffer));
});

ipcMain.handle('kv:set', (_event, key, value) => {
  ensureKvDir();
  const filePath = path.join(KV_DIR, `${key}.bin`);
  fs.writeFileSync(filePath, Buffer.from(new Uint8Array(value)));
});

ipcMain.handle('kv:remove', (_event, key) => {
  ensureKvDir();
  const filePath = path.join(KV_DIR, `${key}.bin`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
});

// -- CORS handling for API domains --------------------------------------------

const API_DOMAINS = ['api.anthropic.com', 'account.philosophers.group'];

function setupCors() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const url = new URL(details.url);
    if (!API_DOMAINS.includes(url.hostname)) {
      return callback({ cancel: false });
    }
    const headers = { ...details.responseHeaders };
    headers['access-control-allow-origin'] = ['*'];
    headers['access-control-allow-headers'] = ['*'];
    headers['access-control-allow-methods'] = ['GET, POST, PUT, DELETE, OPTIONS'];
    callback({ responseHeaders: headers });
  });
}

// -- Window creation ----------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 700,
    minWidth: 360,
    minHeight: 500,
    title: '1111 Learn',
    icon: path.join(__dirname, '..', 'dist', 'assets', 'icon-256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the built web app
  const htmlPath = path.join(__dirname, '..', 'dist', 'sidepanel.html');
  win.loadFile(htmlPath);
}

app.whenReady().then(() => {
  setupCors();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
