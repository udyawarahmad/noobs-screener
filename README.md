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
