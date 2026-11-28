'use strict';
/* Noobs Screener live-data layer: real prices/charts from Yahoo Finance,
   real financials from public company pages (parsed in-browser).
   Results are cached in localStorage so repeat visits are instant.
   (Cache keys keep the legacy 'screenone' prefix so existing watchlists survive the rename.) */

var LIVE_TTL_CO = 7 * 24 * 3600 * 1000;   // company financials: 7 days
var LIVE_TTL_CH = 24 * 3600 * 1000;       // price *history* (the pts array): 1 day
var LIVE_TTL_QT = 2 * 60 * 1000;          // *displayed* quote while the market is open: 2 min
var LIVE_TTL_QT_OFF = 15 * 60 * 1000;     // displayed quote when closed: 15 min

/* Yahoo symbol -> ms when its quote was last confirmed (network fetch, or the
   cache timestamp we trust it to). Bulk/background data keeps the 1-day TTL;
   anything on screen goes through quoteStale()/freshChart* so "live" means live. */
var CH_T = {};

/* NSE trading hours 9:15–15:30 IST, Mon–Fri. Holidays are not modelled — a
   refresh on a holiday just fetches identical data. `nowMs` is injectable for tests. */
function marketOpenNow(nowMs) {
  var d = new Date(nowMs == null ? Date.now() : nowMs);
  // epoch -> IST wall clock: UTC + local offset + 5:30
  var ist = new Date(d.getTime() + d.getTimezoneOffset() * 60000 + 330 * 60000);
  var wd = ist.getDay();
  if (wd === 0 || wd === 6) return false;
  var mins = ist.getHours() * 60 + ist.getMinutes();
  return mins >= 9 * 60 + 15 && mins < 15 * 60 + 30;
}
function quoteTtl(nowMs) { return marketOpenNow(nowMs) ? LIVE_TTL_QT : LIVE_TTL_QT_OFF; }
function markQuote(ySym, t) { CH_T[ySym] = t || Date.now(); }
function quoteStale(ySym, nowMs) {
  var t = CH_T[ySym];
  if (t == null) return true;
  return ((nowMs == null ? Date.now() : nowMs) - t) > quoteTtl(nowMs);
}
/* Newest confirmation time across candidate symbols, or null. */
function quoteTimeOf(symOrCands) {
  var arr = Array.isArray(symOrCands) ? symOrCands : [symOrCands];
  for (var i = 0; i < arr.length; i++) if (CH_T[arr[i]] != null) return CH_T[arr[i]];
  return null;
}

/* Cache lives in PStore (renderer/store.js): files on disk in the desktop app,
   localStorage on the plain website. Returning {t, v} keeps the call sites as-is. */
function liveCacheGet(k) {
  try { return PStore.cacheGet(k); } catch (e) { return null; }
}
function liveCacheSet(k, v) {
  try { return PStore.cacheSet(k, v); } catch (e) { return false; }
}
/* Clears cached price/financial data ONLY — never the watchlist or theme. */
function liveCacheClear() {
  try { PStore.cacheClear(); } catch (e) {}
}

/* ---------- Yahoo Finance price history ---------- */
/* `force` bypasses the 1-day disk cache — used for quotes the user is looking
   at right now (hero, index strip, watchlist) when the quote TTL has passed. */
async function loadChart(ySym, force) {
  var key = 'ch3:' + ySym, c = liveCacheGet(key);
  if (!force && c && (Date.now() - c.t) < LIVE_TTL_CH) {
    CH[ySym] = c.v; markQuote(ySym, c.t);
    return c.v;
  }
  var j = await httpJSON('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ySym) + '?range=5y&interval=1d');
  var res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error('no market data for ' + ySym);
  var ts = res.timestamp || [];
  var ind = res.indicators || {};
  var q = (ind.quote && ind.quote[0]) || {};
  var adj = (ind.adjclose && ind.adjclose[0] && ind.adjclose[0].adjclose) || q.close || [];
  var opens = q.open || [], highs = q.high || [], lows = q.low || [], vols = q.volume || [];
  var kAdj = [];
  for (var ka = 0; ka < ts.length; ka++) {
    var qc = (q.close && Number.isFinite(q.close[ka])) ? q.close[ka] : null;
    var ac = Number.isFinite(adj[ka]) ? adj[ka] : null;
    kAdj.push(qc && ac && qc !== 0 ? ac / qc : 1);
  }
  var pts = [];
  for (var i = 0; i < ts.length; i++) {
    var c = adj[i];
    // Drop gaps and garbage — `adj[i] != null` lets NaN through (NaN != null),
    // and one short Yahoo array must not poison min/max and blank the chart.
    if (!ts[i] || !Number.isFinite(c) || c <= 0) continue;
    var kA = kAdj[i];
    pts.push({
      t: ts[i] * 1000, c: c,
      o: Number.isFinite(opens[i]) ? opens[i] * kA : null,
      h: Number.isFinite(highs[i]) ? highs[i] * kA : null,
      l: Number.isFinite(lows[i]) ? lows[i] * kA : null,
      v: Number.isFinite(vols[i]) ? vols[i] : 0
    });
  }
  if (!pts.length) throw new Error('empty price history for ' + ySym);
  var m = res.meta || {};
  var last = pts[pts.length - 1], prev = pts.length > 1 ? pts[pts.length - 2] : last;
  var back = pts.length > 253 ? pts[pts.length - 253].c : pts[0].c;
  var out = {
    price: m.regularMarketPrice != null ? m.regularMarketPrice : last.c,
    dayChg: m.regularMarketChangePercent != null ? m.regularMarketChangePercent : (last.c / prev.c - 1) * 100,
    dayHigh: m.regularMarketDayHigh != null ? m.regularMarketDayHigh : last.h,
    dayLow: m.regularMarketDayLow != null ? m.regularMarketDayLow : last.l,
    prevClose: prev.c,
    hi52: m.fiftyTwoWeekHigh, lo52: m.fiftyTwoWeekLow,
    vol: m.regularMarketVolume != null ? m.regularMarketVolume : last.v,
    name: m.longName || m.shortName || ySym,
    ret1y: (last.c / back - 1) * 100, pts: pts,
    ccy: m.currency || 'INR',
    qt: Date.now()          // when this quote was fetched (shown in the UI)
  };
  liveCacheSet(key, out);
  CH[ySym] = out; markQuote(ySym, out.qt);
  return out;
}

/* Yahoo candidates for any screener slug: NSE (.NS) first, then BSE (.BO).
   Numeric slugs are BSE scrip codes, so only .BO applies. */
function chartCands(sym) {
  var out = [];
  if (/^\d+$/.test(sym)) { out.push(sym + '.BO'); }
  else {
    out.push(yOf(sym));
    if (sym.slice(-3).toUpperCase() !== '.BO') out.push(sym + '.BO');
  }
  return out.concat((typeof ALT_Y !== 'undefined' && ALT_Y[sym]) || []);
}

/* Try primary + fallback Yahoo symbols for one company (corporate actions happen). */
async function loadChartSym(sym) {
  var cands = chartCands(sym);
  var lastErr = new Error('no market data for ' + sym);
  for (var i = 0; i < cands.length; i++) {
    try { return await loadChart(cands[i]); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}
function cachedChartSym(sym) {
  var cands = chartCands(sym);
  for (var i = 0; i < cands.length; i++) {
    if (CH[cands[i]]) return CH[cands[i]];
    var c = liveCacheGet('ch3:' + cands[i]);
    if (c && (Date.now() - c.t) < LIVE_TTL_CH) {
      CH[cands[i]] = c.v; markQuote(cands[i], c.t);
      return c.v;
    }
  }
  return null;
}

/* ---------- quote freshness for what is ON SCREEN ----------
   Bulk/background data (screener rows, backtest) keeps the 1-day TTL. The hero,
   index strip and watchlist go through these so a session open all day shows
   live prices: re-fetch when the quote is older than quoteTtl(). */
async function freshChartY(ySym) {
  if (CH[ySym] && !quoteStale(ySym)) return CH[ySym];
  var c = liveCacheGet('ch3:' + ySym);
  if (c && (Date.now() - c.t) < quoteTtl()) {
    CH[ySym] = c.v; markQuote(ySym, c.t);
    return c.v;
  }
  // nothing fresh enough → force a network fetch; on failure serve what we have
  try { return await loadChart(ySym, true); }
  catch (e) {
    // a dead network must surface (callers fail fast instead of trying every
    // candidate symbol); "no data for this symbol" still falls back
    if (isNetworkBlocked(e)) throw e;
    return CH[ySym] || (c ? c.v : null);
  }
}
async function freshChartSym(sym) {
  var cands = chartCands(sym), last = null;
  for (var i = 0; i < cands.length; i++) {
    try {
      var ch = await freshChartY(cands[i]);
      if (ch) return ch;
    } catch (e) {
      last = e;
      // .NS and .BO are the same host — a dead network must fail fast
      if (isNetworkBlocked(e)) throw e;
    }
  }
  if (last) throw last;
  throw new Error('no market data for ' + sym);
}

/* ---------- number parsing ---------- */
function toNum(x) {
  if (x == null) return null;
  var s = String(x).replace(/[₹,\s\u00a0\u2009]/g, '').replace(/%/g, '');
  if (s === '' || s === '–' || s === '-' || s === '--') return null;
  var v = parseFloat(s);
  return isNaN(v) ? null : v;
}
function cleanLabel(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/\s*\+\s*$/, '').trim();
}

/* ---------- generic financials table parser ---------- */
function parseDataTable(table) {
  if (!table) return null;
  var heads = Array.prototype.map.call(table.querySelectorAll('thead th'), function (th) {
    return th.textContent.replace(/\s+/g, ' ').trim();
  });
  if (heads.length && heads[0] === '') heads.shift();
  var rows = [];
  Array.prototype.forEach.call(table.querySelectorAll('tbody tr'), function (tr) {
    var tds = tr.querySelectorAll('td');
    if (!tds.length) return;
    var label = cleanLabel(tds[0].textContent);
    if (!label) return;
    if (/raw pdf|download|^pdf$/i.test(label)) return; // link rows, not data
    var vals = [], nums = [], any = false;
    for (var i = 1; i < tds.length; i++) {
      var raw = tds[i].textContent.replace(/\s+/g, ' ').trim();
      vals.push(raw);
      nums.push(toNum(raw));
      if (raw !== '' && raw !== '–' && raw !== '-') any = true;
    }
    if (vals.length && any) rows.push({ label: label, vals: vals, nums: nums });
  });
  return { cols: heads, rows: rows };
}
function findRow(t, names) {
  if (!t) return null;
  var ls = t.rows.map(function (r) { return r.label.toLowerCase(); });
  for (var i = 0; i < names.length; i++) {
    var ix = ls.indexOf(names[i]);
    if (ix >= 0) return t.rows[ix];
  }
  for (var j = 0; j < t.rows.length; j++) {
    for (var k = 0; k < names.length; k++) {
      if (t.rows[j].label.toLowerCase().indexOf(names[k]) === 0) return t.rows[j];
    }
  }
  return null;
}
function lastN(row, n) {
  if (!row) return [];
  var a = row.nums.filter(function (v) { return v != null; });
  return a.slice(-n);
}
function cagr3(row) {
  var a = lastN(row, 4);
  if (a.length < 4 || !a[0]) return null;
  return (Math.pow(a[3] / a[0], 1 / 3) - 1) * 100;
}

/* ---------- full company page parser ---------- */
function parseCompany(html, sym) {
  var doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc.querySelector('#top-ratios')) throw new Error('not a company page');

  var nameEl = doc.querySelector('#top h1');
  var name = nameEl ? nameEl.textContent.replace(/\s+/g, ' ').trim() : sym;

  var price = null, chg = null;
  var pxWrap = doc.querySelector('#top .line-height-14');
  if (pxWrap) {
    var m = pxWrap.textContent.replace(/\s+/g, ' ');
    var pm = m.match(/₹\s*([\d,]+\.?\d*)/);
    var cm = m.match(/([-+]\s*[\d.]+)\s*%/);
    if (pm) price = toNum(pm[1]);
    if (cm) chg = toNum(cm[1]);
  }

  var ratios = {};
  Array.prototype.forEach.call(doc.querySelectorAll('#top-ratios li'), function (li) {
    var n = li.querySelector('.name'), v = li.querySelector('.value');
    if (n && v) ratios[cleanLabel(n.textContent)] = v.textContent.replace(/\s+/g, ' ').trim();
  });

  var about = [];
  Array.prototype.forEach.call(doc.querySelectorAll('.company-profile p'), function (p) {
    var t = p.textContent.replace(/\s+/g, ' ').trim();
    if (t && t.length > 40) about.push(t);
  });

  function grabLink(part, exclude) {
    var as = doc.querySelectorAll('#top a[href]');
    for (var i = 0; i < as.length; i++) {
      var h = as[i].getAttribute('href') || '';
      if (h.indexOf(part) >= 0) return h;
      if (exclude && h.indexOf('http') === 0 && ['screener', 'bseindia', 'nseindia'].every(function (x) { return h.indexOf(x) < 0; })) return h;
    }
    return null;
  }
  var site = grabLink('nomatch-external', true);
  var bse = grabLink('bseindia'), nse = grabLink('nseindia');

  // sector: "Broad Industry" preferred, "Industry" as fallback
  var sector = null;
  try {
    var biEl = doc.querySelector('#peers a[title="Broad Industry"]');
    if (biEl) sector = cleanLabel(biEl.textContent);
    if (!sector) {
      var inEl = doc.querySelector('#peers a[title="Industry"]');
      if (inEl) sector = cleanLabel(inEl.textContent);
    }
  } catch (e) {}

  var pros = [], cons = [];
  Array.prototype.forEach.call(doc.querySelectorAll('#analysis .pros li'), function (li) { pros.push(li.textContent.replace(/\s+/g, ' ').trim()); });
  Array.prototype.forEach.call(doc.querySelectorAll('#analysis .cons li'), function (li) { cons.push(li.textContent.replace(/\s+/g, ' ').trim()); });

  var peers = [];
  var metricHeads = [];
  var pt = doc.querySelector('#peers table.data-table');
  if (pt) {
    // header row lives in tbody (th cells, no company link)
    var allRows = pt.querySelectorAll('tbody tr');
    for (var hi = 0; hi < allRows.length; hi++) {
      if (!allRows[hi].querySelector('a[href*="/company/"]') && /Company/.test(allRows[hi].textContent)) {
        var ths = allRows[hi].querySelectorAll('th');
        var all = Array.prototype.map.call(ths, function (th) { return th.textContent.replace(/\s+/g, ' ').trim(); });
        metricHeads = all.slice(2); // drop checkbox + Company
        break;
      }
    }
    if (!metricHeads.length) {
      metricHeads = Array.prototype.map.call(pt.querySelectorAll('thead th'), function (th) {
        return th.textContent.replace(/\s+/g, ' ').trim();
      }).filter(Boolean);
    }
    Array.prototype.forEach.call(allRows, function (tr) {
      var a = tr.querySelector('a[href*="/company/"]');
      if (!a || peers.length >= 14) return;
      var parts = (a.getAttribute('href') || '').split('/').filter(Boolean);
      var psym = parts.length >= 2 ? parts[1].toUpperCase() : null;
      var nm = a.textContent.replace(/\s+/g, ' ').trim();
      var cells = Array.prototype.map.call(tr.querySelectorAll('td'), function (td) { return td.textContent.replace(/\s+/g, ' ').trim(); });
      // cells[0] = serial, cells[1] = company name cell; metric values follow
      peers.push({ sym: psym, name: nm, vals: cells.slice(2) });
    });
  }

  var quarters = parseDataTable(doc.querySelector('#quarters table.data-table'));
  var pnl = parseDataTable(doc.querySelector('#profit-loss table.data-table'));
  var bs = parseDataTable(doc.querySelector('#balance-sheet table.data-table'));
  var cf = parseDataTable(doc.querySelector('#cash-flow table.data-table'));
  var rat = parseDataTable(doc.querySelector('#ratios table.data-table'));

  var shp = null;
  var sht = doc.querySelector('#quarterly-shp table.data-table') || doc.querySelector('#shareholding table.data-table');
  if (sht) {
    var parsed = parseDataTable(sht);
    if (parsed) {
      // drop leading/empty trailing placeholder quarters, keep last 8 with data
      var keep = [];
      for (var ci = 0; ci < parsed.cols.length; ci++) {
        var any = parsed.rows.some(function (r) { return r.vals[ci] !== '' && r.vals[ci] !== '–'; });
        if (any) keep.push(ci);
      }
      keep = keep.slice(-8);
      shp = {
        cols: keep.map(function (ci) { return parsed.cols[ci]; }),
        rows: parsed.rows.map(function (r) {
          return { label: r.label, vals: keep.map(function (ci) { return r.vals[ci]; }), nums: keep.map(function (ci) { return r.nums[ci]; }) };
        })
      };
    }
  }

  // derived screener metrics
  var revRow = findRow(pnl, ['sales', 'total income', 'revenue', 'interest earned']);
  var npRow = findRow(pnl, ['net profit']);
  var opmRow = findRow(pnl, ['opm %']);
  var borRow = findRow(bs, ['borrowings', 'borrowing']);   // banks label it "Borrowing"
  var scRow = findRow(bs, ['share capital']);
  var resRow = findRow(bs, ['reserves']);
  var eq = null;
  var scL = scRow ? lastN(scRow, 1)[0] : null, rsL = resRow ? lastN(resRow, 1)[0] : null;
  if (scL != null && rsL != null) eq = scL + rsL;
  var borL = borRow ? lastN(borRow, 1)[0] : null;

  var fund = {
    mcap: toNum((ratios['Market Cap'] || '').replace(/Cr\.?/, '')),
    pe: toNum(ratios['Stock P/E']),
    roe: toNum(ratios['ROE']),
    roce: toNum(ratios['ROCE']),
    dy: toNum(ratios['Dividend Yield']),
    bv: toNum(ratios['Book Value']),
    fv: toNum(ratios['Face Value']),
    price: price,
    chg: chg,
    gs: cagr3(revRow),
    gp: cagr3(npRow),
    opm: opmRow ? lastN(opmRow, 1)[0] : null,
    de: (borL != null && eq) ? borL / eq : null
  };

  return {
    sym: sym, name: name, price: price, chg: chg,
    site: site, bse: bse, nse: nse, about: about, sector: sector,
    ratios: ratios, pros: pros, cons: cons, peers: peers, metricHeads: metricHeads,
    quarters: quarters, pnl: pnl, bs: bs, cf: cf, rat: rat, shp: shp,
    fund: fund, fetchedAt: Date.now()
  };
}

async function loadCompany(sym) {
  var key = 'co:' + sym, c = liveCacheGet(key);
  if (c && (Date.now() - c.t) < LIVE_TTL_CO) return c.v;
  var slugs = [sym].concat(ALT_SLUG[sym] || []);
  var suffixes = ['/consolidated/', '/'];
  var lastErr = new Error('company page not found: ' + sym);
  for (var si = 0; si < slugs.length; si++) {
    for (var fi = 0; fi < suffixes.length; fi++) {
      try {
        var url = 'https://www.screener.in/company/' + slugs[si] + suffixes[fi];
        var html = await httpText(url);
        if (!html || html.indexOf('top-ratios') < 0) continue;
        var parsed = parseCompany(html, sym);
        parsed.consolidated = suffixes[fi] !== '/';
        liveCacheSet(key, parsed);
        return parsed;
      } catch (e) {
        lastErr = e;
        // same host for every slug/suffix — a dead network must fail fast
        // instead of waiting through all four URLs
        if (isNetworkBlocked(e)) throw e;
      }
    }
  }
  throw lastErr;
}

/* small concurrency helper */
async function mapLimit(items, limit, fn, onEach) {
  var out = new Array(items.length), i = 0, done = 0;
  async function worker() {
    while (i < items.length) {
      var ix = i++;
      try { out[ix] = await fn(items[ix], ix); }
      catch (e) { out[ix] = { __err: String(e && e.message || e) }; }
      done++;
      if (onEach) { try { onEach(done, items.length); } catch (e2) {} }
    }
  }
  var ws = [];
  for (var k = 0; k < Math.min(limit, items.length); k++) ws.push(worker());
  await Promise.all(ws);
  return out;
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* Abort-based timeout helper: one slow host can never stall a whole page. */
function _withTimeout(ms) {
  try {
    var c = new AbortController();
    var t = setTimeout(function () { try { c.abort(); } catch (e) {} }, ms);
    return { signal: c.signal, done: function () { clearTimeout(t); } };
  } catch (e) { return null; }
}

/* ---------- standalone fetch layer (GitHub/Electron build) ----------
   Order: Electron main-process proxy (no CORS) -> direct fetch (Yahoo
   allows it) -> public CORS-proxy fallback (plain static hosting). */
/* The main-process bridge must never hang the UI: race it against a deadline
   and fall through to direct fetch → corsproxy. A stalled ns-fetch (dropped
   packets, firewall, captive portal) used to leave the skeleton on screen
   forever with no error and no retry. Tests may shrink it via window.__. */
var NS_FETCH_TIMEOUT_MS = 8000;
function _deadline(promise, ms) {
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { reject(new Error('bridge timeout')); }, ms);
    Promise.resolve(promise).then(function (v) {
      clearTimeout(t); resolve(v);
    }, function (e) {
      clearTimeout(t); reject(e);
    });
  });
}
async function httpText(url) {
  try { if (typeof window !== "undefined" && window.electronFetch) {
    var budget = (window.__NS_FETCH_TIMEOUT_MS || NS_FETCH_TIMEOUT_MS);
    var er = await _deadline(window.electronFetch(url), budget);
    if (er && er.ok !== false && typeof er.body === "string") return er.body;
  } } catch (e) {}
  var w1 = _withTimeout(15000);
  try {
    var r = await fetch(url, { credentials: "omit", signal: w1 && w1.signal });
    if (w1) w1.done();
    if (r.ok) return await r.text();
  } catch (e) { if (w1) w1.done(); }
  var w2 = _withTimeout(15000);
  try {
    var r2 = await fetch("https://corsproxy.io/?url=" + encodeURIComponent(url), { signal: w2 && w2.signal });
    if (w2) w2.done();
    if (r2.ok) return await r2.text();
  } catch (e) { if (w2) w2.done(); }
  throw new Error("network blocked");
}
/* Transport-level failure: the host is unreachable or every stage timed out.
   Retrying sibling URLs (same host) would only multiply the wait. */
function isNetworkBlocked(e) {
  return !!e && e.message === 'network blocked';
}
async function httpJSON(url) {
  try { if (typeof window !== "undefined" && window.electronFetch) {
    var er = await window.electronFetch(url);
    if (er && er.ok !== false && typeof er.body === "string") return JSON.parse(er.body);
  } } catch (e) {}
  var w1 = _withTimeout(30000);
  try {
    var r = await fetch(url, { credentials: "omit", signal: w1 && w1.signal });
    if (w1) w1.done();
    if (r.ok) return await r.json();
  } catch (e) { if (w1) w1.done(); }
  var w2 = _withTimeout(30000);
  try {
    var r2 = await fetch("https://corsproxy.io/?url=" + encodeURIComponent(url), { signal: w2 && w2.signal });
    if (w2) w2.done();
    if (r2.ok) return await r2.json();
  } catch (e) { if (w2) w2.done(); }
  throw new Error("network blocked");
}
