'use strict';
/* Persistence layer used by the app.
   - Desktop (Electron): goes through window.nsStore -> files in the app data
     folder. No quota, so the watchlist always saves and the data cache survives
     restarts (that cache filling localStorage's ~5 MB was wiping watchlists).
   - Plain website: falls back to localStorage.
   Keys keep the legacy 'screenone' prefix so existing watchlists carry over. */

var PStore = (function () {
  var bridge = null;
  try { if (typeof window !== 'undefined' && window.nsStore) bridge = window.nsStore; } catch (e) {}
  var mem = Object.create(null);   // 's:'+key = state, 'c:'+key = cached record {t,v}

  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } }

  /* -------- small persistent state: watchlist, theme, ... -------- */
  function getState(key, dflt) {
    var mk = 's:' + key;
    if (mk in mem) return mem[mk] === null ? dflt : mem[mk];
    var val = null;
    if (bridge) { try { val = bridge.stateGet(key); } catch (e) { val = null; } }
    if (val === null || val === undefined) {
      // one-time migration from builds that only had localStorage
      val = lsGet(key);
      if (val != null && bridge) { try { bridge.stateSet(key, val); } catch (e) {} }
    }
    mem[mk] = (val === undefined) ? null : val;
    return (val === null || val === undefined) ? dflt : val;
  }

  function setState(key, value) {
    mem['s:' + key] = value;
    if (bridge) { try { bridge.stateSet(key, value); } catch (e) {} return true; }
    return lsSet(key, value);
  }

  /* -------- live-data cache: price history, company pages -------- */
  function cacheGet(key) {
    var mk = 'c:' + key;
    if (mk in mem) return mem[mk];
    var rec = null;
    if (bridge) {
      try { rec = bridge.cacheGet(key); } catch (e) { rec = null; }
    } else {
      var raw = lsGet('screenone3:' + key);
      if (raw) { try { rec = JSON.parse(raw); } catch (e) { rec = null; } }
    }
    mem[mk] = rec || null;
    return mem[mk];
  }

  function cacheSet(key, value) {
    var rec = { t: Date.now(), v: value };
    mem['c:' + key] = rec;
    if (bridge) { try { bridge.cacheSet(key, value); } catch (e) {} return true; }
    try { return lsSet('screenone3:' + key, JSON.stringify(rec)); }
    catch (e) { return false; }
  }

  function cacheDel(key) {
    delete mem['c:' + key];
    if (bridge) { try { bridge.cacheDel(key); } catch (e) {} return; }
    try { localStorage.removeItem('screenone3:' + key); } catch (e) {}
  }

  /* Clear the data cache only — the watchlist and theme are never touched. */
  function cacheClear() {
    Object.keys(mem).forEach(function (k) { if (k.slice(0, 2) === 'c:') delete mem[k]; });
    if (bridge) { try { bridge.cacheClear(); } catch (e) {} return; }
    try {
      Object.keys(localStorage)
        .filter(function (x) { return x.indexOf('screenone3:') === 0; })
        .forEach(function (x) { localStorage.removeItem(x); });
    } catch (e) {}
  }

  function info() {
    if (bridge && bridge.info) { try { return bridge.info(); } catch (e) {} }
    return { dir: 'browser storage', cacheKeys: 0, cacheBytes: 0 };
  }

  return {
    isDisk: !!bridge,
    getState: getState,
    setState: setState,
    cacheGet: cacheGet,
    cacheSet: cacheSet,
    cacheDel: cacheDel,
    cacheClear: cacheClear,
    info: info
  };
})();
