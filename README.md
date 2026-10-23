# Aurora Files

[![CI](https://github.com/skyline019/AuroraFiles/actions/workflows/ci.yml/badge.svg)](https://github.com/skyline019/AuroraFiles/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-0078D4)](https://github.com/skyline019/AuroraFiles/releases)

Apple-style file manager for **Windows** — real-disk browsing in Electron, with a polished Finder-inspired UI, searchable index, and rich preview.

> Demo mode (browser) ships a virtual disk for UI exploration. Desktop builds talk to the real filesystem.

## Features

- **Real disk** — drives, user folders, copy / cut / paste / rename / trash (Recycle Bin)
- **Views** — grid, list, columns, gallery (files-only toggle)
- **Search** — deep walk + prefix index (cancelable / single-flight)
- **Preview** — images (incl. HEIC/TIFF/AVIF/RAW via bundled ffmpeg), video posters, Office (DOCX/XLSX), **PPTX slide canvas**
- **UX** — tabs, Quick Look (Space), command palette, dark mode, index prefs

## Screenshots

_Add product screenshots here after first public cut._

## Install

Download the latest **unsigned** Windows build from [Releases](https://github.com/skyline019/AuroraFiles/releases):

| Artifact | Use |
|---|---|
| `AuroraFiles-Setup-*.exe` | NSIS installer |
| `AuroraFiles-Portable-*.exe` | Portable |

Windows may warn on SmartScreen until the binary is code-signed.

## Develop

```bash
npm ci
npm run ffmpeg:ensure    # bundled ffmpeg for media decode (mirror by default)
npm run desktop          # Electron + Vite HMR (real disk)
npm run dev              # browser demo disk only
```

### Scripts

| Command | Purpose |
|---|---|
| `npm run typecheck` | TypeScript |
| `npm test` | Vitest unit suite |
| `npm run test:e2e` | Playwright (demo UX + preview) |
| `npm run test:real-search` | Real-disk search assert (Windows) |
| `npm run test:smoke-win` | `win-unpacked` smoke (SKIP if missing) |
| `npm run build:desktop` | NSIS + portable (unsigned) |

### ffmpeg fetch policy

Binary install is **mirror XOR proxy** — never both:

```bash
# default: npmmirror, proxies cleared
npm run ffmpeg:ensure

# or proxy → GitHub releases
# FFMPEG_FETCH=proxy HTTPS_PROXY=http://127.0.0.1:10808 npm run ffmpeg:ensure
```

Bundled ffmpeg is **GPL**. See `node_modules/ffmpeg-static/LICENSE` after install.

## Architecture (short)

```
src/          React UI + Zustand
electron/     Main process, FS IPC, index, updater, ffmpeg path
shared/       Cross-process helpers (if any)
e2e/          Playwright
```

Index stack lives under `electron/index/` (RB-tree / FTS / optional USN). Preview Office/PPTX is dynamically imported to keep the first paint light.

## CI

GitHub Actions (`.github/workflows/ci.yml`) is strict:

1. **test** (Ubuntu) — typecheck, unit, index bench, web + electron renderer build  
2. **windows-gate** — typecheck, unit, real-search, Playwright e2e  
3. **package-win** (push to `main`) — unsigned desktop build + required smoke + artifacts  

PRs must pass `test` + `windows-gate`.

## License

[MIT](LICENSE) © 2026 skyline019  

Third-party: Electron/Chromium and **ffmpeg-static** (GPL) ship with desktop builds — comply with their terms when redistributing binaries.
