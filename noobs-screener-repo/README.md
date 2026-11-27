# Noobs Screener (desktop + web)

One-page Indian stock screener — live prices/charts (Yahoo Finance, NSE), financials,
ratios, peers, pros/cons, shareholding (screener.in, parsed live), 160-stock curated
universe + universal search across every stock on screener.in, custom screener,
watchlist, light/dark themes.

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

1. Create a repo on GitHub (e.g. `noobs-screener`), push this folder to it.
2. Go to the repo's **Actions** tab → **Build Windows EXE** → **Run workflow**
   (or push a tag like `v1.0.0` — a build starts automatically).
3. When it finishes, download **Noobs-Screener-win** from the run's **Artifacts**.
   The `.exe` files are inside the zip.

## Host it as a website (optional)

Upload the contents of `renderer/` to GitHub Pages / Netlify / Vercel / any static
host. No build step — it runs as-is. (On the open web, screener.in pages load through
a public CORS-proxy fallback, so the desktop app is snappier and more reliable.)

## How the data fetching works

- `renderer/live.js` → `httpText` / `httpJSON` try, in order:
  1. `window.electronFetch` (desktop app — main process, no CORS limits),
  2. direct `fetch` (works for Yahoo everywhere),
  3. a public CORS-proxy fallback (so the plain-website version still works).
- Company pages are cached in `localStorage` for 7 days, price history for 1 day —
  repeat visits are instant and easy on the source sites.

## Versioning

Bump `version` in `package.json` for each release, then tag it:

```bash
npm version patch   # 1.0.0 -> 1.0.1
git push --follow-tags
```
