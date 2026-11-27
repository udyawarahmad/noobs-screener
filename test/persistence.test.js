'use strict';
/* Persistence tests — run with `npm test` (plain Node, no dependencies).

   Covers the bug behind "watchlist is empty after restarting the app":
   the cache outgrew localStorage's quota, so the watchlist write threw. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createStore, fileNameFor, copyLegacyLocalStorage } = require('../main-store');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ns-store-')); }

/* Load renderer/store.js in a sandbox with optional bridge + fake localStorage. */
function loadRendererStore(opts) {
  opts = opts || {};
  const sandbox = { console: console };
  sandbox.window = sandbox;
  if (opts.bridge) sandbox.nsStore = opts.bridge;
  if (opts.localStorage) sandbox.localStorage = opts.localStorage;
  const code = fs.readFileSync(path.join(__dirname, '../renderer/store.js'), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: 'renderer/store.js' });
  return sandbox.PStore;
}

/* A bridge that behaves exactly like main.js/preload.js do. */
function bridgeFor(store) {
  return {
    stateGet: (k) => store.stateGet(k),
    stateSet: (k, v) => store.stateSet(k, v),
    cacheGet: (k) => store.cacheGet(k),
    cacheSet: (k, v) => store.cacheSet(k, v),
    cacheDel: (k) => store.cacheDel(k),
    cacheClear: () => store.cacheClear(),
    info: () => store.info()
  };
}

/* Simplified localStorage with Chromium's ~5 MB per-origin quota.
   A Proxy so `Object.keys(localStorage)` lists the stored keys, like the real thing. */
function fakeLocalStorage(quotaBytes) {
  const data = new Map();
  const used = () => { let n = 0; data.forEach((v, k) => { n += k.length + String(v).length; }); return n; };
  const api = {
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) {
      const next = used() - ((data.get(k) || '').length + k.length) + String(v).length + k.length;
      if (next > quotaBytes) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      data.set(k, String(v));
    },
    removeItem(k) { data.delete(k); },
    key(i) { return Array.from(data.keys())[i]; },
    get length() { return data.size; },
    _data: data
  };
  return new Proxy(api, {
    get(t, p) {
      if (p === 'length') return data.size;
      if (p in t) return t[p];
      return data.has(p) ? data.get(p) : undefined;
    },
    ownKeys() { return Array.from(data.keys()); },
    getOwnPropertyDescriptor(t, p) {
      if (data.has(p)) return { value: data.get(p), enumerable: true, configurable: true };
      return Object.getOwnPropertyDescriptor(t, p);
    }
  });
}

console.log('\nmain-store (disk)');
test('watchlist survives a restart', () => {
  const dir = tmpDir();
  const a = createStore(dir);
  a.stateSet('screenone_wl', JSON.stringify(['RELIANCE']));
  a.flush();
  const b = createStore(dir);                 // fresh "app launch"
  assert.strictEqual(b.stateGet('screenone_wl'), '["RELIANCE"]');
});

test('cache stores and reads records with timestamps', () => {
  const dir = tmpDir();
  const a = createStore(dir);
  a.cacheSet('ch3:RELIANCE.NS', { price: 2900, pts: [1, 2, 3] });
  const rec = a.cacheGet('ch3:RELIANCE.NS');
  assert.strictEqual(rec.v.price, 2900);
  assert.ok(Date.now() - rec.t < 5000);
  a.flush();
  const b = createStore(dir);
  assert.strictEqual(b.cacheGet('ch3:RELIANCE.NS').v.price, 2900);
});

test('cache keys with ":" map to safe file names and never collide', () => {
  const a = fileNameFor('ch3:RELIANCE.NS');
  const b = fileNameFor('ch3_RELIANCE.NS');
  assert.ok(!a.includes(':'), 'no colon in file name');
  assert.notStrictEqual(a, b, 'sanitised keys must stay distinct');
});

test('clearing the cache keeps the watchlist', () => {
  const dir = tmpDir();
  const a = createStore(dir);
  a.stateSet('screenone_wl', '["TCS"]');
  a.cacheSet('co:TCS', { name: 'TCS' });
  a.cacheClear();
  assert.strictEqual(a.stateGet('screenone_wl'), '["TCS"]');
  assert.strictEqual(a.cacheGet('co:TCS'), null);
  a.flush();
  assert.strictEqual(createStore(dir).stateGet('screenone_wl'), '["TCS"]');
});

test('persists a full universe of price history (several times the localStorage quota)', () => {
  const dir = tmpDir();
  const a = createStore(dir);
  // same shape as a real 5-year daily chart: ~100 KB per stock
  const big = {
    price: 2900.5,
    pts: Array.from({ length: 1250 }, (_, i) => ({ t: 1600000000000 + i * 86400000, c: 2500.25 + i, o: 2501.5, h: 2530.75, l: 2470.5, v: 1234567 }))
  };
  for (let i = 0; i < 160; i++) a.cacheSet('ch3:SYM' + i + '.NS', big);
  a.flush();
  const bytes = fs.readdirSync(path.join(dir, 'cache')).reduce((n, f) => n + fs.statSync(path.join(dir, 'cache', f)).size, 0);
  assert.ok(bytes > 12 * 1024 * 1024, 'wrote only ' + bytes + ' bytes');
  const b = createStore(dir);
  assert.ok(b.cacheGet('ch3:SYM159.NS').v.pts.length === 1250);
});

test('portable 1.0.1 imports the 1.0.0 profile from %APPDATA% once', () => {
  const legacy = tmpDir();
  fs.mkdirSync(path.join(legacy, 'Local Storage', 'leveldb'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'Local Storage', 'leveldb', '000001.log'), 'old-watchlist');
  const fresh = tmpDir();
  assert.strictEqual(copyLegacyLocalStorage(legacy, fresh), true);
  assert.strictEqual(fs.readFileSync(path.join(fresh, 'Local Storage', 'leveldb', '000001.log'), 'utf8'), 'old-watchlist');
  assert.strictEqual(copyLegacyLocalStorage(legacy, fresh), false, 'must not copy twice');
  assert.strictEqual(copyLegacyLocalStorage(legacy, legacy), false, 'same dir is a no-op');
});

console.log('\nrenderer PStore');

test('desktop: add to watchlist, reopen app -> watchlist still there', () => {
  const dir = tmpDir();
  // first launch
  let store = createStore(dir);
  let P = loadRendererStore({ bridge: bridgeFor(store) });
  P.setState('screenone_wl', JSON.stringify(['RELIANCE', 'INFY']));
  store.flush();
  // reopen
  store = createStore(dir);
  P = loadRendererStore({ bridge: bridgeFor(store) });
  assert.deepStrictEqual(JSON.parse(P.getState('screenone_wl', '[]')), ['RELIANCE', 'INFY']);
});

test('desktop: watchlist still saves when the cache is huge', () => {
  const dir = tmpDir();
  const store = createStore(dir);
  const P = loadRendererStore({ bridge: bridgeFor(store) });
  const big = { pts: Array.from({ length: 1250 }, (_, i) => ({ t: i, c: 100 + i, o: 1, h: 2, l: 0, v: 5 })) };
  for (let i = 0; i < 160; i++) P.cacheSet('ch3:SYM' + i + '.NS', big);   // ~40 MB of cache
  P.setState('screenone_wl', JSON.stringify(['TCS']));
  store.flush();
  assert.strictEqual(JSON.parse(loadRendererStore({ bridge: bridgeFor(createStore(dir)) }).getState('screenone_wl', '[]'))[0], 'TCS');
});

test('desktop: cache clear leaves watchlist and theme alone', () => {
  const dir = tmpDir();
  const store = createStore(dir);
  const P = loadRendererStore({ bridge: bridgeFor(store) });
  P.setState('screenone_wl', '["ITC"]');
  P.setState('screenone_theme', 'dark');
  P.cacheSet('co:ITC', { name: 'ITC' });
  P.cacheClear();
  store.flush();
  const P2 = loadRendererStore({ bridge: bridgeFor(createStore(dir)) });
  assert.strictEqual(P2.getState('screenone_wl', '[]'), '["ITC"]');
  assert.strictEqual(P2.getState('screenone_theme', ''), 'dark');
  assert.strictEqual(P2.cacheGet('co:ITC'), null);
});

test('web fallback: uses localStorage when there is no bridge', () => {
  const ls = fakeLocalStorage(5 * 1024 * 1024);
  const P = loadRendererStore({ localStorage: ls });
  P.setState('screenone_wl', '["HDFCBANK"]');
  assert.strictEqual(P.getState('screenone_wl', '[]'), '["HDFCBANK"]');
  P.cacheSet('co:HDFCBANK', { name: 'HDFC Bank' });
  assert.strictEqual(P.cacheGet('co:HDFCBANK').v.name, 'HDFC Bank');
});

test('migration: watchlist from an old localStorage-only build is imported once', () => {
  const dir = tmpDir();
  const store = createStore(dir);
  const ls = fakeLocalStorage(5 * 1024 * 1024);
  ls.setItem('screenone_wl', '["SBIN"]');            // left by version 1.0.0
  const P = loadRendererStore({ bridge: bridgeFor(store), localStorage: ls });
  assert.deepStrictEqual(JSON.parse(P.getState('screenone_wl', '[]')), ['SBIN']);
  store.flush();
  assert.strictEqual(createStore(dir).stateGet('screenone_wl'), '["SBIN"]');
});

test('regression: the localStorage quota silently stopped the cache saving', () => {
  const ls = fakeLocalStorage(5 * 1024 * 1024);
  const P = loadRendererStore({ localStorage: ls });
  const big = {
    price: 2900.5,
    pts: Array.from({ length: 1250 }, (_, i) => ({ t: 1600000000000 + i * 86400000, c: 2500.25 + i, o: 2501.5, h: 2530.75, l: 2470.5, v: 1234567 }))
  };
  let written = 0;
  for (let i = 0; i < 160; i++) if (P.cacheSet('ch3:SYM' + i + '.NS', big)) written++;
  assert.ok(written < 160, 'expected the quota to bite, but every write succeeded');
  // -> on the next launch almost nothing is cached, so all 160 pages are
  //    re-downloaded: that is the "app is slow" half of the bug report.
});

test('regression: the old cache-clear wiped the watchlist and theme', () => {
  const ls = fakeLocalStorage(5 * 1024 * 1024);
  ls.setItem('screenone_wl', '["RELIANCE"]');
  ls.setItem('screenone_theme', 'dark');
  ls.setItem('screenone3:co:TCS', '{}');
  // what version 1.0.0 did on the Refresh button
  Object.keys(ls).filter((x) => x.indexOf('screenone') === 0).forEach((x) => ls.removeItem(x));
  assert.strictEqual(ls.getItem('screenone_wl'), null, 'watchlist was deleted');
  assert.strictEqual(ls.getItem('screenone_theme'), null, 'theme was deleted');

  // what the fixed version does
  const P = loadRendererStore({ localStorage: ls });
  P.setState('screenone_wl', '["RELIANCE"]');
  P.setState('screenone_theme', 'dark');
  P.cacheSet('co:TCS', {});
  P.cacheClear();
  assert.strictEqual(ls.getItem('screenone_wl'), '["RELIANCE"]');
  assert.strictEqual(ls.getItem('screenone_theme'), 'dark');
  assert.strictEqual(ls.getItem('screenone3:co:TCS'), null);
});

console.log(failures ? '\n' + failures + ' test(s) failed\n' : '\nAll tests passed\n');
process.exit(failures ? 1 : 0);
