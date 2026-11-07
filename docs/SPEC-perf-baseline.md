# SPEC: Performance Baseline Harness

## Objective

Ship a repeatable evidence pipeline before product optimizations: every later claim of “faster / leaner / higher quality” must cite JSON metrics and screenshots from this harness.

## Profiles (extreme matrix)

| Id | Intent | Fixture |
|---|---|---|
| `S-mem` | Small-memory style load | ~5k files, lower `maxScan` |
| `S-files` | Huge directory | ~50k files (CI may cap via env) |
| `S-search` | Cold → hot index search | Deep tree + same query twice |
| `S-preview` | Preview quality + reclaim | Many image-like nodes + Quick Look |

## Metrics (per profile)

1. **folder_open_ms** — inject/open large folder → first visible item (UI)
2. **scroll_longtasks** — 2s grid scroll; count of longtasks >50ms (UI)
3. **search_cold_ms / search_hot_ms / hits** — backend index path
4. **rss_mb** — Node process RSS idle / after index / after search (backend); Chromium RSS note in UI JSON when available

Artifacts: `perf-out/<runId>/` → `summary.json`, per-profile `*.json`, `screenshots/*.png`.

## Commands

```bash
npm run test:perf-backend          # index/search/RSS matrix
npm run test:perf-ui               # Playwright open/scroll/screenshots
npm run test:perf-baseline         # both
npm run test:perf-volume           # whole-volume (Perf track)
npm run test:perf-startup          # cold-start ready/interactive
```

Env:

- `AURORA_PERF_OUT` — output dir (default `perf-out`)
- `AURORA_PERF_FILES_CAP` — cap `S-files` count (default 50000; CI often 8000)
- `AURORA_PERF_PROFILES` — comma list to run subset
- `AURORA_INDEX_TRACK` — `ui` \| `perf`（体积压测脚本通常显式 `track:'perf'`）

Index dual-track contract: [`index-tracks.md`](./index-tracks.md).

## Out of scope (v1)

Product feature changes beyond minimal `data-testid` hooks; macOS; global hard fail gates (warn + baseline compare only).

## Success

- All four profiles produce JSON + at least one screenshot each (UI profiles)
- Backend profiles produce cold/hot search + RSS numbers
- Re-run is deterministic enough to compare runs (same seed sizes)
