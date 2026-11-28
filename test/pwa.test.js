'use strict';
/* PWA shell tests — `node test/pwa.test.js` (no dependencies).

   Guards B18: sw.js exists, precaches only files that really exist (one 404
   fails the whole install — c.addAll rejects), its version tracks
   package.json (stale version = stale caches), and the app registers it only
   on http(s) — never on file:// where Electron runs. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

const ROOT = path.join(__dirname, '..');
const R = (p) => path.join(ROOT, 'renderer', p);
const read = (p) => fs.readFileSync(p, 'utf8');

(async function main() {
  console.log('\nsw.js shell');

  await test('sw.js exists and parses', () => {
    const src = read(R('sw.js'));
    new vm.Script(src);                       // throws on a syntax error
    assert.ok(/SW_VERSION/.test(src), 'has a version constant');
    assert.ok(/addEventListener\('install'/.test(src), 'install handler');
    assert.ok(/addEventListener\('fetch'/.test(src), 'fetch handler');
  });

  await test('every precached shell file exists on disk', () => {
    const src = read(R('sw.js'));
    const m = src.match(/SHELL_FILES = \[([\s\S]*?)\]/);
    assert.ok(m, 'SHELL_FILES array found');
    const files = m[1].split(',').map((s) => s.replace(/['"\s]/g, '')).filter(Boolean);
    assert.ok(files.length >= 10, 'shell precache list looks complete: ' + files.length + ' entries');
    for (const f of files) {
      const p = f === './' ? R('index.html') : R(f);
      assert.ok(fs.existsSync(p), 'missing from renderer/: ' + f);
    }
    // the six scripts + stylesheet are the app itself
    for (const need of ['index.html', 'theme.css', 'app.js', 'live.js', 'universe.js']) {
      assert.ok(files.indexOf(need) >= 0, need + ' is precached');
    }
  });

  await test('SW_VERSION tracks package.json', () => {
    const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
    const m = read(R('sw.js')).match(/SW_VERSION = '([^']+)'/);
    assert.ok(m, 'SW_VERSION constant');
    assert.strictEqual(m[1], 'v' + pkg.version,
      'bump SW_VERSION in sw.js when releasing (package.json says ' + pkg.version + ')');
  });

  await test('app registers sw.js only behind an http(s) guard', () => {
    const app = read(R('app.js'));
    const idx = app.indexOf("register('sw.js')");
    assert.ok(idx > 0, 'register call present');
    const guard = app.slice(Math.max(0, idx - 300), idx);
    assert.ok(/location\.protocol/.test(guard), 'protocol checked before registering');
    assert.ok(/https\?:/.test(guard), 'http/https only — file:// (Electron) must not register');
    assert.ok(/serviceWorker/.test(guard), 'feature-detected');
  });

  console.log('\nmanifest');

  await test('manifest icons exist on disk', () => {
    const man = JSON.parse(read(R('manifest.webmanifest')));
    assert.ok(Array.isArray(man.icons) && man.icons.length >= 2, 'two icons');
    for (const ic of man.icons) assert.ok(fs.existsSync(R(ic.src)), 'missing icon: ' + ic.src);
  });

  await test('index.html links the manifest and sw.js ships next to it', () => {
    const html = read(R('index.html'));
    assert.ok(/rel="manifest" href="manifest\.webmanifest"/.test(html), 'manifest link');
    assert.ok(fs.existsSync(R('sw.js')), 'sw.js at the scope root');
  });

  console.log(failures ? '\n' + failures + ' test(s) failed\n' : '\nAll tests passed\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
