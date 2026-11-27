'use strict';
/* Noobs Screener live-data layer: real prices/charts from Yahoo Finance,
   real financials from screener.in company pages (parsed in-browser).
   Results are cached in localStorage so repeat visits are instant.
   (Cache keys keep the legacy 'screenone' prefix so existing watchlists survive the rename.) */

var LIVE_TTL_CO = 7 * 24 * 3600 * 1000;   // company financials: 7 days
var LIVE_TTL_CH = 24 * 3600 * 1000;       // price history: 1 day

function _ck(k) { return 'screenone3:' + k; }
function liveCacheGet(k) {
  try {
    var raw = localStorage.getItem(_ck(k));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}
function liveCacheSet(k, v) {
  try { localStorage.setItem(_ck(k), JSON.stringify({ t: Date.now(), v: v })); }
  catch (e) {
    // quota full: drop chart caches, retry once
    try {
      Object.keys(localStorage).filter(function (x) { return x.indexOf('screenone3:ch:') === 0; })
        .forEach(function (x) { localStorage.removeItem(x); });
      localStorage.setItem(_ck(k), JSON.stringify({ t: Date.now(), v: v }));
    } catch (e2) {}
  }
}
function liveCacheClear() {
  try {
    Object.keys(localStorage).filter(function (x) {
      return x.indexOf('screenone3:') === 0 || x.indexOf('screenone2:') === 0 || x.indexOf('screenone:') === 0;
    }).forEach(function (x) { localStorage.removeItem(x); });
  } catch (e) {}
}

function _withTimeout(ms) {
  try {
    var c = new AbortController();
    var t = setTimeout(function () { try { c.abort(); } catch (e) {} }, ms);
    return { signal: c.signal, done: function () { clearTimeout(t); } };
  } catch (e) { return null; }
}

/* ---------- fetch layer ----------
   Order: Electron main-process proxy (no CORS) -> direct fetch or CORS proxy
   depending on `preferProxy` -> fallback to the other. */
async function _fetchDirectText(url) {
  var w = _withTimeout(30000);
  try {
    var r = await fetch(url, { credentials: 'omit', signal: w && w.signal });
    if (w) w.done();
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } catch (e) { if (w) w.done(); throw e; }
}
async function _fetchProxyText(url) {
  var w = _withTimeout(30000);
  try {
    var r = await fetch('https://corsproxy.io/?url=' + encodeURIComponent(url), { signal: w && w.signal });
    if (w) w.done();
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } catch (e) { if (w) w.done(); throw e; }
}
async function httpText(url, preferProxy) {
  if (typeof window !== 'undefined' && window.electronFetch) {
    var er = null;
    try { er = await window.electronFetch(url); } catch (e) { er = null; }
    if (er) {
      if (er.ok !== false && typeof er.body === 'string') return er.body;
      if (er.status >= 400) throw new Error('HTTP ' + er.status);
    }
  }
  var first = preferProxy ? _fetchProxyText : _fetchDirectText;
  var second = preferProxy ? _fetchDirectText : _fetchProxyText;
  try { return await first(url); } catch (e1) {}
  try { return await second(url); } catch (e2) {}
  throw new Error('network blocked');
}
async function httpJSON(url) {
  var txt = await httpText(url, false);
  return JSON.parse(txt);
}

/* ---------- Yahoo Finance price history ---------- */
async function loadChart(ySym) {
  var key = 'ch3:' + ySym, c = liveCacheGet(key);
  if (c && (Date.now() - c.t) < LIVE_TTL_CH) return c.v;
  var j = await httpJSON('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ySym) + '?range=5y&interval=1d');
  var res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error('no market data for ' + ySym);
  var ts = res.timestamp || [];
  var ind = res.indicators || {};
  var q = (ind.quote && ind.quote[0]) || {};
  var adj = (ind.adjclose && ind.adjclose[0] && ind.adjclose[0].adjclose) || q.close || [];
  var opens = q.open || [], highs = q.high || [], lows = q.low || [], vols = q.volume || [], closes = q.close || [];
  var pts = [];
  for (var i = 0; i < ts.length; i++) {
    var rawC = closes[i] != null ? closes[i] : null;
    var cVal = adj[i] != null ? adj[i] : rawC;
    if (!ts[i] || cVal == null) continue;
    var kAdj = (rawC && adj[i] != null) ? (adj[i] / rawC) : 1;
    pts.push({
      t: ts[i] * 1000, c: cVal, rc: rawC != null ? rawC : cVal,
      o: opens[i] != null ? opens[i] * kAdj : null,
      h: highs[i] != null ? highs[i] * kAdj : null,
      l: lows[i] != null ? lows[i] * kAdj : null,
      v: vols[i] || 0
    });
  }
  if (!pts.length) throw new Error('empty price history for ' + ySym);
  var m = res.meta || {};
  var last = pts[pts.length - 1], prev = pts.length > 1 ? pts[pts.length - 2] : last;
  var prevClose = m.regularMarketPreviousClose != null ? m.regularMarketPreviousClose : (prev.rc != null ? prev.rc : prev.c);
  var ret1y = null;
  var spanDays = (last.t - pts[0].t) / 86400000;
  if (spanDays >= 330) {
    var targetT = last.t - 365 * 86400000;
    var backPt = pts[0], bestDiff = Math.abs(pts[0].t - targetT);
    for (var bi = 1; bi < pts.length - 1; bi++) {
      var diff = Math.abs(pts[bi].t - targetT);
      if (diff < bestDiff) { bestDiff = diff; backPt = pts[bi]; }
    }
    if (backPt && backPt.c > 0) ret1y = (last.c / backPt.c - 1) * 100;
  }
  var dayChg = m.regularMarketChangePercent != null
    ? m.regularMarketChangePercent
    : (prevClose ? ((m.regularMarketPrice != null ? m.regularMarketPrice : last.rc) / prevClose - 1) * 100 : null);
  var out = {
    price: m.regularMarketPrice != null ? m.regularMarketPrice : last.rc,
    dayChg: dayChg,
    dayHigh: m.regularMarketDayHigh != null ? m.regularMarketDayHigh : last.h,
    dayLow: m.regularMarketDayLow != null ? m.regularMarketDayLow : last.l,
    prevClose: prevClose,
    hi52: m.fiftyTwoWeekHigh, lo52: m.fiftyTwoWeekLow,
    vol: m.regularMarketVolume != null ? m.regularMarketVolume : last.v,
    name: m.longName || m.shortName || ySym,
    ret1y: ret1y, pts: pts,
    ccy: m.currency || 'INR'
  };
  liveCacheSet(key, out);
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
    if (c && (Date.now() - c.t) < LIVE_TTL_CH) { CH[cands[i]] = c.v; return c.v; }
  }
  return null;
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

/* ---------- generic screener.in table parser ---------- */
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
function cagr3(row, cols) {
  if (!row) return null;
  var a = [];
  for (var i = 0; i < row.nums.length; i++) {
    if (cols && cols[i] && /^ttm$/i.test(String(cols[i]).trim())) continue;
    if (row.nums[i] != null) a.push(row.nums[i]);
  }
  a = a.slice(-4);
  if (a.length < 4 || a[0] <= 0 || a[3] <= 0) return null;
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
    var headDrop = 2;
    for (var hi = 0; hi < allRows.length; hi++) {
      if (!allRows[hi].querySelector('a[href*="/company/"]') && /Company|Name/i.test(allRows[hi].textContent)) {
        var ths = allRows[hi].querySelectorAll('th');
        var all = Array.prototype.map.call(ths, function (th) { return th.textContent.replace(/\s+/g, ' ').trim(); });
        var nameIx = all.findIndex(function (h) { return /^(company|name)$/i.test(h); });
        headDrop = nameIx >= 0 ? nameIx + 1 : Math.min(2, all.length);
        metricHeads = all.slice(headDrop);
        break;
      }
    }
    if (!metricHeads.length) {
      var thAll = Array.prototype.map.call(pt.querySelectorAll('thead th'), function (th) {
        return th.textContent.replace(/\s+/g, ' ').trim();
      });
      var nIx = thAll.findIndex(function (h) { return /^(company|name)$/i.test(h); });
      metricHeads = (nIx >= 0 ? thAll.slice(nIx + 1) : thAll).filter(Boolean);
    }
    Array.prototype.forEach.call(allRows, function (tr) {
      var a = tr.querySelector('a[href*="/company/"]');
      if (!a || peers.length >= 14) return;
      var parts = (a.getAttribute('href') || '').split('/').filter(Boolean);
      var psym = parts.length >= 2 ? parts[1].toUpperCase() : null;
      var nm = a.textContent.replace(/\s+/g, ' ').trim();
      var cells = Array.prototype.map.call(tr.querySelectorAll('td'), function (td) { return td.textContent.replace(/\s+/g, ' ').trim(); });
      var cellDrop = cells.length > metricHeads.length ? (cells.length - metricHeads.length) : 2;
      peers.push({ sym: psym, name: nm, vals: cells.slice(cellDrop) });
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
  var borRow = findRow(bs, ['borrowings']);
  var scRow = findRow(bs, ['share capital', 'equity capital']);
  var resRow = findRow(bs, ['reserves']);
  var eq = null, borL = null;
  if (borRow && scRow && resRow) {
    var len = Math.min(borRow.nums.length, scRow.nums.length, resRow.nums.length);
    for (var bi = len - 1; bi >= 0; bi--) {
      if (borRow.nums[bi] != null && scRow.nums[bi] != null && resRow.nums[bi] != null) {
        borL = borRow.nums[bi];
        eq = scRow.nums[bi] + resRow.nums[bi];
        break;
      }
    }
  }
  if (eq == null) {
    var scL = scRow ? lastN(scRow, 1)[0] : null, rsL = resRow ? lastN(resRow, 1)[0] : null;
    if (scL != null && rsL != null) eq = scL + rsL;
    borL = borRow ? lastN(borRow, 1)[0] : null;
  }
  var negEq = (eq != null && eq <= 0);

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
    gs: cagr3(revRow, pnl && pnl.cols),
    gp: cagr3(npRow, pnl && pnl.cols),
    opm: opmRow ? lastN(opmRow, 1)[0] : null,
    de: (borL != null && eq != null && eq > 0) ? borL / eq : null,
    negEq: negEq
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
        var url = 'https://www.screener.in/company/' + encodeURIComponent(slugs[si]) + suffixes[fi];
        var html = await httpText(url, true);
        if (!html || html.indexOf('top-ratios') < 0) continue;
        var parsed = parseCompany(html, sym);
        parsed.consolidated = suffixes[fi] !== '/';
        liveCacheSet(key, parsed);
        return parsed;
      } catch (e) { lastErr = e; }
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
