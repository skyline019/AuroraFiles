# Index resident — aurora-indexd

Authoritative volume index lives in a long-lived Rust process (`aurora-indexd`). Node/`VolumeIndex` orchestrates walk, FTS5 sidecar, debt, and hydrate — it does **not** retain millions of entries in V8 `meta` when `AURORA_INDEX_BACKEND=native`.

**UI vs Perf tracks** (walk concurrency / FTS drip / debt pacing) are orthogonal to the backend switch — see [`index-tracks.md`](./index-tracks.md). Desktop IPC defaults to the **UI** track; volume bakeoff/measure scripts use **Perf** (`maxPerf` / `track: 'perf'`).

## Stack (locked)


```
Electron UI
  → Node fsIndex orchestrator
       → WalkEngine (mft → rust → js)  upsert stream (no V8 retain)
       → aurora-indexd (compact arena, query top-k, persist/hydrate)
       → SQLite FTS5 sidecar (debt slices via export_slice)
```

| Layer | Role |
|---|---|
| **Rust `aurora-indexd`** | path/name/kind/frn compact store; prefix/contains query; FRN map; NDJSON hydrate/persist; RSS stats |
| **Node** | `ensureIndexed` / debt / FTS / WalkEngine spawn+forward; **no** `meta.set` for full volume in native mode |
| **C++ MFT** | enum subprocess only; entries forwarded into indexd |

Not in this iteration: napi, Tantivy rewrite, Tauri UI move.

## Switch

| Value | Behavior |
|---|---|
| unset | native when volume root + lean path + binary present; else js |
| `AURORA_INDEX_BACKEND=native` | force native if binary exists; else degraded js |
| `AURORA_INDEX_BACKEND=js` | classic `VolumeIndex.meta` |

Binary resolution (`AURORA_INDEXD_BIN` or):

- `native/indexd/target/release/aurora-indexd.exe`
- `native/indexd/target/debug/aurora-indexd.exe`

Build: `cargo build --release --manifest-path native/indexd/Cargo.toml`

## IPC (stdio, one JSON object per line)

`upsert` / `upsert_batch` / `upsert_node_batch` · `barrier` · `remove` / `remove_frn` · `query` · `get` · `resolve_frn` · `stats` · `normalize_slice` / `normalize` · `export_slice` · `hydrate_*` · `persist_*` · `clear` · `ping`

Client: [`electron/index/indexdClient.mjs`](../electron/index/indexdClient.mjs).

## Hydrate-first

On second open, Node calls `indexd.hydrate_ndjson` on the volume NDJSON (indexd reads the file — Node does not parse millions of lines into the heap). Status `source` ≈ `disk-hydrate-first`; softRefresh catches up asynchronously.

Native persist writes the same NDJSON path via `indexd.persist` + meta sidecar (`backend: "native"`). Delta appends still go through Node for small live updates; compact is indexd full persist.

## Status fields

`indexStatus` / `refreshIndexStatus`:

- `backend`: `native` | `js`
- `size`: entry count (indexd stats when native)
- `metaSize`: V8 `meta` size (should stay ~0 in native)
- `node_rss_mb` / `indexd_rss_mb`

## Gates

`npm run test:perf-indexd` (full volume) or `--smoke`:

| Metric | Gate (E:\\ ~1.1M lean) |
|---|---|
| Node RSS after index | ≤ 150MB |
| indexd RSS | ≤ **100MB** (dense FRN + lazy path index; measured ~62) |
| Hot search | ≤ 40ms |
| T1 searchable | not worse than prior rust walk +20% |

Unit: `electron/index/indexd.native.test.ts` (skipped if binary missing).

## Storage (v2)

- **Parent-chain**: arena = unique name components only; entry = `{parent, name, flags, frn, path_hash}`. Path rebuilt on demand.
- **Binary snapshot** `.aidx` (magic `AIDX` v2): arena + packed entries; preferred over NDJSON for hydrate/persist.
- **Multi-word**: `query` splits tokens — primary hits name index, rest filter path/name (no FTS required). Set `AURORA_INDEXD_FTS=1` for SQLite FTS5 sidecar when needed.

## Measured (E:\\, 2026-11-07)

### Latest (elevated MFT) — path_slots ≤90

Run: `indexd-2026-11-07T02-46-48-577Z`

| Metric | Value | Gate |
|---|---|---|
| T1 searchable | **6.2s** | ✓ |
| space_cleared | **2.6s** (async; includes 1× arena) | not on T1 |
| persist | **101ms** | ✓ |
| Node RSS | **82MB** | ≤90 ✓ |
| indexd RSS (path ready) | **69MB** | ≤90 ✓ |
| path_index_ready | true | ✓ |
| cold / hot | **4.2 / 0** | ✓ |

Space debt: `normalize_slice` phases `path → shrink → arena(once) → path → done`; `.aidx.d` >8MB (or `AURORA_AIDX_COALESCE_BYTES`) coalesces via `persist_bin`. Path index is open-addressing `path_slots` (~4B/slot).

### Parent-chain + `.aidx` — path upsert baseline

Run: `indexd-2026-11-07T01-42-37-909Z`

| Metric | Parent-chain |
|---|---|
| T1 / Node / indexd | 9.4s / 49MB / 92MB |

### Evolution

| Stage | indexd RSS | Node RSS | T1 |
|---|---|---|---|
| First native | 425MB | 252MB | 12s |
| Parent-chain + aidx | **92MB** | **49MB** | 9.4s |
| MFT FRN-link | 126MB | 50MB | 7.3s |
| dense FRN + fast aidx | 62MB | ~107MB | ~11s |
| defer path_hash | 62MB | 105MB | 4.4s |
| space debt normalize | 96MB (path on) | 102MB | 4.3s |
| **path_slots + no MFT intern** | **69MB** (path on) | **82MB** | **6.2s** |

### Root causes → fixes

| Symptom | Root cause | Fix |
|---|---|---|
| indexd path bloat | full path per entry in arena | **parent-chain** + unique name components |
| mft T1 ≫ rust | materialize full paths in C++ then re-parse | **`stream-nodes`** + `upsert_node` FRN links |
| cold query 1s after FRN ingest | orphan `pending_parent` → relink every query | drop unresolved parents after one barrier |
| total wall ≫ T1 | sync `.aidx` persist | **async persist debt** (`waitPersist` opt-in) |
| USN lag | 5s debounce + path resolve + stat | 1.2s / `remove_frn` / node upsert / deferred flush |
| FRN RSS 126≫94 | HashMap frn + eager by_path | **dense `Vec<u32>` FRN** + **lazy path index** |
| aidx ~32s | 5 syscalls × 1.1M entries | **BufWriter + packed entry blob** (~0.13s) |
| USN PowerShell | Add-Type cold start every poll | **`aurora-mft-enum --mode usn-read`** |
| T1 ~11s after dense FRN | barrier 1M×`build_path` String | **defer path_hash** to lazy path index |
| delta loss on reopen | `.aidx.d` write-only | **`hydrate_bin` / `hydrate_delta` replay** |
| path tip / RSS after T1 | lazy path unpaid | **`debt.space` + `normalize_slice`** idle |
| fat `.aidx.d` | reopen slow | coalesce when **>8MB** into base aidx |
| indexd 96≫90 after path | FxHashMap by_path ~24B/slot + name_intern peak | **`path_slots` OA ~4B/slot**; MFT `push_bytes` (no intern); shrink drops intern |
| Node ~102 after T1 | large walk stdin chunks + one GC | smaller flush (600/96KB) + `releaseWalkBuffers` + multi GC |
| space 180s hang | arena compact cleared path then skipped rebuild | **one-shot arena** then forced path rebuild |
