'use strict';
/* Renderer smoke test — boots the real index.html in jsdom and checks that the
   app starts, paints, and wires up without throwing.

   Network is stubbed to fail, which exercises the error paths too (a broken
   error path is still a crash the user would see). */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { createStore } = require('../main-store');

const ROOT = path.join(__dirname, '..');

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

/* Canvas isn't implemented in jsdom; give the chart code a no-op 2D context. */
function fakeCanvas() {
  const store = {};
  return new Proxy(store, {
    get(t, p) {
      if (p === 'measureText') return () => ({ width: 8 });
      if (p === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (p === 'canvas') return { width: 800, height: 300 };
      if (p in t) return t[p];
      return () => {};
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}

async function boot(opts) {
  opts = opts || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-smoke-'));
  const store = createStore(dir);
  if (opts.watchlist) store.stateSet('screenone_wl', JSON.stringify(opts.watchlist));
  if (opts.theme) store.stateSet('screenone_theme', opts.theme);

  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
  virtualConsole.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  const html = fs.readFileSync(path.join(ROOT, 'renderer/index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'file://' + path.join(ROOT, 'renderer/index.html'),
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = () => fakeCanvas();
      window.IntersectionObserver = class { constructor() {} observe() {} unobserve() {} disconnect() {} };
      window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
      window.nsStore = {
        stateGet: (k) => store.stateGet(k),
        stateSet: (k, v) => store.stateSet(k, v),
        cacheGet: (k) => store.cacheGet(k),
        cacheSet: (k, v) => store.cacheSet(k, v),
        cacheDel: (k) => store.cacheDel(k),
        cacheClear: () => store.cacheClear(),
        info: () => store.info()
      };
      window.electronFetch = async () => ({ ok: false, status: 0, body: '', error: 'offline (test)' });
      window.fetch = async () => { throw new Error('offline (test)'); };
      window.addEventListener('error', (e) => errors.push('window.error: ' + (e.message || e.error)));
      window.addEventListener('unhandledrejection', (e) => errors.push('unhandledrejection: ' + (e.reason && e.reason.message)));
    }
  });

  // let DOMContentLoaded, the deferred index render and the hero load settle
  await new Promise((r) => setTimeout(r, 900));
  return { dom, window: dom.window, doc: dom.window.document, store, errors, dir };
}

(async function main() {
  console.log('\nbooting the app');

  let app;
  await test('index.html boots with no uncaught errors', async () => {
    app = await boot({ watchlist: ['RELIANCE', 'TCS'] });
    const real = app.errors.filter((e) => !/offline \(test\)|Not implemented|Could not load/i.test(e));
    assert.strictEqual(real.length, 0, 'errors: ' + JSON.stringify(real.slice(0, 5)));
    assert.ok(app.window.S, 'app state should exist');
  });

  await test('watchlist from disk is painted on startup', () => {
    const txt = app.doc.getElementById('watchlistRow').textContent;
    assert.ok(/RELIANCE/.test(txt), 'watchlist row should list RELIANCE, looked like: ' + txt.slice(0, 120));
    assert.ok(/2 watching/.test(app.doc.getElementById('watchCount').textContent), 'count shown');
  });

  await test('starring a stock persists it to disk immediately', () => {
    app.window.toggleWL('INFY');
    const saved = JSON.parse(app.store.stateGet('screenone_wl'));
    assert.ok(saved.includes('INFY'), 'INFY should be saved: ' + JSON.stringify(saved));
    assert.ok(saved.includes('RELIANCE'), 'existing entries kept');
  });

  await test('theme toggle persists', () => {
    app.window.setTheme('dark');
    assert.strictEqual(app.store.stateGet('screenone_theme'), 'dark');
    assert.strictEqual(app.doc.documentElement.getAttribute('data-theme'), 'dark');
  });

  await test('startup does not bulk-load all 160 stocks', () => {
    // the lazy loader leaves this hint until the screener card is scrolled to
    const txt = app.doc.getElementById('loadTxt').textContent;
    assert.ok(/loads when this section is in view|cached and up to date/.test(txt),
      'unexpected load hint: ' + txt);
  });

  await test('desktop build switches off the expensive backdrop blur', () => {
    assert.ok(app.doc.body.classList.contains('native'), 'body.native should be set when running on disk');
  });

  console.log('\nnews card');

  await test('renders headlines with safe external links', () => {
    const now = Date.now();
    app.window.paintNews({
      source: 'Google News',
      items: [
        { title: 'Reliance Industries Q2 profit up 8%', link: 'https://example.com/a', source: 'Mint', t: now - 90 * 60000 },
        { title: 'Reliance Industries to invest in green energy', link: 'https://example.com/b', source: 'BS', t: now - 3 * 3600000 }
      ]
    });
    const box = app.doc.getElementById('newsList');
    const links = box.querySelectorAll('a.news-item');
    assert.strictEqual(links.length, 2);
    assert.strictEqual(links[0].getAttribute('href'), 'https://example.com/a');
    assert.strictEqual(links[0].getAttribute('target'), '_blank');
    assert.ok(/noopener/.test(links[0].getAttribute('rel')));
    assert.ok(/1h ago/.test(box.textContent) && /3h ago/.test(box.textContent), 'relative times shown: ' + box.textContent);
    const now2 = Date.now();
    assert.strictEqual(app.window.timeAgo(now2 - 30 * 1000), 'just now');
    assert.strictEqual(app.window.timeAgo(now2 - 5 * 60000), '5m ago');
    assert.strictEqual(app.window.timeAgo(now2 - 50 * 3600000), '2d ago');
    assert.strictEqual(app.window.timeAgo(null), '');
    assert.ok(/Google News/.test(app.doc.getElementById('newsTag').textContent));
  });

  await test('shows a clear empty state instead of unrelated news', () => {
    app.window.paintNews({ source: '', items: [] });
    const txt = app.doc.getElementById('newsList').textContent;
    assert.ok(/No recent headlines/.test(txt), txt.slice(0, 120));
  });

  await test('news only accepts http(s) links', () => {
    const { parseNewsXml } = app.window;
    const items = parseNewsXml('<rss><channel><item><title>Reliance Industries hacked</title><link>javascript:alert(1)</link></item></channel></rss>');
    assert.strictEqual(items.length, 0);
  });

  console.log(failures ? '\n' + failures + ' test(s) failed\n' : '\nAll tests passed\n');
  process.exit(failures ? 1 : 0);
})();
