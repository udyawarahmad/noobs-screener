'use strict';
/* Universe data-quality tests — `node test/universe.test.js` (no dependencies).

   Guards B14: the curated list had drifted (M&M and LICI missing, MINDTREE
   used as the LTIMindtree key) and every new entry must stay well-formed. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

const sandbox = { console };
sandbox.window = sandbox;
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '../renderer/universe.js'), 'utf8'),
  sandbox,
  { filename: 'renderer/universe.js' }
);
const { UNIVERSE, ACTIVE_UNIVERSE, SECTORS, yOf, ALT_SLUG, ALT_Y } = sandbox;

console.log('\nuniverse data');

test('every entry is well-formed', () => {
  UNIVERSE.forEach((u) => {
    assert.ok(u.sym && typeof u.sym === 'string', 'sym: ' + JSON.stringify(u));
    assert.ok(u.y && typeof u.y === 'string', u.sym + ': y');
    assert.ok(u.sec && typeof u.sec === 'string', u.sym + ': sec');
    assert.ok(u.n && typeof u.n === 'string', u.sym + ': n');
  });
});

test('no duplicate symbols', () => {
  const seen = new Set();
  UNIVERSE.forEach((u) => {
    assert.ok(!seen.has(u.sym), 'duplicate symbol ' + u.sym);
    seen.add(u.sym);
  });
});

test('Yahoo symbols end in .NS (or .BO for numeric scrip codes)', () => {
  UNIVERSE.forEach((u) => {
    assert.ok(/\.(NS|BO)$/.test(u.y), u.sym + ' -> ' + u.y);
  });
});

test('NIFTY 50 heavyweights are present: M&M and LICI', () => {
  const syms = new Set(UNIVERSE.map((u) => u.sym));
  assert.ok(syms.has('M&M'), 'M&M (Mahindra & Mahindra) must be in the universe');
  assert.ok(syms.has('LICI'), 'LICI must be in the universe');
  assert.strictEqual(yOf('M&M'), 'M&M.NS');
  assert.strictEqual(yOf('LICI'), 'LICI.NS');
});

test('LTIMindtree is keyed by its real screener slug (LTIM), not MINDTREE', () => {
  const syms = new Set(UNIVERSE.map((u) => u.sym));
  assert.ok(syms.has('LTIM'), 'LTIM present');
  assert.ok(!syms.has('MINDTREE'), 'MINDTREE must not be the primary key');
  // ...but old watchlists still resolve through the fallbacks
  assert.deepStrictEqual(Array.from(ALT_SLUG.MINDTREE), ['LTIM']);
  assert.deepStrictEqual(Array.from(ALT_Y.MINDTREE), ['LTIM.NS']);
  assert.strictEqual(yOf('MINDTREE'), 'MINDTREE.NS'); // chartCands tries ALT_Y next
});

test('skip flags only hide entries from the active screener, not from lookups', () => {
  assert.ok(ACTIVE_UNIVERSE.length < UNIVERSE.length, 'something is skipped');
  ACTIVE_UNIVERSE.forEach((u) => assert.ok(!u.skip, u.sym + ' should not be active'));
  const skipped = UNIVERSE.find((u) => u.skip);
  if (skipped) assert.ok(yOf(skipped.sym), 'skipped entries still resolve a Yahoo symbol');
});

test('sector list matches the active entries', () => {
  const want = Array.from(new Set(ACTIVE_UNIVERSE.map((u) => u.sec))).sort();
  assert.deepStrictEqual(Array.from(SECTORS), want);
});

console.log(failures ? '\n' + failures + ' test(s) failed\n' : '\nAll tests passed\n');
process.exit(failures ? 1 : 0);
