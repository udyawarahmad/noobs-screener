/* Noobs Screener — tiny offline shell (B18).
   No build step, no data caching here: market data lives in PStore (disk /
   localStorage) and the app already treats that as the offline source of truth.
   This worker only keeps the *shell* (HTML/CSS/JS/icons) so the page opens
   instantly and works offline; data requests pass straight through. */
var SW_VERSION = 'v3.0.2';
var SHELL = 'shell-' + SW_VERSION;
var SHELL_FILES = [
  './',
  'index.html',
  'theme.css',
  'manifest.webmanifest',
  'store.js',
  'universe.js',
  'live.js',
  'news.js',
  'valuation.js',
  'app.js',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL).then(function (c) { return c.addAll(SHELL_FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k.indexOf('shell-') === 0 && k !== SHELL ? caches.delete(k) : null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  // same-origin only — data hosts (market data, financials, news, …) are the app's job,
  // not the worker's: PStore already caches them with the right TTLs
  if (url.origin !== self.location.origin) return;

  // navigations: network first (fresh HTML), cached shell when offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(SHELL).then(function (c) { return c.put('index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('index.html').then(function (r) { return r || Response.error(); });
      })
    );
    return;
  }

  // static assets: cache first, refresh in the background (stale-while-revalidate)
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(SHELL).then(function (c) { return c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
