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
      // jsdom doesn't implement scrolling — selectStock()/openSlug() call it
      window.Element.prototype.scrollIntoView = function () {};
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

  console.log('\nregression: P0/P1 fixes');

  await test('quarterly growth is true YoY (step 4), not QoQ mislabelled', () => {
    const row = (label, vals) => ({ label, vals: vals.map(String), nums: vals.map(Number) });
    const quarters = {
      cols: ['Jun 2024', 'Sep 2024', 'Dec 2024', 'Mar 2025', 'Jun 2025', 'Sep 2025', 'Dec 2025', 'Mar 2026'],
      rows: [row('Sales', [100, 110, 120, 130, 140, 150, 160, 170])]
    };
    const h = app.window.finTableHTML(quarters, { cols: 8, growth: true, growthStep: 4, first: 'Metric' });
    const subs = [...h.matchAll(/>([+-][\d.]+% YoY)</g)].map((m) => m[1]);
    assert.strictEqual(subs.length, 4, 'growth under the last 4 quarters only: ' + subs.join(' '));
    assert.strictEqual(subs[0], '+40.0% YoY', 'Jun 2025 vs Jun 2024 must be year-on-year');
    assert.ok(!/\+10\.0% YoY/.test(h), 'QoQ numbers must never be labelled YoY');
    // annual tables keep the step-1 default: previous year = YoY
    const annual = { cols: ['Mar 2024', 'Mar 2025'], rows: [row('Sales', [100, 150])] };
    const ah = app.window.finTableHTML(annual, { cols: 2, growth: true });
    assert.ok(/\+50\.0% YoY/.test(ah), 'annual YoY still works');
  });

  await test('the real quarterly card passes growthStep: 4', () => {
    // guard against a future edit dropping the option at the call site
    const src = require('fs').readFileSync(require('path').join(__dirname, '../renderer/app.js'), 'utf8');
    const m = src.match(/finTableHTML\(C\.quarters,[^)]*\)/);
    assert.ok(m, 'quarterly call site found');
    assert.ok(/growthStep:\s*4/.test(m[0]), 'call site must pass growthStep:4 — got: ' + m[0]);
  });

  await test('search dropdown rows stay clickable after a remote-results append (B2)', () => {
    const si = app.doc.getElementById('searchInput');
    si.value = 'REL';
    app.window.renderSearchDrop('REL');
    const box = app.doc.getElementById('searchDrop');
    assert.ok(box.querySelectorAll('.sd-row[data-sym]').length > 0, 'curated rows rendered');
    // exactly what the async screener.in search does to the box
    box.innerHTML += '<div class="sd-empty">More from screener.in</div>' +
      '<div class="sd-row" data-slug="EXTRA" data-name="Extra Ltd"><div><b>Extra Ltd</b></div></div>';
    const opened = [];
    const origSelect = app.window.selectStock;
    const origOpen = app.window.openSlug;
    app.window.selectStock = (s) => opened.push(['stock', s]);
    app.window.openSlug = (s) => opened.push(['slug', s]);
    try {
      box.querySelector('.sd-row[data-sym]').dispatchEvent(new app.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      box.querySelector('.sd-row[data-slug]').dispatchEvent(new app.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    } finally {
      app.window.selectStock = origSelect;
      app.window.openSlug = origOpen;
    }
    assert.strictEqual(opened.length, 2, 'both rows must respond: ' + JSON.stringify(opened));
    assert.strictEqual(opened[0][0], 'stock');
    assert.strictEqual(opened[1][0], 'slug');
    assert.strictEqual(opened[1][1], 'EXTRA');
    si.value = '';
    app.window.renderSearchDrop('');
  });

  await test('symbols are escaped in the screener table — no attribute breakout (B4)', () => {
    // huge market cap so the row sorts to page 1 of the default mcap-desc sort
    app.window.ACTIVE_UNIVERSE.push({ sym: 'E"VIL', y: 'E.NS', sec: 'IT', n: 'Evil Corp' });
    app.window.CO['E"VIL'] = {
      sym: 'E"VIL', name: 'Evil Corp', sector: 'IT',
      fund: { mcap: 9e9, pe: 5, roe: 50, roce: 60, dy: 3, de: 0, gs: 30, gp: 30, opm: 40, price: 100, fv: 10 }
    };
    try {
      app.window.renderScreener();
      const html = app.doc.getElementById('screenTable').innerHTML;
      assert.ok(!/data-sym="E"VIL/.test(html), 'raw quote must not break out of the attribute');
      assert.ok(/data-sym="E&quot;VIL"/.test(html), 'escaped quote expected in: ' + html.slice(0, 400));
      assert.ok(/Evil Corp/.test(html), 'the row is actually rendered');
    } finally {
      app.window.ACTIVE_UNIVERSE.pop();
      delete app.window.CO['E"VIL'];
      app.window.renderScreener();
    }
  });

  await test('openSlug rejects hostile slugs from the remote search (B4)', () => {
    const keysBefore = Object.keys(app.window.UNI).length;
    app.window.openSlug('x" onmouseover="alert(1)', 'Evil');
    app.window.openSlug('javascript:alert(1)', 'Evil');
    app.window.openSlug('<img src=x onerror=alert(1)>', 'Evil');
    assert.strictEqual(Object.keys(app.window.UNI).length, keysBefore, 'no UNI entry created');
    assert.ok(!app.window.selectStock('x" ONMOUSEOVER="ALERT(1)'), 'selectStock rejects it too');
    assert.ok(app.window.selectStock('RELIANCE') === undefined && app.window.S.sym === 'RELIANCE',
      'legitimate symbols still work');
  });

  await test('the error panel uses a safe retry button, never inline onclick (B4/B6)', () => {
    app.window.renderStockError("O'Brien", new Error('boom'));
    const q = app.doc.getElementById('qTable');
    assert.ok(/Could not load/.test(q.innerHTML), 'error panel rendered: ' + q.innerHTML.slice(0, 160));
    assert.ok(!/onclick=/.test(q.innerHTML), 'no inline onclick attribute');
    assert.ok(/data-retry="O'Brien"/.test(q.innerHTML), 'retry button carries the symbol safely');
    // the listener is real: clicking retry re-opens the stock
    const opened = [];
    const orig = app.window.selectStock;
    app.window.selectStock = (s) => opened.push(s);
    try { q.querySelector('[data-retry]').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true })); }
    finally { app.window.selectStock = orig; }
    assert.deepStrictEqual(opened, ["O'Brien"], 'retry click reaches selectStock');
  });

  await test('sector dropdown picks up sectors discovered after the first render (B12)', () => {
    const sel = app.doc.getElementById('f_sector');
    const before = sel.options.length;
    app.window.SECTORS.push('Quantum Widgets');
    app.window.renderScreener();
    assert.strictEqual(sel.options.length, before + 1, 'new sector appears in the select');
    let found = false;
    for (const o of sel.options) if (o.textContent === 'Quantum Widgets') found = true;
    assert.ok(found, 'option text present');
    app.window.SECTORS.pop();   // SECTORS was appended to, not re-sorted, so pop removes ours
    app.window.renderScreener();
    assert.strictEqual(sel.options.length, before, 'option removed again with the sector');
  });

  await test('a strict CSP meta tag ships with the page (B6)', () => {
    const metas = app.doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');
    assert.strictEqual(metas.length, 1, 'exactly one CSP meta');
    const c = metas[0].getAttribute('content');
    const scriptDir = (c.match(/script-src[^;]*/) || [''])[0];
    assert.ok(/script-src/.test(scriptDir), 'script-src present');
    assert.ok(/'self'/.test(scriptDir), 'scripts restricted to self: ' + scriptDir);
    assert.ok(!/unsafe-inline/.test(scriptDir), 'no unsafe-inline for scripts: ' + scriptDir);
    assert.ok(/connect-src/.test(c) && /query1\.finance\.yahoo\.com/.test(c), 'connect-src lists the data hosts');
    assert.ok(/style-src[^;]*unsafe-inline/.test(c), 'inline style attributes still allowed');
  });

  await test('displayed prices carry an honest freshness stamp, not a bare "live" (B3)', () => {
    const C = {
      sym: 'TCS', name: 'Tata Consultancy Services', sector: 'IT',
      fund: { pe: 20, bv: 500, fv: 10, mcap: 1200000, roe: 45, roce: 55, dy: 1.5, de: 0.1, gs: 10, gp: 12, opm: 25, price: 3000, chg: 1 },
      about: [], shp: null, pros: [], cons: [], fetchedAt: Date.now()
    };
    const chart = { price: 3000, dayChg: 1.2, lo52: 2000, hi52: 3500, ret1y: 10, pts: [{ t: Date.now(), c: 3000, o: 2990, h: 3010, l: 2980, v: 1 }], ccy: 'INR' };
    app.window.markQuote('TCS.NS', Date.now());
    app.window.renderStockHead(C, chart);
    const stamp = app.doc.getElementById('freshStamp').textContent;
    assert.ok(/Financials as of/.test(stamp), stamp);
    assert.ok(/prices as of/.test(stamp), 'quote time shown: ' + stamp);
    assert.ok(!/prices live/.test(stamp), 'no bare "prices live" claim');
    // without a quote time the stamp must not pretend either
    app.window.renderStockHead(C, null);
    const stamp2 = app.doc.getElementById('freshStamp').textContent;
    assert.ok(!/prices live/.test(stamp2), 'still no bare claim without a chart: ' + stamp2);
  });

  console.log(failures ? '\n' + failures + ' test(s) failed\n' : '\nAll tests passed\n');
  process.exit(failures ? 1 : 0);
})();
