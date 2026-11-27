'use strict';
/* Noobs Screener — Electron main process.
   Opens the app window and proxies HTTP requests for the renderer,
   so screener.in / Yahoo work without any CORS problems on desktop. */
const { app, BrowserWindow, ipcMain, net, shell } = require('electron');
const path = require('path');

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
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(String(url))) {
      shell.openExternal(String(url)).catch(() => {});
    }
    return { action: 'deny' };
  });
  win.loadFile(path.join(__dirname, 'renderer/index.html'));
  // win.webContents.openDevTools(); // uncomment while debugging
}

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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
