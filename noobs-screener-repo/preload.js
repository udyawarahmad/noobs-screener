'use strict';
/* Preload: safely exposes the main-process fetch proxy to the app page. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronFetch', (url) => ipcRenderer.invoke('ns-fetch', url));
