'use strict';
/* Noobs Screener app: everything on this page is REAL data —
   prices/charts via Yahoo Finance, financials via screener.in (parsed live in your browser). */

var S = {
  sym: 'RELIANCE', range: '1Y', finMode: 'sales', theme: 'light', wl: [],
  mode: 'stock', index: null,  scr: { q: '', sector: 'ALL', mcapMin: 0, peMax: 1000, roeMin: -100, roceMin: -100, dyMin: 0, deMax: 99, gsMin: -100, gpMin: -100, opmMin: 0, sort: 'mcap', dir: -1, page: 0, onlyWL: false }
};
try {
  S.wl = JSON.parse(PStore.getState('screenone_wl', '[]') || '[]');
  if (!Array.isArray(S.wl)) S.wl = [];
  S.wl = S.wl.filter(function (x) { return typeof x === 'string' && x; });
} catch (e) { S.wl = []; }
try { var _t = PStore.getState('screenone_theme', ''); if (_t) S.theme = _t; } catch (e) {}

var CO = {};   // sym -> parsed company (memory)
var CH = {};   // yahoo symbol -> chart (memory)
var LAST_CH = null; // chart currently shown in the hero (stock or index)
var FIN_SECTIONS = ['valSec', 'pcSec', 'newsSec', 'peerSec', 'qSec', 'pnlSec', 'bsSec', 'cfSec', 'ratSec', 'shSec', 'docSec', 'aboutSec'];
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
function saveWL() { try { PStore.setState('screenone_wl', JSON.stringify(S.wl)); } catch (e) {} }
/* Re-render the screener table at most a few times a second: during the bulk
   load each arriving stock used to repaint all ~160 rows. */
var _scrTimer = null;
/* The screener needs data for the whole universe; loading it at startup made the
   window sluggish for no benefit if the user only looked at a stock. */
var _screenerKicked = false;
function kickScreenerLoad() {
  if (_screenerKicked) return;
  _screenerKicked = true;
  loadAllData();
}
function setupScreenerLazyLoad() {
  var sec = $('screenSec');
  var lt = $('loadTxt');
  var want = ACTIVE_UNIVERSE.filter(function (u) { return !cachedCompany(u.sym); }).length;
  if (lt && want > 0) lt.textContent = 'Live data for ' + want + ' stocks loads when this section is in view.';
  else if (lt) lt.textContent = 'Screener data is cached and up to date.';
  if (!want) { _screenerKicked = true; renderScreener(); return; }   // cache is warm
  if (typeof IntersectionObserver === 'function' && sec) {
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) { io.disconnect(); kickScreenerLoad(); return; }
      }
    }, { rootMargin: '300px 0px' });
    io.observe(sec);
  } else {
    setTimeout(kickScreenerLoad, 2500);
  }
}
function renderScreenerSoon() {
  if (_scrTimer) return;
  _scrTimer = setTimeout(function () { _scrTimer = null; renderScreener(); }, 300);
}
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
    ['NIFTY 50', '^NSEI'], ['SENSEX', '^BSESN'], ['NIFTY BANK', '^NSEBANK'], ['USD / Inr', 'INR=X'], ['Gold', 'GC=F']
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
      var l = ch.pts[ch.pts.length - 1].c, p = ch.pts.length > 1 ? ch.pts[ch.pts.length - 2].c : l;
      var c = (l / p - 1) * 100;
      el.innerHTML = '<span class="idx-n">' + x[0] + '</span><b>' + inr1(l) + '</b><span class="' + numCls(c) + '">' + pct1(c) + '</span>';
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
  chgEl.textContent = (CHd.dayChg >= 0 ? '▲ +' : '▼ ') + CHd.dayChg.toFixed(2) + '% today';
  chgEl.className = 'chg ' + numCls(CHd.dayChg);
  var rEl = $('stRange');
  rEl.textContent = '52W Low ' + money(CHd.lo52, ccy) + ' · 52W High ' + money(CHd.hi52, ccy) + ' · 1Y ' + pct1(CHd.ret1y);
  rEl.className = numCls(CHd.ret1y);
  var pos = (CHd.price - CHd.lo52) / (CHd.hi52 - CHd.lo52) * 100;
  pos = Math.min(100, Math.max(0, pos));
  $('w52wrap').innerHTML = '<div class="w52"><div class="w52-track"><div class="w52-mark" style="left:' + pos.toFixed(1) + '%"></div></div>' +
    '<div class="w52-lab"><span>Low ' + money(CHd.lo52, ccy) + '</span><span>High ' + money(CHd.hi52, ccy) + '</span></div></div>';
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
  if (!hits.length) { box.hidden = false; box.innerHTML = '<div class="sd-empty">Searching…</div>'; }
  else {
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
  var pe = f.pe, pb = (price != null && f.bv) ? price / f.bv : null;
  function cls(v) { return v != null ? ' class="' + numCls(v) + '"' : ''; }
  var cards = [
    ['Market Cap', f.mcap != null ? '₹ ' + inr0(f.mcap) + ' Cr' : '–', ''],
    ['P/E', f.pe != null ? inr1(f.pe) + 'x' : '–', ''],
    ['P/B', pb != null ? inr1(pb) + 'x' : '–', ''],
    ['ROE', f.roe != null ? inr1(f.roe) + '%' : '–', cls(f.roe)],
    ['ROCE', f.roce != null ? inr1(f.roce) + '%' : '–', cls(f.roce)],
    ['Div. Yield', f.dy != null ? inr1(f.dy) + '%' : '–', ''],
    ['D/E', f.de != null ? inr2(f.de) : '–', f.de != null ? (f.de > 1 ? ' class="neg"' : ' class="pos"') : ''],
    ['Face Value', f.fv != null ? '₹' + inr1(f.fv) : '–', ''],
    ['Sales Gr (3Y)', f.gs != null ? pct1(f.gs) : '–', cls(f.gs)],
    ['Profit Gr (3Y)', f.gp != null ? pct1(f.gp) : '–', cls(f.gp)],
    ['OPM (latest)', f.opm != null ? inr1(f.opm) + '%' : '–', cls(f.opm)],
    ['52W Range', (CH && CH.lo52 != null) ? '₹' + inr0(CH.lo52) + '–' + inr0(CH.hi52) : '–', '']
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
  if (CH && CH.lo52 != null) {
    rEl.textContent = '52W Low ₹' + inr0(CH.lo52) + ' · 52W High ₹' + inr0(CH.hi52) + ' · 1Y ' + pct1(CH.ret1y);
    rEl.className = numCls(CH.ret1y);
  } else { rEl.textContent = ''; }
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
  if (S.sym !== sym) return;
  try {
    // company page and price history are independent -> fetch together
    var pair = await Promise.all([
      ensureCompany(sym),
      ensureChart(sym).catch(function () { return null; })
    ]);
    var C = pair[0], CH = pair[1];
    if (S.sym !== sym) return;
    CO[sym] = C;
    // adopt screener's sector for dynamic entries; grow the sector list for everyone
    if (C.sector) {
      if (UNI[sym] && !UNI[sym].sec) UNI[sym].sec = C.sector;
      if (typeof SECTORS !== 'undefined' && SECTORS.indexOf(C.sector) < 0) { SECTORS.push(C.sector); SECTORS.sort(); }
    }
    renderAll(C, CH);
  } catch (e) {
    if (S.sym !== sym) return;
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
  var nl = $('newsList'); if (nl) nl.innerHTML = skel(46) + skel(46) + skel(46);
  var vg = $('valGrid'); if (vg) vg.innerHTML = skel(80) + skel(80);
}
function renderStockError(sym, e) {
  $('stSym').textContent = sym;
  $('stName').textContent = nameOf(sym);
  $('stSector').textContent = '';
  $('stPrice').textContent = '–';
  var msg = '<div class="errbox"><b>Could not load live data for ' + esc(sym) + '.</b><br><span class="muted">' +
    esc((e && e.message) || 'network error') + ' — check your connection and retry.</span><br>' +
    '<button class="btn sm" onclick="selectStock(\'' + sym + '\')">Retry</button></div>';
  ['qTable', 'pnlTable', 'bsTable', 'cfTable', 'ratTable', 'shTable', 'peersTable'].forEach(function (id) { $(id).innerHTML = msg; });
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
  for (var t = 0; t <= 4; t++) {
    var ix = Math.round((data.length - 1) * t / 4);
    ctx.fillText(dLabel(data[ix].t), X(ix) - 14, H - 6);
  }
  // volume bars
  var bw = Math.max(1, (W - padL - padR) / data.length * 0.7);
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
    var g = c._geom; if (!g) return;
    var r = c.getBoundingClientRect(), mx = clientX - r.left;
    var i = Math.round((mx - 8) / (r.width - 8 - 56) * (g.data.length - 1));
    i = Math.max(0, Math.min(g.data.length - 1, i));
    tip.hidden = false;
    tip.style.left = (g.X(i) + 10) + 'px';
    tip.style.top = (g.Y(g.data[i].c) - 10) + 'px';
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
      var raw = r.vals[off + i], nv = r.nums[off + i];
      var sub = null, cls = '';
      if (opts.growth && shouldGrow(r.label) && i > 0) {
        var pv = r.nums[off + i - 1];
        if (nv != null && pv) { var g = (nv / pv - 1) * 100; sub = (g >= 0 ? '+' : '') + g.toFixed(1) + '% YoY'; cls = numCls(g); }
      }
      h += '<td class="num">' + esc(raw === '' ? '–' : raw) + (sub ? '<div class="sub ' + cls + '">' + sub + '</div>' : '') + '</td>';
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
  var N = 7;
  var heads = (C.metricHeads || []).map(shortPeerHead);
  var h = '<table class="fin"><thead><tr><th class="sticky">Company</th>';
  // align columns from the right: metric heads may outnumber row values
  var rows = C.peers.map(function (p) { return p; });
  var maxV = 1;
  rows.forEach(function (p) { maxV = Math.max(maxV, (p.vals || []).length); });
  var take = Math.min(N, maxV);
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
  $('qTable').innerHTML = finTableHTML(C.quarters, { cols: 8, growth: true, first: 'Metric · ₹ Cr' }) +
    '<p class="tbl-note">Quarterly figures in ₹ Cr. Source: screener.in (consolidated where available).</p>';
  var T = C.pnl, n = 8, note = '';
  if (T && T.cols.length > n) note = 'Showing latest ' + n + ' periods (scroll table for more). ';
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
  var data = row ? row.nums.filter(function (v) { return v != null; }).slice(-10) : [];
  var labels = C.pnl.cols.slice(-data.length);
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
  var want = ['promoter', 'fii', 'dii', 'public', 'other'];
  var picked = want.map(function (w) { return T.rows.find(function (r) { return r.label.toLowerCase().indexOf(w) === 0; }); })
    .filter(Boolean).slice(0, 5);
  var cols = ['#0a84ff', '#ff9f0a', '#30d158', '#8e8e93', '#bf5af2'];
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
  var links = [];
  if (C.site) links.push(['Company website', C.site]);
  links.push(['screener.in company page', 'https://www.screener.in/company/' + C.sym + '/']);
  if (C.nse) links.push(['NSE quote page', C.nse]);
  else links.push(['NSE quote page', 'https://www.nseindia.com/get-quotes/equity?symbol=' + C.sym]);
  if (C.bse) links.push(['BSE quote page', C.bse]);
  links.push(['Yahoo Finance quote', 'https://finance.yahoo.com/quote/' + yOf(C.sym)]);
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
  $('aboutFacts').innerHTML =
    '<div><span>Sector</span><b>' + esc(UNI[C.sym] ? UNI[C.sym].sec : '–') + '</b></div>' +
    '<div><span>NSE symbol</span><b>' + esc(C.sym) + '</b></div>' +
    '<div><span>Promoter holding</span><b>' + (prom != null ? inr1(prom) + '%' : '–') + '</b></div>' +
    '<div><span>Face value</span><b>' + (C.fund.fv != null ? '₹' + inr1(C.fund.fv) : '–') + '</b></div>' +
    '<div><span>Yahoo symbol</span><b>' + esc(yOf(C.sym)) + '</b></div>';
}
function timeAgo(ms) {
  if (!ms) return '';
  var d = Date.now() - ms;
  if (d < 0) return 'just now';
  var m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  var h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  var dd = Math.floor(h / 24);
  if (dd < 30) return dd + 'd ago';
  return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
function paintNews(res) {
  var box = $('newsList');
  if (!box) return;
  var tag = $('newsTag');
  if (tag) tag.textContent = res && res.source ? 'free · ' + res.source : 'free · RSS';
  var items = (res && res.items) || [];
  if (!items.length) {
    box.innerHTML = '<p class="muted news-empty">No recent headlines found for this stock right now. ' +
      'News comes from free RSS feeds (Google News, Bing News, Yahoo Finance) — try Refresh in a minute.</p>';
    return;
  }
  box.innerHTML = items.map(function (n) {
    var meta = [n.source, timeAgo(n.t)].filter(Boolean).join(' · ');
    return '<a class="news-item" href="' + esc(n.link) + '" target="_blank" rel="noopener noreferrer" title="' + esc(n.title) + '">' +
      '<span class="ni-body"><span class="ni-title">' + esc(n.title) + '</span>' +
      (meta ? '<span class="ni-meta">' + esc(meta) + '</span>' : '') + '</span>' +
      '<span class="ni-go">↗</span></a>';
  }).join('');
}
/* Show cached headlines immediately, then refresh in the background. */
function renderNews(C) {
  var box = $('newsList');
  if (!box || typeof loadNews !== 'function') return;
  var cached = null;
  try { cached = liveCacheGet('news:' + C.sym); } catch (e) { cached = null; }
  if (cached && cached.v) paintNews(cached.v);
  else box.innerHTML = skel(46) + skel(46) + skel(46);
  var sym = C.sym;
  loadNews(C).then(function (res) {
    if (S.sym !== sym || S.mode !== 'stock') return;
    paintNews(res);
  }).catch(function () {
    if (S.sym !== sym) return;
    paintNews({ items: [], source: '' });
  });
}
/* ---------------- valuation history ---------------- */
function valChip(pct) {
  if (pct == null) return '';
  var cls = pct <= 33 ? 'cheap' : (pct >= 67 ? 'rich' : 'fair');
  var word = pct <= 33 ? 'cheaper' : (pct >= 67 ? 'dearer' : 'in line');
  return '<span class="chip ' + cls + '">' + word + ' than ' + Math.round(pct) + '% of its history</span>';
}
function drawValChart(summary, label) {
  var cv = $('valChart'); if (!cv || !summary || !summary.series || !summary.series.length) return;
  var dpr = window.devicePixelRatio || 1;
  var W = cv.clientWidth || 640, H = 190;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv.style.height = H + 'px';
  var ctx = cv.getContext('2d'); if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  var css = getComputedStyle(document.documentElement);
  var muted = css.getPropertyValue('--muted') || '#6e6e73';
  var ink = css.getPropertyValue('--ink') || '#1d1d1f';
  var line = css.getPropertyValue('--line') || '#d2d2d7';
  var brand = css.getPropertyValue('--brand') || '#0071e3';

  var pts = summary.series;
  var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  var lo = Math.min(summary.min, summary.p20), hi = Math.max(summary.max, summary.p80);
  var pad = (hi - lo) * 0.08 || 1;
  var yMin = Math.max(0, lo - pad), yMax = hi + pad;
  var L = 46, R = 10, T = 10, B = 22;
  function X(t) { return L + (W - L - R) * (t - t0) / Math.max(1, t1 - t0); }
  function Y(v) { return T + (H - T - B) * (1 - (v - yMin) / Math.max(1e-9, yMax - yMin)); }

  // band lines
  [[summary.p80, '80th'], [summary.median, 'median'], [summary.p20, '20th']].forEach(function (b) {
    var y = Y(b[0]);
    ctx.strokeStyle = line; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = muted; ctx.font = '10.5px -apple-system,Segoe UI,sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(b[1], L - 6, y + 3);
  });

  // the multiple itself
  ctx.strokeStyle = brand; ctx.lineWidth = 1.6; ctx.beginPath();
  pts.forEach(function (p, i) { var x = X(p.t), y = Y(p.v); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.stroke();

  // current point — on the line, so the marker never floats off the series
  var last = pts[pts.length - 1];
  ctx.fillStyle = ink;
  ctx.beginPath(); ctx.arc(X(last.t), Y(last.v), 3.2, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = muted; ctx.font = '10.5px -apple-system,Segoe UI,sans-serif'; ctx.textAlign = 'left';
  if (label) ctx.fillText(label, L, T + 2);
  ctx.fillText(new Date(t0).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }), L, H - 6);
  ctx.textAlign = 'right';
  ctx.fillText('now', W - R, H - 6);
}
function valStat(label, summary) {
  if (!summary) {
    return '<div class="val-stat"><div class="vs-k">' + label + '</div>' +
      '<div class="vs-v">–</div><div class="vs-sub">Not enough history to judge.</div></div>';
  }
  var f = function (v) { return (v == null || !isFinite(v)) ? '–' : v.toFixed(1) + '×'; };
  var rng = f(summary.p20) + ' – ' + f(summary.p80);
  return '<div class="val-stat">' +
    '<div class="vs-k">' + label + '</div>' +
    '<div class="vs-v">' + (summary.now == null ? '–' : summary.now.toFixed(1) + '×') + '</div>' +
    valChip(summary.percentile) +
    '<div class="vs-sub">Median ' + summary.median.toFixed(1) + '× · usual range ' + rng +
    '<br>' + summary.samples + ' trading days</div></div>';
}
function renderVal(C, chart) {
  var grid = $('valGrid'), note = $('valNote'), tag = $('valTag');
  if (!grid) return;
  if (typeof valForCompany !== 'function') return;
  var v = null;
  try { v = valForCompany(C, chart); } catch (e) { v = null; }
  if (!v) {
    grid.innerHTML = '<p class="muted">Not enough financial history for a valuation band yet.</p>';
    var cv0 = $('valChart'); if (cv0) { var c0 = cv0.getContext('2d'); if (c0) c0.clearRect(0, 0, cv0.width, cv0.height); }
    if (note) note.textContent = '';
    return;
  }
  grid.innerHTML = valStat('P/E', v.pe) + valStat('P/B', v.pb);
  if (tag) tag.textContent = v.years + ' yrs · ' + (v.ttm ? 'TTM' : 'latest annual');
  drawValChart(v.pe || v.pb, v.pe ? 'P/E history' : 'P/B history');
  if (note) {
    note.textContent = 'P/E = price ÷ EPS as published' + (v.pe && v.pe.factor !== 1 ? ' (series scaled so today matches the reported multiple)' : '') +
      '; P/B = price ÷ book value. Per-share history uses today\'s share count (' +
      (v.sharesCr ? v.sharesCr.toFixed(1) + ' Cr shares' : '–') + '), the same basis as split-adjusted prices. ' +
      'Fundamentals count from ~90 days after each fiscal year ends.';
  }
}

/* ---------------- backtest ---------------- */
function universeCounts() {
  var need = 0, have = 0;
  ACTIVE_UNIVERSE.forEach(function (u) {
    need++;
    if ((typeof CO !== 'undefined' && CO[u.sym]) || cachedCompany(u.sym)) have++;
  });
  return { have: have, need: need };
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function ensureUniverse(onProgress) {
  kickScreenerLoad();
  var idleRounds = 0;
  for (var i = 0; i < 900; i++) {
    var c = universeCounts();
    if (onProgress) onProgress(c);
    if (!_loadingAll) {
      if (c.have > 0) return c;
      // nothing loaded and nothing in flight -> give up instead of spinning
      if (++idleRounds >= 3) return c;
    } else {
      idleRounds = 0;
    }
    await sleep(400);
  }
  return universeCounts();
}
function btKpi(label, value, cls) {
  return '<div class="bt-kpi"><span>' + esc(label) + '</span><b class="' + (cls || '') + '">' + value + '</b></div>';
}
function renderBacktest(res, years) {
  var out = $('btOut'); if (!out) return;
  if (!res || !res.count) {
    out.innerHTML = '<p class="muted">No stock in the universe passed this screen at that date — loosen the filters and try again.</p>';
    return;
  }
  var fmtPct = function (v) { return v == null ? '–' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'; };
  var alpha = (res.cagr != null && res.benchCagr != null) ? res.cagr - res.benchCagr : null;
  var html = '<div class="bt-res">' +
    btKpi('Stocks passing', res.count + ' / ' + res.universe) +
    btKpi(years + '-year CAGR', fmtPct(res.cagr), res.cagr > 0 ? 'pos' : (res.cagr < 0 ? 'neg' : '')) +
    btKpi('NIFTY CAGR', fmtPct(res.benchCagr)) +
    btKpi('vs NIFTY', (alpha == null ? '–' : (alpha > 0 ? '+' : '') + alpha.toFixed(1) + ' pp'), alpha > 0 ? 'pos' : (alpha < 0 ? 'neg' : '')) +
    btKpi('Max drawdown', fmtPct(res.maxDrawdown)) +
    btKpi('Hit rate', res.hitRate == null ? '–' : Math.round(res.hitRate) + '%') +
    '</div>';
  var top = res.picks.slice(0, 12);
  html += '<div class="bt-picks"><table><thead><tr><th>Stock</th><th>Return</th><th>P/E then</th><th>ROE then</th></tr></thead><tbody>' +
    top.map(function (p) {
      return '<tr class="bt-row" data-sym="' + esc(p.sym) + '"><td>' + esc(p.name || p.sym) + '</td><td class="' + numCls(p.ret) + '">' + fmtPct(p.ret) +
        '</td><td>' + (p.pe == null ? '–' : p.pe.toFixed(1) + '×') + '</td><td>' + (p.roe == null ? '–' : p.roe.toFixed(1) + '%') + '</td></tr>';
    }).join('') + '</tbody></table>' +
    (res.picks.length > top.length ? '<p class="muted" style="font-size:12px">Showing best ' + top.length + ' of ' + res.picks.length + '.</p>' : '') +
    '</div>';
  out.innerHTML = html;
  // click a pick to open that stock
  Array.prototype.forEach.call(out.querySelectorAll('.bt-row'), function (tr) {
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', function () {
      var sym = tr.getAttribute('data-sym');
      if (sym && UNI[sym]) selectStock(sym);
      else if (sym) openSlug(sym, tr.textContent);
    });
  });
}
async function runBacktest() {
  var btn = $('btRun'), out = $('btOut');
  if (!btn || !out) return;
  if (typeof valBacktest !== 'function') return;
  var years = parseFloat(($('btYears') || {}).value) || 3;
  btn.disabled = true; btn.textContent = 'Preparing…';
  try {
    var counts = await ensureUniverse(function (c) {
      btn.textContent = 'Loading data ' + c.have + '/' + c.need + '…';
    });
    if (!counts.have) {
      out.innerHTML = '<p class="muted">Could not load the universe — check your connection and try again.</p>';
      return;
    }
    btn.textContent = 'Running…';
    var end = Date.now();
    var start = end - years * 365.25 * 86400000;
    var members = [];
    ACTIVE_UNIVERSE.forEach(function (u) {
      var C = CO[u.sym] || cachedCompany(u.sym);
      var chart = chartOf(u.sym);
      if (C && chart) members.push({ sym: u.sym, C: C, chart: chart });
    });
    var bench = null;
    try { bench = CH['^NSEI'] || await loadChart('^NSEI'); } catch (e) { bench = null; }
    var passes = function (fund, C) {
      var u = UNI[C.sym] || { sym: C.sym, sec: '' };
      return rowPasses(u, S.scr, fund, null);
    };
    var res = valBacktest(members, start, end, passes, bench);
    renderBacktest(res, years);
  } catch (e) {
    out.innerHTML = '<p class="muted">Backtest failed: ' + esc(String(e && e.message || e)) + '</p>';
  } finally {
    btn.disabled = false; btn.textContent = 'Run backtest';
  }
}
function renderAll(C, CHd) {
  LAST_CH = CHd;
  renderStockHead(C, CHd);
  drawPriceChart(CHd);
  renderVal(C, CHd);
  renderProsCons(C);
  renderNews(C);
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
  if (f.mcapMin > 0 && (fund == null || fund.mcap == null || fund.mcap < f.mcapMin)) return false;
  function chk(v, op, lim) {
    if (v == null) return op === 'min' ? false : true; // nulls fail active minimums, pass inactive ones
    return op === 'min' ? v >= lim : v <= lim;
  }
  if (f.peMax < 1000 && (fund == null || fund.pe == null || fund.pe > f.peMax)) return false;
  if (f.roeMin > -100 && (fund == null || fund.roe == null || fund.roe < f.roeMin)) return false;
  if (f.roceMin > -100 && (fund == null || fund.roce == null || fund.roce < f.roceMin)) return false;
  if (f.dyMin > 0 && (fund == null || fund.dy == null || fund.dy < f.dyMin)) return false;
  if (f.deMax < 99 && (fund == null || fund.de == null || fund.de > f.deMax)) return false;
  if (f.gsMin > -100 && (fund == null || fund.gs == null || fund.gs < f.gsMin)) return false;
  if (f.gpMin > -100 && (fund == null || fund.gp == null || fund.gp < f.gpMin)) return false;
  if (f.opmMin > 0 && (fund == null || fund.opm == null || fund.opm < f.opmMin)) return false;
  if (f.q && !matches(f.q, u.sym)) return false;
  return true;
}
function activeFilters(f) {
  return f.mcapMin > 0 || f.peMax < 1000 || f.roeMin > -100 || f.roceMin > -100 || f.dyMin > 0 ||
    f.deMax < 99 || f.gsMin > -100 || f.gpMin > -100 || f.opmMin > 0 || f.onlyWL || (f.q && f.q.trim());
}
function sortVal(u, fund, ch, key) {
  switch (key) {
    case 'price': return ch ? ch.price : (fund && fund.price);
    case 'mcap': return fund && fund.mcap; case 'pe': return fund && fund.pe;
    case 'roe': return fund && fund.roe; case 'roce': return fund && fund.roce;
    case 'dy': return fund && fund.dy; case 'de': return fund && fund.de;
    case 'gs': return fund && fund.gs; case 'gp': return fund && fund.gp;
    case 'opm': return fund && fund.opm; case 'ret1y': return ch && ch.ret1y;
    case 'name': return nameOf(u.sym); default: return fund && fund.mcap;
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
    if (va == null && vb == null) return 0;
    if (va == null) return 1; if (vb == null) return -1;
    if (typeof va === 'string') return dir * String(va).localeCompare(String(vb));
    return dir * (va - vb);
  });
  return out;
}
function queryPreview() {
  var f = S.scr, p = [];
  if (f.sector !== 'ALL') p.push('Sector = "' + f.sector + '"');
  if (f.mcapMin > 0) p.push('Market cap > ' + inr0(f.mcapMin));
  if (f.peMax < 1000) p.push('P/E < ' + f.peMax);
  if (f.roeMin > -100) p.push('ROE > ' + f.roeMin + '%');
  if (f.roceMin > -100) p.push('ROCE > ' + f.roceMin + '%');
  if (f.dyMin > 0) p.push('Dividend yield > ' + f.dyMin + '%');
  if (f.deMax < 99) p.push('Debt/Equity < ' + f.deMax);
  if (f.gsMin > -100) p.push('Sales growth 3Y > ' + f.gsMin + '%');
  if (f.gpMin > -100) p.push('Profit growth 3Y > ' + f.gpMin + '%');
  if (f.opmMin > 0) p.push('OPM > ' + f.opmMin + '%');
  if (f.onlyWL) p.push('in Watchlist');
  if (f.q.trim()) p.push('matches "' + f.q.trim() + '"');
  return p.length ? p.join('  AND  ') : 'All stocks (no filters)';
}
var SCR_COLS = [
  ['sym', 'Symbol'], ['name', 'Company'], ['price', 'CMP ₹'], ['mcap', 'M.Cap Cr'],
  ['pe', 'P/E'], ['roe', 'ROE%'], ['roce', 'ROCE%'], ['dy', 'Div%'], ['de', 'D/E'],
  ['gs', 'SalesGr%'], ['gp', 'ProfitGr%'], ['ret1y', '1Y%'], ['wl', '★']
];
function renderScreener() {
  var f = S.scr;
  var secSel = $('f_sector');
  if (!secSel.options.length) {
    secSel.innerHTML = '<option value="ALL">All sectors</option>' + SECTORS.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('');
  }
  secSel.value = f.sector;
  $('queryPreview').textContent = queryPreview();
  var nf = (f.sector !== 'ALL' ? 1 : 0) + (f.mcapMin > 0 ? 1 : 0) + (f.peMax < 1000 ? 1 : 0) +
    (f.roeMin > -100 ? 1 : 0) + (f.roceMin > -100 ? 1 : 0) + (f.dyMin > 0 ? 1 : 0) +
    (f.deMax < 99 ? 1 : 0) + (f.gsMin > -100 ? 1 : 0) + (f.gpMin > -100 ? 1 : 0) +
    (f.opmMin > 0 ? 1 : 0) + (f.onlyWL ? 1 : 0) + (f.q.trim() ? 1 : 0);
  $('resetBtn').textContent = nf ? 'Reset (' + nf + ')' : 'Reset';
  var rows = screenRows();
  var per = 15, pages = Math.max(1, Math.ceil(rows.length / per));
  if (f.page >= pages) f.page = pages - 1;
  var slice = rows.slice(f.page * per, f.page * per + per);
  function cell(v, isPct) {
    if (v == null) return '<span class="muted">…</span>';
    return isPct ? '<span class="' + numCls(v) + '">' + pct1(v) + '</span>' : inr1(v);
  }
  var h = '<table class="fin sortable"><thead><tr>';
  SCR_COLS.forEach(function (c) {
    var arrow = S.scr.sort === c[0] ? (S.scr.dir === 1 ? ' ▲' : ' ▼') : '';
    h += '<th data-k="' + c[0] + '" class="' + (c[0] === 'sym' || c[0] === 'name' ? 'sticky' : 'num') + '">' + c[1] + arrow + '</th>';
  });
  h += '</tr></thead><tbody>';
  slice.forEach(function (r) {
    var u = r.u, d = r.fund || {}, ch = r.ch;
    var stared = S.wl.indexOf(u.sym) >= 0;
    h += '<tr>' +
      '<td class="sticky"><a class="peerlink" data-sym="' + u.sym + '"><b>' + u.sym + '</b></a></td>' +
      '<td class="sticky2">' + esc(nameOf(u.sym)) + '</td>' +
      '<td class="num">' + (ch ? inr1(ch.price) : (d.price != null ? inr1(d.price) : '<span class="muted">…</span>')) + '</td>' +
      '<td class="num">' + (d.mcap != null ? inr0(d.mcap) : '<span class="muted">…</span>') + '</td>' +
      '<td class="num">' + (d.pe != null ? inr1(d.pe) : '<span class="muted">…</span>') + '</td>' +
      '<td class="num">' + (d.roe != null ? inr1(d.roe) : '<span class="muted">…</span>') + '</td>' +
      '<td class="num">' + (d.roce != null ? inr1(d.roce) : '<span class="muted">…</span>') + '</td>' +
      '<td class="num">' + (d.dy != null ? inr1(d.dy) : '<span class="muted">…</span>') + '</td>' +
      '<td class="num">' + (d.de != null ? inr2(d.de) : '<span class="muted">…</span>') + '</td>' +
      '<td class="num">' + cell(d.gs, true) + '</td>' +
      '<td class="num">' + cell(d.gp, true) + '</td>' +
      '<td class="num">' + (ch ? '<span class="' + numCls(ch.ret1y) + '">' + pct1(ch.ret1y) + '</span>' : '<span class="muted">…</span>') + '</td>' +
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
  f.q = g('f_q'); f.sector = g('f_sector');
  f.mcapMin = +g('f_mcap') || 0; f.peMax = g('f_pe') === '' ? 1000 : +g('f_pe');
  f.roeMin = g('f_roe') === '' ? -100 : +g('f_roe');
  f.roceMin = g('f_roce') === '' ? -100 : +g('f_roce');
  f.dyMin = +g('f_dy') || 0; f.deMax = g('f_de') === '' ? 99 : +g('f_de');
  f.gsMin = g('f_gs') === '' ? -100 : +g('f_gs');
  f.gpMin = g('f_gp') === '' ? -100 : +g('f_gp');
  f.opmMin = +g('f_opm') || 0;
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
      if (p.mcapMin) $('f_mcap').value = p.mcapMin;
      if (p.roeMin) $('f_roe').value = p.roeMin;
      if (p.dyMin) $('f_dy').value = p.dyMin;
      if (p.peMax) $('f_pe').value = p.peMax;
      if (p.deMax) $('f_de').value = p.deMax;
      if (p.gsMin) $('f_gs').value = p.gsMin;
      if (p.gpMin) $('f_gp').value = p.gpMin;
      readScreenerInputs(); renderScreener();
      document.getElementById('screenSec').scrollIntoView({ behavior: 'smooth' });
    });
  });
}
function resetScreenerInputs() {
  ['f_q', 'f_mcap', 'f_pe', 'f_roe', 'f_roce', 'f_dy', 'f_de', 'f_gs', 'f_gp', 'f_opm'].forEach(function (id) { $(id).value = ''; });
  $('f_sector').value = 'ALL'; $('f_onlyWL').checked = false;
  S.scr = { q: '', sector: 'ALL', mcapMin: 0, peMax: 1000, roeMin: -100, roceMin: -100, dyMin: 0, deMax: 99, gsMin: -100, gpMin: -100, opmMin: 0, sort: 'mcap', dir: -1, page: 0, onlyWL: false };
}

/* progressive background load of the whole universe */
var _loadingAll = false;
async function loadAllData() {
  if (_loadingAll) return;
  _loadingAll = true;
  try {
    await _loadAllDataInner();
  } catch (e) {
    var lt2 = $('loadTxt'); if (lt2) lt2.textContent = 'Load failed — tap Refresh to retry.';
  } finally {
    _loadingAll = false;
  }
}
async function _loadAllDataInner() {
  var syms = ACTIVE_UNIVERSE.map(function (u) { return u.sym; });
  var need = syms.filter(function (s) { return !cachedCompany(s); });
  var total = need.length, doneN = 0, failN = 0;
  function progress(pct, label) {
    var bar = $('loadFill'); if (bar) bar.style.width = Math.round(pct) + '%';
    var tx = $('loadTxt'); if (tx) tx.textContent = label;
  }
  progress(2, total ? 'Loading live financials… 0/' + total : 'Checking cache…');
  await mapLimit(need, 3, async function (s) {
    try { CO[s] = await ensureCompany(s); }
    catch (e) {
      // one gentle retry — bulk bursts can trip transient proxy/rate limits
      await sleep(1200);
      try { CO[s] = await ensureCompany(s); }
      catch (e2) { CO[s] = null; failN++; }
    }
    await sleep(250);
    return true;
  }, function (d) {
    doneN = d;
    progress(2 + 68 * doneN / Math.max(total, 1), 'Loading live financials… ' + doneN + '/' + total);
    renderScreenerSoon();
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
    renderScreenerSoon();
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
    try {
      var CHx = await ensureChart(S.sym).catch(function () { return null; });
      if (CHx) renderAll(CO[S.sym], CHx);
    } catch (e) {}
  }
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
  if (!S.wl.length) { box.innerHTML = '<p class="muted">No stocks yet — tap ☆ on any stock or in the screener to track it here. Saved automatically, and kept after you close the app.</p>'; return; }
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
  var lines = rows.map(function (r) {
    var d = r.fund || {}, ch = r.ch;
    function q(s) { return '"' + String(s == null ? '' : s).replace(/"/g, '') + '"'; }
    return [r.u.sym, q(nameOf(r.u.sym)), r.u.sec, ch ? ch.price.toFixed(1) : '', d.mcap == null ? '' : d.mcap,
      d.pe == null ? '' : d.pe, d.roe == null ? '' : d.roe, d.roce == null ? '' : d.roce, d.dy == null ? '' : d.dy,
      d.de == null ? '' : d.de.toFixed(2), d.gs == null ? '' : d.gs.toFixed(1), d.gp == null ? '' : d.gp.toFixed(1),
      ch ? ch.ret1y.toFixed(1) : ''].join(',');
  });
  downloadCSV('noobs_results.csv', ['Symbol', 'Company', 'Sector', 'CMP', 'MCap_Cr', 'PE', 'ROE', 'ROCE', 'DivYld', 'DE', 'SalesGr3Y', 'ProfitGr3Y', 'Ret1Y'], lines);
}
function exportStock() {
  var C = CO[S.sym] || cachedCompany(S.sym);
  if (!C || !C.pnl) return;
  var lines = C.pnl.cols.map(function (L, i) {
    function col(row) { return row ? row.vals[i].replace(/,/g, '') : ''; }
    return [L, col(findRow(C.pnl, ['sales'])), col(findRow(C.pnl, ['operating profit'])), col(findRow(C.pnl, ['net profit'])), col(findRow(C.pnl, ['eps']))].join(',');
  });
  downloadCSV(C.sym + '_financials.csv', ['Period', 'Sales_Cr', 'OpProfit_Cr', 'NetProfit_Cr', 'EPS'], lines);
}

/* ---------------- theme / init ---------------- */
function setTheme(t) {
  S.theme = t;
  document.documentElement.setAttribute('data-theme', t);
  try { PStore.setState('screenone_theme', t); } catch (e) {}
  $('themeBtn').textContent = t === 'dark' ? 'Light' : 'Dark';
  var C = CO[S.sym] || cachedCompany(S.sym);
  if (C && S.mode === 'stock') { renderAll(C, chartOf(S.sym)); }
  else if (S.mode === 'index' && LAST_CH && S.index) { renderIndex(LAST_CH, S.index.label, S.index.y); }
}
function init() {
  document.documentElement.setAttribute('data-theme', S.theme);
  // desktop build: swap the blurred sticky bars for solid ones (cheaper to paint)
  if (typeof PStore !== 'undefined' && PStore.isDisk) document.body.classList.add('native');
  $('themeBtn').textContent = S.theme === 'dark' ? 'Light' : 'Dark';
  renderPresets();
  renderScreener(); renderWatchlist();
  showSkeletons();
  loadAndRender(S.sym);
  // the index strip is secondary: let the stock hero paint first
  setTimeout(renderIndices, 250);
  // The 160-stock bulk load only starts when the screener card comes into view
  // (or the user touches its filters). It never competes with the first paint.
  setupScreenerLazyLoad();
  var si = $('searchInput');
  si.addEventListener('input', function () { renderSearchDrop(si.value); });
  si.addEventListener('focus', function () { renderSearchDrop(si.value); });
  si.addEventListener('blur', function () { setTimeout(function () { $('searchDrop').hidden = true; }, 150); });
  si.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
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
    var el = $(id);
    if (!el) return;
    var onFilter = function () {
      kickScreenerLoad(); readScreenerInputs(); renderScreenerSoon();
      // a result from the previous filters would be misleading
      var bo = $('btOut');
      if (bo && bo.innerHTML) bo.innerHTML = '<p class="muted">Filters changed — run the backtest again.</p>';
    };
    el.addEventListener('input', onFilter);
    el.addEventListener('change', onFilter);
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
      _screenerKicked = true;
      if (lt) lt.textContent = 'Cache cleared — reloading live…';
      loadAllData();
    }
    // stay on the current view: an index refresh must not fall back to the last stock (RIL)
    if (S.mode === 'index' && S.index) { enterIndexMode(S.index.y, S.index.label, true); }
    else { loadAndRender(S.sym); }
  });
  $('starBtn').addEventListener('click', function () { toggleWL(S.sym); });
  var _bt = $('btRun'); if (_bt) _bt.addEventListener('click', runBacktest);
  var _ib = $('installBtn'); if (_ib) _ib.addEventListener('click', openInstall);
  var _ic = $('installClose'); if (_ic) _ic.addEventListener('click', function () { $('installOverlay').hidden = true; });
  var _io = $('installOverlay'); if (_io) _io.addEventListener('click', function (e) { if (e.target === _io) _io.hidden = true; });
  var _ig = $('installGoBtn'); if (_ig) _ig.addEventListener('click', nativeInstall);
  var links = Array.prototype.slice.call(document.querySelectorAll('.subnav a'));
  window.addEventListener('scroll', function () {
    var best = null;
    links.forEach(function (a) {
      var el = document.querySelector(a.getAttribute('href'));
      if (el && el.getBoundingClientRect().top < 140) best = a;
    });
    links.forEach(function (a) { a.classList.toggle('on', a === best); });
  }, { passive: true });
  window.addEventListener('resize', function () {
    if (LAST_CH) drawPriceChart(LAST_CH);
    var vc = CO[S.sym] || cachedCompany(S.sym);
    if (vc && S.mode === 'stock') renderVal(vc, chartOf(S.sym));
    var C = CO[S.sym] || cachedCompany(S.sym);
    if (C && S.mode === 'stock') { drawFinChart(C); renderSH(C); }
  });
}
document.addEventListener('DOMContentLoaded', init);
