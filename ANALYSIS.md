# Noobs Screener — Deep Analysis, Bug Report & Roadmap

> **UPDATE (2026-11-28, same day):** bugs **B1–B20 are all fixed** — P0 + P1
> (B1–B14) first, then P2 (B15–B20: curve-consistent backtest maths, NaN chart
> guards, dead code removed, real `sw.js` offline shell, CI on main + PRs,
> debounce/rAF/Enter polish), each with a regression test. The suite now runs
> **108 checks across 8 suites**, `npm audit` is clean (0 vulnerabilities), and
> the roadmap's headline feature — **shareable screen links (`?q=`)** — has
> shipped as part of **v3.0.0**. What's left is §5's forward roadmap
> (NSE-500 via official CSVs, ⌘K palette, compare mode, IndexedDB, ESLint…).
>
> **UPDATE v3.0.1 (same day):** reliability pass — the section nav now stays
> pinned *below* the header while scrolling (it used to slide underneath it),
> the backtest feature was removed entirely (UI, maths, tests, styles), all
> visible data-source names were scrubbed from the UI/docs (fetch URLs and the
> host allowlist remain, as the features depend on them), index refreshes no
> longer rebuild the screener/watchlist DOM, and the test chain now really runs
> all **8 suites / 103 checks** (a duplicate `package.json` key had been
> silently skipping the pwa suite).
>
> **UPDATE v3.0.2 (same day):** field report — the packaged exe sat on the
> skeleton forever. Root cause: the `ns-fetch` bridge call had **no timeout at
> any layer**, so one stalled connection hung `loadAndRender` for good (no
> error, no retry). Now every stage has a hard deadline (main 10 s / bridge
> 8 s / direct+proxy 15 s each), a dead network fails fast after **one**
> attempt instead of eight, the bulk loader trips a circuit breaker with an
> honest "Network unreachable" message, and the UI always lands on the error
> panel with a Retry button.

> Audited 2026-11-28 on branch `arena/75f05bca-noobs-screener` (base `2c41783`).
> Method: full source review of every file (~5,100 lines), the whole test suite run
> locally (`npm test` → **all 62 checks pass**), `npm audit`, and targeted
> repro scripts for suspected bugs (results cited below).

---

## 1. Executive summary

This is a genuinely well-built project for its size: zero-build plain JS, a real
persistence layer with atomic writes, a pure-function valuation/backtest module
tested against real TCS/HDFC figures, fuzz tests, honest documentation, and
careful performance work (lazy universe load, throttled repaints, no white flash).
The bones are excellent.

But the audit found **4 user-visible correctness bugs**, **several security
hardening gaps**, and a handful of edge-case crashes. The most damning finding:
**the Quarterly card's "YoY" growth numbers are actually quarter-on-quarter**
(verified by running the real function), and **prices labelled "live" can be up to
24 hours old — or frozen for the entire session**.

Beyond bugs, the gap between this and "best in the world" is mostly *scope and
trust*: a hand-maintained 161-stock universe that has already drifted (M&M and
LICI — both NIFTY 50 constituents — are missing), no full-NSE screening, no
shareable screens, no offline PWA, and a dependency tree with 18 known
vulnerabilities (including in Electron itself).

### Bug summary

| # | Sev | Bug | Where |
|---|-----|-----|-------|
| B1 | 🔴 P0 | Quarterly growth computes QoQ but labels it **"% YoY"** | `renderer/app.js:579-581` |
| B2 | 🔴 P0 | Search dropdown: curated results become **unclickable** once remote results arrive | `renderer/app.js:252` |
| B3 | 🔴 P0 | Prices shown as **"live"** are cached 24 h on disk and **forever in-session** | `renderer/live.js:8,35,104` |
| B4 | 🔴 P0 | **HTML injection**: symbol inserted unescaped into attributes + inline `onclick` | `renderer/app.js:216,416,1149,1161,1312` |
| B5 | 🟠 P1 | `ns-fetch` IPC is an **open proxy** — no scheme/host allowlist (`file://` readable) | `main.js:32-41` |
| B6 | 🟠 P1 | No **CSP** anywhere (web build fully open to injected script) | `renderer/index.html` |
| B7 | 🟠 P1 | `npm audit`: **18 vulnerabilities (1 critical, 13 high)** — incl. Electron ≤42 | `package.json:15,17` |
| B8 | 🟠 P1 | No **single-instance lock** → two windows race on `state.json`/cache | `main.js` |
| B9 | 🟠 P1 | `exportStock()` **crashes** if any table row is shorter than the header | `renderer/app.js:1370` |
| B10 | 🟠 P1 | P&L mini-chart **labels misalign with bars** when the series has gaps | `renderer/app.js:679` |
| B11 | 🟠 P1 | Index view: `hi52 === lo52` → `NaN%` bar; stale previous-stock chart flashes | `renderer/app.js:179,120` |
| B12 | 🟠 P1 | Sector dropdown populated **once** — sectors discovered later never appear | `renderer/app.js:1121` |
| B13 | 🟠 P1 | Dead `NEWS_ALIAS` keys (`BAJAJ_AUTO`, `LTIM`, `M_M`) never match → weaker news | `renderer/news.js:128,163` |
| B14 | 🟠 P1 | Universe gaps: **M&M, LICI missing**; `MINDTREE` key for LTIMindtree | `renderer/universe.js` |
| B15 | 🟡 P2 | Backtest CAGR (buy & hold) vs drawdown (daily-rebalanced) — **inconsistent maths** | `renderer/valuation.js:452-455` |
| B16 | 🟡 P2 | `loadChart` trusts parallel Yahoo arrays — a short array yields **NaN points** that poison the whole chart | `renderer/live.js:44-56` |
| B17 | 🟡 P2 | Dead code: `_getSF`/`superFetch`, duplicate `sleep()`, unused `preferProxy` param | `live.js:23,364,378` · `app.js:918` |
| B18 | 🟡 P2 | Website "PWA" has **no service worker** — no offline, install prompt inconsistent | `renderer/` |
| B19 | 🟡 P2 | CI only runs on `arena/**` pushes and tags — **nothing runs on `main` or PRs** | `.github/workflows/build-exe.yml:19-24` |
| B20 | 🟡 P2 | Misc: `author: ""`, no `engines`, resize/scroll handlers undebounced, search Enter only matches curated 161 | `package.json`, `app.js` |

---

## 2. How the project works (as-built architecture)

```
┌──────────────────────────── Electron (optional) ───────────────────────────┐
│ main.js ── ipcMain 'ns-fetch'  → net.fetch proxy (no CORS)                │
│          ── ipcMain 'ns-state-*'/'ns-cache-*' → main-store.js             │
│              state.json (watchlist/theme) + cache/<key>.json (40 MB cap)  │
│ preload.js ── contextBridge: window.electronFetch, window.nsStore         │
└──────────────────────────────────┬─────────────────────────────────────────┘
                                   │ same files work with zero changes
┌──────────────────────────────────▼─────────────────────────────────────────┐
│ renderer/  (no bundler, no framework, classic <script> tags)              │
│  store.js      PStore: disk bridge ⇄ localStorage fallback                 │
│  universe.js   hand-curated 161 NSE stocks (162 entries, 1 skipped)        │
│  live.js       Yahoo chart API + financials HTML parser + fetch chain     │
│  news.js       Google/Bing/Yahoo RSS + strict relevance filter             │
│  valuation.js  pure: P/E-P/B history, point-in-time fundamentals, backtest │
│  app.js        all UI: canvas charts, screener, watchlist, search, backtest│
│  index.html/theme.css  Apple-inspired design system, light+dark, print     │
└────────────────────────────────────────────────────────────────────────────┘
```

Data flow per stock: company-page HTML → `DOMParser` → labelled
tables → `C.fund`/`C.pnl`/`C.bs`… ; `query1.finance.yahoo.com/v8/finance/chart`
→ `{pts:[{t,c,o,h,l,v}]}`. Both cached (7 days / 1 day) through `PStore`.

**What must not regress** (genuinely good, protect it):

- **Test culture**: 62 checks incl. fuzzing (300 random companies, 200 random
  portfolios never produce NaN), real TCS/HDFC fixtures, jsdom boot of the real
  `index.html` with network stubbed to fail (tests the error paths).
- **Persistence design**: atomic tmp+rename writes, base-36 hash + original-key
  guard against filename collisions, debounced flush with `unref()`, legacy
  localStorage migration, cache-clear that never touches watchlist/theme.
- **Honest docs**: README documents TTLs, survivorship bias, share-count basis,
  SmartScreen warnings. This honesty is a competitive advantage — keep it.
- **Security basics already present**: `contextIsolation`, `nodeIntegration:false`,
  external-link interception (`setWindowOpenHandler`/`will-navigate`), `esc()`
  for scraped text, `rel="noopener"`, news links restricted to `http(s)`.
- **Performance care**: IntersectionObserver-gated bulk load, 300 ms repaint
  coalescing, `show:false` + `ready-to-show`, `body.native` blur opt-out.

---

## 3. The bugs — details & verified evidence

### B1 🔴 Quarterly growth is QoQ but labelled "YoY" (correctness)

`finTableHTML()` always compares column *i* with *i−1* and prints `"% YoY"`
(`app.js:579-581`). For the **annual** P&L that is YoY ✓. For the **quarterly**
card (8 consecutive quarters), *i−1* is the **previous quarter** ✗.

Verified by invoking the real function in jsdom with a synthetic quarter series
(10% sequential growth):

```
growth labels under Sales: +10.0% YoY +9.1% YoY +8.3% YoY +7.7% YoY …
QoQ would be +10.0% each; true YoY should be +40.0%, +36.4%, +33.3%, +30.8%
```

The UI (`index.html` qSec: *"year-on-year growth under key lines"*) and the cell
text both promise YoY. Users screening on "growth" see inflated smooth numbers.

**Fix**: pass a step per table — `finTableHTML(C.quarters, { growthStep: 4 })`
(quarters) vs `{ growthStep: 1 }` (annual; skip the TTM column, it isn't YoY
either), and label the sub-line honestly (`% QoQ` for quarters if you prefer
consecutive comparison — but then the section copy must change).

### B2 🔴 Search dropdown: results die after the remote search returns

`renderSearchDrop()` attaches `mousedown` listeners to curated rows, then later
the remote search resolves and does `box.innerHTML += …` (`app.js:252`).
`innerHTML +=` re-parses the whole box, **discarding the nodes and their
listeners** — every curated row becomes inert until the next keystroke.

Verified in isolation:

```
clicks after innerHTML += : 0   (expected 1 if listeners survived)
```

**Fix**: build the *entire* dropdown HTML (curated + "More results")
in one string, assign once, attach listeners after — or better, use **event
delegation** on `#searchDrop` (one listener, immune to re-renders).

### B3 🔴 "Live" prices can be a day old — or frozen all session

Three layers stack up:

1. `LIVE_TTL_CH = 24 h` disk cache (`live.js:8,35`) — a chart fetched at 09:15
   is served again at 15:30 the same day.
2. In-memory `CH[cands[i]]` is returned **without any TTL check** (`live.js:104`)
   — within one app session the price never moves, ever.
3. UI claims: header "Live market data", `freshStamp` "prices live", index strip
   "live". README is honest ("nothing is fetched twice in the same day") but the
   product surface is not.

For a stock app this is the core promise broken: open at 9:20, keep it open till
3:30, every price, day-change %, 52-week bar and screener CMP column is stale.

**Fix**: split the record — keep `pts` history at 1-day TTL (it barely changes),
but re-fetch the **quote tail** (meta price/change/high/low/volume + last 1-2
points) on a short TTL (60-150 s during market hours, off-market → static), and
make in-memory charts honour the same TTL. Add a small NSE market-calendar helper
(9:15-15:30 IST Mon-Fri) so you're not polling on weekends. Surface a real
timestamp ("as of 15:32") instead of the word "live".

### B4 🔴 HTML injection via unescaped symbols

`esc()` is used well for *names and scraped text*, but **symbols are pasted raw
into HTML**:

- `data-sym="' + u.sym + '"` — search rows (`app.js:216`), screener table
  (`app.js:1149`), star buttons (`app.js:1161`), watchlist cards (`app.js:1312`)
- `onclick="selectStock(\'" + sym + "\')"` — error retry (`app.js:416`); note
  `esc()` wouldn't even save this one, because the JS string uses single quotes
  and `esc()` only escapes `"`.

Where does a hostile symbol come from? On the **website build** every
the financials response may transit **corsproxy.io**; a hostile/compromised proxy
or upstream can return a slug like `X" onmouseover="…`. One quote breaks out of
the attribute. In Electron the blast radius is smaller but the renderer holds
the `ns-fetch` bridge (see B5). Also functionally: a slug containing `'` breaks
the retry button outright.

**Fix**: (a) escape *every* interpolation with `esc()` including symbols;
(b) delete inline `onclick` — attach listeners after render (you already do this
everywhere else); (c) validate symbols at the boundary: `openSlug()` should
reject anything outside `/^[A-Z0-9&\-]{1,20}$/`; (d) add a CSP (B6) as a second
layer.

### B5 🟠 `ns-fetch` is an open proxy

```js
ipcMain.handle('ns-fetch', async (_event, url) => { … net.fetch(String(url)) … })
```

No scheme or host allowlist. Any script that ever executes in the renderer can
read `file:///…` (local files), scan the LAN, or pull arbitrary content through
the app. Not exploitable by a random website (the bridge is only exposed to your
own page), but it's the one bridge an XSS (B4) would grab.

**Fix**: allow only `http:`/`https:` and ideally a host allowlist
(`query1.finance.yahoo.com`, the financials host, `news.google.com`,
`www.bing.com`, `feeds.finance.yahoo.com`, `corsproxy.io`, …) with a clear
error for anything else. Cap response size. Consider a GET-only restriction.

### B6 🟠 No Content-Security-Policy

`index.html` ships no CSP meta. The app renders scraped HTML (escaped, but see
B4) and runs inline `onclick`. On a static host, one injection = full script.

**Fix**: add a CSP `<meta>` — `default-src 'self'; connect-src 'self' https:;
img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'` —
after removing inline handlers (B4). Add `'unsafe-inline'` for styles only if
needed. This is free, ships today, and works in both Electron and the web build.

### B7 🟠 18 known vulnerabilities in the dependency tree

```
npm audit            → 18 vulnerabilities (4 moderate, 13 high, 1 critical)
npm audit --omit=dev → 0            ← the shipped renderer has no prod deps
```

The findings are in **electron ≤ 42** (runtime! you pin `^33.2.0`) and the
electron-builder 25 chain (`app-builder-lib`, `tar`, `minimatch`, …). The
renderer being dependency-free is a real security win — don't lose it, but the
*shell* must be current.

**Fix**: bump `electron` to current stable, `electron-builder` to ≥26.18 (the
audit-recommended fix), re-run `npm test` + a manual smoke of the EXE. Add a
scheduled `npm audit` CI job. Add `"engines": { "node": ">=22" }` (the smoke
test needs 22 and CI already uses it).

### B8 🟠 No single-instance lock

Two copies of the app share `state.json` and `cache/` with independent in-memory
`state`/`mem` maps. Last writer wins — watchlist edits in window A can be
silently erased when window B flushes.

**Fix**: `app.requestSingleInstanceLock()`; on `second-instance`, focus the
existing window instead of opening another.

### B9 🟠 `exportStock()` can throw

```js
function col(row) { return row ? row.vals[i].replace(/,/g, '') : ''; }
```

If any P&L row has fewer cells than the header (screener tables occasionally
do), `row.vals[i]` is `undefined` → `.replace` throws → click does nothing, no
CSV, no error. (Same class of issue: `esc(undefined)` renders `''` rather than
`–` in `finTableHTML`.)

**Fix**: `var v = row && row.vals[i]; return v == null ? '' : String(v).replace(…)`
and wrap the export in try/catch with a user-visible toast.

### B10 🟠 P&L chart labels misalign when the series has gaps

```js
var data = row.nums.filter(v => v != null).slice(-10);   // nulls removed → indices shift
var labels = C.pnl.cols.slice(-data.length);            // last N columns, nulls ignored
```

One `–` (null) inside the last 10 columns shifts every bar against its year
label — a silently wrong chart. Fix: collect `{label, value}` pairs together
and slice *that*.

### B11 🟠 Index view edge cases

- `renderIndex` computes the 52-week bar **without the guard** that
  `renderStockHead` has (`hi52 > lo52`): `hi52 === lo52` → `left:NaN%` (`app.js:179`).
- `enterIndexMode()` doesn't clear `LAST_CH`: while the index chart loads, the
  range buttons (1M/6M/…) redraw the **previous stock's chart** under the index
  header (`app.js:120` + the `.rngBtn` handler).

### B12 🟠 Sector dropdown is filled exactly once

```js
if (!secSel.options.length) { …SECTORS.map… }   // app.js:1121
```

`loadAndRender` later pushes newly discovered screener sectors into `SECTORS`,
but the `<select>` is never rebuilt — those sectors can never be filtered on.
**Fix**: rebuild options whenever `SECTORS.length` changes (keep the current
selection), or populate from a single source of truth on each render.

### B13 🟠 Dead `NEWS_ALIAS` keys → weaker news matching

```js
M_M: ['M&M', 'Mahindra'],        // sym would be 'M&M' — not in the universe (see B14)
BAJAJ_AUTO: ['Bajaj Auto'],      // sym is 'BAJAJ-AUTO' — aliasKey only replaces '&'
LTIM: ['LTIMindtree'],           // sym key is 'MINDTREE'
```

`newsKeys()` builds `aliasKey = sym.replace(/&/g, '_')`, so `BAJAJ_AUTO` never
matches `BAJAJ-AUTO`. Bajaj Auto, LTIMindtree (under its `MINDTREE` key) and
Mahindra get worse headline recall than the alias table intended.
**Fix**: normalise keys with `newsNorm()` on both sides; rename `MINDTREE` →
`LTIM` (B14); add `M&M` to the universe and its alias fires naturally.

### B14 🟠 Universe data has drifted (M&M, LICI missing)

- **Mahindra & Mahindra (`M&M`)** — NIFTY 50 heavyweight — is absent, while its
  news alias `M_M` sits unused (B13): it was clearly planned and never shipped.
  Its Yahoo symbol is `M&M.NS` (needs `encodeURIComponent`, which `loadChart`
  already does).
- **LICI** — NIFTY 50 since 2022 — absent.
- Check the current NIFTY 50 roster against `universe.js` for other recent adds
  (e.g. Bajaj Housing Finance, Jio Financial — verify against today's list).
- `{ sym: 'MINDTREE', y: 'LTIM.NS', n: 'LTIMindtree' }` — screener's slug is
  `LTIM`; you rely on their redirect, and the news alias key doesn't line up.

**Fix**: stop hand-maintaining — see §5, "Generate the universe from NSE CSVs".

### B15 🟡 Backtest maths is internally inconsistent

- `cagr` = CAGR of the **arithmetic mean** of per-stock buy-and-hold returns
  (`valuation.js:452`).
- `maxDrawdown` = drawn from an **equal-weight daily-rebalanced** curve
  (`valuation.js:455`).

Two different portfolio constructions in one KPI row. Also the mean-of-returns →
CAGR conversion overstates compounded growth for volatile baskets.
**Fix**: compute *both* from the equity curve (CAGR = `(curveLast/curveFirst)^(1/y)`),
and state the rebalancing policy in the note (or offer buy-and-hold vs annual
rebalance). The curve is already built — one extra pass.

### B16 🟡 `loadChart` can emit NaN points

`kAdj.push(qc ? adj[ka] / qc : 1)` trusts `adj[ka]` exists, and the point filter
`adj[i] != null` **passes NaN** (`NaN != null` is true). One short/odd Yahoo
array poisons `min/max` and blanks the entire chart.
**Fix**: `Number.isFinite(...)` guards when building `pts`; drop bad points.

### B17 🟡 Dead code

- `_getSF()` / `superFetch` (`live.js:23`) — never called.
- `sleep()` defined twice (`live.js:364`, `app.js:918`).
- `httpText(url, preferProxy)` — `preferProxy` never read (`live.js:378`).
- Comment at `live.js:29-31` says "this block used to hold a second copy…" —
  the NOTE itself is now stale.

### B18 🟡 The "PWA" has no service worker

`manifest.webmanifest` exists, but nothing registers a service worker (grep
confirms). Consequences: no offline shell, no install-prompt reliability in
Chrome, and the README's "PWA install" claim is half true.

**Fix**: tiny hand-written `sw.js` (precache the shell: `index.html`,
`theme.css`, the six scripts, icons; network-first for data with the existing
PStore cache as the offline source). ~60 lines, no build step.

### B19 🟡 CI never runs on `main` or on PRs

Workflow triggers: `push: branches: ["arena/**"]`, tags, manual. A PR into
`main` runs nothing; a direct push to `main` runs nothing. The quality gate only
exists on arena branches. (Also the header comment claims branch pushes upload
to the `noobsscreener` Release, but the `if:` only passes for tags or when
`inputs.release_tag` is non-empty — verify which behaviour you actually want;
comment and condition disagree.)

**Fix**: add `pull_request:` + `push: branches: [main]`; split into a fast
`test` job (ubuntu + windows matrix, `npm test`) and the existing `build` job
(tags only, to save Actions minutes). Add ESLint + Prettier to that gate.

### B20 🟡 Polish items

- `package.json`: `"author": ""`; no `engines`.
- `resize` handler redraws three charts with no debounce; scroll-spy runs 13
  `querySelector`s per scroll event (throttle to rAF).
- Search **Enter** only considers the curated 161 (`init()` keydown) — a stock
  found via universal search can't be opened with Enter.
- `freshStamp` says "prices live" even when the chart failed and the price shown
  is screener's up-to-7-day-old page price.
- Workflow/test docs: README says 62 checks — accurate ✓ (13+12+22+15).

---

## 4. Required changes — prioritised fix list

### P0 — do before the next release (visible wrongness / injection)

1. **B1** Quarterly growth step + honest labels (+ test: 4-quarter fixture must
   print true YoY).
2. **B2** Search dropdown: single-render + event delegation (+ jsdom test:
   simulate remote append, click a curated row).
3. **B3** Split quote TTL (60-150 s in market hours) from history TTL (1 day);
   honour TTL on the in-memory `CH` cache; replace "live" copy with a real
   timestamp.
4. **B4** Escape all symbol interpolations; remove inline `onclick`; validate
   slugs at `openSlug()` (`/^[A-Z0-9&\-]{1,20}$/`).

### P1 — hardening (do in the same sprint)

5. **B5** `ns-fetch` scheme + host allowlist, response-size cap.
6. **B6** CSP meta tag (after B4 removes inline handlers).
7. **B7** Upgrade `electron` + `electron-builder` → zero audit findings; add
   `engines`.
8. **B8** `requestSingleInstanceLock()`.
9. **B9** Guard `exportStock` + user-visible error toast.
10. **B10** Pair labels with values in `drawFinChart`.
11. **B11** `hi52 > lo52` guard; clear `LAST_CH` on entering index mode.
12. **B12** Rebuild sector `<select>` when `SECTORS` grows.
13. **B13/B14** Fix alias keys; add `M&M`, `LICI`; rename `MINDTREE`→`LTIM`
    (keep `ALT_SLUG`/redirect tolerance); re-verify the full NIFTY 50 roster.

### P2 — quality of life

14. **B15** One portfolio construction for CAGR + drawdown (from the curve).
15. **B16** Finite-number guards in `loadChart`.
16. **B17** Delete dead code.
17. **B18** `sw.js` for the web build.
18. **B19** CI on `main` + PRs; ESLint/Prettier; fix workflow comment/condition.
19. **B20** Debounce resize, rAF scroll-spy, Enter opens top remote hit,
    honest freshness stamp, `author` field.

Each fix should land with a regression test — the suite's style (real fixtures,
fuzzing, jsdom boot) makes this cheap.

---

## 5. Roadmap: what "best in the world" looks like here

Your unfair advantage: **no build step, no backend, no API keys, everything
client-side** — a stock screener a noob can double-click. Screener.in has the
data but not the product craft; TradingView has the craft but not the India
fundamentals. Win by combining: *the financials data model × TradingView's
polish × zero-install honesty*.

### 5.1 Data & trust (the foundation)

- **Generate the universe from official NSE CSVs.** NSE publishes index
  constituent lists (`ind_nifty50list.csv`, `ind_nifty500list.csv` on
  `archives.nseindia.com` — verify exact URLs) with symbol + industry. A small
  Node script (run in CI weekly or on demand) emits `universe-nse500.js` in the
  same shape as today's file. This permanently fixes drift (B14), gives you
  **NSE 500 screening**, and keeps the "ship static data, fetch live" model.
  Keep the curated file as "Favorites" if you like the hand-picked feel.
- **Freshness you can see**: every card gets a subtle "updated 2m ago" chip;
  a global market-status pill (open/closed/closed-updating) driven by a tiny
  NSE calendar (weekends + fixed holidays list, ~40 lines).
- **Polite, resilient scraping**: exponential backoff with jitter on 429/5xx,
  a request queue that serialises financials-source traffic (you're a guest on their
  service), conditional requests if they send validators, and a visible
  "data source unreachable — showing cached 6 h old data" banner instead of
  silent staleness.
- **Data-source status card** ("Yahoo: 41 ms · financials: 210 ms · Google
  News: down") — turns opacity into trust and makes bug reports actionable.
- **Legal posture**: keep the attribution section, add `SECURITY.md`, and
  evaluate at least one *licensed* fallback feed (e.g. an optional user-supplied
  API key for Twelve Data / FMP / Alpha Vantage) so the app survives any single
  source changing its mind.

### 5.2 Product depth (why people stay)

- **Shareable screens** — the query preview already exists. Serialize `S.scr`
  to `?q=` in the URL (copy button becomes "Copy link"). Someone tweets a
  screen; a stranger opens it. Zero backend, infinite distribution. *Highest
  ROI feature on this list.*
- **More filters**: P/S, EV/EBITDA, ROCE *trend*, debt trend, promoter pledge %,
  FII Δ q/q, beta, distance from 52w high, min years of data, exclude-banks flag.
- **Saved screens** (persisted via `PStore.state`), named, re-runnable, with a
  CSV/PNG export and a "backtest this saved screen" flow.
- **Backtest v2**: CAGR/drawdown from one curve (B15), rolling returns, more
  horizons (1/2/3/5/10y), benchmark picker (SENSEX, sector indices), optional
  annual rebalance, export picks with entry/exit prices, and an explicit
  survivorship-bias banner (you already disclose — make it a first-class UI
  element when the universe grows to NSE 500).
- **Compare mode**: pick 2-4 stocks → one table (valuation, growth, margins,
  shareholding, returns) + overlaid normalised price chart. Peers card already
  gives you 90% of the data plumbing.
- **Watchlist v2**: portfolio mode — buy price/qty, P&L, allocation donut,
  day-change totals. Stored in the same `state.json`.
- **Alerts (desktop)**: price/PE/ROE thresholds via `Notification` + a periodic
  quote refresh (only after B3's short TTL exists). This is the killer desktop
  feature a static site can't match.
- **Charts**: keep the hand-drawn canvas (it's good and dependency-free), add
  crosshair OHLC readout, log scale, stock-vs-NIFTY normalised overlay, and a
  volume-VP overlay. If you ever want candles, vendor TradingView's
  `lightweight-charts` as a single UMD file — still no bundler.
- **Dividend / bonus / split history card** — cheap to parse, high utility.
- **Command palette (⌘K / Ctrl-K)**: fuzzy search across stocks, screens,
  actions ("toggle theme", "run backtest"). The search box logic is already
  90% there.

### 5.3 For the "noobs" (lean into the name)

- **First-run guided tour** of the one-page layout (3 steps, localStorage-gated).
- **Glossary tooltips** on every metric: "What is ROCE? Why does P/E matter?"
  — a `data-tip` attribute + one delegated listener. Nobody else does this.
- **Sample/offline demo mode**: press a key and the app loads a bundled fixture
  company so the product is explorable with no network (great for demos, for
  the smoke test, and for first-run anxiety).
- Empty states that teach ("No stocks match — try loosening P/E to 40; here's
  what P/E means ↗").

### 5.4 Engineering excellence (keep the philosophy, raise the bar)

- **Stay zero-build**, but add *analysis-only* tooling: ESLint + Prettier, and
  `tsc --noEmit --allowJs --checkJs` over `renderer/` with JSDoc typedefs for
  `Company`, `Chart`, `ScreenerRow` — type safety without a compile step.
- **Extract pure logic for tests**: `finTableHTML`, `rowPasses`, `esc`, CSV
  export already *are* pure — move them (or re-export) so they're testable
  without booting jsdom. Target: cover every P0/P1 bug with a regression test.
- **Web build storage**: `PStore` is already an interface — add an **IndexedDB**
  backend for the no-Electron path. Kills the 5 MB localStorage quota (the exact
  class of bug that produced this app's worst incident, per `main-store.js`).
- **Service worker** (B18) + `Cache Storage` for the shell.
- **CI**: test matrix (ubuntu/windows × Node 22), lint, `npm audit --omit=dev`
  (must stay 0), a Playwright smoke that loads `renderer/` against a local
  static server with mocked routes, and a **release workflow on tags only**.
- **Perf budgets**: Lighthouse CI on the web build (you've done the hard parts —
  lazy load, paint coalescing — now enforce them). If the universe grows to 500,
  virtualise the screener table (only 15 rows render today — already fine).
- **Move HTML parsing off the UI thread**: a Web Worker using `DOMParser`
  (available in workers) keeps 500 stock parses from ever janking the chart.
- **Error boundary**: one global `error`/`unhandledrejection` handler that shows
  a toast with a copyable report ("Noobs Screener 2.0.1 · Electron 33 ·
  RELIANCE · loadChart timeout") — turns mystery reports into precise ones.
- **Logging**: main-process log file (rotating, 1 MB cap) behind a `--verbose`
  flag; no telemetry, no phones home (that's on brand — say so in the README).

### 5.5 Release & distribution

- **Code signing** is the single biggest adoption blocker today (SmartScreen
  scare on every install). For an OSS project, look at **SignPath.io's free
  OSS tier** — it integrates with GitHub Actions directly.
- **Auto-update** (`electron-updater`) *after* signing — updates signed,
  updates trusted. Without signing it makes SmartScreen worse, not better.
- Multi-platform CI (macOS `dmg`, Linux `AppImage`) — electron-builder already
  supports it; you've just configured `win`.
- Docs polish: architecture diagram (the one in §2 works), a 30-second GIF tour
  at the top of the README, `CONTRIBUTING.md`, issue/PR templates, and a live
  demo link pinned in the repo description.

### 5.6 Suggested sequencing

| Sprint | Focus | Outcome |
|---|---|---|
| **1** | P0 fixes (B1-B4) + regression tests | No wrong numbers, no dead clicks, no injection |
| **2** | P1 hardening (B5-B14) + dependency upgrades | Clean `npm audit`, locked-down shell, universe repaired |
| **3** | Freshness architecture (B3 fully) + market calendar + honest timestamps | "Live" means live |
| **4** | Shareable screen URLs + saved screens + ⌘K | First viral/distributable feature |
| **5** | NSE 500 generation script + backtest v2 (B15) | Screener grows10× |
| **6** | PWA (SW + IndexedDB) + CI on main + lint/type gate | Engineering credibility |
| **7+** | Compare mode, alerts, portfolio, glossary/tour | The product moat |

---

## 6. One-paragraph verdict

Noobs Screener is unusually honest, unusually well-tested for a no-build side
project, and architecturally clean — the fixes above are mostly surgical. Ship
sprint 1-2 and it goes from "clever scraping toy" to *trustworthy*: right
numbers, live prices that are actually live, a locked-down shell, and a universe
that can't drift. Then the roadmap is about the two things no competitor
simultaneously offers: **shareable, backtestable screens over the full NSE
universe — in an app that a noob can run without an account, a key, or a
build step.**

---

*Generated by a full-repo audit. Every bug above cites file:line and, where
marked "verified", was reproduced against the real code before this document
was written.*
