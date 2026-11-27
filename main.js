'use strict';
/* Noobs Screener — Electron main process.
   Opens the app window, proxies HTTP requests for the renderer (so screener.in /
   Yahoo work without any CORS problems on desktop), and keeps the watchlist +
   data cache on disk so they survive restarts. */
const { app, BrowserWindow, ipcMain, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { createStore } = require('./main-store');

/* Portable build: keep app data next to the .exe, so the watchlist survives
   restarts and travels with the file. Read-only location -> fall back to the
   default %APPDATA% folder. Must run before the app is ready. */
(function setPortableDataDir() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (!portableDir) return;
  const dir = path.join(portableDir, 'Noobs-Screener-Data');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    app.setPath('userData', dir);
    app.setPath('sessionData', dir);
  } catch (e) { /* keep the default location */ }
})();

let store = null;

function registerIpc() {
  // Renderer -> main fetch proxy (Node has no CORS restrictions).
  ipcMain.handle('ns-fetch', async (_event, url) => {
    try {
      const res = await net.fetch(String(url));
      const body = await res.text();
      return { ok: res.ok, status: res.status, body };
    } catch (e) {
      return { ok: false, status: 0, body: '', error: String((e && e.message) || e) };
    }
  });

  // Persistent state (watchlist, theme, ...). Synchronous reads: the renderer
  // needs the watchlist while its scripts are still initialising.
  ipcMain.on('ns-state-get', (e, key) => { e.returnValue = store.stateGet(key); });
  ipcMain.on('ns-state-set', (e, key, value) => { store.stateSet(key, value); e.returnValue = true; });

  // Persistent data cache (price history, company financials).
  ipcMain.on('ns-cache-get', (e, key) => { e.returnValue = store.cacheGet(key); });
  ipcMain.on('ns-cache-set', (e, key, value) => { store.cacheSet(key, value); e.returnValue = true; });
  ipcMain.on('ns-cache-del', (e, key) => { store.cacheDel(key); e.returnValue = true; });
  ipcMain.on('ns-cache-clear', (e) => { store.cacheClear(); e.returnValue = true; });

  ipcMain.on('ns-store-info', (e) => {
    const info = store.info();
    e.returnValue = { dir: info.dir, cacheKeys: info.cacheKeys, cacheBytes: info.cacheBytes };
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 360,
    minHeight: 600,
    title: 'Noobs Screener',
    backgroundColor: '#f5f5f7',
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer/index.html'));
  // win.webContents.openDevTools(); // uncomment while debugging
}

app.whenReady().then(() => {
  try {
    store = createStore(app.getPath('userData'));
    store.trimCache();
  } catch (e) {
    // Extremely unlikely, but never leave the app without a store.
    store = createStore(path.join(app.getPath('temp') || '.', 'noobs-screener'));
  }
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Make sure nothing queued is lost when the window closes.
app.on('before-quit', () => { if (store) store.flush(); });
app.on('window-all-closed', () => {
  if (store) store.flush();
  if (process.platform !== 'darwin') app.quit();
});
