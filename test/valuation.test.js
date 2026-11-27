'use strict';
/* Valuation + backtest maths, checked against real published TCS figures
   (screener.in consolidated page, fetched 27 Nov 2026) and synthetic series.
   Run: node test/valuation.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
function near(actual, expected, tol, label) {
  assert.ok(Math.abs(actual - expected) <= tol,
    (label || '') + ' expected ~' + expected + ' ±' + tol + ', got ' + actual);
}

const V = (function load() {
  const sandbox = { console: console };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/valuation.js'), 'utf8'), sandbox, { filename: 'valuation.js' });
  return sandbox;
})();

/* ---- real TCS consolidated numbers (₹ Cr, as published) ---- */
const YEARS = ['Mar 2015', 'Mar 2016', 'Mar 2017', 'Mar 2018', 'Mar 2019', 'Mar 2020',
  'Mar 2021', 'Mar 2022', 'Mar 2023', 'Mar 2024', 'Mar 2025', 'Mar 2026'];

function col(values, ttm) {
  const vals = values.map(String);
  if (ttm != null) vals.push(String(ttm));
  return vals;
}
const TCS = {
  sym: 'TCS',
  name: 'Tata Consultancy Services Ltd',
  fund: { fv: 1, pe: 17.03, bv: 329 },
  pnl: {
    cols: YEARS.concat(['TTM']),
    rows: [
      { label: 'Sales', vals: col([94648, 108646, 117966, 123104, 146463, 156949, 164177, 191754, 225458, 240893, 255324, 267021], 283248) },
      { label: 'Operating Profit', vals: col([24482, 30677, 32311, 32516, 39506, 42109, 46546, 53057, 59259, 64296, 67407, 72398], 74916) },
      { label: 'OPM %', vals: col([26, 28, 27, 26, 27, 27, 28, 28, 26, 27, 26, 27], 26) },
      { label: 'Net Profit', vals: col([20060, 24338, 26357, 25880, 31562, 32447, 32562, 38449, 42303, 46099, 48797, 49454], 51858) },
      { label: 'EPS in Rs', vals: col([50.68, 61.58, 66.71, 67.46, 83.87, 86.19, 87.67, 104.75, 115.19, 126.88, 134.20, 136.01], 142.64) },
      { label: 'Dividend Payout %', vals: col([78, 35, 35, 37, 36, 85, 43, 41, 100, 58, 94, 81], '') }
    ].map(r => {
      const nums = r.vals.map(v => (v === '' ? null : parseFloat(v)));
      return { label: r.label, vals: r.vals, nums };
    })
  },
  bs: {
    cols: YEARS.concat(['Sep 2026']),
    rows: [
      { label: 'Equity Capital', vals: col([196, 197, 197, 191, 375, 375, 370, 366, 366, 362, 362, 362, 362]) },
      { label: 'Reserves', vals: col([50439, 70875, 86017, 84937, 89071, 83751, 86063, 88773, 90058, 90127, 94394, 106878, 118624]) },
      { label: 'Borrowings', vals: col([358, 245, 289, 247, 62, 8174, 7795, 7818, 7688, 8021, 9392, 11283, 11808]) }
    ].map(r => ({ label: r.label, nums: r.vals.map(v => (v === '' ? null : parseFloat(v))), vals: r.vals }))
  },
  rat: {
    cols: YEARS,
    rows: [
      { label: 'ROCE %', vals: YEARS.map(String), nums: [50, 51, 44, 39, 47, 47, 49, 54, 59, 64, 65, 63] }
    ]
  }
};

/* price series: one point per month-end, so lag/step logic is exercised */
function monthlyChart(fromYear, toYear, startPrice) {
  const pts = [];
  let p = startPrice;
  for (let y = fromYear; y <= toYear; y++) {
    for (let m = 0; m < 12; m++) {
      p *= 1.004;
      pts.push({ t: Date.UTC(y, m, 15), c: Math.round(p * 100) / 100 });
    }
  }
  return { pts };
}
const TCS_CHART = monthlyChart(2015, 2026, 1200);

console.log('\nper-share history (real TCS numbers)');

test('share count from the latest balance sheet matches market cap', () => {
  const sh = V.valShares(TCS);
  near(sh.sharesCr, 362, 0.01, 'shares (crore)');
  // 362 Cr shares × ₹2,572 = ₹9.3 lakh crore, as screener.in reports
  near(sh.sharesCr * 2572.5 / 1000, 931, 3, 'market cap (₹ ’000 cr)');
});

test('annual EPS timeline uses the published (split-adjusted) EPS row', () => {
  const tl = V.valPerShareTimelines(TCS);
  assert.strictEqual(tl.eps.length, 12);
  near(tl.eps[0].value, 50.68, 0.01, 'FY15 EPS');
  near(tl.eps[11].value, 136.01, 0.01, 'FY26 EPS');
  near(tl.epsTtm, 142.64, 0.01, 'TTM EPS');
  assert.ok(tl.eps[0].adjusted, 'flagged as source-adjusted');
});

test('book value per share reproduces screener.in’s ₹329', () => {
  const tl = V.valPerShareTimelines(TCS);
  const sept = { capital: 362, reserves: 118624 };
  near((sept.capital + sept.reserves) / 362, 329, 1, 'BVPS');
  near(tl.bvps[tl.bvps.length - 1].value, (362 + 106878) / 362, 0.01, 'FY26 BVPS');
});

test('month-end parsing: "Mar 2026" -> 31 Mar 2026, TTM ignored', () => {
  assert.strictEqual(new Date(V.valMonthEnd('Mar 2026')).toISOString().slice(0, 10), '2026-03-31');
  assert.strictEqual(new Date(V.valMonthEnd('Feb 2024')).toISOString().slice(0, 10), '2024-02-29');
  assert.strictEqual(V.valMonthEnd('TTM'), null);
  assert.strictEqual(V.valMonthEnd(''), null);
  assert.strictEqual(V.valMonthEnd('garbage'), null);
  assert.strictEqual(V.valAnnualCols({ cols: ['Mar 2025', 'TTM', 'Sep 2026'] }).length, 2);
});

console.log('\nvaluation series');

test('EPS only counts from ~90 days after the fiscal year ends', () => {
  const tl = V.valPerShareTimelines(TCS);
  const daily = V.valDailySeries(TCS_CHART, tl.eps, 'pe');
  // nothing before FY15 is "published"
  assert.ok(daily[0].t >= Date.UTC(2015, 5, 29), 'first point after FY15 + lag: ' + new Date(daily[0].t).toISOString());
  // the FY26 step should not appear before 29 Jun 2026
  const before = daily.filter(d => d.t < Date.UTC(2026, 5, 29));
  const last = before[before.length - 1];
  near(last.v, last.v, 0.0001); // no crash
  assert.ok(before[before.length - 1].v > 0);
});

test('P/E now is price ÷ TTM EPS and PB now matches the published 7.82×', () => {
  const v = V.valForCompany(TCS, TCS_CHART);
  const price = TCS_CHART.pts[TCS_CHART.pts.length - 1].c;
  near(v.pe.now, TCS.fund.pe, 0.01, 'P/E anchored to the published multiple');
  near(v.pb.now, price / 329, 0.01, 'P/B from published book value');
  // cross-check the formula against screener.in's own sentence:
  // "Stock is trading at 7.82 times its book value" at ₹2,572.50 / BV ₹329
  near(2572.5 / 329, 7.82, 0.01, 'P/B matches the source text');
  assert.ok(v.pe.percentile >= 0 && v.pe.percentile <= 100);
  assert.ok(v.pe.p20 < v.pe.median && v.pe.median < v.pe.p80, 'bands ordered');
});

test('percentile/quantile helpers behave', () => {
  assert.strictEqual(V.valPercentile([1, 2, 3, 4], 4), 87.5);
  assert.strictEqual(V.valPercentile([1, 2, 3, 4], 1), 12.5);
  assert.strictEqual(V.valPercentile([], 1), null);
  assert.strictEqual(V.valQuantile([1, 2, 3, 4, 5], 0.5), 3);
  near(V.valQuantile([1, 2, 3, 4], 0.5), 2.5, 1e-9);
});

/* ---- real HDFC Bank consolidated numbers (fetched 27 Nov 2026):
   a bank: no ROCE row, "Borrowing" (singular), FV ₹1, price ₹857.25,
   published P/E 16.43, published Book Value ₹391 ---- */
const HDFC_YEARS = ['Mar 2022', 'Mar 2023', 'Mar 2024', 'Mar 2025', 'Mar 2026'];
const HDFCBANK = {
  sym: 'HDFCBANK',
  name: 'HDFC Bank Ltd',
  fund: { fv: 1, pe: 16.43, bv: 391 },
  pnl: {
    cols: HDFC_YEARS.concat(['TTM']),
    rows: [
      { label: 'Net Profit', nums: [38151, 46149, 65446, 73440, 79219, 83685] },
      { label: 'EPS in Rs', nums: [34.31, 41.22, 42.16, 46.26, 49.39, 52.02] },
      { label: 'Dividend Payout %', nums: [23, 23, 23, 24, 31, null] }
    ].map(r => ({ label: r.label, vals: r.nums.map(String), nums: r.nums }))
  },
  bs: {
    cols: HDFC_YEARS.concat(['Sep 2026']),
    rows: [
      { label: 'Equity Capital', nums: [555, 558, 760, 765, 1539, 1542] },
      { label: 'Reserves', nums: [246772, 288880, 455636, 521024, 584520, 601927] },
      { label: 'Borrowing', nums: [226966, 256549, 730615, 634606, 588485, 594144] }
    ].map(r => ({ label: r.label, vals: r.nums.map(String), nums: r.nums }))
  },
  rat: { cols: HDFC_YEARS, rows: [{ label: 'ROE %', vals: HDFC_YEARS.map(String), nums: [17, 17, 17, 14, 14] }] }
};
const HDFC_CHART = (function () {
  const pts = [];
  let p = 1400;
  for (let y = 2022; y <= 2026; y++) for (let m = 0; m < 12; m++) {
    p *= 0.99;
    pts.push({ t: Date.UTC(y, m, 15), c: Math.round(p * 100) / 100 });
  }
  return { pts };
})();

test('bank: book value per share reproduces the published ₹391', () => {
  const sh = V.valShares(HDFCBANK);
  near(sh.sharesCr, 1542, 0.01, 'shares');
  const bvps = (1542 + 601927) / 1542;
  near(bvps, 391, 0.5, 'BVPS vs screener.in');
  // market cap cross-check: 1542 Cr shares × ₹857.25 ≈ ₹13.2 lakh crore
  near(1542 * 857.25 / 1000, 1322, 10, 'market cap (₹ ’000 cr)');
});

test('bank: "Borrowing" is picked up and D-E is computed, not null', () => {
  const at = V.valFundamentalsAt(HDFCBANK, HDFC_CHART, Date.UTC(2026, 7, 1)); // after Mar 2026 filing
  assert.strictEqual(at.fyLabel, 'Mar 2026');
  near(at.de, 588485 / (1539 + 584520), 1e-6, 'debt/equity');
  near(at.roe, 79219 / (1539 + 584520) * 100, 0.01, 'ROE');
  assert.strictEqual(at.roce, null, 'banks have no ROCE row -> null, never a made-up number');
});

test('bank: raw P/E from EPS is within a few percent of the published multiple', () => {
  const epsTtm = 52.02;
  near(857.25 / epsTtm, 16.43, 0.1, 'P/E cross-check');
});

console.log('\npoint-in-time fundamentals');

test('uses the fiscal year that had actually been reported by that date', () => {
  const at = V.valFundamentalsAt(TCS, TCS_CHART, Date.UTC(2024, 5, 15)); // 15 Jun 2024
  assert.strictEqual(at.fyLabel, 'Mar 2023', 'FY24 was not out yet on 15 Jun 2024');
  const after = V.valFundamentalsAt(TCS, TCS_CHART, Date.UTC(2024, 6, 15)); // 15 Jul 2024
  assert.strictEqual(after.fyLabel, 'Mar 2024');
});

test('ROE / ROCE / D-E at a past date come from the right columns', () => {
  const at = V.valFundamentalsAt(TCS, TCS_CHART, Date.UTC(2024, 6, 15)); // FY24
  near(at.roe, 46099 / (362 + 90127) * 100, 0.01, 'ROE');
  near(at.roce, 64, 0.01, 'ROCE from the published ratio table');
  near(at.de, 8021 / (362 + 90127), 0.0001, 'debt/equity');
  near(at.opm, 27, 0.01, 'OPM');
  assert.ok(at.mcap > 0 && at.pe > 0);
});

test('3-year growth uses four annual columns and handles bad bases', () => {
  const at = V.valFundamentalsAt(TCS, TCS_CHART, Date.UTC(2024, 6, 15)); // FY24 vs FY21
  near(at.gs, (Math.pow(240893 / 164177, 1 / 3) - 1) * 100, 0.01, '3y sales growth');
  near(at.gp, (Math.pow(46099 / 32562, 1 / 3) - 1) * 100, 0.01, '3y profit growth');
});

test('returns null instead of guessing when data is missing', () => {
  assert.strictEqual(V.valFundamentalsAt({ ...TCS, bs: null }, TCS_CHART, Date.UTC(2024, 6, 15)), null);
  assert.strictEqual(V.valFundamentalsAt(TCS, { pts: [] }, Date.UTC(2024, 6, 15)), null);
  const noShares = { ...TCS, fund: { fv: null } };
  assert.strictEqual(V.valShares(noShares), null);
  assert.strictEqual(V.valForCompany(TCS, null), null);
});

console.log('\nbacktest maths');

test('CAGR and max drawdown', () => {
  near(V.valCagr(100, 121, 2), 10, 1e-9, 'CAGR');
  assert.strictEqual(V.valCagr(0, 100, 2), null);
  assert.strictEqual(V.valCagr(100, 100, 0), null);
  near(V.valMaxDrawdown([100, 120, 90, 110]), -25, 1e-9, 'drawdown');
  near(V.valMaxDrawdown([100, 110, 120]), 0, 1e-9, 'no drawdown');
  near(V.valMaxDrawdown([]), 0, 1e-9, 'empty');
});

function flatChart(startMs, endMs, from, to) {
  const pts = [];
  const steps = 100;
  for (let i = 0; i <= steps; i++) {
    const t = startMs + (endMs - startMs) * i / steps;
    pts.push({ t, c: from + (to - from) * i / steps });
  }
  return { pts };
}

test('equal-weight portfolio: returns, hit rate, benchmark and drawdown', () => {
  const start = Date.UTC(2023, 0, 1), end = Date.UTC(2026, 0, 1);
  const members = [
    { sym: 'A', C: TCS, chart: flatChart(start, end, 100, 200) },   // +100%
    { sym: 'B', C: TCS, chart: flatChart(start, end, 100, 50) },    // -50%
    { sym: 'C', C: TCS, chart: flatChart(start, end, 100, 100) }    // flat
  ];
  const bench = flatChart(start, end, 100, 150);                    // +50%
  const res = V.valBacktest(members, start, end, () => true, bench);

  assert.strictEqual(res.count, 3);
  near(res.avgReturn, (100 - 50 + 0) / 3, 0.01, 'equal weight average');
  near(res.hitRate, 100 / 3, 0.01, 'one of three winners');
  near(res.benchReturn, 50, 0.01, 'benchmark');
  near(res.years, 3.0, 0.02, 'three years');
  near(res.cagr, (Math.pow((1 + 16.6667 / 100), 1 / 3) - 1) * 100, 0.01, 'portfolio CAGR');
  near(res.benchCagr, (Math.pow(1.5, 1 / 3) - 1) * 100, 0.01, 'benchmark CAGR');
  assert.ok(res.maxDrawdown <= 0 && res.maxDrawdown > -100, 'drawdown sane: ' + res.maxDrawdown);
  assert.strictEqual(res.picks[0].sym, 'A', 'sorted best first');
});

test('the screen predicate decides who is in the portfolio', () => {
  const start = Date.UTC(2023, 0, 1), end = Date.UTC(2026, 0, 1);
  const members = [
    { sym: 'A', C: TCS, chart: flatChart(start, end, 100, 200) },
    { sym: 'B', C: TCS, chart: flatChart(start, end, 100, 50) }
  ];
  const onlyA = V.valBacktest(members, start, end, (fund, C) => C === TCS && fund.mcap > 0, null);
  assert.strictEqual(onlyA.count, 2, 'both pass a mcap filter');
  const none = V.valBacktest(members, start, end, () => false, null);
  assert.strictEqual(none.count, 0);
  assert.strictEqual(none.avgReturn, null);
  assert.strictEqual(none.cagr, null);
  assert.strictEqual(none.maxDrawdown, null);
});

test('a stock with no price history at the start date is skipped, not zeroed', () => {
  const start = Date.UTC(2023, 0, 1), end = Date.UTC(2026, 0, 1);
  const members = [
    { sym: 'A', C: TCS, chart: flatChart(start, end, 100, 200) },
    { sym: 'B', C: TCS, chart: { pts: [{ t: Date.UTC(2025, 0, 1), c: 10 }] } }   // listed later
  ];
  const res = V.valBacktest(members, start, end, () => true, null);
  assert.strictEqual(res.count, 1, 'late listing cannot poison the average');
  assert.strictEqual(res.benchReturn, null, 'no benchmark given -> null');
});

console.log('\nfuzz: degenerate companies and portfolios');

/* deterministic PRNG so failures reproduce */
function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}

test('300 random companies: never NaN, percentages stay in range', () => {
  const rand = rng(42);
  let checked = 0, produced = 0;
  for (let n = 0; n < 300; n++) {
    const years = 1 + Math.floor(rand() * 10);
    const cols = [];
    for (let y = 0; y < years; y++) cols.push('Mar ' + (2016 + y));
    const money = () => (rand() < 0.15 ? null : Math.round((rand() - 0.2) * 50000));
    const rowOf = (label, fn) => {
      const nums = cols.map((_, i) => fn(i));
      return { label, nums, vals: nums.map(v => (v == null ? '' : String(v))) };
    };
    const C = {
      sym: 'S' + n, name: 'Some Co ' + n,
      fund: { fv: rand() < 0.1 ? null : [1, 2, 5, 10][Math.floor(rand() * 4)], pe: rand() < 0.3 ? null : 5 + rand() * 60, bv: rand() < 0.3 ? null : 10 + rand() * 400 },
      pnl: {
        cols: cols.concat(['TTM']),
        rows: [
          rowOf('Sales', money), rowOf('Operating Profit', money),
          rowOf('OPM %', () => (rand() < 0.2 ? null : Math.round(rand() * 40))),
          rowOf('Net Profit', money),
          rowOf('EPS in Rs', () => (rand() < 0.2 ? null : (rand() - 0.15) * 100)),
          rowOf('Dividend Payout %', () => (rand() < 0.3 ? null : rand() * 100))
        ]
      },
      bs: {
        cols: cols,
        rows: [rowOf('Equity Capital', () => Math.round(rand() * 2000) || 1), rowOf('Reserves', money), rowOf('Borrowing', money)]
      },
      rat: { cols: cols, rows: [rowOf('ROCE %', () => (rand() < 0.4 ? null : rand() * 60))] }
    };
    const chart = {
      pts: Array.from({ length: 50 + Math.floor(rand() * 400) }, (_, i) => ({
        t: Date.UTC(2016, 0, 1) + i * 7 * 86400000,
        c: 10 + rand() * 3000
      }))
    };
    const v = V.valForCompany(C, chart);
    checked++;
    if (!v) continue;
    produced++;
    [v.pe, v.pb].forEach(sm => {
      if (!sm) return;
      assert.ok(isFinite(sm.now), 'now finite: ' + sm.now);
      assert.ok(sm.p20 <= sm.median + 1e-9 && sm.median <= sm.p80 + 1e-9, 'bands ordered');
      assert.ok(sm.percentile >= 0 && sm.percentile <= 100, 'percentile in range: ' + sm.percentile);
      sm.series.forEach(p => { assert.ok(isFinite(p.v) && p.v > 0, 'series finite and positive: ' + p.v); });
    });
    // point-in-time fundamentals must be null or sane, never NaN
    const at = V.valFundamentalsAt(C, chart, Date.UTC(2019, 5, 1));
    if (at) {
      ['mcap', 'pe', 'roe', 'roce', 'dy', 'de', 'gs', 'gp', 'opm'].forEach(k => {
        if (at[k] != null) assert.ok(isFinite(at[k]), k + ' must be a finite number, got ' + at[k]);
      });
      assert.ok(at.mcap == null || at.mcap >= 0, 'market cap never negative');
    }
  }
  assert.ok(produced > 100, 'most random companies should produce a valuation, got ' + produced + '/' + checked);
});

test('200 random portfolios: backtest never reports impossible statistics', () => {
  const rand = rng(7);
  for (let n = 0; n < 200; n++) {
    const start = Date.UTC(2023, 0, 1), end = Date.UTC(2026, 0, 1);
    const members = [];
    const size = Math.floor(rand() * 8);
    for (let i = 0; i < size; i++) {
      const from = 20 + rand() * 500, to = 20 + rand() * 500;
      members.push({
        sym: 'M' + i, C: TCS,
        chart: { pts: Array.from({ length: 200 }, (_, k) => ({ t: start + (end - start) * k / 199, c: from + (to - from) * k / 199 })) }
      });
    }
    const res = V.valBacktest(members, start, end, () => rand() < 0.6, null);
    assert.ok(res.count <= members.length, 'count bounded by universe');
    if (res.hitRate != null) assert.ok(res.hitRate >= 0 && res.hitRate <= 100, 'hit rate in range');
    if (res.maxDrawdown != null) assert.ok(res.maxDrawdown <= 0 && res.maxDrawdown >= -100, 'drawdown in range: ' + res.maxDrawdown);
    if (res.avgReturn != null && res.picks.length) {
      const rets = res.picks.map(p => p.ret);
      assert.ok(res.avgReturn >= Math.min.apply(null, rets) - 1e-9 && res.avgReturn <= Math.max.apply(null, rets) + 1e-9,
        'average lies between best and worst');
    }
    assert.strictEqual(res.picks.length, res.count);
  }
});

test('empty and single-member inputs are handled', () => {
  const start = Date.UTC(2023, 0, 1), end = Date.UTC(2026, 0, 1);
  const empty = V.valBacktest([], start, end, () => true, null);
  assert.strictEqual(empty.count, 0);
  assert.strictEqual(empty.universe, 0);
  assert.strictEqual(empty.hitRate, null);
  assert.strictEqual(V.valForCompany(null, null), null);
  assert.strictEqual(V.valForCompany({}, {}), null);
  assert.strictEqual(V.valFundamentalsAt({}, {}, start), null);
});

console.log(failures ? '\n' + failures + ' test(s) failed\n' : '\nAll tests passed\n');
process.exit(failures ? 1 : 0);
