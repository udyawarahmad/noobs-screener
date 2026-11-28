'use strict';
/* Per-company news — free and keyless.
   Sources are plain RSS feeds (no API key, no signup, no quota):
     1. Google News search RSS   (best Indian coverage)
     2. Bing News RSS            (fallback)
     3. Yahoo Finance headline RSS for the ticker (fallback)
   Items are cached for 45 minutes so reopening a stock is instant. */

var LIVE_TTL_NEWS = 45 * 60 * 1000;

/* ---------- RSS/Atom parsing (pure, unit-tested) ---------- */

/* Decode the handful of entities RSS uses, drop CDATA wrappers and stray tags. */
function newsText(raw) {
  var s = String(raw == null ? '' : raw);
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  s = s.replace(/<[^>]*>/g, '');
  s = s.replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)); });
  s = s.replace(/&#x([0-9a-f]+);/gi, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
  s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
       .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  s = s.replace(/<[^>]*>/g, '');   // markup that was entity-encoded inside CDATA
  return s.replace(/\s+/g, ' ').trim();
}

function newsTagText(block, tag) {
  var m = String(block).match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i'));
  return m ? newsText(m[1]) : '';
}

function newsHost(url) {
  var m = String(url || '').match(/^https?:\/\/([^\/?#]+)/i);
  if (!m) return '';
  return m[1].replace(/^www\./, '');
}

/* Parse an RSS feed into a normalised list: {title, link, source, t}. */
function parseNewsXml(xml) {
  var out = [];
  if (!xml || typeof xml !== 'string') return out;
  var blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/(item|entry)>/gi) || [];
  blocks.forEach(function (block) {
    var title = newsTagText(block, 'title');
    if (!title) return;
    var link = newsTagText(block, 'link');
    if (!link) {
      // Atom style: <link href="..."/>
      var href = block.match(/<link[^>]*href=["']([^"']+)["']/i);
      if (href) link = href[1];
    }
    if (!/^https?:\/\//i.test(link)) return;
    var source = newsTagText(block, 'source') || newsHost(link);
    // Google News titles read "Headline - Publisher"; drop the redundant suffix.
    var suffix = ' - ' + source;
    if (source && title.slice(-suffix.length).toLowerCase() === suffix.toLowerCase()) {
      title = title.slice(0, -suffix.length).trim();
    }
    var pub = newsTagText(block, 'pubDate') || newsTagText(block, 'updated') || newsTagText(block, 'published');
    var t = pub ? Date.parse(pub) : NaN;
    if (isNaN(t)) t = null;
    out.push({ title: title, link: link, source: source, t: t });
  });

  // newest first, de-duplicated by headline
  out.sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
  var seen = {}, uniq = [];
  out.forEach(function (it) {
    var k = it.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 70);
    if (!k || seen[k]) return;
    seen[k] = 1;
    uniq.push(it);
  });
  return uniq;
}

/* ---------- feeds ---------- */

function newsFeeds(C) {
  var name = String((C && C.name) || (C && C.sym) || '').replace(/"/g, '').trim();
  var sym = (C && C.sym) || '';
  var ySym = (C && C.y) || (typeof yOf === 'function' ? yOf(sym) : sym + '.NS');
  // quoted company name keeps the feed on-topic; the strict filter below is the
  // real guarantee, the query just improves the hit rate
  var q = '"' + (name || sym) + '" share OR stock';
  return [
    {
      id: 'google',
      label: 'Google News',
      url: 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) +
           '&hl=en-IN&gl=IN&ceid=IN:en'
    },
    {
      id: 'bing',
      label: 'Bing News',
      url: 'https://www.bing.com/news/search?q=' + encodeURIComponent(q) +
           '&format=RSS&setmkt=en-IN&setlang=en'
    },
    {
      id: 'yahoo',
      label: 'Yahoo Finance',
      url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=' + encodeURIComponent(ySym) +
           '&region=IN&lang=en-IN'
    }
  ];
}

/* Strict relevance. A headline is kept only if it is about THIS company:

     1. it contains the company's full name (minus filler words), or
     2. it contains every distinctive word of the name ("Power Grid" -> both
        "power" and "grid" must appear), or
     3. it contains the ticker / a known short form (L&T, HUL, M&M, ...) as a word.

   Anything else is dropped — the card shows fewer (or zero) headlines rather than
   filling up with unrelated market news. */

/* words that say nothing about which company it is */
var NEWS_FILLER = [
  'limited', 'ltd', 'pvt', 'private', 'india', 'indian', 'the', 'and', 'of', 'for', 'co',
  'company', 'corporation', 'corp', 'industries', 'industry', 'group', 'holdings', 'holding',
  'enterprises', 'enterprise', 'international', 'global', 'services', 'solutions'
];

/* ticker -> how the press usually writes it */
var NEWS_ALIAS = {
  LT: ['L&T', 'Larsen'],
  HINDUNILVR: ['HUL', 'Hindustan Unilever'],
  M_M: ['M&M', 'Mahindra'],
  MMS: ['M&M'],
  SBIN: ['SBI', 'State Bank'],
  HDFCBANK: ['HDFC Bank'],
  ICICIBANK: ['ICICI Bank'],
  RELIANCE: ['RIL', 'Reliance'],
  TCS: ['TCS', 'Tata Consultancy'],
  INFY: ['Infosys'],
  WIPRO: ['Wipro'],
  ITC: ['ITC'],
  BAJFINANCE: ['Bajaj Finance'],
  MARUTI: ['Maruti', 'Maruti Suzuki'],
  SUNPHARMA: ['Sun Pharma'],
  DRREDDY: ['Dr Reddy'],
  COALINDIA: ['Coal India'],
  ONGC: ['ONGC'],
  NTPC: ['NTPC'],
  POWERGRID: ['Power Grid'],
  BHARTIARTL: ['Bharti Airtel', 'Airtel'],
  TATAMOTORS: ['Tata Motors'],
  TATASTEEL: ['Tata Steel'],
  ADANIENT: ['Adani Enterprises'],
  ADANIPORTS: ['Adani Ports'],
  AXISBANK: ['Axis Bank'],
  KOTAKBANK: ['Kotak'],
  HCLTECH: ['HCL Tech', 'HCL Technologies'],
  TECHM: ['Tech Mahindra'],
  ULTRACEMCO: ['UltraTech'],
  ASIANPAINT: ['Asian Paints'],
  NESTLEIND: ['Nestle'],
  BRITANNIA: ['Britannia'],
  CIPLA: ['Cipla'],
  DIVISLAB: ['Divi'],
  EICHERMOT: ['Eicher', 'Royal Enfield'],
  HEROMOTOCO: ['Hero MotoCorp'],
  BAJAJ_AUTO: ['Bajaj Auto'],
  INDUSINDBK: ['IndusInd'],
  JSWSTEEL: ['JSW Steel'],
  TITAN: ['Titan'],
  LTIM: ['LTIMindtree'],
  DMART: ['DMart', 'Avenue Supermarts']
};

/* lowercase, "&" becomes a separator so "Larsen & Toubro" and "M&M" normalise
   the way headlines are written */
function newsNorm(str) {
  return String(str || '').toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/* Words that identify the company; falls back to the raw name for short names. */
function newsKeys(C) {
  var name = String((C && C.name) || (C && C.sym) || '');
  var words = newsNorm(name).split(' ').filter(Boolean);
  var core = words.filter(function (w) { return NEWS_FILLER.indexOf(w) < 0; });
  var sym = String((C && C.sym) || '').toUpperCase();
  var aliasKey = sym.replace(/&/g, '_');
  var aliases = (NEWS_ALIAS[aliasKey] || NEWS_ALIAS[sym] || []).map(newsNorm).filter(Boolean);
  return { full: core.join(' '), core: core, sym: newsNorm(sym), aliases: aliases };
}

function newsMatches(title, keys) {
  var t = ' ' + newsNorm(title) + ' ';
  if (!t.trim()) return false;
  if (keys.full && t.indexOf(' ' + keys.full + ' ') >= 0) return true;
  if (keys.core.length >= 2) {
    var all = keys.core.every(function (w) { return t.indexOf(' ' + w + ' ') >= 0; });
    if (all) return true;
  }
  if (keys.sym && new RegExp(' ' + keys.sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' ').test(t)) return true;
  for (var i = 0; i < keys.aliases.length; i++) {
    if (t.indexOf(' ' + keys.aliases[i] + ' ') >= 0) return true;
  }
  return false;
}

function newsRelevant(items, C) {
  var keys = newsKeys(C);
  if (!keys.full && !keys.sym) return [];
  return items.filter(function (it) { return newsMatches(it.title, keys); });
}

/* Fetch news for a company: cached -> Google -> Bing -> Yahoo. */
async function loadNews(C) {
  var key = 'news:' + C.sym;
  var cached = liveCacheGet(key);
  if (cached && cached.v) {
    // a miss is remembered for 5 minutes only, so a flaky network recovers
    var ttl = cached.v.empty ? 5 * 60 * 1000 : LIVE_TTL_NEWS;
    if (Date.now() - cached.t < ttl) return cached.v;
  }

  var feeds = newsFeeds(C);
  var lastErr = null;
  for (var i = 0; i < feeds.length; i++) {
    try {
      var xml = await httpText(feeds[i].url, true);
      var items = newsRelevant(parseNewsXml(xml), C);
      if (items.length) {
        var res = { items: items.slice(0, 12), source: feeds[i].label, at: Date.now() };
        liveCacheSet(key, res);
        return res;
      }
    } catch (e) { lastErr = e; }
  }
  // remember the miss briefly so the card doesn't refetch on every open
  var empty = { items: [], source: '', at: Date.now(), empty: true, error: lastErr ? String(lastErr.message || lastErr) : '' };
  liveCacheSet(key, empty);
  return empty;
}
