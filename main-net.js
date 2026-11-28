'use strict';
/* URL policy for the renderer -> main fetch bridge (main.js 'ns-fetch').

   The bridge exists so screener.in/Yahoo work without CORS, but it must not be
   an open proxy: a renderer that ever runs injected script (see the escaping
   rules in renderer/app.js) could otherwise read local files (file://), probe
   the LAN, or pull arbitrary content through the app.

   Rule: http(s) only, and only the hosts this app actually talks to.
   corsproxy.io stays allowed — it is the website build's fallback and, being a
   remote service, it can reach neither your filesystem nor your LAN. */

const FETCH_HOSTS = [
  'query1.finance.yahoo.com',   // price history / quotes
  'query2.finance.yahoo.com',   // Yahoo mirror
  'www.screener.in',            // company pages + search API
  'screener.in',
  'news.google.com',            // news RSS
  'www.bing.com',               // news RSS fallback
  'feeds.finance.yahoo.com',    // ticker headline RSS
  'corsproxy.io'                // last-resort CORS fallback (web build)
];

const ALLOWED = new Set(FETCH_HOSTS);

/* Returns null when the URL may be fetched, otherwise a short reason. */
function fetchBlockReason(raw) {
  let u;
  try { u = new URL(String(raw)); } catch (e) { return 'malformed URL'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return 'only http(s) URLs are allowed (' + u.protocol + ')';
  }
  const host = u.hostname.toLowerCase();
  if (!ALLOWED.has(host)) return 'host not allowed: ' + host;
  return null;
}

function isFetchAllowed(raw) { return fetchBlockReason(raw) === null; }

module.exports = { FETCH_HOSTS, ALLOWED, fetchBlockReason, isFetchAllowed };
