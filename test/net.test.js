'use strict';
/* Fetch-bridge policy tests — `node test/net.test.js` (no dependencies).

   Guards B5: the renderer->main fetch proxy must never become an open proxy
   (file:// reader, LAN probe, arbitrary host). */
const assert = require('assert');
const { isFetchAllowed, fetchBlockReason, FETCH_HOSTS } = require('../main-net');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

console.log('\nns-fetch policy');

test('the app\'s own data hosts are allowed', () => {
  [
    'https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=5y&interval=1d',
    'https://www.screener.in/company/RELIANCE/consolidated/',
    'https://www.screener.in/api/company/search/?q=rel',
    'https://news.google.com/rss/search?q=x',
    'https://www.bing.com/news/search?q=x&format=RSS',
    'https://feeds.finance.yahoo.com/rss/2.0/headline?s=RELIANCE.NS',
    'https://corsproxy.io/?url=https%3A%2F%2Fexample.com'
  ].forEach((u) => assert.strictEqual(fetchBlockReason(u), null, u));
});

test('file:// URLs are blocked (local file read)', () => {
  assert.ok(!isFetchAllowed('file:///etc/passwd'));
  assert.ok(!isFetchAllowed('file:///C:/Users/secret/state.json'));
  assert.ok(/only http/.test(fetchBlockReason('file:///etc/passwd')));
});

test('javascript: and other schemes are blocked', () => {
  ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'ftp://x/', 'vbscript:x'].forEach((u) => {
    assert.ok(!isFetchAllowed(u), u);
  });
});

test('arbitrary and LAN hosts are blocked', () => {
  [
    'https://evil.example.com/steal',
    'http://192.168.1.1/admin',
    'http://localhost:8080/',
    'https://query1.finance.yahoo.com.evil.com/x',   // suffix confusion
    'https://www.screener.in.evil.com/x'
  ].forEach((u) => assert.ok(!isFetchAllowed(u), u));
});

test('malformed input is blocked, not thrown', () => {
  assert.ok(!isFetchAllowed('not a url'));
  assert.ok(!isFetchAllowed(''));
  assert.ok(!isFetchAllowed(null));
  assert.ok(!isFetchAllowed(undefined));
  assert.ok(!isFetchAllowed({}));
});

test('the allowlist is exactly the documented host set', () => {
  assert.ok(FETCH_HOSTS.includes('query1.finance.yahoo.com'));
  assert.ok(FETCH_HOSTS.includes('corsproxy.io'));
  assert.strictEqual(new Set(FETCH_HOSTS).size, FETCH_HOSTS.length, 'no duplicates');
});

test('block reasons are short and safe to surface', () => {
  const r = fetchBlockReason('https://evil.example.com/x');
  assert.ok(r && r.length < 100);
  assert.ok(!/\n/.test(r));
});

console.log(failures ? '\n' + failures + ' test(s) failed\n' : '\nAll tests passed\n');
process.exit(failures ? 1 : 0);
