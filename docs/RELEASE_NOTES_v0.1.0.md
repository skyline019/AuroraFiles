## Aurora Files v0.1.0

First public **Windows x64** cut — Apple-style explorer UI on a real disk via Electron.

### Highlights

- Real-disk navigation, tabs, grid / list / columns / gallery
- Cancelable deep search + configurable index prefs
- Media decode via **bundled ffmpeg** (HEIC / TIFF / AVIF / common RAW → preview JPEG; video gallery posters)
- Office preview: DOCX · XLSX · **PPTX slide-level canvas** (layout + images; approximate)
- Auto-update plumbing (`electron-updater`) — configure a real feed before relying on in-app updates
- CI: Linux typecheck/build + Windows real-search / Playwright / unsigned package smoke

### Downloads

| File | Notes |
|---|---|
| `AuroraFiles-Setup-0.1.0.exe` | NSIS installer (~154 MB, includes ffmpeg) |
| `AuroraFiles-Portable-0.1.0.exe` | Portable |

### Known limitations

- **Unsigned** — SmartScreen / AV may warn
- Bundled ffmpeg may be a large full build in some local trees; redistributors should prefer a slim static binary and respect **GPL** terms
- PPTX preview is approximate (no animation / SmartArt / charts)
- Update feed must be pointed at a real GitHub Releases / CDN URL for production

### Verify

```bash
npm ci && npm run ci          # local gates (smoke SKIP without win-unpacked)
```

MIT · © 2026 skyline019
