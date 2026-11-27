# Noobs Screener (desktop + web)

One-page Indian stock screener — live prices/charts (Yahoo Finance, NSE), financials,
ratios, peers, pros/cons, shareholding (screener.in, parsed live), **per-company news
(free RSS, no API key)**, **valuation history + screen backtesting ("Time Machine")**,
160-stock curated universe + universal search across every stock on screener.in,
custom screener, watchlist, light/dark themes.

This repo runs the app **outside Perchance** in two ways:

| Way | How | Notes |
|---|---|---|
| **Desktop app (.exe)** | Electron | No CORS issues — requests go through the main process |
| **Plain website** | `renderer/` on any static host | Yahoo works directly; screener.in goes via a fallback CORS proxy |

```
noobs-screener/
  main.js, preload.js     Electron shell (window + fetch proxy)
  renderer/               The app itself: index.html, theme.css,
                          universe.js, live.js, app.js, icons, manifest
  assets/                 icon.ico (installer) + icon.png (window)
  .github/workflows/      builds the Windows .exe automatically
```

## Run it on your machine

Needs **Node.js 18+ LTS** (https://nodejs.org).

```bash
git clone <your-repo-url> noobs-screener
cd noobs-screener
npm install
npm start
```

## Make the .exe (Windows)

On a Windows machine (or any machine — see GitHub option below):

```bash
npm run dist
```

Find the installer + portable exe in `dist/`:

- `Noobs Screener Setup 1.0.0.exe` — installer (Start-menu shortcut, uninstaller)
- `Noobs-Screener-Portable-1.0.0.exe` — single file, runs without installing

> First build downloads Electron + the installer toolkit (~100–200 MB). Later builds
> are fast. Building *for* Windows *from* Mac/Linux works with Wine — simplest is to
> build on Windows or use the GitHub Action below.

## Let GitHub build the .exe for you (easiest)

The workflow in `.github/workflows/build-exe.yml` builds both `.exe` files on a
Windows runner and attaches them to a **Release** — nothing to install locally.

1. Bump `version` in `package.json` if you're cutting a new version.
2. Push a tag — the build starts automatically and uploads to that tag's release:

   ```bash
   npm version patch        # or minor / major
   git push --follow-tags
   ```

   (Or run **Actions → Build Windows EXE → Run workflow** and type the release tag.)
3. When it finishes, the files are on the repo's **Releases** page:

   - `Noobs-Screener-Setup-<version>.exe` — installer (Start-menu shortcut, uninstaller)
   - `Noobs-Screener-Portable-<version>.exe` — single file, runs without installing

   The same files are also kept as the **Noobs-Screener-win** artifact on the run.

The `.exe` is **not code-signed**, so Windows SmartScreen may show
"Windows protected your PC" on first launch — click **More info → Run anyway**.

## Host it as a website (optional)

Upload the contents of `renderer/` to GitHub Pages / Netlify / Vercel / any static
host. No build step — it runs as-is. (On the open web, screener.in pages load through
a public CORS-proxy fallback, so the desktop app is snappier and more reliable.)

## Where your data is stored

The watchlist, theme and the live-data cache are **written to disk**, not to the
browser's localStorage (which is capped at ~5 MB and was the reason watchlists
disappeared after a restart in 1.0.0).

| Build | Location |
|---|---|
| Portable `.exe` | `Noobs-Screener-Data\` next to the `.exe` |
| Installed app | `%APPDATA%\Noobs Screener\` |
| Plain website | browser localStorage |

Inside that folder:

- `state.json` — watchlist and theme (small, always writable)
- `cache/` — one JSON file per cached stock (last 7 days of financials, 1 day of
  price history). Safe to delete; the app re-downloads what it needs.

Because the cache survives restarts, only the first launch of a day fetches data;
later launches render straight from disk. **Refresh** clears the cache only — your
watchlist is never touched.

## Time Machine: valuation history + backtesting

Two things free Indian screeners usually don't do.

**1. Is it cheap for *this* stock?** Every stock page shows P/E and P/B against that
stock's own multi-year history: current multiple, percentile ("cheaper than 78% of its
history"), median, 20th–80th percentile band, and a chart of the whole series.

**2. Would the screen have actually worked?** In the screener card, **Backtest this
screen** rebuilds your current filters as of 1–3 years ago, equal-weights the stocks that
passed, and reports CAGR, NIFTY CAGR, alpha, max drawdown and hit rate — plus the picks
with the return each one made.

How the numbers are produced (`renderer/valuation.js`):

| Input | Source / rule |
|---|---|
| EPS, net profit, book value | screener.in annual statements (10 years) |
| Price series | Yahoo Finance daily closes (5 years, split/bonus adjusted) |
| "Known at the time" | a fiscal year counts from **year end + 90 days**, approximating filing dates |
| Per-share history | today's share count (equity capital ÷ face value) — the same basis as adjusted prices |
| Today's multiple | anchored to the P/E and book value the source publishes, so this card never contradicts the rest of the app |

Honest limits, all shown in the UI: the backtest universe is *today's* 160 stocks
(survivorship bias), dividends are excluded, market cap uses today's share count, and
ROCE comes from the published ratio table (banks have none — shown as “–”, never invented).

## Speed

- **Only the stock you open is fetched at startup.** The 160-stock screener load waits
  until the screener card scrolls into view (or you touch its filters).
- Cached stocks paint straight from disk; the cache survives restarts.
- The bundler window is shown on `ready-to-show` (no white flash), and the desktop
  build drops the `backdrop-filter` blur on the sticky bars — the single most
  expensive thing to repaint on Windows.
- Company data and price history for the open stock are fetched in parallel.

**Pick the download that suits your startup-time preference:**

| Build | Startup | Why |
|---|---|---|
| `Noobs-Screener-Setup-*.exe` | fastest after first launch | installed normally, nothing to unpack |
| `Noobs-Screener-*-win.zip` | fast | unzip once, run `Noobs Screener.exe` — no per-launch unpacking |
| `Noobs-Screener-Portable-*.exe` | slowest | the portable launcher unpacks ~250 MB to `%TEMP%` **every launch** |

This is why the portable `.exe` feels slow to open: it is unpacking itself each time.
Use the installer or the zip for everyday use; keep the portable exe for USB sticks.

## News (free, no API key)

Each stock page has a **Latest News** card with recent headlines about that company.
Sources are public RSS feeds, tried in order until one returns results:

| Source | Feed |
|---|---|
| Google News | `news.google.com/rss/search?q="<company>" share` (best Indian coverage) |
| Bing News | `www.bing.com/news/search?format=RSS` |
| Yahoo Finance | `feeds.finance.yahoo.com/rss/2.0/headline?s=<ticker>` |

Nothing to sign up for and no quota.

**Only related news is shown.** A headline is kept only if it contains the company's
full name, every key word of the name (`Power Grid` -> both words), the ticker, or a
known press short form (`RIL`, `L&T`, `HUL`, `M&M`, `SBI`, ...). If nothing matches, the
card says so — it never fills up with generic market news.

Headlines are cached for 45 minutes (misses for 5), and clicking one opens it in your
system browser — links never navigate the app window.

## How the data fetching works

- `renderer/live.js` → `httpText` / `httpJSON` try, in order:
  1. `window.electronFetch` (desktop app — main process, no CORS limits),
  2. direct `fetch` (works for Yahoo everywhere),
  3. a public CORS-proxy fallback (so the plain-website version still works).
- Company pages are cached for 7 days, price history for 1 day — repeat visits are
  instant and easy on the source sites. In the desktop app the cache lives in
  `cache/` on disk (see above), so it survives restarts.

## Versioning

Bump `version` in `package.json` for each release, then tag it:

```bash
npm version patch   # 1.0.0 -> 1.0.1
git push --follow-tags
```
