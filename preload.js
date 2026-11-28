'use strict';
/* Preload: safely exposes the main-process bridge to the app page. */
const { contextBridge, ipcRenderer } = require('electron');

// HTTP proxy — Node has no CORS restrictions.
contextBridge.exposeInMainWorld('electronFetch', (url) => ipcRenderer.invoke('ns-fetch', url));

// On-disk persistence: watchlist/theme + the live-data cache.
// (localStorage is capped at ~5 MB per origin, which the cache filled, so the
// watchlist stopped saving. These go to real files next to the app instead.)
contextBridge.exposeInMainWorld('nsStore', {
  stateGet: (key) => ipcRenderer.sendSync('ns-state-get', key),
  stateSet: (key, value) => ipcRenderer.send('ns-state-set', key, value),
  cacheGet: (key) => ipcRenderer.sendSync('ns-cache-get', key),
  cacheSet: (key, value) => ipcRenderer.send('ns-cache-set', key, value),
  cacheDel: (key) => ipcRenderer.send('ns-cache-del', key),
  cacheClear: () => ipcRenderer.send('ns-cache-clear'),
  info: () => ipcRenderer.sendSync('ns-store-info')
});
