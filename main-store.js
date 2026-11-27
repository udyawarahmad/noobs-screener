'use strict';
/* Persistent store for the desktop app — plain Node, no Electron imports,
   so it can be unit-tested on its own.

   Why this exists: the app used to keep the watchlist and the data cache in
   localStorage, which has a ~5 MB per-origin quota. A full universe needs
   ~40 MB (17 MB of price history alone), so the quota filled up, every later
   write threw, `saveWL()` failed silently and the watchlist was empty after a
   restart. Here:

   - state.json         tiny key/value state (watchlist, theme, ...) — always writable
   - cache/<key>.json   one file per cached item, so no quota and no re-serialising
                        the whole cache on every write
*/
const fs = require('fs');
const path = require('path');

const CACHE_CAP_BYTES = 250 * 1024 * 1024; // trim oldest items only above this
const STATE_WRITE_DELAY = 300;
const CACHE_WRITE_DELAY = 1500;

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

/* Cache keys contain characters that are illegal in Windows file names
   (":" in "ch3:RELIANCE.NS"), so sanitise and add a hash to stay collision-free. */
function fileNameFor(key) {
  let safe = String(key).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  let h = 0;
  const s = String(key);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return safe + '.' + (h >>> 0).toString(36) + '.json';
}

function createStore(dataDir) {
  const stateFile = path.join(dataDir, 'state.json');
  const cacheDir = path.join(dataDir, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  let state = readJson(stateFile, {});
  if (typeof state !== 'object' || state === null) state = {};

  const mem = new Map();      // key -> {t, v} already loaded from disk
  const dirty = new Set();    // keys whose file needs writing
  let stateTimer = null;
  let cacheTimer = null;

  function flushState() {
    if (stateTimer) { clearTimeout(stateTimer); stateTimer = null; }
    try { writeJsonAtomic(stateFile, state); } catch (e) { /* read-only dir: ignore */ }
  }

  function flushCache() {
    if (cacheTimer) { clearTimeout(cacheTimer); cacheTimer = null; }
    dirty.forEach(function (key) {
      const rec = mem.get(key);
      const file = path.join(cacheDir, fileNameFor(key));
      try {
        if (rec == null) { if (fs.existsSync(file)) fs.unlinkSync(file); }
        else writeJsonAtomic(file, { k: key, t: rec.t, v: rec.v });
      } catch (e) { /* ignore individual write failures */ }
    });
    dirty.clear();
  }

  function flush() { flushState(); flushCache(); }

  function scheduleStateWrite() {
    if (stateTimer) clearTimeout(stateTimer);
    stateTimer = setTimeout(function () { stateTimer = null; flushState(); }, STATE_WRITE_DELAY);
    // never keep the process alive just for this timer
    if (stateTimer.unref) stateTimer.unref();
  }

  function scheduleCacheWrite() {
    if (cacheTimer) clearTimeout(cacheTimer);
    cacheTimer = setTimeout(function () { cacheTimer = null; flushCache(); }, CACHE_WRITE_DELAY);
    if (cacheTimer.unref) cacheTimer.unref();
  }

  function stateGet(key) {
    return Object.prototype.hasOwnProperty.call(state, String(key)) ? state[String(key)] : null;
  }

  function stateSet(key, value) {
    if (value === undefined) delete state[String(key)];
    else state[String(key)] = value;
    scheduleStateWrite();
    return true;
  }

  function cacheGet(key) {
    const k = String(key);
    if (mem.has(k)) return mem.get(k);
    const rec = readJson(path.join(cacheDir, fileNameFor(k)), null);
    // guard against a hash collision handing back a different key's record
    if (!rec || rec.k !== k) { mem.set(k, null); return null; }
    const out = { t: rec.t, v: rec.v };
    mem.set(k, out);
    return out;
  }

  function cacheSet(key, value) {
    const k = String(key);
    mem.set(k, { t: Date.now(), v: value });
    dirty.add(k);
    scheduleCacheWrite();
    return true;
  }

  function cacheDel(key) {
    const k = String(key);
    mem.set(k, null);
    dirty.add(k);
    scheduleCacheWrite();
    return true;
  }

  function cacheClear() {
    mem.forEach(function (_v, k) { dirty.add(k); mem.set(k, null); });
    try {
      fs.readdirSync(cacheDir).forEach(function (f) {
        if (/\.json$/.test(f)) { try { fs.unlinkSync(path.join(cacheDir, f)); } catch (e) {} }
      });
    } catch (e) {}
    dirty.clear();
    return true;
  }

  /* Keep the cache directory from growing without bound: drop the oldest files
     once it passes the cap. Called at startup, so it never stalls the UI. */
  function trimCache() {
    let files;
    try { files = fs.readdirSync(cacheDir); } catch (e) { return; }
    const items = [];
    let total = 0;
    files.forEach(function (f) {
      if (!/\.json$/.test(f)) return;
      const full = path.join(cacheDir, f);
      try {
        const st = fs.statSync(full);
        total += st.size;
        items.push({ full: full, size: st.size, mtime: st.mtimeMs });
      } catch (e) {}
    });
    if (total <= CACHE_CAP_BYTES) return;
    items.sort(function (a, b) { return a.mtime - b.mtime; });
    const target = CACHE_CAP_BYTES * 0.75;
    for (let i = 0; i < items.length && total > target; i++) {
      try { fs.unlinkSync(items[i].full); total -= items[i].size; } catch (e) {}
    }
  }

  function info() {
    let keys = 0, bytes = 0;
    try {
      fs.readdirSync(cacheDir).forEach(function (f) {
        if (!/\.json$/.test(f)) return;
        keys++;
        try { bytes += fs.statSync(path.join(cacheDir, f)).size; } catch (e) {}
      });
    } catch (e) {}
    return { dir: dataDir, state, cacheKeys: keys, cacheBytes: bytes };
  }

  return {
    dir: dataDir,
    stateGet: stateGet,
    stateSet: stateSet,
    cacheGet: cacheGet,
    cacheSet: cacheSet,
    cacheDel: cacheDel,
    cacheClear: cacheClear,
    trimCache: trimCache,
    info: info,
    flush: flush
  };
}

module.exports = { createStore: createStore, fileNameFor: fileNameFor };
