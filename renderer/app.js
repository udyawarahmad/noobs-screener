'use strict';
/* Noobs Screener app: everything on this page is REAL data —
   prices/charts via Yahoo Finance, financials via screener.in (parsed live in your browser). */

var S = {
  sym: 'RELIANCE', range: '1Y', finMode: 'sales', theme: 'light', wl: [],
  mode: 'stock', index: null,  scr: { q: '', sector: 'ALL', mcapMin: null, peMax: null, roeMin: null, roceMin: null, dyMin: null, deMax: null, gsMin: null, gpMin: null, opmMin: null, sort: 'mcap', dir: -1, page: 0, onlyWL: false }
};
try { S.wl = JSON.parse(localStorage.getItem('screenone_wl') || '[]'); } catch (e) { S.wl = []; }
try { var _t = localStorage.getItem('screenone_theme'); if (_t) S.theme = _t; } catch (e) {}

var CO = {};   // sym -> parsed company (memory)
var CH = {};   // yahoo symbol -> chart (memory)
var LAST_CH = null; // chart currently shown in the hero (stock or index)
var FIN_SECTIONS = ['pcSec', 'peerSec', 'qSec', 'pnlSec', 'bsSec', 'cfSec', 'ratSec', 'shSec', 'docSec', 'aboutSec'];
var UNI = {};  // sym -> universe entry (curated + ephemeral search/peer opens)
UNIVERSE.forEach(function (u) { UNI[u.sym] = u; });
var ACTIVE_SET = {};
ACTIVE_UNIVERSE.forEach(function (u) { ACTIVE_SET[u.sym] = true; });
// watchlisted stocks opened via universal search get placeholder entries so they reopen
S.wl.forEach(function (s) {
  if (!UNI[s]) {
    var wc = null;
    try { wc = cachedCompany(s); } catch (e) {}
    UNI[s] = { sym: s, y: null, sec: (wc && wc.sector) || '', n: (wc && wc.name) || s };
  }
});

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function inr0(v) { if (v == null || isNaN(v)) return '–'; return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
function inr1(v) { if (v == null || isNaN(v)) return '–'; return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1, minimumFractionDigits: 1 }); }
function inr2(v) { if (v == null || isNaN(v)) return '–'; return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 }); }
function pct1(v) { if (v == null || isNaN(v)) return '–'; return (v > 0 ? '+' : '') + Number(v).toFixed(1) + '%'; }
function numCls(v) { return v > 0 ? 'pos' : (v < 0 ? 'neg' : ''); }
function saveWL() { try { localStorage.setItem('screenone_wl', JSON.stringify(S.wl)); } catch (e) {} }
function skel(h) { return '<div class="skel" style="height:' + (h || 18) + 'px"></div>'; }

/* ---------------- data access ---------------- */
function cachedCompany(sym) {
  if (CO[sym]) return CO[sym];
  var c = (typeof liveCacheGet === 'function') ? liveCacheGet('co:' + sym) : null;
  if (c && (Date.now() - c.t) < LIVE_TTL_CO) { CO[sym] = c.v; return c.v; }
  return null;
}
async function ensureCompany(sym) {
  var hit = cachedCompany(sym);
  if (hit) return hit;
  var parsed = await loadCompany(sym);
  CO[sym] = parsed;
  return parsed;
}
async function ensureChart(sym) {
  var hit = cachedChartSym(sym);
  if (hit) return hit;
  var ch = await loadChartSym(sym);
  CH[yOf(sym)] = ch;
  return ch;
}
function chartOf(sym) { return cachedChartSym(sym); }

/* ---------------- header / market indices ---------------- */
function renderIndices() {
  var items = [
    ['NIFTY 50', '^NSEI'], ['SENSEX', '^BSESN'], ['NIFTY BANK', '^NSEBANK'], ['USD / INR', 'INR=X'], ['Gold', 'GC=F']
  ];
  $('indicesStrip').innerHTML = items.map(function (x) {
    return '<div class="idx" data-y="' + x[1] + '"><span class="idx-n">' + x[0] + '</span><b>…</b><span class="muted">live</span></div>';
  }).join('');
  items.forEach(function (x) {
    var el0 = document.querySelector('.idx[data-y="' + x[1] + '"]');
    if (el0) el0.addEventListener('click', function () { enterIndexMode(x[1], x[0]); });
    loadChart(x[1]).then(function (ch) {
      var el = document.querySelector('.idx[data-y="' + x[1] + '"]');
      if (!el || !ch || !ch.pts.length) return;
      var l = ch.price != null ? ch.price : ch.pts[ch.pts.length - 1].c;
      var p = ch.pts.length > 1 ? ch.pts[ch.pts.length - 2].c : l;
      var c = ch.dayChg != null ? ch.dayChg : (p ? (l / p - 1) * 100 : null);
      var pxStr = ch.ccy === 'USD' ? money(l, 'USD') : inr1(l);
      el.innerHTML = '<span class="idx-n">' + x[0] + '</span><b>' + pxStr + '</b><span class="' + numCls(c) + '">' + pct1(c) + '</span>';
    }).catch(function () { /* leave placeholder */ });
  });
}
/* Clicking a market index loads its live chart + stats into the Overview. */
async function enterIndexMode(ySym, label, skipScroll) {
  S.mode = 'index'; S.index = { y: ySym, label: label };
  FIN_SECTIONS.forEach(function (id) { $(id).hidden = true; });
  var note = $('indexNote'); if (note) note.hidden = false;
  var sc = document.querySelector('.star-col'); if (sc) sc.style.display = 'none';
  var si = $('searchInput'); if (si) si.value = '';
  $('stSym').textContent = ySym;
  $('stName').textContent = label;
  $('stSector').textContent = 'Market index · Yahoo Finance';
  $('stPrice').textContent = '…'; $('stChg').textContent = ''; $('stRange').textContent = '';
  $('w52wrap').innerHTML = ''; $('dayStats').innerHTML = ''; $('metricsGrid').innerHTML = skel(140);
  if (!skipScroll) document.getElementById('stockSec').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    var ch = CH[ySym] || await loadChart(ySym);
    CH[ySym] = ch; LAST_CH = ch;
    if (S.mode !== 'index' || !S.index || S.index.y !== ySym) return;
    renderIndex(ch, label, ySym);
  } catch (e) {
    $('metricsGrid').innerHTML = '<div class="errbox"><b>Could not load ' + esc(label) + '.</b><br><span class="muted">' +
      esc((e && e.message) || 'network error') + '</span></div>';
    drawEmpty($('priceChart'), 'Index data unavailable');
  }
}
function money(v, ccy) {
  if (v == null || isNaN(v)) return '–';
  if (ccy === 'USD') return '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (ccy === 'INR' || ccy == null) return '₹' + inr1(v);
  return inr1(v) + ' ' + ccy;
}
function indexMetricCards(CHd) {
  var ccy = CHd.ccy || 'INR';
  var cards = [
    ['Prev Close', money(CHd.prevClose, ccy)],
    ['Open', (function () { var p = CHd.pts[CHd.pts.length - 1]; return money(p.o, ccy); })()],
    ['Day High', money(CHd.dayHigh, ccy)],
    ['Day Low', money(CHd.dayLow, ccy)],
    ['Volume', CHd.vol != null && CHd.vol > 0 ? shortVol(CHd.vol) : '–'],
    ['52W High', money(CHd.hi52, ccy)],
    ['52W Low', money(CHd.lo52, ccy)],
    ['1Y Return', CHd.ret1y != null ? pct1(CHd.ret1y) : '–']
  ];
  return cards.map(function (c, i) {
    var cls = (i === 7 && CHd.ret1y != null) ? ' class="' + numCls(CHd.ret1y) + '"' : '';
    return '<div class="mcard"><span>' + c[0] + '</span><b' + cls + '>' + c[1] + '</b></div>';
  }).join('');
}
function renderIndex(CHd, label, ySym) {
  LAST_CH = CHd;
  var ccy = CHd.ccy || 'INR';
  $('stSym').textContent = ySym;
  $('stName').textContent = label;
  $('stSector').textContent = 'Market index · Yahoo Finance';
  $('stPrice').textContent = money(CHd.price, ccy);
  var chgEl = $('stChg');
  if (CHd.dayChg != null) {
    chgEl.textContent = (CHd.dayChg >= 0 ? '▲ +' : '▼ ') + CHd.dayChg.toFixed(2) + '% today';
    chgEl.className = 'chg ' + numCls(CHd.dayChg);
  } else { chgEl.textContent = '–'; chgEl.className = 'chg'; }
  var rEl = $('stRange');
  var rParts = [];
  if (CHd.lo52 != null && CHd.hi52 != null) rParts.push('52W Low ' + money(CHd.lo52, ccy) + ' · 52W High ' + money(CHd.hi52, ccy));
  if (CHd.ret1y != null) rParts.push('1Y ' + pct1(CHd.ret1y));
  rEl.textContent = rParts.join(' · ');
  rEl.className = CHd.ret1y != null ? numCls(CHd.ret1y) : '';
  var w52 = '';
  if (CHd.lo52 != null && CHd.hi52 != null && CHd.hi52 > CHd.lo52 && CHd.price != null) {
    var pos = Math.min(100, Math.max(0, (CHd.price - CHd.lo52) / (CHd.hi52 - CHd.lo52) * 100));
    w52 = '<div class="w52"><div class="w52-track"><div class="w52-fill" style="width:' + pos.toFixed(1) + '%"></div><div class="w52-mark" style="left:' + pos.toFixed(1) + '%"></div></div>' +
      '<div class="w52-lab"><span>Low ' + money(CHd.lo52, ccy) + '</span><span>High ' + money(CHd.hi52, ccy) + '</span></div></div>';
  }
  $('w52wrap').innerHTML = w52;
  var lp = CHd.pts[CHd.pts.length - 1];
  var ds = [['Open', money(lp.o, ccy)],
    ['Day High', money(CHd.dayHigh, ccy)],
    ['Day Low', money(CHd.dayLow, ccy)],
    ['Prev Close', money(CHd.prevClose, ccy)],
    ['Volume', CHd.vol != null && CHd.vol > 0 ? shortVol(CHd.vol) : '–']];
  $('dayStats').innerHTML = ds.map(function (d) { return '<div><span>' + d[0] + '</span><b>' + d[1] + '</b></div>'; }).join('');
  $('metricsGrid').innerHTML = indexMetricCards(CHd);
  var fEl = $('freshStamp'); if (fEl) fEl.textContent = 'Index data · Yahoo Finance (indicative, may be delayed)';
  drawPriceChart(CHd);
  renderScreener(); renderWatchlist();
}
/* ---------------- search ---------------- */
function nameOf(sym) {
  if (CO[sym]) return CO[sym].name;
  var c = cachedCompany(sym);
  return c ? c.name : (UNI[sym] ? UNI[sym].n : sym);
}
function matches(q, sym) {
  q = (q || '').trim().toUpperCase();
  if (!q) return true;
  return sym.indexOf(q) >= 0 || nameOf(sym).toUpperCase().indexOf(q) >= 0;
}
var _searchSeq = 0, _searchT = null;
function renderSearchDrop(q) {
  var box = $('searchDrop');
  if (!q || !q.trim()) { box.hidden = true; box.innerHTML = ''; return; }
  var hits = ACTIVE_UNIVERSE.filter(function (u) { return matches(q, u.sym); }).slice(0, 8);
  if (!hits.length) {
    box.hidden = false;
    box.innerHTML = '<div class="sd-empty">' + (q.trim().length < 2 ? 'Type at least 2 characters to search all stocks' : 'Searching…') + '</div>';
  } else {
    box.hidden = false;
    box.innerHTML = hits.map(function (u) {
      var hit = cachedChartSym(u.sym);
      return '<div class="sd-row" data-sym="' + u.sym + '"><div><b>' + esc(nameOf(u.sym)) + '</b><span class="sd-sym">' + u.sym + ' · ' + esc(u.sec) + '</span></div>' +
        '<div class="sd-p">' + (hit ? '₹' + inr1(hit.price) : 'live…') + '</div></div>';
    }).join('');
  }
  box.setAttribute('data-q', q);
  Array.prototype.forEach.call(box.querySelectorAll('.sd-row[data-sym]'), function (el) {
    el.addEventListener('mousedown', function (e) { e.preventDefault(); selectStock(el.getAttribute('data-sym')); });
  });
  // universal search: anything on screener.in, not just the curated universe
  if (q.trim().length < 2) return;
  var my = ++_searchSeq;
  clearTimeout(_searchT);
  _searchT = setTimeout(function () {
    httpText('https://www.screener.in/api/company/search/?q=' + encodeURIComponent(q.trim()), true).then(function (txt) {
      if (my !== _searchSeq) return;
      if ($('searchInput').value !== q || box.getAttribute('data-q') !== q) return;
      var arr;
      try { arr = JSON.parse(txt); } catch (e) { return; }
      if (!arr || !arr.length) {
        if (!hits.length) box.innerHTML = '<div class="sd-empty">No matches</div>';
        return;
      }
      var seen = {};
      hits.forEach(function (u) { seen[u.sym] = true; });
      var extra = [];
      for (var i = 0; i < arr.length && extra.length < 8; i++) {
        var slug = slugOfUrl(arr[i].url);
        if (!slug || seen[slug]) continue;
        seen[slug] = true;
        extra.push({ slug: slug, name: arr[i].name });
      }
      if (!extra.length) {
        if (!hits.length) box.innerHTML = '<div class="sd-empty">No matches</div>';
        return;
      }
      if (!hits.length) box.innerHTML = '';
      box.innerHTML += '<div class="sd-empty">More from screener.in</div>' + extra.map(function (x) {
        var hit = cachedChartSym(x.slug);
        return '<div class="sd-row" data-slug="' + esc(x.slug) + '" data-name="' + esc(x.name) + '"><div><b>' + esc(x.name) + '</b><span class="sd-sym">' + esc(x.slug) + ' · screener.in</span></div>' +
          '<div class="sd-p">' + (hit ? '₹' + inr1(hit.price) : '') + '</div></div>';
      }).join('');
      Array.prototype.forEach.call(box.querySelectorAll('.sd-row[data-slug]'), function (el) {
        el.addEventListener('mousedown', function (e) { e.preventDefault(); openSlug(el.getAttribute('data-slug'), el.getAttribute('data-name')); });
      });
    }).catch(function () {
      if (my !== _searchSeq) return;
      if (!hits.length && $('searchInput').value === q) box.innerHTML = '<div class="sd-empty">No matches</div>';
    });
  }, 350);
}

/* ---------------- stock detail ---------------- */
function metricCards(C, CH) {
  var f = C.fund, price = CH ? CH.price : f.price;
  var pb = (price != null && f.bv != null && f.bv > 0) ? price / f.bv : null;
  function cls(v) { return v != null ? ' class="' + numCls(v) + '"' : ''; }
  var deTxt = f.de != null ? inr2(f.de) : (f.negEq ? 'Neg. Eq.' : '–');
  var deCls = f.de != null ? (f.de > 1 ? ' class="neg"' : ' class="pos"') : (f.negEq ? ' class="neg"' : '');
  var range52 = (CH && CH.lo52 != null && CH.hi52 != null) ? '₹' + inr0(CH.lo52) + '–' + inr0(CH.hi52) : (C.ratios && C.ratios['High / Low'] ? C.ratios['High / Low'] : '–');
  var cards = [
    ['Market Cap', f.mcap != null ? '₹ ' + inr0(f.mcap) + ' Cr' : '–', ''],
    ['P/E', f.pe != null ? inr1(f.pe) + 'x' : '–', ''],
    ['P/B', pb != null ? inr1(pb) + 'x' : '–', ''],
    ['ROE', f.roe != null ? inr1(f.roe) + '%' : '–', cls(f.roe)],
    ['ROCE', f.roce != null ? inr1(f.roce) + '%' : '–', cls(f.roce)],
    ['Div. Yield', f.dy != null ? inr1(f.dy) + '%' : '–', ''],
    ['D/E', deTxt, deCls],
    ['Face Value', f.fv != null ? '₹' + inr1(f.fv) : '–', ''],
    ['Sales Gr (3Y)', f.gs != null ? pct1(f.gs) : '–', cls(f.gs)],
    ['Profit Gr (3Y)', f.gp != null ? pct1(f.gp) : '–', cls(f.gp)],
    ['OPM (latest)', f.opm != null ? inr1(f.opm) + '%' : '–', cls(f.opm)],
    ['52W Range', range52, '']
  ];
  return cards.map(function (c) { return '<div class="mcard"><span>' + c[0] + '</span><b' + c[2] + '>' + c[1] + '</b></div>'; }).join('');
}
function renderStockHead(C, CH) {
  var f = C.fund, price = CH ? CH.price : f.price, chg = CH ? CH.dayChg : f.chg;
  $('stSym').textContent = C.sym;
  $('stName').textContent = C.name;
  $('stSector').textContent = ((UNI[C.sym] && UNI[C.sym].sec) || C.sector || '') + (C.consolidated === false ? ' · standalone' : ' · consolidated');
  $('stPrice').textContent = price != null ? '₹' + inr1(price) : '–';
  var chgEl = $('stChg');
  if (chg != null) {
    chgEl.textContent = (chg >= 0 ? '▲ +' : '▼ ') + chg.toFixed(2) + '% today';
    chgEl.className = 'chg ' + numCls(chg);
  } else { chgEl.textContent = '–'; chgEl.className = 'chg'; }
  var rEl = $('stRange');
  if (CH && CH.lo52 != null && CH.hi52 != null) {
    rEl.textContent = '52W Low ₹' + inr0(CH.lo52) + ' · 52W High ₹' + inr0(CH.hi52) + (CH.ret1y != null ? ' · 1Y ' + pct1(CH.ret1y) : '');
    rEl.className = CH.ret1y != null ? numCls(CH.ret1y) : '';
  } else { rEl.textContent = ''; rEl.className = ''; }
  $('metricsGrid').innerHTML = metricCards(C, CH);
  var star = $('starBtn'), on = S.wl.indexOf(C.sym) >= 0;
  star.textContent = on ? '★ Watching' : '☆ Watchlist';
  star.classList.toggle('on', on);
  // 52-week position bar
  var w52 = '';
  if (CH && CH.lo52 != null && CH.hi52 != null && CH.hi52 > CH.lo52 && price != null) {
    var pos = Math.min(100, Math.max(0, (price - CH.lo52) / (CH.hi52 - CH.lo52) * 100));
    w52 = '<div class="w52"><div class="w52-track"><div class="w52-fill" style="width:' + pos.toFixed(1) + '%"></div><div class="w52-mark" style="left:' + pos.toFixed(1) + '%"></div></div>' +
      '<div class="w52-lab"><span>Low ₹' + inr0(CH.lo52) + '</span><span>High ₹' + inr0(CH.hi52) + '</span></div></div>';
  }
  $('w52wrap').innerHTML = w52;
  // day stats
  var ds = [];
  if (CH && CH.pts.length) {
    var lp = CH.pts[CH.pts.length - 1];
    ds.push(['Open', lp.o != null ? '₹' + inr1(lp.o) : '–']);
    ds.push(['Day High', CH.dayHigh != null ? '₹' + inr1(CH.dayHigh) : '–']);
    ds.push(['Day Low', CH.dayLow != null ? '₹' + inr1(CH.dayLow) : '–']);
    if (CH.prevClose != null) ds.push(['Prev Close', '₹' + inr1(CH.prevClose)]);
    ds.push(['Volume', CH.vol != null && CH.vol > 0 ? shortVol(CH.vol) : '–']);
  }
  $('dayStats').innerHTML = ds.map(function (d) { return '<div><span>' + d[0] + '</span><b>' + d[1] + '</b></div>'; }).join('');
  var fEl = $('freshStamp');
  if (fEl) {
    var fd = C.fetchedAt ? new Date(C.fetchedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
    fEl.textContent = fd ? 'Financials as of ' + fd + ' · prices live' : 'Prices live';
  }
  renderAbout(C);
}
function shortVol(v) {
  if (v >= 10000000) return (v / 10000000).toFixed(2) + ' Cr';
  if (v >= 100000) return (v / 100000).toFixed(1) + ' L';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
  return '' + Math.round(v);
}
function slugOfUrl(url) {
  var m = String(url || '').match(/\/company\/([^\/]+)/);
  return m ? m[1].toUpperCase() : null;
}
/* Open any screener.in stock by slug (search results, peers, BSE-only codes, ...).
   Curated symbols use the fast path; everything else gets an ephemeral universe entry. */
function openSlug(slug, name) {
  slug = String(slug || '').toUpperCase();
  if (!slug) return;
  if (UNI[slug]) { selectStock(slug); return; }
  UNI[slug] = { sym: slug, y: null, sec: '', n: name || slug };
  S.sym = slug; S.mode = 'stock'; S.index = null;
  FIN_SECTIONS.forEach(function (id) { $(id).hidden = false; });
  var note = $('indexNote'); if (note) note.hidden = true;
  var sc = document.querySelector('.star-col'); if (sc) sc.style.display = '';
  var si = $('searchInput'); if (si) si.value = '';
  $('searchDrop').hidden = true;
  showSkeletons();
  document.getElementById('stockSec').scrollIntoView({ behavior: 'smooth', block: 'start' });
  loadAndRender(slug);
}
window.openSlug = openSlug;
function selectStock(sym) {
  if (!UNI[sym]) return;
  S.sym = sym; S.mode = 'stock'; S.index = null;
  FIN_SECTIONS.forEach(function (id) { $(id).hidden = false; });
  var note = $('indexNote'); if (note) note.hidden = true;
  var sc = document.querySelector('.star-col'); if (sc) sc.style.display = '';
  var si = $('searchInput'); if (si) si.value = '';
  $('searchDrop').hidden = true;
  showSkeletons();
  document.getElementById('stockSec').scrollIntoView({ behavior: 'smooth', block: 'start' });
  loadAndRender(sym);
}
async function loadAndRender(sym) {
  if (S.mode !== 'stock' || S.sym !== sym) return;
  try {
    var C = await ensureCompany(sym);
    if (S.mode !== 'stock' || S.sym !== sym) return;
    var CH = null;
    try { CH = await ensureChart(sym); } catch (e) { CH = null; }
    if (S.mode !== 'stock' || S.sym !== sym) return;
    CO[sym] = C;
    // adopt screener's sector for dynamic entries; grow the sector list for everyone
    if (C.sector) {
      if (UNI[sym] && !UNI[sym].sec) UNI[sym].sec = C.sector;
      if (typeof SECTORS !== 'undefined' && SECTORS.indexOf(C.sector) < 0) { SECTORS.push(C.sector); SECTORS.sort(); }
    }
    renderAll(C, CH);
  } catch (e) {
    if (S.mode !== 'stock' || S.sym !== sym) return;
    renderStockError(sym, e);
  }
}
function showSkeletons() {
  ['qTable', 'pnlTable', 'bsTable', 'cfTable', 'ratTable', 'shTable', 'peersTable'].forEach(function (id) {
    $(id).innerHTML = skel(120);
  });
  $('prosList').innerHTML = '<li>' + skel() + '</li>';
  $('consList').innerHTML = '<li>' + skel() + '</li>';
  $('metricsGrid').innerHTML = skel(140);
  $('stPrice').textContent = '…';
  $('aboutText').innerHTML = skel(90);
  $('docsLinks').innerHTML = skel(60);
}
function renderStockError(sym, e) {
  $('stSym').textContent = sym;
  $('stName').textContent = nameOf(sym);
  $('stSector').textContent = '';
  $('stPrice').textContent = '–';
  var msg = '<div class="errbox"><b>Could not load live data for ' + esc(sym) + '.</b><br><span class="muted">' +
    esc((e && e.message) || 'network error') + ' — check your connection and retry.</span><br>' +
    '<button class="btn sm retryBtn">Retry</button></div>';
  ['qTable', 'pnlTable', 'bsTable', 'cfTable', 'ratTable', 'shTable', 'peersTable'].forEach(function (id) {
    $(id).innerHTML = msg;
    var btn = $(id).querySelector('.retryBtn');
    if (btn) btn.addEventListener('click', function () { selectStock(sym); });
  });
  drawEmpty($('priceChart'), 'No chart data');
}
window.selectStock = selectStock;

/* ---------------- charts ---------------- */
var RANGE_LEN = { '1M': 22, '6M': 126, '1Y': 252, '3Y': 756, '5Y': 5000 };
var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dLabel(ts) { var d = new Date(ts); return MON[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2); }
function fitCanvas(c, hCss) {
  var dpr = window.devicePixelRatio || 1;
  var w = c.parentElement.clientWidth || c.clientWidth || 800, h = hCss || 260;
  c.style.width = '100%'; c.style.height = h + 'px';
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  var ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx: ctx, w: w, h: h };
}
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function drawEmpty(c, msg) {
  if (!c) return;
  var b = fitCanvas(c, 260), ctx = b.ctx;
  ctx.fillStyle = cssVar('--muted') || '#6b7280';
  ctx.font = '13px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(msg || 'No data', b.w / 2, 130);
}
function axFmt(v, ccy) {
  var r = Math.round(v);
  if (ccy === 'USD') return '$' + r.toLocaleString('en-US');
  if (ccy === 'INR' || ccy == null) return '₹' + r.toLocaleString('en-IN');
  return r.toLocaleString('en-IN') + ' ' + ccy;
}
function sma(vals, n) {
  var out = new Array(vals.length).fill(null), s = 0;
  for (var i = 0; i < vals.length; i++) {
    s += vals[i];
    if (i >= n) s -= vals[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}
function drawPriceChart(CH) {
  var c = $('priceChart'); if (!c) return;
  var lg = $('chartLegend'); if (lg) lg.innerHTML = '';
  if (!CH || !CH.pts || !CH.pts.length) { drawEmpty(c, 'Price history unavailable'); return; }
  var ccy = CH.ccy || 'INR';
  var len = RANGE_LEN[S.range] || 252;
  var full = CH.pts;
  var start = Math.max(0, full.length - len);
  var data = full.slice(start);
  var closes = full.map(function (p) { return p.c; });
  var dma50 = sma(closes, 50).slice(start), dma200 = sma(closes, 200).slice(start);
  var box = fitCanvas(c, 280), ctx = box.ctx, W = box.w, H = box.h;
  var padL = 8, padR = 56, padT = 12, padB = 22;
  var priceH = (H - padT - padB) * 0.72, volTop = padT + priceH + 6;
  var min = Infinity, max = -Infinity, vmax = 0;
  data.forEach(function (p) {
    if (p.c < min) min = p.c; if (p.c > max) max = p.c;
    if (p.v > vmax) vmax = p.v;
  });
  var span = (max - min) || 1; min -= span * 0.06; max += span * 0.06;
  function X(i) { return padL + (W - padL - padR) * (i / Math.max(data.length - 1, 1)); }
  function Y(v) { return padT + priceH * (1 - (v - min) / (max - min)); }
  function Yv(v) { return (H - padB) - (H - padB - volTop) * (vmax ? v / vmax : 0); }
  var grid = cssVar('--grid') || '#e5e7eb', txt = cssVar('--muted') || '#6b7280';
  ctx.strokeStyle = grid; ctx.fillStyle = txt; ctx.lineWidth = 1; ctx.font = '10px system-ui';
  for (var g = 0; g <= 4; g++) {
    var v = min + (max - min) * g / 4, y = Y(v);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillText(axFmt(v, ccy), W - padR + 5, y + 3);
  }
  var seenTicks = {};
  for (var t = 0; t <= 4; t++) {
    var ix = Math.round((data.length - 1) * t / 4);
    if (seenTicks[ix]) continue;
    seenTicks[ix] = true;
    ctx.fillText(dLabel(data[ix].t), X(ix) - 14, H - 6);
  }
  // volume bars
  var bw = Math.min(24, Math.max(1, (W - padL - padR) / Math.max(data.length, 1) * 0.7));
  ctx.fillStyle = 'rgba(120,140,170,.45)';
  for (var vi = 0; vi < data.length; vi++) {
    var vh = (H - padB) - Yv(data[vi].v || 0);
    if (vh > 0.5) ctx.fillRect(X(vi) - bw / 2, H - padB - vh, bw, vh);
  }
  var up = data[data.length - 1].c >= data[0].c;
  var line = up ? (cssVar('--pos') || '#0c7a3d') : (cssVar('--neg') || '#d70015');
  var grad = ctx.createLinearGradient(0, padT, 0, padT + priceH);
  grad.addColorStop(0, up ? 'rgba(22,163,74,.25)' : 'rgba(220,38,38,.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath(); ctx.moveTo(X(0), Y(data[0].c));
  for (var i = 1; i < data.length; i++) ctx.lineTo(X(i), Y(data[i].c));
  ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.stroke();
  ctx.lineTo(X(data.length - 1), padT + priceH); ctx.lineTo(X(0), padT + priceH); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
  // DMA overlays
  function dmaLine(arr, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.beginPath();
    var started = false;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] == null) continue;
      if (!started) { ctx.moveTo(X(i), Y(arr[i])); started = true; }
      else ctx.lineTo(X(i), Y(arr[i]));
    }
    if (started) ctx.stroke();
  }
  dmaLine(dma50, cssVar('--dma1') || '#ff9f0a'); dmaLine(dma200, cssVar('--dma2') || '#af52de');
  ctx.beginPath(); ctx.arc(X(data.length - 1), Y(data[data.length - 1].c), 4, 0, 7); ctx.fillStyle = line; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
  c._geom = { X: X, Y: Y, data: data };
  if (lg) {
    var chips = [];
    var d50 = dma50[dma50.length - 1], d200 = dma200[dma200.length - 1];
    var dmac1 = cssVar('--dma1') || '#ff9f0a', dmac2 = cssVar('--dma2') || '#af52de';
    if (d50 != null) chips.push('<span class="lg-chip"><i style="background:' + dmac1 + '"></i>50 DMA ' + money(d50, ccy) + '</span>');
    if (d200 != null) chips.push('<span class="lg-chip"><i style="background:' + dmac2 + '"></i>200 DMA ' + money(d200, ccy) + '</span>');
    chips.push('<span class="lg-chip"><i style="background:' + line + '"></i>' + (data[data.length - 1].v > 0 ? 'Vol ' + shortVol(data[data.length - 1].v) : 'Vol –') + '</span>');
    lg.innerHTML = chips.join('');
  }
}
function bindChartHover() {
  var c = $('priceChart'), tip = $('chartTip'), hideT = null;
  function showTipAt(clientX) {
    var g = c._geom; if (!g || !g.data.length) return;
    var r = c.getBoundingClientRect(), mx = clientX - r.left;
    var spanW = Math.max(1, r.width - 8 - 56);
    var i = Math.round((mx - 8) / spanW * (g.data.length - 1));
    i = Math.max(0, Math.min(g.data.length - 1, i));
    tip.hidden = false;
    var x = g.X(i), y = g.Y(g.data[i].c);
    var tx = x > r.width * 0.65 ? '-95%' : '-10%';
    var ty = y < 56 ? '18%' : '-110%';
    tip.style.left = Math.max(4, Math.min(r.width - 4, x + (x > r.width * 0.65 ? -8 : 10))) + 'px';
    tip.style.top = (y < 56 ? y + 10 : y - 10) + 'px';
    tip.style.transform = 'translate(' + tx + ',' + ty + ')';
    var d = new Date(g.data[i].t);
    tip.innerHTML = '<b>' + money(g.data[i].c, (LAST_CH && LAST_CH.ccy) || 'INR') + '</b><span>' + d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + '</span>';
  }
  c.addEventListener('mousemove', function (e) { showTipAt(e.clientX); });
  c.addEventListener('mouseleave', function () { tip.hidden = true; });
  c.addEventListener('touchstart', function (e) {
    if (hideT) { clearTimeout(hideT); hideT = null; }
    showTipAt(e.touches[0].clientX);
  }, { passive: true });
  c.addEventListener('touchmove', function (e) { showTipAt(e.touches[0].clientX); }, { passive: true });
  c.addEventListener('touchend', function () {
    if (hideT) clearTimeout(hideT);
    hideT = setTimeout(function () { tip.hidden = true; }, 1600);
  });
}

/* ---------------- generic financial table ---------------- */
var GROWTH_LABELS = ['sales', 'operating profit', 'profit before tax', 'net profit', 'eps', 'total income', 'interest earned', 'revenue'];
function shouldGrow(label) {
  var l = label.toLowerCase();
  return GROWTH_LABELS.some(function (g) { return l === g || l.indexOf(g) === 0; });
}
function finTableHTML(T, opts) {
  opts = opts || {};
  if (!T || !T.rows.length) return '<p class="muted pad">Not disclosed for this company.</p>';
  var n = opts.cols || 8;
  var cols = T.cols.slice(-n), off = T.cols.length - cols.length;
  var h = '<table class="fin"><thead><tr><th class="sticky">' + esc(opts.first || 'Metric') + '</th>';
  cols.forEach(function (c) { h += '<th class="num">' + esc(c) + '</th>'; });
  h += '</tr></thead><tbody>';
  T.rows.forEach(function (r) {
    h += '<tr><td class="sticky">' + esc(r.label) + '</td>';
    for (var i = 0; i < cols.length; i++) {
      var colIdx = off + i;
      var raw = r.vals[colIdx], nv = r.nums[colIdx];
      var sub = null, cls = '';
      if (opts.growth && shouldGrow(r.label)) {
        var prevIdx = opts.quarterly ? (colIdx - 4) : (colIdx - 1);
        var isTTM = !opts.quarterly && /^ttm$/i.test(String(cols[i] || '').trim());
        if (prevIdx >= 0 && !isTTM && (opts.quarterly || i > 0)) {
          var pv = r.nums[prevIdx];
          if (nv != null && pv != null && pv > 0) {
            var g = (nv / pv - 1) * 100;
            sub = (g >= 0 ? '+' : '') + g.toFixed(1) + '% YoY';
            cls = numCls(g);
          }
        }
      }
      h += '<td class="num">' + esc(raw == null || raw === '' ? '–' : raw) + (sub ? '<div class="sub ' + cls + '">' + sub + '</div>' : '') + '</td>';
    }
    h += '</tr>';
  });
  h += '</tbody></table>';
  return h;
}

/* ---------------- detail sections ---------------- */
function renderProsCons(C) {
  $('prosList').innerHTML = C.pros.length ? C.pros.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') : '<li class="muted">No checklist pros published.</li>';
  $('consList').innerHTML = C.cons.length ? C.cons.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') : '<li class="muted">No checklist cons published.</li>';
}
function shortPeerHead(s) {
  // screener peer headers carry units/tooltips/sample values — map to crisp labels
  var t = String(s || '').replace(/\s+/g, ' ').trim();
  var L = t.toLowerCase();
  var RULES = [
    [/\bcmp\b/, 'CMP ₹'],
    [/mar(?:ket)?\s*cap/, 'M.Cap Cr'],
    [/div.*yld/, 'Div Yld%'],
    [/qtr.*profit.*var|qtr p.*var/, 'Qtr P Gr%'],
    [/np\s*qtr|net profit/, 'Qtr Profit'],
    [/qtr.*sal.*var/, 'Qtr S Gr%'],
    [/sales.*qtr|qtr.*sal/, 'Qtr Sales'],
    [/gnpa/, 'GNPA%'], [/net npa|nnpa/, 'NNPA%'],
    [/casa/, 'CASA%'], [/\bnim\b/, 'NIM%'],
    [/roce/, 'ROCE%'], [/\broe\b/, 'ROE%'], [/\broa\b/, 'ROA%'],
    [/\bp\/?e\b/, 'P/E'], [/eps/, 'EPS ₹'],
    [/debtor|receiv/, 'Debtors D'], [/inventory|stock/, 'Inv Days'],
    [/payable|creditor/, 'Pay Days'], [/cash.*conv|\bccc\b/, 'CCC'],
    [/work.*cap/, 'WC Days'], [/interest.*cover/, 'Int Cov'],
    [/current ratio/, 'Cur Ratio'], [/quick/, 'Quick'],
    [/debt.*eq|\bd\s*\/\s*e\b/, 'D/E'], [/payout|dividend.*pay/, 'Payout%'],
    [/book/, 'Book Val'], [/\bsales\b/, 'Sales'], [/\bprofit\b/, 'Profit'],
    [/revenue/, 'Revenue'], [/price/, 'Price'], [/\bmcap\b/, 'M.Cap']
  ];
  for (var i = 0; i < RULES.length; i++) {
    if (RULES[i][0].test(L)) return RULES[i][1];
  }
  var f = t.replace(/^[0-9,.]+\s+/, '').split('·')[0].split('.')[0].trim();
  return (f.length > 16 ? f.slice(0, 15) + '…' : f) || '–';
}
function renderPeers(C) {
  if (!C.peers.length) { $('peersTable').innerHTML = '<p class="muted pad">No peer list published for this company.</p>'; return; }
  var heads = (C.metricHeads || []).map(shortPeerHead);
  var h = '<table class="fin"><thead><tr><th class="sticky">Company</th>';
  var rows = C.peers.map(function (p) { return p; });
  var maxV = 1;
  rows.forEach(function (p) { maxV = Math.max(maxV, (p.vals || []).length); });
  var take = Math.max(heads.length, maxV);
  var headTake = heads.slice(-take);
  while (headTake.length < take) headTake.unshift('');
  headTake.forEach(function (x) { h += '<th class="num">' + esc(x) + '</th>'; });
  h += '</tr></thead><tbody>';
  rows.forEach(function (p) {
    var vals = (p.vals || []).slice(-take);
    while (vals.length < take) vals.unshift('');
    var link = p.sym ? '<a class="peerlink" data-sym="' + esc(p.sym) + '" data-name="' + esc(p.name) + '">' + esc(p.name) + '</a>' : esc(p.name);
    h += '<tr' + (p.sym === C.sym ? ' class="hl"' : '') + '><td class="sticky">' + link + '</td>';
    vals.forEach(function (v) { h += '<td class="num">' + esc(v === '' ? '–' : v) + '</td>'; });
    h += '</tr>';
  });
  $('peersTable').innerHTML = h + '</table><p class="tbl-note">Live peer list from screener.in. Highlighted row is this company where listed.</p>';
  Array.prototype.forEach.call(document.querySelectorAll('#peersTable .peerlink'), function (el) {
    el.addEventListener('click', function () { openSlug(el.getAttribute('data-sym'), el.getAttribute('data-name')); });
  });
}
function renderStatements(C) {
  $('qTable').innerHTML = finTableHTML(C.quarters, { cols: 8, growth: true, quarterly: true, first: 'Metric · ₹ Cr' }) +
    '<p class="tbl-note">Quarterly figures in ₹ Cr with YoY growth vs. same quarter last year. Source: screener.in (consolidated where available).</p>';
  var T = C.pnl, n = 8, note = '';
  if (T && T.cols.length > n) note = 'Showing latest ' + n + ' periods. ';
  $('pnlTable').innerHTML = finTableHTML(T, { cols: n, growth: true, first: 'Metric · ₹ Cr' }) +
    '<p class="tbl-note">' + note + 'Annual figures in ₹ Cr, last column is TTM where published. Source: screener.in.</p>';
  $('bsTable').innerHTML = finTableHTML(C.bs, { cols: 8, first: 'Metric · ₹ Cr' }) + '<p class="tbl-note">Figures in ₹ Cr. Source: screener.in.</p>';
  $('cfTable').innerHTML = finTableHTML(C.cf, { cols: 8, first: 'Metric · ₹ Cr' }) + '<p class="tbl-note">Figures in ₹ Cr. Source: screener.in.</p>';
  $('ratTable').innerHTML = finTableHTML(C.rat, { cols: 8, first: 'Metric' }) + '<p class="tbl-note">Year-wise ratios as published. Source: screener.in.</p>';
  drawFinChart(C);
}
function shortCr(v) {
  if (v == null) return '–';
  var a = Math.abs(v);
  if (a >= 100000) return (v / 100000).toFixed(1) + 'L';
  if (a >= 1000) return (v / 1000).toFixed(1) + 'K';
  return Math.round(v) + '';
}
function drawFinChart(C) {
  var c = $('finChart'); if (!c) return;
  if (!C.pnl) { drawEmpty(c, 'No data'); return; }
  var row = S.finMode === 'sales'
    ? (findRow(C.pnl, ['sales']) || findRow(C.pnl, ['total income']) || findRow(C.pnl, ['revenue']) || findRow(C.pnl, ['interest earned']))
    : findRow(C.pnl, ['net profit']);
  var name = row ? row.label : '';
  var pairs = [];
  if (row) {
    for (var pi = 0; pi < row.nums.length; pi++) {
      if (row.nums[pi] != null) pairs.push({ lbl: C.pnl.cols[pi] || '', val: row.nums[pi] });
    }
  }
  pairs = pairs.slice(-10);
  var data = pairs.map(function (p) { return p.val; });
  var labels = pairs.map(function (p) { return p.lbl; });
  if (!data.length) { drawEmpty(c, name ? 'No numeric series for ' + name : 'No revenue series for this company'); return; }
  var box = fitCanvas(c, 220), ctx = box.ctx, W = box.w, H = box.h;
  var max = Math.max.apply(null, data.map(Math.abs)) * 1.15 || 1;
  var mn = Math.min.apply(null, data), lo = mn < 0 ? -max : 0;
  function Y(v) { var pT = 16, pB = 30; return pT + (H - pT - pB) * (1 - (v - lo) / (max - lo)); }
  var grid = cssVar('--grid') || '#e5e7eb', txt = cssVar('--muted') || '#6b7280';
  ctx.font = '10px system-ui';
  for (var g = 0; g <= 3; g++) {
    var vv = lo + (max - lo) * g / 3, y = Y(vv);
    ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(34, y); ctx.lineTo(W - 6, y); ctx.stroke();
    ctx.fillStyle = txt; ctx.fillText(shortCr(vv), 2, y + 3);
  }
  var baseY = Y(0), bw = (W - 40) / data.length * 0.55;
  for (var i = 0; i < data.length; i++) {
    var cx = 34 + (W - 44) * (i + 0.5) / data.length, y2 = Y(data[i]);
    var top = Math.min(baseY, y2), hh = Math.abs(baseY - y2) || 1;
    var col = S.finMode === 'sales' ? '10,132,255' : (data[i] >= 0 ? '48,209,88' : '255,69,58');
    var grad = ctx.createLinearGradient(0, top, 0, top + hh);
    grad.addColorStop(0, 'rgba(' + col + ',.95)'); grad.addColorStop(1, 'rgba(' + col + ',.55)');
    ctx.fillStyle = grad; ctx.fillRect(cx - bw / 2, top, bw, hh);
    ctx.fillStyle = txt; ctx.fillText(String(labels[i] || '').replace('Mar ', "'"), cx - 8, H - 12);
    ctx.fillStyle = cssVar('--ink') || '#111'; ctx.fillText(shortCr(data[i]), cx - 16, top - 5);
  }
  c.title = name;
}
function renderSH(C) {
  var T = C.shp;
  if (!T || !T.rows.length) { $('shTable').innerHTML = '<p class="muted pad">Shareholding data not published for this company.</p>'; drawEmpty($('shChart'), 'No data'); return; }
  var want = ['promoter', 'government', 'fii', 'dii', 'public', 'other'];
  var picked = want.map(function (w) { return T.rows.find(function (r) { return r.label.toLowerCase().indexOf(w) === 0; }); })
    .filter(Boolean).slice(0, 6);
  var cols = ['#0a84ff', '#32ade6', '#ff9f0a', '#30d158', '#8e8e93', '#bf5af2'];
  var h = '<table class="fin"><thead><tr><th class="sticky">Holder</th>';
  T.cols.forEach(function (c) { h += '<th class="num">' + esc(c) + '</th>'; });
  h += '</tr></thead><tbody>';
  picked.forEach(function (r, i) {
    h += '<tr><td class="sticky"><span class="dot" style="background:' + cols[i] + '"></span>' + esc(r.label) + '</td>';
    r.vals.forEach(function (v) { h += '<td class="num">' + esc(v || '–') + '</td>'; });
    h += '</tr>';
  });
  $('shTable').innerHTML = h + '</tbody></table><p class="tbl-note">Quarterly shareholding in %. Source: screener.in.</p>';
  // stacked chart
  var c = $('shChart'), box = fitCanvas(c, 240), ctx = box.ctx, W = box.w, H = box.h;
  var n = T.cols.length, padB = 30, padT = 14;
  var bw = (W - 20) / n * 0.58;
  ctx.font = '10px system-ui';
  var txt = cssVar('--muted') || '#6b7280';
  for (var i = 0; i < n; i++) {
    var cx = 10 + (W - 20) * (i + 0.5) / n, y = H - padB, tot = 0;
    picked.forEach(function (r) { tot += r.nums[i] || 0; });
    picked.forEach(function (r, k) {
      var hh = tot ? (H - padT - padB) * (r.nums[i] || 0) / tot : 0;
      ctx.fillStyle = cols[k]; ctx.fillRect(cx - bw / 2, y - hh, bw, hh); y -= hh;
    });
    ctx.fillStyle = txt; ctx.fillText(T.cols[i].replace(' 20', " '"), cx - 20, H - 10);
  }
}
function renderDocs(C) {
  var isBSE = /^\d+$/.test(String(C.sym || ''));
  var links = [];
  if (C.site) links.push(['Company website', C.site]);
  links.push(['screener.in company page', 'https://www.screener.in/company/' + encodeURIComponent(C.sym) + '/']);
  if (C.nse) links.push(['NSE quote page', C.nse]);
  else if (!isBSE) links.push(['NSE quote page', 'https://www.nseindia.com/get-quotes/equity?symbol=' + encodeURIComponent(C.sym)]);
  if (C.bse) links.push(['BSE quote page', C.bse]);
  else if (isBSE) links.push(['BSE quote page', 'https://www.bseindia.com/stock-share-price/x/x/' + encodeURIComponent(C.sym) + '/']);
  links.push(['Yahoo Finance quote', 'https://finance.yahoo.com/quote/' + encodeURIComponent(yOf(C.sym))]);
  $('docsLinks').innerHTML = links.map(function (L) {
    return '<div class="doc-row"><div><b>' + esc(L[0]) + '</b><span>' + esc(L[1]) + '</span></div>' +
      '<a class="btn sm" href="' + esc(L[1]) + '" target="_blank" rel="noopener">Open ↗</a></div>';
  }).join('');
}
function renderAbout(C) {
  var paras = C.about.length ? C.about.slice(0, 3).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('')
    : '<p class="muted">Company description not published on the source page.</p>';
  $('aboutText').innerHTML = paras + '<p class="muted" style="font-size:12.5px">Source: screener.in company profile. Consolidated statements where available.</p>';
  var prom = null;
  if (C.shp) {
    var pr = C.shp.rows.find(function (r) { return r.label.toLowerCase().indexOf('promoter') === 0; });
    if (pr) { var v = pr.nums.filter(function (x) { return x != null; }); prom = v.length ? v[v.length - 1] : null; }
  }
  var isBSE = /^\d+$/.test(String(C.sym || ''));
  $('aboutFacts').innerHTML =
    '<div><span>Sector</span><b>' + esc((UNI[C.sym] && UNI[C.sym].sec) || C.sector || '–') + '</b></div>' +
    '<div><span>' + (isBSE ? 'BSE code' : 'NSE symbol') + '</span><b>' + esc(C.sym) + '</b></div>' +
    '<div><span>Promoter holding</span><b>' + (prom != null ? inr1(prom) + '%' : '–') + '</b></div>' +
    '<div><span>Face value</span><b>' + (C.fund.fv != null ? '₹' + inr1(C.fund.fv) : '–') + '</b></div>' +
    '<div><span>Yahoo symbol</span><b>' + esc(yOf(C.sym)) + '</b></div>';
}
function renderAll(C, CHd) {
  LAST_CH = CHd;
  renderStockHead(C, CHd);
  drawPriceChart(CHd);
  renderProsCons(C);
  renderPeers(C);
  renderStatements(C);
  renderSH(C);
  renderDocs(C);
  renderScreener();
  renderWatchlist();
}

/* ---------------- screener ---------------- */
var PRESETS = {
  'Large caps': { mcapMin: 200000 }, 'High ROE (>20%)': { roeMin: 20 },
  'High dividends': { dyMin: 2 }, 'Low P/E (<20)': { peMax: 20 },
  'Almost debt-free': { deMax: 0.2 }, 'Fast growers': { gsMin: 12, gpMin: 15 }, 'Reset': {}
};
function fundOf(sym) {
  var C = CO[sym] || cachedCompany(sym);
  return C ? C.fund : null;
}
function rowPasses(u, f, fund, ch) {
  if (f.onlyWL && S.wl.indexOf(u.sym) < 0) return false;
  if (f.sector !== 'ALL' && u.sec !== f.sector) return false;
  function minFail(v, lim) { return lim != null && (v == null || isNaN(v) || v < lim); }
  function maxFail(v, lim) { return lim != null && (v == null || isNaN(v) || v > lim); }
  if (minFail(fund && fund.mcap, f.mcapMin)) return false;
  if (maxFail(fund && fund.pe, f.peMax)) return false;
  if (minFail(fund && fund.roe, f.roeMin)) return false;
  if (minFail(fund && fund.roce, f.roceMin)) return false;
  if (minFail(fund && fund.dy, f.dyMin)) return false;
  if (maxFail(fund && fund.de, f.deMax)) return false;
  if (minFail(fund && fund.gs, f.gsMin)) return false;
  if (minFail(fund && fund.gp, f.gpMin)) return false;
  if (minFail(fund && fund.opm, f.opmMin)) return false;
  if (f.q && !matches(f.q, u.sym)) return false;
  return true;
}
function activeFilters(f) {
  return f.sector !== 'ALL' || f.mcapMin != null || f.peMax != null || f.roeMin != null || f.roceMin != null || f.dyMin != null ||
    f.deMax != null || f.gsMin != null || f.gpMin != null || f.opmMin != null || f.onlyWL || (f.q && f.q.trim());
}
function sortVal(u, fund, ch, key) {
  switch (key) {
    case 'sym': return u.sym;
    case 'name': return nameOf(u.sym);
    case 'price': return ch ? ch.price : (fund && fund.price);
    case 'mcap': return fund && fund.mcap; case 'pe': return fund && fund.pe;
    case 'roe': return fund && fund.roe; case 'roce': return fund && fund.roce;
    case 'dy': return fund && fund.dy; case 'de': return fund && fund.de;
    case 'gs': return fund && fund.gs; case 'gp': return fund && fund.gp;
    case 'opm': return fund && fund.opm; case 'ret1y': return ch && ch.ret1y;
    case 'wl': return S.wl.indexOf(u.sym) >= 0 ? 1 : 0;
    default: return fund && fund.mcap;
  }
}
/* Screener rows: the curated universe plus any explored stocks whose
   fundamentals are already cached (from search/peer browsing). */
function screenerBase() {
  var base = ACTIVE_UNIVERSE.slice(), seen = {};
  base.forEach(function (u) { seen[u.sym] = true; });
  Object.keys(UNI).forEach(function (s) {
    if (seen[s]) return;
    var c = CO[s] || cachedCompany(s);
    if (c && c.fund) { base.push(UNI[s]); seen[s] = true; }
  });
  return base;
}
function screenRows() {
  var f = S.scr;
  var out = screenerBase().map(function (u) {
    return { u: u, fund: fundOf(u.sym), ch: chartOf(u.sym) };
  }).filter(function (r) { return rowPasses(r.u, f, r.fund, r.ch); });
  var key = S.scr.sort, dir = S.scr.dir;
  out.sort(function (a, b) {
    var va = sortVal(a.u, a.fund, a.ch, key), vb = sortVal(b.u, b.fund, b.ch, key);
    var aEmpty = (va == null || (typeof va === 'number' && isNaN(va)));
    var bEmpty = (vb == null || (typeof vb === 'number' && isNaN(vb)));
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1; if (bEmpty) return -1;
    if (typeof va === 'string') return dir * String(va).localeCompare(String(vb));
    return dir * (va - vb);
  });
  return out;
}
function queryPreview() {
  var f = S.scr, p = [];
  if (f.sector !== 'ALL') p.push('Sector = "' + f.sector + '"');
  if (f.mcapMin != null) p.push('Market cap ≥ ' + inr0(f.mcapMin));
  if (f.peMax != null) p.push('P/E ≤ ' + f.peMax);
  if (f.roeMin != null) p.push('ROE ≥ ' + f.roeMin + '%');
  if (f.roceMin != null) p.push('ROCE ≥ ' + f.roceMin + '%');
  if (f.dyMin != null) p.push('Dividend yield ≥ ' + f.dyMin + '%');
  if (f.deMax != null) p.push('Debt/Equity ≤ ' + f.deMax);
  if (f.gsMin != null) p.push('Sales growth 3Y ≥ ' + f.gsMin + '%');
  if (f.gpMin != null) p.push('Profit growth 3Y ≥ ' + f.gpMin + '%');
  if (f.opmMin != null) p.push('OPM ≥ ' + f.opmMin + '%');
  if (f.onlyWL) p.push('in Watchlist');
  if (f.q.trim()) p.push('matches "' + f.q.trim() + '"');
  return p.length ? p.join('  AND  ') : 'All stocks (no filters)';
}
var SCR_COLS = [
  ['sym', 'Symbol'], ['name', 'Company'], ['price', 'CMP ₹'], ['mcap', 'M.Cap Cr'],
  ['pe', 'P/E'], ['roe', 'ROE%'], ['roce', 'ROCE%'], ['dy', 'Div%'], ['de', 'D/E'],
  ['opm', 'OPM%'], ['gs', 'SalesGr%'], ['gp', 'ProfitGr%'], ['ret1y', '1Y%'], ['wl', '★']
];
var _lastSectorKey = '';
function renderScreener() {
  var f = S.scr;
  var secSel = $('f_sector');
  var secKey = SECTORS.join('|');
  if (!secSel.options.length || secKey !== _lastSectorKey) {
    _lastSectorKey = secKey;
    secSel.innerHTML = '<option value="ALL">All sectors</option>' + SECTORS.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('');
  }
  secSel.value = f.sector;
  $('queryPreview').textContent = queryPreview();
  var nf = (f.sector !== 'ALL' ? 1 : 0) + (f.mcapMin != null ? 1 : 0) + (f.peMax != null ? 1 : 0) +
    (f.roeMin != null ? 1 : 0) + (f.roceMin != null ? 1 : 0) + (f.dyMin != null ? 1 : 0) +
    (f.deMax != null ? 1 : 0) + (f.gsMin != null ? 1 : 0) + (f.gpMin != null ? 1 : 0) +
    (f.opmMin != null ? 1 : 0) + (f.onlyWL ? 1 : 0) + (f.q.trim() ? 1 : 0);
  $('resetBtn').textContent = nf ? 'Reset (' + nf + ')' : 'Reset';
  var rows = screenRows();
  var per = 15, pages = Math.max(1, Math.ceil(rows.length / per));
  if (f.page >= pages) f.page = pages - 1;
  var slice = rows.slice(f.page * per, f.page * per + per);
  function cell(v, isPct, loaded) {
    if (v == null || isNaN(v)) return '<span class="muted">' + (loaded ? '–' : '…') + '</span>';
    return isPct ? '<span class="' + numCls(v) + '">' + pct1(v) + '</span>' : inr1(v);
  }
  var h = '<table class="fin sortable"><thead><tr>';
  SCR_COLS.forEach(function (c) {
    var arrow = S.scr.sort === c[0] ? (S.scr.dir === 1 ? ' ▲' : ' ▼') : '';
    var cls = c[0] === 'sym' ? 'sticky' : (c[0] === 'name' ? 'sticky2' : 'num');
    h += '<th data-k="' + c[0] + '" class="' + cls + '">' + c[1] + arrow + '</th>';
  });
  h += '</tr></thead><tbody>';
  slice.forEach(function (r) {
    var u = r.u, d = r.fund || {}, ch = r.ch, loaded = CO[u.sym] !== undefined;
    var stared = S.wl.indexOf(u.sym) >= 0;
    h += '<tr>' +
      '<td class="sticky"><a class="peerlink" data-sym="' + u.sym + '"><b>' + u.sym + '</b></a></td>' +
      '<td class="sticky2">' + esc(nameOf(u.sym)) + '</td>' +
      '<td class="num">' + (ch ? inr1(ch.price) : (d.price != null ? inr1(d.price) : '<span class="muted">' + (loaded ? '–' : '…') + '</span>')) + '</td>' +
      '<td class="num">' + (d.mcap != null ? inr0(d.mcap) : '<span class="muted">' + (loaded ? '–' : '…') + '</span>') + '</td>' +
      '<td class="num">' + cell(d.pe, false, loaded) + '</td>' +
      '<td class="num">' + cell(d.roe, false, loaded) + '</td>' +
      '<td class="num">' + cell(d.roce, false, loaded) + '</td>' +
      '<td class="num">' + cell(d.dy, false, loaded) + '</td>' +
      '<td class="num">' + (d.de != null ? inr2(d.de) : (d.negEq ? '<span class="neg">Neg</span>' : '<span class="muted">' + (loaded ? '–' : '…') + '</span>')) + '</td>' +
      '<td class="num">' + cell(d.opm, false, loaded) + '</td>' +
      '<td class="num">' + cell(d.gs, true, loaded) + '</td>' +
      '<td class="num">' + cell(d.gp, true, loaded) + '</td>' +
      '<td class="num">' + (ch && ch.ret1y != null ? '<span class="' + numCls(ch.ret1y) + '">' + pct1(ch.ret1y) + '</span>' : '<span class="muted">' + (ch ? '–' : '…') + '</span>') + '</td>' +
      '<td class="num"><button class="star sm2" data-wl="' + u.sym + '">' + (stared ? '★' : '☆') + '</button></td>' +
      '</tr>';
  });
  h += '</tbody></table>';
  if (!slice.length) h = '<p class="muted pad">No stocks match these filters. Loosen a condition or Reset.</p>' + h;
  $('screenTable').innerHTML = h;
  $('countEl').textContent = rows.length + ' of ' + screenerBase().length + ' stocks';
  $('pageInfo').textContent = 'Page ' + (f.page + 1) + ' / ' + pages;
  Array.prototype.forEach.call(document.querySelectorAll('#screenTable th[data-k]'), function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (S.scr.sort === k) S.scr.dir *= -1; else { S.scr.sort = k; S.scr.dir = (k === 'name' || k === 'sym') ? 1 : -1; }
      renderScreener();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('#screenTable .peerlink'), function (el) {
    el.addEventListener('click', function () { selectStock(el.getAttribute('data-sym')); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('#screenTable [data-wl]'), function (b) {
    b.addEventListener('click', function (e) { e.stopPropagation(); toggleWL(b.getAttribute('data-wl')); });
  });
}
function readScreenerInputs() {
  var f = S.scr, g = function (id) { return $(id).value; };
  function numOrNull(id) {
    var raw = String(g(id)).trim();
    if (raw === '') return null;
    var v = Number(raw);
    return isNaN(v) ? null : v;
  }
  f.q = g('f_q'); f.sector = g('f_sector') || 'ALL';
  f.mcapMin = numOrNull('f_mcap'); f.peMax = numOrNull('f_pe');
  f.roeMin = numOrNull('f_roe'); f.roceMin = numOrNull('f_roce');
  f.dyMin = numOrNull('f_dy'); f.deMax = numOrNull('f_de');
  f.gsMin = numOrNull('f_gs'); f.gpMin = numOrNull('f_gp');
  f.opmMin = numOrNull('f_opm');
  f.onlyWL = $('f_onlyWL').checked;
  f.page = 0;
}
function renderPresets() {
  $('presets').innerHTML = Object.keys(PRESETS).map(function (k) {
    return '<button class="chip" data-p="' + k + '">' + k + '</button>';
  }).join('');
  Array.prototype.forEach.call(document.querySelectorAll('#presets .chip'), function (b) {
    b.addEventListener('click', function () {
      resetScreenerInputs();
      var p = PRESETS[b.getAttribute('data-p')] || {};
      if (p.mcapMin != null) $('f_mcap').value = p.mcapMin;
      if (p.roeMin != null) $('f_roe').value = p.roeMin;
      if (p.dyMin != null) $('f_dy').value = p.dyMin;
      if (p.peMax != null) $('f_pe').value = p.peMax;
      if (p.deMax != null) $('f_de').value = p.deMax;
      if (p.gsMin != null) $('f_gs').value = p.gsMin;
      if (p.gpMin != null) $('f_gp').value = p.gpMin;
      readScreenerInputs(); renderScreener();
      document.getElementById('screenSec').scrollIntoView({ behavior: 'smooth' });
    });
  });
}
function resetScreenerInputs() {
  ['f_q', 'f_mcap', 'f_pe', 'f_roe', 'f_roce', 'f_dy', 'f_de', 'f_gs', 'f_gp', 'f_opm'].forEach(function (id) { $(id).value = ''; });
  $('f_sector').value = 'ALL'; $('f_onlyWL').checked = false;
  S.scr = { q: '', sector: 'ALL', mcapMin: null, peMax: null, roeMin: null, roceMin: null, dyMin: null, deMax: null, gsMin: null, gpMin: null, opmMin: null, sort: 'mcap', dir: -1, page: 0, onlyWL: false };
}

/* progressive background load of the whole universe */
var _loadingAll = false;
async function loadAllData() {
  if (_loadingAll) return;
  _loadingAll = true;
  var syms = ACTIVE_UNIVERSE.map(function (u) { return u.sym; });
  var need = syms.filter(function (s) { return !cachedCompany(s); });
  var total = need.length, doneN = 0, failN = 0;
  function progress(pct, label) {
    var bar = $('loadFill'); if (bar) bar.style.width = Math.round(pct) + '%';
    var tx = $('loadTxt'); if (tx) tx.textContent = label;
  }
  progress(2, total ? 'Loading live financials… 0/' + total : 'Checking cache…');
  await mapLimit(need, 2, async function (s) {
    try { CO[s] = await ensureCompany(s); }
    catch (e) {
      // one gentle retry — bulk bursts can trip transient proxy/rate limits
      await sleep(1500);
      try { CO[s] = await ensureCompany(s); }
      catch (e2) { CO[s] = null; failN++; }
    }
    await sleep(400);
    return true;
  }, function (d) {
    doneN = d;
    progress(2 + 68 * doneN / Math.max(total, 1), 'Loading live financials… ' + doneN + '/' + total);
    renderScreener();
  });
  // price history for all (fast, cached daily)
  var doneC = 0, failC = 0;
  await mapLimit(syms, 6, async function (s) {
    try { await ensureChart(s); }
    catch (e) { failC++; }
    return true;
  }, function (d) {
    doneC = d;
    progress(70 + 30 * doneC / syms.length, 'Loading price history… ' + doneC + '/' + syms.length);
    renderScreener();
  });
  var badNames = syms.filter(function (s) { return !CO[s]; });
  if (badNames.length) {
    progress(100, 'Could not load ' + badNames.length + ' stock(s): ' + badNames.join(', ') + ' — tap Refresh to retry.');
  } else if (failC) {
    progress(100, 'Financials loaded ✓ · price history missing for ' + failC + ' stock(s) — tap Refresh to retry.');
  } else {
    progress(100, 'Live data up to date ✓ (' + syms.length + ' stocks cached)');
  }
  renderScreener();
  // refresh the open stock with chart if it arrived later
  if (S.mode === 'stock' && CO[S.sym]) {
    var curSym = S.sym;
    try {
      var CHx = await ensureChart(curSym).catch(function () { return null; });
      if (S.mode === 'stock' && S.sym === curSym && CHx && CO[curSym]) renderAll(CO[curSym], CHx);
    } catch (e) {}
  }
  _loadingAll = false;
}

/* loadAllData wrapper: never leave the busy flag stuck on unexpected throws */
var _loadAllRaw = loadAllData;
loadAllData = async function () {
  if (_loadingAll) return;
  try { await _loadAllRaw(); }
  finally { _loadingAll = false; }
};

/* ---------------- watchlist ---------------- */
function toggleWL(sym) {
  var i = S.wl.indexOf(sym);
  if (i >= 0) S.wl.splice(i, 1); else S.wl.push(sym);
  saveWL();
  // in index mode the hero shows the index — don't repaint it with the stale stock
  if (S.mode === 'stock' && CO[S.sym]) renderStockHead(CO[S.sym], chartOf(S.sym));
  renderScreener(); renderWatchlist();
}
function renderWatchlist() {
  $('watchCount').textContent = S.wl.length ? S.wl.length + ' watching' : '';
  var box = $('watchlistRow');
  if (!S.wl.length) { box.innerHTML = '<p class="muted">No stocks yet — tap ☆ on any stock or in the screener to track it here. Saved in this browser.</p>'; return; }
  box.innerHTML = S.wl.map(function (sym) {
    var ch = chartOf(sym), C = CO[sym] || cachedCompany(sym);
    var nm = C ? C.name : nameOf(sym);
    return '<div class="wl-card" data-sym="' + sym + '"><div><b>' + sym + '</b><span>' + esc(nm) + '</span></div>' +
      '<div class="wl-p">' + (ch ? '₹' + inr1(ch.price) + ' <i class="' + numCls(ch.dayChg) + '">' + pct1(ch.dayChg) + '</i>' : 'live…') + '</div>' +
      '<button class="star sm2" data-unwl="' + sym + '">★</button></div>';
  }).join('');
  Array.prototype.forEach.call(box.querySelectorAll('.wl-card'), function (el) {
    el.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-unwl')) return;
      selectStock(el.getAttribute('data-sym'));
    });
  });
  Array.prototype.forEach.call(box.querySelectorAll('[data-unwl]'), function (b) {
    b.addEventListener('click', function (e) { e.stopPropagation(); toggleWL(b.getAttribute('data-unwl')); });
  });
}

/* ---------------- install (PWA / add-to-home-screen) ---------------- */
var _deferredPrompt = null;
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  _deferredPrompt = e;
  var b = $('installGoBtn');
  if (b) b.hidden = false;
});
function openInstall() {
  var ov = $('installOverlay');
  if (ov) ov.hidden = false;
  var b = $('installGoBtn');
  if (b) b.hidden = !_deferredPrompt;
}
async function nativeInstall() {
  if (!_deferredPrompt) return;
  _deferredPrompt.prompt();
  try { await _deferredPrompt.userChoice; } catch (e) {}
  _deferredPrompt = null;
  var b = $('installGoBtn');
  if (b) b.hidden = true;
}

/* ---------------- export ---------------- */
function downloadCSV(name, heads, lines) {
  var csv = heads.join(',') + '\n' + lines.join('\n');
  var blob = new Blob([csv], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
}
function exportScreener() {
  var rows = screenRows();
  function q(s) { return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; }
  function num(v, d) { return (v != null && Number.isFinite(v)) ? (d != null ? v.toFixed(d) : v) : ''; }
  var lines = rows.map(function (r) {
    var d = r.fund || {}, ch = r.ch;
    return [q(r.u.sym), q(nameOf(r.u.sym)), q(r.u.sec), ch && Number.isFinite(ch.price) ? ch.price.toFixed(1) : num(d.price, 1),
      num(d.mcap), num(d.pe), num(d.roe), num(d.roce), num(d.dy),
      num(d.de, 2), num(d.opm, 1), num(d.gs, 1), num(d.gp, 1),
      ch ? num(ch.ret1y, 1) : ''].join(',');
  });
  downloadCSV('noobs_results.csv', ['Symbol', 'Company', 'Sector', 'CMP', 'MCap_Cr', 'PE', 'ROE', 'ROCE', 'DivYld', 'DE', 'OPM', 'SalesGr3Y', 'ProfitGr3Y', 'Ret1Y'], lines);
}
function exportStock() {
  function q(s) { return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; }
  if (S.mode === 'index' && LAST_CH && S.index) {
    var idxLines = LAST_CH.pts.map(function (p) {
      var dt = new Date(p.t).toISOString().slice(0, 10);
      return [dt, p.o != null ? p.o.toFixed(2) : '', p.h != null ? p.h.toFixed(2) : '', p.l != null ? p.l.toFixed(2) : '', p.c.toFixed(2), p.v || 0].join(',');
    });
    downloadCSV(S.index.label.replace(/[^a-z0-9]+/gi, '_') + '_history.csv', ['Date', 'Open', 'High', 'Low', 'Close', 'Volume'], idxLines);
    return;
  }
  var C = CO[S.sym] || cachedCompany(S.sym);
  if (!C || !C.pnl) return;
  var revRow = findRow(C.pnl, ['sales', 'total income', 'revenue', 'interest earned']);
  var opRow = findRow(C.pnl, ['operating profit', 'financing profit']);
  var npRow = findRow(C.pnl, ['net profit']);
  var epsRow = findRow(C.pnl, ['eps']);
  var lines = C.pnl.cols.map(function (L, i) {
    function col(row) {
      var v = (row && row.vals && row.vals[i] != null) ? String(row.vals[i]).replace(/,/g, '') : '';
      return q(v);
    }
    return [q(L), col(revRow), col(opRow), col(npRow), col(epsRow)].join(',');
  });
  downloadCSV(C.sym + '_financials.csv', ['Period', 'Sales_Cr', 'OpProfit_Cr', 'NetProfit_Cr', 'EPS'], lines);
}

/* ---------------- theme / init ---------------- */
function setTheme(t) {
  S.theme = t;
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('screenone_theme', t); } catch (e) {}
  $('themeBtn').textContent = t === 'dark' ? 'Light' : 'Dark';
  var C = CO[S.sym] || cachedCompany(S.sym);
  if (C && S.mode === 'stock') { renderAll(C, chartOf(S.sym)); }
  else if (S.mode === 'index' && LAST_CH && S.index) { renderIndex(LAST_CH, S.index.label, S.index.y); }
}
function init() {
  document.documentElement.setAttribute('data-theme', S.theme);
  $('themeBtn').textContent = S.theme === 'dark' ? 'Light' : 'Dark';
  renderIndices(); renderPresets();
  renderScreener(); renderWatchlist();
  showSkeletons();
  loadAndRender(S.sym);
  loadAllData();
  var si = $('searchInput');
  si.addEventListener('input', function () { renderSearchDrop(si.value); });
  si.addEventListener('focus', function () { renderSearchDrop(si.value); });
  si.addEventListener('blur', function () { setTimeout(function () { $('searchDrop').hidden = true; }, 150); });
  si.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      if (!si.value.trim()) return;
      var firstDrop = $('searchDrop').querySelector('.sd-row');
      if (firstDrop) {
        if (firstDrop.hasAttribute('data-sym')) selectStock(firstDrop.getAttribute('data-sym'));
        else if (firstDrop.hasAttribute('data-slug')) openSlug(firstDrop.getAttribute('data-slug'), firstDrop.getAttribute('data-name'));
        return;
      }
      var hits = ACTIVE_UNIVERSE.filter(function (u) { return matches(si.value, u.sym); });
      if (hits.length) selectStock(hits[0].sym);
    }
  });
  Array.prototype.forEach.call(document.querySelectorAll('.rngBtn'), function (b) {
    b.addEventListener('click', function () {
      S.range = b.getAttribute('data-r');
      Array.prototype.forEach.call(document.querySelectorAll('.rngBtn'), function (x) { x.classList.toggle('on', x === b); });
      if (LAST_CH) drawPriceChart(LAST_CH);
    });
  });
  bindChartHover();
  Array.prototype.forEach.call(document.querySelectorAll('.finBtn'), function (b) {
    b.addEventListener('click', function () {
      S.finMode = b.getAttribute('data-f');
      Array.prototype.forEach.call(document.querySelectorAll('.finBtn'), function (x) { x.classList.toggle('on', x === b); });
      var C = CO[S.sym] || cachedCompany(S.sym);
      if (C && S.mode === 'stock') drawFinChart(C);
    });
  });
  ['f_q', 'f_sector', 'f_mcap', 'f_pe', 'f_roe', 'f_roce', 'f_dy', 'f_de', 'f_gs', 'f_gp', 'f_opm', 'f_onlyWL'].forEach(function (id) {
    $(id).addEventListener('input', function () { readScreenerInputs(); renderScreener(); });
    $(id).addEventListener('change', function () { readScreenerInputs(); renderScreener(); });
  });
  $('resetBtn').addEventListener('click', function () { resetScreenerInputs(); renderScreener(); });
  $('copyQueryBtn').addEventListener('click', function () {
    var t = queryPreview();
    if (navigator.clipboard) navigator.clipboard.writeText(t);
    $('copyQueryBtn').textContent = 'Copied ✓';
    setTimeout(function () { $('copyQueryBtn').textContent = 'Copy query'; }, 1500);
  });
  $('prevPage').addEventListener('click', function () { if (S.scr.page > 0) { S.scr.page--; renderScreener(); } });
  $('nextPage').addEventListener('click', function () { S.scr.page++; renderScreener(); });
  $('exportScreenBtn').addEventListener('click', exportScreener);
  $('exportStockBtn').addEventListener('click', exportStock);
  $('themeBtn').addEventListener('click', function () { setTheme(S.theme === 'dark' ? 'light' : 'dark'); });
  $('refreshBtn').addEventListener('click', function () {
    var lt = $('loadTxt');
    if (_loadingAll) {
      if (lt) lt.textContent = 'A load is already in progress…';
    } else {
      if (typeof liveCacheClear === 'function') liveCacheClear();
      CO = {}; CH = {};
      if (lt) lt.textContent = 'Cache cleared — reloading live…';
      loadAllData();
    }
    // stay on the current view: an index refresh must not fall back to the last stock (RIL)
    if (S.mode === 'index' && S.index) { enterIndexMode(S.index.y, S.index.label, true); }
    else { loadAndRender(S.sym); }
  });
  $('starBtn').addEventListener('click', function () { toggleWL(S.sym); });
  var _ib = $('installBtn'); if (_ib) _ib.addEventListener('click', openInstall);
  var _ic = $('installClose'); if (_ic) _ic.addEventListener('click', function () { $('installOverlay').hidden = true; });
  var _io = $('installOverlay'); if (_io) _io.addEventListener('click', function (e) { if (e.target === _io) _io.hidden = true; });
  var _ig = $('installGoBtn'); if (_ig) _ig.addEventListener('click', nativeInstall);
  var links = Array.prototype.slice.call(document.querySelectorAll('.subnav a'));
  window.addEventListener('scroll', function () {
    var best = null;
    links.forEach(function (a) {
      var el = document.querySelector(a.getAttribute('href'));
      if (el && !el.hidden && el.getBoundingClientRect().top < 140) best = a;
    });
    links.forEach(function (a) { a.classList.toggle('on', a === best); });
  }, { passive: true });
  window.addEventListener('resize', function () {
    if (LAST_CH) drawPriceChart(LAST_CH);
    var C = CO[S.sym] || cachedCompany(S.sym);
    if (C && S.mode === 'stock') { drawFinChart(C); renderSH(C); }
  });
}
document.addEventListener('DOMContentLoaded', init);
