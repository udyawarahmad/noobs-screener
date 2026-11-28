'use strict';
/* Valuation history + screen backtesting — the "Time Machine".

   Everything here is a pure function over the parsed screener.in tables (`C.pnl`,
   `C.bs`, `C.cf`) and a Yahoo price chart ({pts:[{t,c}]}), so it can be unit
   tested against real published numbers without a browser.

   Two deliberate simplifications, both shown in the UI:
   - Per-share history uses TODAY's share count (equity capital / face value), the
     same basis Yahoo's split/bonus-adjusted closes are on. Genuine dilution is not
     retro-fitted.
   - Fundamentals are treated as known `LAG_DAYS` after the fiscal year ends, which
     is roughly when Indian companies report.
*/

var VAL_LAG_DAYS = 90;
var VAL_MIN_YEARS = 3;          // below this the percentile is not meaningful

/* ---------------- small date helpers ---------------- */

var VAL_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/* "Mar 2026" -> end of March 2026 (UTC ms). Returns null for TTM / junk. */
function valMonthEnd(label) {
  var m = String(label || '').trim().match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (!m) return null;
  var mon = VAL_MONTHS[m[1].toLowerCase()];
  if (mon == null) return null;
  var year = parseInt(m[2], 10);
  var end = new Date(Date.UTC(year, mon + 1, 0));   // last day of that month
  return end.getTime();
}

function valDay(t) { return Math.floor(t / 86400000); }

/* ---------------- table access ---------------- */

/* Annual columns only (TTM and any interim quarter dropped), with their dates. */
function valAnnualCols(table) {
  if (!table || !table.cols) return [];
  var out = [];
  for (var i = 0; i < table.cols.length; i++) {
    var t = valMonthEnd(table.cols[i]);
    if (t == null) continue;
    out.push({ i: i, t: t, label: table.cols[i] });
  }
  // oldest -> newest, whatever order the source used
  out.sort(function (a, b) { return a.t - b.t; });
  return out;
}

function valRow(table, names) {
  if (!table || !table.rows) return null;
  var want = names.map(function (n) { return n.toLowerCase(); });
  for (var i = 0; i < table.rows.length; i++) {
    var l = String(table.rows[i].label || '').toLowerCase();
    if (want.indexOf(l) >= 0) return table.rows[i];
  }
  for (var j = 0; j < table.rows.length; j++) {
    var l2 = String(table.rows[j].label || '').toLowerCase();
    for (var k = 0; k < want.length; k++) {
      if (l2.indexOf(want[k]) === 0) return table.rows[j];
    }
  }
  return null;
}

function valNum(row, i) {
  if (!row || !row.nums || i == null) return null;
  var v = row.nums[i];
  return (v == null || isNaN(v)) ? null : v;
}

/* ---------------- company fundamentals ---------------- */

/* Share count in crores, on the latest reported balance sheet. */
function valShares(C) {
  var sc = valRow(C && C.bs, ['equity capital', 'share capital']);
  var fv = C && C.fund ? C.fund.fv : null;
  if (!sc || !fv) return null;
  // latest column with a real capital figure — works whether the source lists
  // columns oldest-first or newest-first, and whether or not an interim quarter
  // (e.g. "Sep 2026") is present
  var capital = null, bestT = -Infinity;
  (C.bs.cols || []).forEach(function (label, i) {
    var t = valMonthEnd(label);
    if (t == null) return;                       // TTM and other non-months
    var v = valNum(sc, i);
    if (v == null || v <= 0) return;
    if (t > bestT) { bestT = t; capital = v; }
  });
  if (capital == null || capital <= 0) return null;
  var sharesCr = capital / fv;             // ₹Cr / ₹ per share = crore shares
  if (!isFinite(sharesCr) || sharesCr <= 0) return null;
  return { sharesCr: sharesCr, capital: capital, fv: fv };
}

/* Annual EPS (₹) + book value per share (₹) timelines, on today's share basis. */
function valPerShareTimelines(C) {
  var sh = valShares(C);
  if (!sh) return { eps: [], bvps: [], shares: null };

  var pnl = C.pnl, bs = C.bs;
  var npRow = valRow(pnl, ['net profit']);
  var scRow = valRow(bs, ['equity capital', 'share capital']);
  var resRow = valRow(bs, ['reserves']);

  // reported EPS row is already split/bonus adjusted by the source -> prefer it
  var epsRow = valRow(pnl, ['eps in rs', 'eps']);

  var eps = [], bvps = [];
  var pnlCols = valAnnualCols(pnl);
  var bsByLabel = {};
  valAnnualCols(bs).forEach(function (c) { bsByLabel[c.label] = c; });

  pnlCols.forEach(function (c) {
    var value = null;
    var rep = valNum(epsRow, c.i);
    if (rep != null) value = rep;
    else {
      var np = valNum(npRow, c.i);
      if (np != null) value = np / sh.sharesCr;
    }
    if (value != null) eps.push({ t: c.t, label: c.label, value: value, adjusted: rep != null });

    var bc = bsByLabel[c.label];
    if (bc) {
      var sc = valNum(scRow, bc.i), res = valNum(resRow, bc.i);
      if (sc != null && res != null) bvps.push({ t: bc.t, label: c.label, value: (sc + res) / sh.sharesCr });
    }
  });

  // TTM earnings, if the P&L has that column (current valuation point)
  var ttmIdx = -1;
  for (var i = 0; i < (pnl.cols || []).length; i++) {
    if (/^ttm$/i.test(String(pnl.cols[i]).trim())) ttmIdx = i;
  }
  var epsTtm = null;
  if (ttmIdx >= 0) {
    epsTtm = valNum(epsRow, ttmIdx);
    if (epsTtm == null) {
      var npT = valNum(npRow, ttmIdx);
      if (npT != null) epsTtm = npT / sh.sharesCr;
    }
  }

  return {
    eps: eps,
    bvps: bvps,
    epsTtm: epsTtm,
    shares: sh,
    currentBvps: bvps.length ? bvps[bvps.length - 1].value : null
  };
}

/* ---------------- price series helpers ---------------- */

/* Last close at or before t (binary search over an ascending series). */
function valPriceAt(pts, t) {
  if (!pts || !pts.length) return null;
  var lo = 0, hi = pts.length - 1, best = null;
  while (lo <= hi) {
    var mid = (lo + hi) >> 1;
    if (pts[mid].t <= t) { best = pts[mid].c; lo = mid + 1; }
    else hi = mid - 1;
  }
  return best;
}

/* Daily valuation series: price / per-share value, using the fundamental that was
   published at that time (step function, shifted by the reporting lag). */
function valDailySeries(chart, timeline) {
  var pts = (chart && chart.pts) || [];
  var series = timeline || [];
  if (!pts.length || !series.length) return [];
  var usable = series.filter(function (p) { return p.value != null && p.value > 0; })
    .map(function (p) { return { from: p.t + VAL_LAG_DAYS * 86400000, value: p.value }; })
    .sort(function (a, b) { return a.from - b.from; });
  if (!usable.length) return [];

  var out = [];
  var k = -1;
  for (var i = 0; i < pts.length; i++) {
    var t = pts[i].t;
    while (k + 1 < usable.length && usable[k + 1].from <= t) k++;
    if (k < 0) continue;                       // nothing reported yet at this date
    var denom = usable[k].value;
    if (!denom || denom <= 0) continue;
    out.push({ t: t, v: pts[i].c / denom });
  }
  return out;
}

/* Percentile rank of x within values (0..100). */
function valPercentile(values, x) {
  var arr = (values || []).filter(function (v) { return v != null && isFinite(v); });
  if (!arr.length || x == null || !isFinite(x)) return null;
  var below = 0, equal = 0;
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] < x) below++;
    else if (arr[i] === x) equal++;
  }
  return ((below + 0.5 * equal) / arr.length) * 100;
}

function valQuantile(sorted, q) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  var pos = (sorted.length - 1) * q;
  var lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/* Summary of one ratio's history: where does "now" sit?
   `calibrate` scales the series so today's value matches the published multiple
   (screener.in's P/E is standalone-ish, so a raw consolidated ratio drifts). */
function valSummarise(daily, currentValue, calibrate) {
  var vals = (daily || []).map(function (d) { return d.v; }).filter(function (v) { return v > 0 && isFinite(v); });
  if (vals.length < 20) return null;
  var sorted = vals.slice().sort(function (a, b) { return a - b; });
  var raw = daily[daily.length - 1].v;

  var factor = 1;
  if (calibrate && calibrate > 0 && raw > 0) {
    factor = calibrate / raw;
    if (!isFinite(factor) || factor < 0.5 || factor > 2) factor = 1;   // implausible -> ignore
  }
  var cur = (currentValue != null && currentValue > 0) ? currentValue : raw * factor;

  var scaled = sorted.map(function (v) { return v * factor; });
  return {
    now: cur,
    factor: factor,
    median: valQuantile(scaled, 0.5),
    p20: valQuantile(scaled, 0.2),
    p80: valQuantile(scaled, 0.8),
    min: scaled[0],
    max: scaled[scaled.length - 1],
    percentile: valPercentile(scaled, cur),
    samples: scaled.length,
    series: daily.map(function (d) { return { t: d.t, v: d.v * factor }; })
  };
}

/* Full valuation picture for one stock. */
function valForCompany(C, chart) {
  if (!C || !chart) return null;
  var tl = valPerShareTimelines(C);
  if (!tl.shares) return null;

  var peDaily = valDailySeries(chart, tl.eps);
  var pbDaily = valDailySeries(chart, tl.bvps);
  var priceNow = (chart.pts && chart.pts.length) ? chart.pts[chart.pts.length - 1].c : null;
  if (priceNow == null) return null;

  // today's multiple, on the same basis the source publishes where possible
  var epsNow = tl.epsTtm != null ? tl.epsTtm : (tl.eps.length ? tl.eps[tl.eps.length - 1].value : null);
  var peNow = (epsNow != null && epsNow > 0) ? priceNow / epsNow : null;
  var bvNow = tl.currentBvps;
  var pbNow = (bvNow != null && bvNow > 0) ? priceNow / bvNow : null;

  var publishedPe = C.fund ? C.fund.pe : null;
  var publishedBv = C.fund ? C.fund.bv : null;
  if (publishedBv != null && publishedBv > 0) { bvNow = publishedBv; pbNow = priceNow / bvNow; }

  return {
    price: priceNow,
    epsNow: epsNow,
    bvpsNow: bvNow,
    sharesCr: tl.shares.sharesCr,
    // anchor "now" to the multiple the source publishes, so this card never
    // contradicts the P/E shown elsewhere in the app
    pe: valSummarise(peDaily, (publishedPe != null && publishedPe > 0) ? publishedPe : peNow, publishedPe),
    pb: valSummarise(pbDaily, pbNow, publishedBv && publishedBv > 0 ? pbNow : null),
    years: Math.max(tl.eps.length, tl.bvps.length),
    ttm: tl.epsTtm != null
  };
}

/* ---------------- point-in-time fundamentals (for backtests) ---------------- */

/* The fiscal year a screener.in-style column represents, as of `dateMs`. */
function valYearAvailable(cols, dateMs) {
  var usable = null;
  for (var i = 0; i < cols.length; i++) {
    if (cols[i].t + VAL_LAG_DAYS * 86400000 <= dateMs) usable = cols[i];
  }
  return usable;
}

/* Fundamentals as they would have been known at `dateMs`:
   same shape as C.fund, so the screener's own filters can be reused. */
function valFundamentalsAt(C, chart, dateMs) {
  var sh = valShares(C);
  if (!sh) return null;
  var pnl = C.pnl, bs = C.bs;
  var pCols = valAnnualCols(pnl), bCols = valAnnualCols(bs);
  var pCol = valYearAvailable(pCols, dateMs);
  var bCol = valYearAvailable(bCols, dateMs);
  if (!pCol || !bCol) return null;

  var npRow = valRow(pnl, ['net profit']);
  var salesRow = valRow(pnl, ['sales', 'total income', 'revenue', 'interest earned']);
  var opmRow = valRow(pnl, ['opm %']);
  var scRow = valRow(bs, ['equity capital', 'share capital']);
  var resRow = valRow(bs, ['reserves']);
  // banks use "Borrowing", most others "Borrowings"
  var borRow = valRow(bs, ['borrowings', 'borrowing']);

  var np = valNum(npRow, pCol.i);
  var sales = valNum(salesRow, pCol.i);
  var opm = valNum(opmRow, pCol.i);
  var sc = valNum(scRow, bCol.i), res = valNum(resRow, bCol.i);
  var bor = valNum(borRow, bCol.i);
  var equity = (sc != null && res != null) ? sc + res : null;

  var price = valPriceAt(chart && chart.pts, dateMs);
  if (price == null) return null;

  var epsRow = valRow(pnl, ['eps in rs', 'eps']);
  var eps = valNum(epsRow, pCol.i);
  if (eps == null && np != null) eps = np / sh.sharesCr;

  // ROE from the statements; ROCE from the published year-wise ratio table
  // (EBIT / capital employed) with a statement-based fallback.
  var roe = (np != null && equity) ? (np / equity) * 100 : null;
  var roceRow = valRow(C.rat, ['roce %', 'roce']);
  var opRow = valRow(pnl, ['operating profit']);
  var op = valNum(opRow, pCol.i);
  var roce = null;
  if (roceRow) {
    // the ratios table shares the P&L column labels
    var ri = -1;
    for (var q = 0; q < (C.rat.cols || []).length; q++) {
      if (String(C.rat.cols[q]).trim() === String(pCol.label).trim()) ri = q;
    }
    if (ri >= 0) roce = valNum(roceRow, ri);
  }
  if (roce == null && op != null && equity && bor != null && equity + bor > 0) {
    roce = (op / (equity + bor)) * 100;
  }
  var deRun = (bor != null && equity) ? bor / equity : null;

  // 3-year growth ending at this fiscal year (needs 4 columns)
  var gs = null, gp = null;
  var idx = pCols.findIndex(function (c) { return c.i === pCol.i; });
  if (idx >= 3) {
    var s0 = valNum(salesRow, pCols[idx - 3].i), s1 = sales;
    var n0 = valNum(npRow, pCols[idx - 3].i), n1 = np;
    if (s0 != null && s1 != null && s0 > 0 && s1 > 0) gs = (Math.pow(s1 / s0, 1 / 3) - 1) * 100;
    if (n0 != null && n1 != null && n0 > 0 && n1 > 0) gp = (Math.pow(n1 / n0, 1 / 3) - 1) * 100;
  }

  var payoutRow = valRow(pnl, ['dividend payout %']);
  var payout = valNum(payoutRow, pCol.i);
  var dy = (payout != null && eps != null && eps > 0 && price > 0) ? (payout * eps / price) : null;

  return {
    mcap: price * sh.sharesCr,          // ₹ per share × crore shares = ₹ crore
    pe: (eps != null && eps > 0) ? price / eps : null,
    roe: roe,
    roce: roce,
    dy: dy,
    de: deRun,
    gs: gs,
    gp: gp,
    opm: opm,
    price: price,
    fyLabel: pCol.label,
    eps: eps
  };
}

/* ---------------- backtest ---------------- */

function valCagr(startV, endV, years) {
  if (!(startV > 0) || !(endV > 0) || !(years > 0)) return null;
  return (Math.pow(endV / startV, 1 / years) - 1) * 100;
}

function valMaxDrawdown(values) {
  var peak = -Infinity, worst = 0;
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (!isFinite(v) || v <= 0) continue;
    if (v > peak) peak = v;
    if (peak > 0) {
      var dd = (v / peak - 1) * 100;
      if (dd < worst) worst = dd;
    }
  }
  return worst;
}

/* Equal-weight portfolio of every stock that passed the screen on `startMs`,
   held to `endMs`. `members` = [{sym, C, chart}]. `passes(fund, C)` decides. */
function valBacktest(members, startMs, endMs, passes, benchmarkChart) {
  var picks = [], rets = [];
  members.forEach(function (m) {
    var fund = valFundamentalsAt(m.C, m.chart, startMs);
    if (!fund) return;
    var ok = false;
    try { ok = !!passes(fund, m.C); } catch (e) { ok = false; }
    if (!ok) return;
    var p0 = valPriceAt(m.chart.pts, startMs);
    var p1 = valPriceAt(m.chart.pts, endMs);
    if (!(p0 > 0) || !(p1 > 0)) return;
    var r = (p1 / p0 - 1) * 100;
    picks.push({ sym: m.sym, name: (m.C && m.C.name) || m.sym, ret: r, pe: fund.pe, roe: fund.roe, mcap: fund.mcap });
    rets.push(r);
  });

  var years = (endMs - startMs) / (365.25 * 86400000);
  var avg = rets.length ? rets.reduce(function (a, b) { return a + b; }, 0) / rets.length : null;

  // equal-weight equity curve from the members' own daily closes
  var curve = [];
  if (members.length && picks.length) {
    var picked = {};
    picks.forEach(function (p) { picked[p.sym] = true; });
    var byDay = {};
    members.forEach(function (m) {
      if (!picked[m.sym]) return;
      var pts = (m.chart && m.chart.pts) || [];
      var base = valPriceAt(pts, startMs);
      if (!(base > 0)) return;
      pts.forEach(function (p) {
        if (p.t < startMs || p.t > endMs) return;
        var d = valDay(p.t);
        if (!byDay[d]) byDay[d] = { sum: 0, n: 0 };
        byDay[d].sum += p.c / base;
        byDay[d].n += 1;
      });
    });
    Object.keys(byDay).map(Number).sort(function (a, b) { return a - b; }).forEach(function (d) {
      if (byDay[d].n > 0) curve.push(byDay[d].sum / byDay[d].n);
    });
  }

  var benchStart = benchmarkChart ? valPriceAt(benchmarkChart.pts, startMs) : null;
  var benchEnd = benchmarkChart ? valPriceAt(benchmarkChart.pts, endMs) : null;
  var benchRet = (benchStart > 0 && benchEnd > 0) ? (benchEnd / benchStart - 1) * 100 : null;

  var winners = rets.filter(function (r) { return r > 0; }).length;

  /* One equity curve drives BOTH KPIs (B15): CAGR and max drawdown describe
     the same equal-weight portfolio path, instead of a mean-of-returns CAGR
     sitting next to a curve-based drawdown. */
  var curveCagr = null;
  if (curve.length > 1 && years > 0 && curve[0] > 0 && curve[curve.length - 1] > 0) {
    curveCagr = (Math.pow(curve[curve.length - 1] / curve[0], 1 / years) - 1) * 100;
  }

  return {
    count: picks.length,
    universe: members.length,
    avgReturn: avg,
    medianReturn: rets.length ? rets.slice().sort(function (a, b) { return a - b; })[Math.floor(rets.length / 2)] : null,
    cagr: curveCagr,
    benchReturn: benchRet,
    benchCagr: (benchRet != null) ? valCagr(100, 100 + benchRet, years) : null,
    maxDrawdown: curve.length > 2 ? valMaxDrawdown(curve) : null,
    hitRate: rets.length ? (winners / rets.length) * 100 : null,
    years: years,
    picks: picks.sort(function (a, b) { return b.ret - a.ret; }),
    startMs: startMs,
    endMs: endMs
  };
}
