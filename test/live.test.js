'use strict';
/* Quote-freshness tests — `node test/live.test.js` (no dependencies).

   Guards B3: prices shown as "live" must not be frozen. The displayed quote
   (hero, index strip, watchlist) honours a 2-min TTL while the NSE is open
   (15 min otherwise); background data keeps its 1-day TTL. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

/* Mon 30 Nov 2026, 10:00 IST — market open. (Today is Sat 28 Nov 2026.) */
const OPEN_MON_IST = Date.UTC(2026, 10, 30, 4, 30);
const SAT_10_IST = Date.UTC(2026, 10, 28, 4, 30);

function yahooFixture(price) {
  const t0 = 1764547200;
  return {
    chart: {
      result: [{
        meta: {
          regularMarketPrice: price, regularMarketChangePercent: 1.5,
          currency: 'INR', longName: 'Test Co',
          fiftyTwoWeekHigh: price * 1.2, fiftyTwoWeekLow: price * 0.8
        },
        timestamp: [t0, t0 + 86400],
        indicators: {
          quote: [{ open: [price - 1, price], high: [price + 1, price + 2], low: [price - 2, price - 1], close: [price - 1, price], volume: [100, 200] }],
          adjclose: [{ adjclose: [price - 1, price] }]
        }
      }],
      error: null
    }
  };
}

/* Load renderer/live.js in a vm with a controllable clock, an in-memory disk
   cache and a counting network stub (same harness style as news.test.js). */
function loadLive() {
  const clock = { t: OPEN_MON_IST };
  class FakeDate extends Date {
    constructor(...a) { if (a.length === 0) super(clock.t); else super(...a); }
    static now() { return clock.t; }
  }
  const disk = {};
  const state = { fetches: 0, fail: false };
  const sandbox = {
    console,
    Date: FakeDate,
    setTimeout, clearTimeout,
    window: {},
    CH: {},
    ALT_SLUG: {},
    ALT_Y: {},
    yOf: (s) => s + '.NS',
    PStore: {
      cacheGet(k) { return Object.prototype.hasOwnProperty.call(disk, k) ? disk[k] : null; },
      cacheSet(k, v) { disk[k] = { t: clock.t, v }; },
      cacheDel(k) { delete disk[k]; },
      cacheClear() { Object.keys(disk).forEach((k) => delete disk[k]); }
    }
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../renderer/live.js'), 'utf8'),
    sandbox,
    { filename: 'renderer/live.js' }
  );
  sandbox.httpJSON = async () => {
    state.fetches++;
    if (state.fail) throw new Error('network down');
    return yahooFixture(100);
  };
  return { sandbox, clock, disk, state };
}

(async function main() {
  console.log('\nmarket hours (NSE = 9:15–15:30 IST, Mon–Fri)');

  await test('open during the session, closed before/after and on weekends', () => {
    const { sandbox } = loadLive();
    assert.strictEqual(sandbox.marketOpenNow(OPEN_MON_IST), true, 'Mon 10:00 IST');
    assert.strictEqual(sandbox.marketOpenNow(Date.UTC(2026, 10, 30, 3, 45)), true, 'Mon 09:15 IST');
    assert.strictEqual(sandbox.marketOpenNow(Date.UTC(2026, 10, 30, 3, 0)), false, 'Mon 08:30 IST');
    assert.strictEqual(sandbox.marketOpenNow(Date.UTC(2026, 10, 30, 10, 30)), false, 'Mon 16:00 IST');
    assert.strictEqual(sandbox.marketOpenNow(SAT_10_IST), false, 'Saturday');
    assert.strictEqual(sandbox.marketOpenNow(Date.UTC(2026, 10, 29, 4, 30)), false, 'Sunday');
  });

  await test('quote TTL: 2 min while open, 15 min when closed', () => {
    const { sandbox } = loadLive();
    assert.strictEqual(sandbox.quoteTtl(OPEN_MON_IST), sandbox.LIVE_TTL_QT);
    assert.strictEqual(sandbox.quoteTtl(SAT_10_IST), sandbox.LIVE_TTL_QT_OFF);
    assert.strictEqual(sandbox.LIVE_TTL_QT, 2 * 60 * 1000);
    assert.strictEqual(sandbox.LIVE_TTL_CH, 24 * 3600 * 1000, 'history stays at 1 day');
  });

  console.log('\nloadChart caching');

  await test('loadChart writes the disk cache, marks the quote time, force bypasses', async () => {
    const h = loadLive();
    const ch1 = await h.sandbox.loadChart('T.NS');
    assert.strictEqual(h.state.fetches, 1);
    assert.ok(h.disk['ch3:T.NS'], 'persisted for next launch');
    assert.strictEqual(h.sandbox.CH['T.NS'], ch1, 'memory populated');
    assert.strictEqual(h.sandbox.CH_T['T.NS'], h.clock.t, 'quote time marked');

    h.clock.t += 60 * 60 * 1000;                    // 1 h later, still same day
    await h.sandbox.loadChart('T.NS');
    assert.strictEqual(h.state.fetches, 1, 'within the 1-day history TTL: served from disk');

    await h.sandbox.loadChart('T.NS', true);
    assert.strictEqual(h.state.fetches, 2, 'force refetches');
    assert.strictEqual(h.sandbox.CH_T['T.NS'], h.clock.t, 'quote time refreshed');
  });

  console.log('\nfreshChartY (what the hero / index strip / watchlist use)');

  await test('serves a fresh-enough quote without refetching', async () => {
    const h = loadLive();
    await h.sandbox.loadChart('T.NS');
    const ch = await h.sandbox.freshChartY('T.NS');
    assert.strictEqual(h.state.fetches, 1, 'no extra request');
    assert.ok(ch && ch.price === 100);
  });

  await test('refetches once the quote TTL passes during market hours', async () => {
    const h = loadLive();
    await h.sandbox.loadChart('T.NS');
    h.clock.t += 3 * 60 * 1000;                      // 3 min later, market still open
    const ch = await h.sandbox.freshChartY('T.NS');
    assert.strictEqual(h.state.fetches, 2, 'stale quote refreshed');
    assert.strictEqual(h.sandbox.CH_T['T.NS'], h.clock.t);
    assert.ok(ch);
  });

  await test('uses a disk record younger than the quote TTL (no request)', async () => {
    const h = loadLive();
    h.disk['ch3:T.NS'] = { t: h.clock.t - 30 * 1000, v: { price: 42, pts: [{ t: 1, c: 42 }] } };
    const ch = await h.sandbox.freshChartY('T.NS');
    assert.strictEqual(h.state.fetches, 0, '30-second-old quote is fresh while open');
    assert.strictEqual(ch.price, 42);
  });

  await test('refreshes an older disk record (between quote TTL and 1-day TTL)', async () => {
    const h = loadLive();
    h.disk['ch3:T.NS'] = { t: h.clock.t - 10 * 60 * 1000, v: { price: 42, pts: [] } };
    const ch = await h.sandbox.freshChartY('T.NS');
    assert.strictEqual(h.state.fetches, 1, '10-minute-old quote is stale while open');
    assert.ok(ch.price > 0, 'got a chart back');
  });

  await test('falls back to the stale chart when the network dies', async () => {
    const h = loadLive();
    const first = await h.sandbox.loadChart('T.NS');
    h.clock.t += 10 * 60 * 1000;                      // now stale
    h.state.fail = true;
    const ch = await h.sandbox.freshChartY('T.NS');
    assert.strictEqual(h.state.fetches, 2, 'it tried to refresh');
    assert.strictEqual(ch, first, 'serves the previous chart rather than nothing');
  });

  await test('freshChartSym falls back to the BSE symbol when the NSE one fails', async () => {
    const h = loadLive();
    h.sandbox.httpJSON = async (url) => {
      h.state.fetches++;
      if (String(url).indexOf('.NS') >= 0) throw new Error('no data');
      return yahooFixture(55);
    };
    const ch = await h.sandbox.freshChartSym('WEIRD');
    assert.ok(ch, 'a chart came back');
    assert.strictEqual(ch.price, 55, 'from the .BO candidate');
  });

  console.log('\\nB16: garbage points are dropped, not chart-poisoning');

  await test('NaN closes and missing opens are filtered out of pts', async () => {
    const h = loadLive();
    const t0 = 1764547200;
    h.sandbox.httpJSON = async () => ({
      chart: {
        result: [{
          meta: { regularMarketPrice: 103, regularMarketChangePercent: 1, currency: 'INR', longName: 'Gap Co' },
          timestamp: [t0, t0 + 86400, t0 + 172800, t0 + 259200],
          indicators: {
            quote: [{
              open: [100, 100, null, 100], high: [101, 101, null, 101],
              low: [99, 99, null, 99], close: [100, null, 102, 103], volume: [1, 2, 3, 4]
            }],
            adjclose: [{ adjclose: [100, NaN, 102, 103] }]
          }
        }],
        error: null
      }
    });
    const ch = await h.sandbox.loadChart('G.NS');
    assert.strictEqual(ch.pts.length, 3, 'the NaN point is dropped (old code kept it: NaN != null)');
    assert.ok(ch.pts.every((p) => Number.isFinite(p.c) && p.c > 0), 'every close finite and positive');
    assert.ok(ch.pts.every((p) => p.o == null || Number.isFinite(p.o)), 'opens finite or null');
    const cs = ch.pts.map((p) => p.c);
    assert.ok(Number.isFinite(Math.min(...cs)) && Number.isFinite(Math.max(...cs)), 'min/max consumers see no NaN');
  });

  await test('a chart of nothing but garbage still fails loudly', async () => {
    const h = loadLive();
    h.sandbox.httpJSON = async () => ({
      chart: {
        result: [{
          meta: { currency: 'INR' },
          timestamp: [1764547200],
          indicators: { quote: [{ close: [null] }], adjclose: [{ adjclose: [NaN] }] }
        }],
        error: null
      }
    });
    await assert.rejects(() => h.sandbox.loadChart('J.NS'), /empty price history/);
  });

  console.log(failures ? '\n' + failures + ' test(s) failed\n' : '\nAll tests passed\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
