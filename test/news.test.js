'use strict';
/* News parser tests — `node test/news.test.js` (plain Node, no dependencies). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

/* Load renderer/news.js in a sandbox with stubbed cache/network hooks. */
function loadNews(cache, fetcher) {
  const sandbox = { console: console };
  sandbox.window = sandbox;
  sandbox.liveCacheGet = (k) => (cache && Object.prototype.hasOwnProperty.call(cache, k) ? cache[k] : null);
  sandbox.liveCacheSet = (k, v) => { if (cache) cache[k] = { t: Date.now(), v: v }; };
  sandbox.httpText = fetcher || (async () => { throw new Error('offline'); });
  sandbox.yOf = (s) => s + '.NS';
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/news.js'), 'utf8'), sandbox, { filename: 'renderer/news.js' });
  return sandbox;
}

/* Real Google News RSS shape (trimmed). */
const GOOGLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>"Reliance Industries" share - Google News</title>
<item>
  <title>Reliance Industries shares rise 2% after Q2 results - The Economic Times</title>
  <link>https://news.google.com/rss/articles/CBMiabc?oc=5</link>
  <guid isPermaLink="false">CBMiabc</guid>
  <pubDate>Wed, 26 Nov 2025 09:15:00 GMT</pubDate>
  <description>&lt;a href="https://news.google.com/rss/articles/CBMiabc"&gt;Reliance&lt;/a&gt;&amp;nbsp;&amp;nbsp;The Economic Times</description>
  <source url="https://economictimes.indiatimes.com">The Economic Times</source>
</item>
<item>
  <title>Jio tariff hike to boost Reliance earnings, say analysts - Mint</title>
  <link>https://news.google.com/rss/articles/CBMidef?oc=5</link>
  <pubDate>Tue, 25 Nov 2025 18:40:00 GMT</pubDate>
  <source url="https://www.livemint.com">Mint</source>
</item>
<item>
  <title>Reliance Industries shares rise 2% after Q2 results - The Economic Times</title>
  <link>https://news.google.com/rss/articles/CBMidup?oc=5</link>
  <pubDate>Tue, 25 Nov 2025 07:00:00 GMT</pubDate>
  <source url="https://economictimes.indiatimes.com">The Economic Times</source>
</item>
</channel></rss>`;

/* Bing News RSS has no <source> tag. */
const BING_RSS = `<rss version="2.0"><channel>
<item>
  <title>Reliance Jio Q2 net profit up 12%</title>
  <link>https://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2fexample.com%2fa</link>
  <description>Telecom arm reports growth</description>
  <pubDate>Wed, 26 Nov 2025 06:00:00 GMT</pubDate>
</item>
</channel></rss>`;

console.log('\nRSS parsing');

test('parses Google News items with source, link and date', () => {
  const { parseNewsXml } = loadNews();
  const items = parseNewsXml(GOOGLE_RSS);
  assert.strictEqual(items.length, 2, 'duplicate headline should be dropped');
  assert.strictEqual(items[0].title, 'Reliance Industries shares rise 2% after Q2 results',
    'publisher suffix stripped');
  assert.strictEqual(items[0].source, 'The Economic Times');
  assert.strictEqual(items[1].source, 'Mint');
  assert.ok(items[0].link.startsWith('https://news.google.com/rss/articles/'));
  assert.ok(items[0].t > items[1].t, 'sorted newest first');
});

test('decodes entities and CDATA', () => {
  const { parseNewsXml, newsText } = loadNews();
  const items = parseNewsXml(`<rss><channel><item>
    <title><![CDATA[Reliance &amp; Jio: Q2 &lt;strong&gt;beat&lt;/strong&gt;]]></title>
    <link>https://example.com/a?x=1&amp;y=2</link>
    <pubDate>Wed, 26 Nov 2025 06:00:00 GMT</pubDate>
  </item></channel></rss>`);
  assert.strictEqual(items[0].title, 'Reliance & Jio: Q2 beat');
  assert.strictEqual(items[0].link, 'https://example.com/a?x=1&y=2');
  assert.strictEqual(newsText('&amp;lt;'), '&lt;');
});

test('falls back to the link host when the feed has no <source>', () => {
  const { parseNewsXml } = loadNews();
  const items = parseNewsXml(BING_RSS);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].source, 'bing.com');
});

test('ignores items without a usable link or title', () => {
  const { parseNewsXml } = loadNews();
  const items = parseNewsXml(`<rss><channel>
    <item><title>No link here</title></item>
    <item><link>https://example.com/x</link></item>
    <item><title>Javascript is not a news link</title><link>javascript:alert(1)</link></item>
  </channel></rss>`);
  assert.strictEqual(items.length, 0);
});

test('survives junk input', () => {
  const { parseNewsXml } = loadNews();
  assert.strictEqual(parseNewsXml('').length, 0);
  assert.strictEqual(parseNewsXml(null).length, 0);
  assert.strictEqual(parseNewsXml('<html><body>504 Gateway Timeout</body></html>').length, 0);
});

console.log('\nFeed selection');

test('builds keyless feeds (no API key anywhere) for the company', () => {
  const { newsFeeds } = loadNews();
  const feeds = newsFeeds({ sym: 'RELIANCE', name: 'Reliance Industries' });
  assert.strictEqual(feeds.map((f) => f.id).join(','), 'google,bing,yahoo');
  feeds.forEach((f) => {
    assert.ok(/^https:\/\//.test(f.url));
    assert.ok(!/api[_-]?key|apikey|token=/i.test(f.url), 'must not need a key: ' + f.url);
  });
  assert.ok(decodeURIComponent(feeds[0].url).includes('"Reliance Industries" share'));
  assert.ok(feeds[2].url.includes('RELIANCE.NS'), 'Yahoo feed uses the ticker');
});

test('falls back to the next feed when one fails', async () => {
  const cache = {};
  const calls = [];
  const sb = loadNews(cache, async (url) => {
    calls.push(url);
    if (url.includes('news.google.com')) throw new Error('blocked');
    return BING_RSS;
  });
  const res = await sb.loadNews({ sym: 'RELIANCE', name: 'Reliance Industries' });
  assert.strictEqual(res.source, 'Bing News');
  assert.strictEqual(res.items.length, 1);
  assert.strictEqual(calls.length, 2);
});

test('caches results so reopening a stock does not refetch', async () => {
  const cache = {};
  let hits = 0;
  const sb = loadNews(cache, async () => { hits++; return GOOGLE_RSS; });
  const a = await sb.loadNews({ sym: 'RELIANCE', name: 'Reliance Industries' });
  const b = await sb.loadNews({ sym: 'RELIANCE', name: 'Reliance Industries' });
  assert.strictEqual(hits, 1, 'second call must come from cache');
  assert.deepStrictEqual(b, a);
  assert.ok(cache['news:RELIANCE']);
});

test('filters out headlines that never mention the company', async () => {
  const cache = {};
  const unrelated = `<rss><channel>
    <item><title>Sensex ends 300 points higher</title><link>https://example.com/1</link></item>
    <item><title>Rupee weakens against dollar</title><link>https://example.com/2</link></item>
    <item><title>Reliance Industries wins new order</title><link>https://example.com/3</link></item>
    <item><title>RIL to invest in green energy</title><link>https://example.com/4</link></item>
  </channel></rss>`;
  const sb = loadNews(cache, async () => unrelated);
  const res = await sb.loadNews({ sym: 'RELIANCE', name: 'Reliance Industries' });
  const titles = res.items.map((i) => i.title);
  assert.strictEqual(titles.join(' | '), 'Reliance Industries wins new order', 'only relevant headlines kept');
});

test('an empty result is cached briefly, not forever', async () => {
  const cache = {};
  const sb = loadNews(cache, async () => { throw new Error('offline'); });
  const res = await sb.loadNews({ sym: 'X', name: 'X Ltd' });
  assert.strictEqual(res.items.length, 0);
  assert.ok(res.empty, 'marked as a miss');
  assert.strictEqual(cache['news:X'].v.empty, true);
});

console.log(failures ? '\n' + failures + ' test(s) failed\n' : '\nAll tests passed\n');
process.exit(failures ? 1 : 0);
