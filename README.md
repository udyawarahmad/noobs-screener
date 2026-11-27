# Noobs Screener

**Noobs Screener** is a lightweight, single-page Indian stock screener and research terminal. It fetches **live market prices, charts, financials, ratios, peers, and shareholding** directly from Yahoo Finance and screener.in — with no backend server, no API keys, and no login required.

You can use it in **three ways**:

| Way | Best for | How it runs |
|---|---|---|
| **Windows Desktop App (`.exe`)** | Everyday use (fastest & most reliable) | Electron app — fetches through Node.js with zero CORS limits |
| **Run from Source (Win / Mac / Linux)** | Developers & customizers | `npm install && npm start` with Node.js |
| **Static Website** | Hosting online or mobile browser | Upload `renderer/` to GitHub Pages, Netlify, or Vercel |

---

## Table of Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
  - [1. Download the Windows App](#1-download-the-windows-app)
  - [2. Run Locally from Source](#2-run-locally-from-source)
  - [3. Host as a Static Website](#3-host-as-a-static-website)
- [How It Works Under the Hood](#how-it-works-under-the-hood)
  - [Data Sources & Fetch Pipeline](#data-sources--fetch-pipeline)
  - [Caching & Browser Storage](#caching--browser-storage)
  - [Financial Calculations & Edge-Case Rules](#financial-calculations--edge-case-rules)
- [Testing](#testing)
- [Building the Windows `.exe`](#building-the-windows-exe)
  - [Build Locally](#build-locally)
  - [Automated Builds via GitHub Actions](#automated-builds-via-github-actions)
- [Creating a New Release](#creating-a-new-release)
- [Troubleshooting & FAQ](#troubleshooting--faq)
- [Disclaimer & License](#disclaimer--license)

---

## Features

### Market Overview & Universal Search
- **Live Indices Bar**: Tracks **NIFTY 50**, **SENSEX**, **NIFTY BANK**, **USD / INR**, and **Gold** across the top strip. Click any chip to load its full price chart, 52-week range, day stats, and 1-year return.
- **Universal Stock Search**: Instant search across **161 curated NSE stocks** plus live API search across **every listed company on screener.in** (including BSE-only numeric scrip codes).

### Stock Deep-Dive Page
- **Price & Interactive Chart**:
  - Current price, day % change, Open / Day High / Day Low / Prev Close / Volume, and a visual **52-week range bar**.
  - Canvas price & volume chart with **1M / 6M / 1Y / 3Y / 5Y** timeframes, **50 DMA** and **200 DMA** moving-average overlays, and desktop hover / mobile touch tooltips.
- **12 Key Ratio Cards**: Market Cap, P/E, P/B, ROE, ROCE, Dividend Yield, Debt/Equity, Face Value, 3Y Sales Growth, 3Y Profit Growth, Latest OPM, and 52W Range.
- **Pros & Cons**: Strengths and red flags parsed from screener.in.
- **Peer Comparison**: Live peer metrics (`CMP ₹`, `P/E`, `M.Cap Cr`, `Div Yld%`, `Qtr Profit`, `Qtr Sales`, `ROCE%`, etc.). Click any peer to open it.
- **Quarterly Results**: Latest 8 quarters with **true Year-over-Year (YoY)** growth under revenue, operating profit, PBT, net profit, and EPS.
- **Profit & Loss**: Annual statements plus trailing twelve months (`TTM`), with a toggleable **Sales / Net Profit** bar chart.
- **Balance Sheet, Cash Flows & Ratios**: Up to 8 periods of annual statements and published ratios.
- **Shareholding Pattern**: Tabular breakdown + stacked bar chart for **Promoters, Government, FII, DII, Public, and Others**.
- **Filings & Links / About**: Quick links to the company website, screener.in, NSE, BSE, and Yahoo Finance (opened in your default browser on desktop), plus business summary and key facts.

### Custom Screener, Watchlist & Exports
- **Live Stock Screener**: Filter the curated universe (plus any additional stocks you opened via search or peers) using:
  - **One-click Presets**: *Large caps*, *High ROE (>20%)*, *High dividends*, *Low P/E (<20)*, *Almost debt-free*, *Fast growers*.
  - **12 Filters**: Search query, Sector, Market Cap, P/E, ROE, ROCE, Dividend Yield, Debt/Equity, 3Y Sales Growth, 3Y Profit Growth, OPM, and Watchlist-only.
  - **Query Preview & Sorting**: Human-readable query bar with one-click copy, clickable column headers (`Symbol`, `Company`, `CMP ₹`, `M.Cap Cr`, `P/E`, `ROE%`, `ROCE%`, `Div%`, `D/E`, `OPM%`, `SalesGr%`, `ProfitGr%`, `1Y%`, `★`), and pagination.
- **Watchlist**: Star/unstar stocks from the header or screener table. Saved in `localStorage` across sessions.
- **CSV Exports**:
  - **Export results CSV**: Downloads filtered screener results as `noobs_results.csv`.
  - **Export (top bar)**: Downloads the open stock's P&L (`<SYMBOL>_financials.csv`, supporting both standard companies and Banks/NBFCs) or the open index's daily price history (`<INDEX>_history.csv`).
- **Light & Dark Themes**: Toggle anytime from the top bar; preference is saved locally.

---

## Project Structure

```text
noobs-screener/
├── main.js                          # Electron main process (window, external links, IPC fetch proxy)
├── preload.js                       # Safely exposes window.electronFetch to the renderer
├── package.json                     # App metadata, npm scripts, electron-builder config
├── LICENSE                          # MIT License
├── README.md                        # Documentation
├── assets/
│   ├── icon.ico                     # Windows app & installer icon
│   └── icon.png                     # Window icon
├── renderer/                        # Standalone web app (works inside Electron or any static host)
│   ├── index.html                   # Single-page layout & section structure
│   ├── theme.css                    # Light/dark design system, sticky nav, responsive & print styles
│   ├── universe.js                  # 161 active NSE stocks + Yahoo/screener symbol aliases
│   ├── live.js                      # Network layer, localStorage cache, Yahoo & screener.in parsers
│   ├── app.js                       # UI rendering, charts, screener engine, watchlist, CSV exports
│   ├── manifest.webmanifest         # PWA manifest
│   └── icons/                       # 192x192 & 512x512 app icons
├── test/
│   └── screener.test.js             # 17 automated JSDOM regression & accuracy tests
└── .github/
    └── workflows/
        └── build-exe.yml            # GitHub Actions CI: runs tests, builds Windows .exe & uploads releases
```

---

## Quick Start

### 1. Download the Windows App

1. Open the repository's **Releases** page on GitHub.
2. Download one of the Windows builds:
   - **`Noobs-Screener-Setup-<version>.exe`** — Standard Windows installer (adds Start Menu shortcut & uninstaller).
   - **`Noobs-Screener-Portable-<version>.exe`** — Single standalone executable, no installation required.
   - **`Noobs.Screener-<version>-win.zip`** — Pre-extracted archive (launches fastest since it doesn't self-unpack on startup).
3. **Note on Windows SmartScreen**: The `.exe` files are unsigned, so Windows may show *"Windows protected your PC"* on first launch. Click **More info → Run anyway**.

### 2. Run Locally from Source

Requires **Node.js 22 LTS** (recommended for running `npm test`; Node 18+ works for `npm start`) from [nodejs.org](https://nodejs.org).

```bash
git clone https://github.com/udyawarahmad/noobs-screener.git
cd noobs-screener
npm install
npm start
```

### 3. Host as a Static Website

The `renderer/` directory has **zero build steps** and works on any static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages, or a local HTTP server):

```bash
# Quick local preview in a browser
npx serve renderer
```

> **Tip**: In a plain browser, `screener.in` requests go through a public CORS proxy (`corsproxy.io`), whereas Yahoo Finance allows direct browser requests. The Electron desktop app uses Node's `net.fetch` directly, making it faster and immune to third-party proxy limits.

---

## How It Works Under the Hood

### Data Sources & Fetch Pipeline

| Data | Source | How symbols are resolved |
|---|---|---|
| **Prices, intraday stats, 52W H/L, 5Y history** | Yahoo Finance (`v8/finance/chart`) | Tries `<SYM>.NS` (NSE) → `<SYM>.BO` (BSE) → `ALT_Y` fallbacks. Numeric slugs (BSE codes) try `<SYM>.BO` directly. |
| **Financials, ratios, peers, pros/cons, shareholding, search** | `screener.in` | Tries `/company/<SYM>/consolidated/` → `/company/<SYM>/`, plus `ALT_SLUG` aliases (e.g. `ETERNAL → ZOMATO`, `LTIM → MINDTREE`). |

Inside `renderer/live.js`, `httpText(url, preferProxy)` and `httpJSON(url)` fetch data in this order:

1. **Electron IPC (`window.electronFetch` → `main.js` `ns-fetch`)**: Runs in the Electron main process with no browser CORS restrictions. Explicit HTTP `4xx`/`5xx` errors stop immediately instead of retrying through fallbacks.
2. **Direct `fetch` vs. CORS Proxy (`https://corsproxy.io/?url=...`)**:
   - When `preferProxy` is `false` (Yahoo Finance): tries direct `fetch` first, falling back to `corsproxy.io`.
   - When `preferProxy` is `true` (`screener.in`): tries `corsproxy.io` first, falling back to direct `fetch`.

All requests use a **30-second `AbortController` timeout** so one stalled request cannot freeze the app.

### Caching & Browser Storage

All state and cached responses live in `localStorage`:

| Key pattern | Contents | Retention |
|---|---|---|
| `screenone3:co:<SYM>` | Parsed company financials, ratios, peers, shareholding | **7 days** |
| `screenone3:ch3:<YSYM>` | Yahoo 5-year daily OHLCV price history & quote metadata | **1 day** |
| `screenone_wl` | Saved watchlist symbols | Persistent |
| `screenone_theme` | Selected UI theme (`light` or `dark`) | Persistent |

- Clicking **Refresh** clears `screenone3:` cache keys and reloads live data while **preserving** your saved watchlist (`screenone_wl`) and theme (`screenone_theme`).
- If `localStorage` hits its quota limit, old chart caches are automatically cleared to make room for new data.

### Financial Calculations & Edge-Case Rules

Several safeguards ensure figures and filters stay accurate across unusual companies (banks, PSUs, turnaround companies, newly listed IPOs, and negative-net-worth firms):

- **Quarterly YoY Growth**: Compares each quarter `i` against the same quarter 1 year earlier (`i - 4`), rather than quarter-over-quarter (`i - 1`). Skips `% YoY` when the prior-year base is `<= 0`.
- **Annual P&L YoY Growth**: Compares consecutive fiscal years, skipping the `TTM` column and any negative/zero prior-year bases.
- **3Y Sales & Profit CAGR (`cagr3`)**:
  - Strips trailing `TTM` columns so CAGR is always computed across 4 distinct fiscal years (a true 3-year span).
  - Returns `null` (`–`) if either the starting or ending figure is `<= 0`, preventing `NaN` on loss-to-profit turnarounds or misleading positive percentages when losses deepen.
  - `NaN` / `null` values never pass active Screener filters.
- **Debt / Equity (`D/E`)**:
  - Reads `Borrowings` alongside either `Share Capital` or `Equity Capital` + `Reserves`, aligned to the latest shared balance-sheet column.
  - If total equity (`Capital + Reserves`) is `<= 0`, `D/E` is treated as `null` and flagged as **`Neg. Eq.`** / **`Neg`** in red so heavily indebted companies with negative net worth never pass *"Almost debt-free"* filters.
- **Price / Book (`P/B`)**: Calculated from live CMP divided by Book Value; omitted (`–`) when Book Value is `<= 0`.
- **1-Year Return (`ret1y`)**: Calculated from the trading bar closest to 365 days prior. Newly listed stocks with fewer than **330 days** of trading history display `–` instead of labeling a short post-IPO move as a 1-year return.
- **Moving Averages (50 DMA / 200 DMA)**: Computed over the trailing 50 and 200 trading days on split/dividend-adjusted closes.
- **Shareholding**: Tracks `Promoter`, `Government` (for PSUs), `FII`, `DII`, `Public`, and `Other`.

---

## Testing

The test suite uses **JSDOM** to boot the actual `renderer/index.html`, `universe.js`, `live.js`, and `app.js` and verify 17 regression & calculation scenarios (cache preservation, CAGR/TTM/negative-base math, negative net worth D/E, `Equity Capital` parsing, quarterly YoY, peer columns, PSU Government shareholding, chart label alignment, screener sorting/filtering, bank/index CSV exports, IPO 1Y return, intraday bars, index strip consistency, and async race conditions).

```bash
npm test
```

---

## Building the Windows `.exe`

### Build Locally

On a Windows machine (or Linux/macOS with Wine installed):

```bash
npm run dist
```

`electron-builder` writes the artifacts into `dist/`:
- `dist/Noobs-Screener-Setup-<version>.exe` (NSIS installer)
- `dist/Noobs-Screener-Portable-<version>.exe` (Portable executable)
- `dist/Noobs Screener-<version>-win.zip` (Zip archive)

> The first build downloads Electron and the NSIS packaging tools (~100–200 MB). Subsequent builds are much faster.

### Automated Builds via GitHub Actions

`.github/workflows/build-exe.yml` runs on `windows-latest`:
1. Installs dependencies (`npm install`) with Node.js 22.
2. Runs the full test suite (`npm test`).
3. Builds the NSIS installer, portable `.exe`, and `.zip` (`npm run dist`).
4. Uploads the outputs as a workflow artifact (**`Noobs-Screener-win`**).
5. When triggered by a **`v*` tag push** (or a manual run with `release_tag` set), automatically uploads the `.exe` and `.zip` files to that GitHub Release.

To run it manually: **GitHub → Actions tab → Build Windows EXE → Run workflow**.

---

## Creating a New Release

1. Update the version and commit (creates a `vX.Y.Z` tag automatically):
   ```bash
   npm version patch   # e.g. 1.0.2 -> 1.0.3 (or minor / major)
   ```
2. Push the branch and tag:
   ```bash
   git push origin <your-branch> --follow-tags
   ```
3. Create the GitHub Release (or wait for the `Build Windows EXE` workflow to attach the Windows binaries to the tag):
   ```bash
   gh release create v1.0.3 --title "Noobs Screener v1.0.3" --generate-notes
   ```

---

## Troubleshooting & FAQ

- **Stocks stay on `…` or show `"Could not load live data"`**:
  - Screener.in or the public CORS proxy (in web mode) may be rate-limiting bulk requests. Wait a few seconds and click **Refresh** in the top bar.
  - For bulk screening across all 161 stocks, the Electron desktop app is much more reliable than a static browser page.
- **Why does a metric show `–`?**
  - Either the source page doesn't disclose that metric, or a safeguard suppressed a misleading value (for example: negative Book Value for `P/B`, negative/zero equity for `D/E`, turnaround/negative base for `3Y CAGR`, or `< 330` days of price history for `1Y Return`).
- **I clicked Refresh — will I lose my Watchlist or Dark Mode?**
  - No. **Refresh** only clears cached company/chart data (`screenone3:*`), leaving `screenone_wl` and `screenone_theme` untouched.
- **Where are exported CSVs saved?**
  - In your browser or OS default **Downloads** folder (`noobs_results.csv`, `<SYMBOL>_financials.csv`, or `<INDEX>_history.csv`).

---

## Disclaimer & License

- **Disclaimer**: Market prices and charts from Yahoo Finance are indicative and may be delayed. Financial statements, ratios, peers, and shareholding are parsed live from screener.in. **This tool is for informational and educational purposes only and is not investment advice.**
- **License**: [MIT](LICENSE)
