'use strict';
/* Noobs Screener — Electron main process.
   Opens the app window, proxies HTTP requests for the renderer (so external
   data sources work without any CORS problems on desktop), and keeps the watchlist +
   data cache on disk so they survive restarts. */
const { app, BrowserWindow, ipcMain, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { createStore, copyLegacyLocalStorage } = require('./main-store');
const { fetchBlockReason } = require('./main-net');

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
    // bring the 1.0.0 profile over so its watchlist can be imported
    copyLegacyLocalStorage(path.join(app.getPath('appData'), app.getName()), dir);
  } catch (e) { /* keep the default location */ }
})();

let store = null;
let win = null;

function registerIpc() {
  // Renderer -> main fetch proxy (Node has no CORS restrictions).
  // Restricted to an allowlist (main-net.js): this must never become a
  // file:// reader or a LAN probe if injected script ever runs in the renderer.
  ipcMain.handle('ns-fetch', async (_event, url) => {
    const blocked = fetchBlockReason(url);
    if (blocked) return { ok: false, status: 0, body: '', error: 'blocked: ' + blocked };
    try {
      // hard deadline: a stalled connection must settle the IPC call, or the
      // renderer's skeleton waits forever (the renderer races its own timeout
      // too — this one just keeps main-process requests from piling up)
      const res = await net.fetch(String(url), { signal: AbortSignal.timeout(10000) });
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
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 360,
    minHeight: 600,
    title: 'Noobs Screener',
    backgroundColor: '#f5f5f7',
    show: false,          // avoids the white flash: shown once the page can paint
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  // Links (news headlines, filings, company site) open in the system browser —
  // never inside the app window and never as a bare Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (/^https?:\/\//i.test(url)) { event.preventDefault(); shell.openExternal(url); }
  });

  win.once('ready-to-show', function () { win.show(); });
  win.loadFile(path.join(__dirname, 'renderer/index.html'));
  // win.webContents.openDevTools(); // uncomment while debugging
}

/* Single instance: two copies of the app would share state.json and cache/ with
   independent in-memory copies — last writer wins, so a watchlist edit in one
   window could be erased by the other flushing. */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
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
}

// Make sure nothing queued is lost when the window closes.
app.on('before-quit', () => { if (store) store.flush(); });
app.on('window-all-closed', () => {
  if (store) store.flush();
  if (process.platform !== 'darwin') app.quit();
});
