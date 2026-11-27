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
  var q = '"' + (name || sym) + '" share';
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

/* Keep only headlines that actually mention the company (or its symbol), so a
   loose feed match can't fill the card with unrelated market news. Falls back to
   the unfiltered list rather than showing nothing. */
function newsRelevant(items, C) {
  var name = String((C && C.name) || '');
  var tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter(function (w) {
    return w.length >= 4 && ['limited', 'ltd', 'india', 'company', 'corporation', 'industries', 'the'].indexOf(w) < 0;
  });
  var sym = String((C && C.sym) || '').toLowerCase();
  if (!tokens.length && !sym) return items;
  var kept = items.filter(function (it) {
    var t = it.title.toLowerCase();
    if (sym && t.indexOf(sym) >= 0) return true;
    return tokens.some(function (w) { return t.indexOf(w) >= 0; });
  });
  return kept.length >= 2 ? kept : items;
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
