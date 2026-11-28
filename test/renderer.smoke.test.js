'use strict';
/* Renderer smoke test — boots the real index.html in jsdom and checks that the
   app starts, paints, and wires up without throwing.

   Network is stubbed to fail, which exercises the error paths too (a broken
   error path is still a crash the user would see). */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const zlib = require('zlib');
const { createStore } = require('../main-store');

/* jsdom (via undici) needs Node 22+; skip rather than fail on older runtimes. */
if (typeof zlib.createZstdDecompress !== 'function') {
  console.log('\nskipped: the renderer smoke test needs Node 22+ (found ' + process.version + ')\n');
  process.exit(0);
}
const { JSDOM, VirtualConsole } = require('jsdom');

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
    // pathToFileURL: on Windows "file://C:\..." is not a valid URL
    url: pathToFileURL(path.join(ROOT, 'renderer/index.html')).href,
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

  console.log('\ntime machine (valuation + backtest)');

  /* a compact but internally consistent company: 6 fiscal years of statements */
  function fixtureCompany(sym, name, np, priceStart, priceEnd) {
    const years = ['Mar 2021', 'Mar 2022', 'Mar 2023', 'Mar 2024', 'Mar 2025', 'Mar 2026'];
    const row = (label, vals) => ({ label, vals: vals.map(String), nums: vals.map(Number) });
    const pts = [];
    for (let i = 0; i <= 240; i++) {
      const t = Date.UTC(2023, 0, 1) + i * 5 * 86400000;
      pts.push({ t, c: priceStart + (priceEnd - priceStart) * i / 240 });
    }
    return {
      C: {
        sym, name,
        fund: { fv: 1, pe: 20, bv: 100 },
        pnl: {
          cols: years.concat(['TTM']),
          rows: [
            row('Sales', [100, 110, 120, 130, 140, 150, 155]),
            row('Operating Profit', [20, 22, 24, 26, 28, 30, 31]),
            row('OPM %', [20, 20, 20, 20, 20, 20, 20]),
            row('Net Profit', np.concat([np[np.length - 1] + 2])),
            row('EPS in Rs', np.map(v => v / 10).concat([(np[np.length - 1] + 2) / 10])),
            row('Dividend Payout %', [20, 20, 20, 20, 20, 20, 20])
          ]
        },
        bs: {
          cols: years,
          rows: [
            row('Equity Capital', [100, 100, 100, 100, 100, 100]),
            row('Reserves', [400, 450, 500, 550, 600, 650]),
            row('Borrowings', [50, 45, 40, 35, 30, 25])
          ]
        },
        rat: { cols: years, rows: [row('ROCE %', [18, 19, 20, 21, 22, 23])] }
      },
      chart: { pts }
    };
  }

  await test('valuation card shows P/E, P/B and a percentile chip', () => {
    const f = fixtureCompany('TCS', 'Tata Consultancy Services', [100, 110, 120, 130, 140, 150], 2000, 3000);
    app.window.CO['TCS'] = f.C;
    app.window.renderVal(f.C, f.chart);
    const grid = app.doc.getElementById('valGrid');
    assert.ok(/P\/E/.test(grid.textContent) && /P\/B/.test(grid.textContent), 'both multiples shown');
    assert.ok(/×/.test(grid.textContent), 'value has a multiple: ' + grid.textContent.slice(0, 120));
    assert.ok(/chip /.test(grid.innerHTML), 'a percentile chip is rendered');
    assert.ok(/cheaper than|in line|dearer than/.test(grid.textContent), 'chip wording: ' + grid.textContent);
    assert.ok(/shares/.test(app.doc.getElementById('valNote').textContent), 'method note explains the share basis');
  });

  await test('valuation card degrades gracefully without price history', () => {
    const f = fixtureCompany('X', 'X Ltd', [10, 10, 10, 10, 10, 10], 100, 100);
    app.window.renderVal(f.C, null);
    const grid = app.doc.getElementById('valGrid');
    assert.ok(/Not enough/.test(grid.textContent), 'fallback message: ' + grid.textContent.slice(0, 80));
  });

  await test('valuation maths never returns impossible numbers', () => {
    const f = fixtureCompany('Y', 'Y Ltd', [50, 60, 70, 80, 90, 100], 500, 900);
    const v = app.window.valForCompany(f.C, f.chart);
    assert.ok(isFinite(v.pe.now) && v.pe.now > 0, 'P/E finite');
    assert.ok(isFinite(v.pb.now) && v.pb.now > 0, 'P/B finite');
    assert.ok(v.pe.p20 <= v.pe.median && v.pe.median <= v.pe.p80, 'P/E bands ordered');
    assert.ok(v.pe.percentile >= 0 && v.pe.percentile <= 100, 'percentile in range');
  });

  await test('backtest KPIs and stock table render from a result', () => {
    app.window.renderBacktest({
      count: 3, universe: 160, avgReturn: 40, cagr: 12.5, benchReturn: 20, benchCagr: 6.3,
      maxDrawdown: -18.4, hitRate: 66.7, years: 3,
      picks: [
        { sym: 'A', name: 'Alpha Ltd', ret: 80, pe: 18, roe: 22 },
        { sym: 'B', name: 'Beta Ltd', ret: 20, pe: 25, roe: 15 },
        { sym: 'C', name: 'Gamma Ltd', ret: -10, pe: 30, roe: 9 }
      ]
    }, 3);
    const out = app.doc.getElementById('btOut');
    assert.ok(/Stocks passing\s*3 \/ 160/.test(out.textContent.replace(/\s+/g, ' ')), 'coverage shown: ' + out.textContent.slice(0, 140));
    assert.ok(/\+12\.5%/.test(out.textContent), 'CAGR shown');
    assert.ok(/vs NIFTY/.test(out.textContent) && /\+6\.2 pp/.test(out.textContent), 'alpha vs NIFTY: ' + out.textContent.slice(0, 200));
    assert.ok(/-18\.4%/.test(out.textContent), 'drawdown shown');
    assert.strictEqual(out.querySelectorAll('tbody tr').length, 3, 'picks table rows');
    assert.ok(/Gamma/.test(out.textContent));
  });

  await test('backtest explains an empty result instead of showing zeros', () => {
    app.window.renderBacktest({ count: 0, universe: 160, picks: [] }, 3);
    const out = app.doc.getElementById('btOut');
    assert.ok(/No stock in the universe passed/.test(out.textContent), out.textContent.slice(0, 100));
  });

  await test('runBacktest end-to-end over a stubbed universe', async () => {
    const a = fixtureCompany('AAA', 'Alpha Ltd', [100, 110, 120, 130, 140, 150], 100, 200);  // strong
    const b = fixtureCompany('BBB', 'Beta Ltd', [90, 95, 100, 105, 110, 115], 200, 150);     // falling
    app.window.CO['AAA'] = a.C; app.window.CO['BBB'] = b.C;
    app.window.CH['AAA.NS'] = a.chart; app.window.CH['BBB.NS'] = b.chart;
    app.window.ACTIVE_UNIVERSE.push({ sym: 'AAA', y: 'AAA.NS', sec: 'IT', n: 'Alpha Ltd' });
    app.window.ACTIVE_UNIVERSE.push({ sym: 'BBB', y: 'BBB.NS', sec: 'IT', n: 'Beta Ltd' });
    app.window._screenerKicked = true;   // don't kick a real 160-stock load
    app.window._loadingAll = false;
    app.window.S.scr = Object.assign({}, app.window.S.scr, { peMax: 1000, q: '', sector: 'ALL', onlyWL: false });

    await app.window.runBacktest();
    const out = app.doc.getElementById('btOut').textContent;
    assert.ok(/Stocks passing\s*2 \/ 2/.test(out.replace(/\s+/g, ' ')), 'both stubs selected: ' + out.slice(0, 160));
    assert.ok(/CAGR/.test(out), 'CAGR row present');
    assert.ok(/Alpha Ltd/.test(out), 'winner listed');
    assert.strictEqual(app.doc.getElementById('btRun').disabled, false, 'button re-enabled');
  });

  console.log(failures ? '\n' + failures + ' test(s) failed\n' : '\nAll tests passed\n');
  process.exit(failures ? 1 : 0);
})();
