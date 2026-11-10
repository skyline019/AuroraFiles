#!/usr/bin/env node
/**
 * 真盘索引热路径冒烟：使用本机 userData 索引，断言 E:「问」瞬时命中。
 *
 *   node scripts/real-search-index.mjs --assert --max-ms 200
 *
 * 注意：无 .aidx 时冷 hydrate 可能很慢（数十秒～数分钟）；测完必须 dispose 关掉 indexd，
 * 否则会残留 aurora-indexd.exe / node 子进程。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { configureIndexDir, getIndexFilePaths } from '../electron/index/persist.mjs';
import { resetIndexPrefsCache } from '../electron/index/indexPrefs.mjs';
import { disposeVolumeIndex, ensureIndexed, getIndex } from '../electron/index/fsIndex.mjs';
import { searchFiles, volumeRootOf } from '../electron/index/searchFiles.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const root = path.resolve(arg('--root', process.env.AURORA_SEARCH_ROOT || 'E:\\'));
const query = arg('--query', process.env.AURORA_SEARCH_QUERY || '问');
const assert = process.argv.includes('--assert');
const maxMs = Number(arg('--max-ms', '200')) || 200;
const maxHydrateMs = Number(arg('--max-hydrate-ms', process.env.AURORA_MAX_HYDRATE_MS || '300000')) || 300_000;
const indexDir = arg(
  '--index-dir',
  process.env.AURORA_INDEX_DIR || path.join(os.homedir(), 'AppData', 'Roaming', 'aurora-files', 'index'),
);

let exitCode = 0;

try {
  await fs.access(indexDir);
} catch {
  console.error(`index dir missing: ${indexDir}`);
  process.exit(assert ? 2 : 0);
}

try {
  await fs.access(root);
} catch {
  console.error(`root missing: ${root}`);
  process.exit(assert ? 2 : 0);
}

configureIndexDir(indexDir);
resetIndexPrefsCache();
const vol = volumeRootOf(root);
disposeVolumeIndex(vol);

const files = getIndexFilePaths(vol);
let aidxBytes = 0;
try {
  aidxBytes = (await fs.stat(files.aidx)).size;
} catch { /* no aidx */ }
if (!aidxBytes) {
  console.warn(`[warn] missing ${files.aidx} — cold hydrate may take minutes (ndjson→native)`);
}

const hydrateHeartbeat = setInterval(() => {
  const idx = getIndex(vol);
  console.error(`[hydrate…] ${Math.round((performance.now()) / 1000)}s entries≈${idx.entryCount()} ready=${idx.ready}`);
}, 15_000);
hydrateHeartbeat.unref?.();

let hydrateMs = 0;
let ms = 0;
/** @type {any} */
let res = null;
/** @type {any} */
let idx = null;

try {
  const hydrateT0 = performance.now();
  await ensureIndexed(vol, { maxDepth: 0, track: 'ui' });
  hydrateMs = Math.round(performance.now() - hydrateT0);
  clearInterval(hydrateHeartbeat);

  if (assert && hydrateMs > maxHydrateMs) {
    console.error(`ASSERT fail: hydrate too slow ${hydrateMs}ms > ${maxHydrateMs}`);
    exitCode = 1;
  }

  idx = getIndex(vol);
  const t0 = performance.now();
  res = await searchFiles(root, query, {
    maxDepth: 64,
    maxScan: 0,
    maxResults: 100,
    indexDepth: 0,
  });
  ms = Math.round(performance.now() - t0);

  console.log(JSON.stringify({
    root,
    query,
    indexDir,
    aidxBytes,
    hydrateMs,
    ms,
    source: res.source,
    scanned: res.scanned,
    hits: (res.items || []).length,
    sample: (res.items || []).slice(0, 8).map((it) => it.name),
    idx: {
      ready: idx.ready,
      building: idx.building,
      entries: idx.entryCount(),
      backend: idx._backend,
    },
  }, null, 2));

  if (assert && exitCode === 0) {
    if (!idx.ready || idx.entryCount() < 1) {
      console.error('ASSERT fail: index not ready');
      exitCode = 1;
    } else if (!String(res.source || '').includes('index')) {
      console.error(`ASSERT fail: expected index source, got ${res.source}`);
      exitCode = 1;
    } else if (!(res.items || []).length) {
      console.error('ASSERT fail: no hits');
      exitCode = 1;
    } else if (ms > maxMs) {
      console.error(`ASSERT fail: too slow ${ms}ms > ${maxMs}`);
      exitCode = 1;
    } else {
      console.log('ASSERT ok');
    }
  }
} catch (err) {
  clearInterval(hydrateHeartbeat);
  console.error(err);
  exitCode = 1;
} finally {
  try {
    disposeVolumeIndex(vol);
  } catch { /* */ }
}

process.exit(exitCode);
