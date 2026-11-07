#!/usr/bin/env node
/**
 * Hydrate-first second-open benchmark.
 *   npm run test:perf-hydrate
 *   node scripts/perf/measure-hydrate.mjs --volume E:\\ --max-scan 80000
 *
 * Builds (or reuses) a persisted lean index, disposes, then ensureIndexed without rebuild
 * and measures searchable_ms + hot search.
 */
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { rssMb } from './seed-tree.mjs';
import {
  configureIndexDir,
  ensureIndexed,
  disposeVolumeIndex,
  indexStatus,
  queryIndex,
} from '../../electron/index/fsIndex.mjs';
import { saveIndexPrefs, resetIndexPrefsCache } from '../../electron/index/indexPrefs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

function parseArgs(argv) {
  const out = {
    volume: null,
    maxScan: Number(process.env.AURORA_PERF_HYDRATE_MAX_SCAN) || 80_000,
    maxDepth: 32,
    query: 'png',
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--volume' || a === '--root') out.volume = argv[++i];
    else if (a === '--max-scan') out.maxScan = Number(argv[++i]) || out.maxScan;
    else if (a === '--max-depth') out.maxDepth = Number(argv[++i]) || out.maxDepth;
    else if (a === '--query') out.query = argv[++i];
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv);
  let root = opts.volume;
  if (!root) {
    // Prefer a mid-size tree under the repo if no volume — still proves hydrate path
    root = path.join(REPO, 'electron');
  }
  root = path.win32.normalize(root);
  if (!fssync.existsSync(root)) {
    console.error('root not found', root);
    process.exit(2);
  }

  const runId = `hydrate-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const outDir = path.join(REPO, 'perf-out', runId);
  await fs.mkdir(outDir, { recursive: true });
  const idxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-hydrate-idx-'));
  configureIndexDir(idxDir);
  resetIndexPrefsCache();
  await saveIndexPrefs({ maxScan: opts.maxScan, excludeNames: [] });

  console.log(`[hydrate] cold build persist root=${root} maxScan=${opts.maxScan}…`);
  disposeVolumeIndex(root);
  const tCold0 = performance.now();
  await ensureIndexed(root, {
    rebuild: true,
    leanMemory: true,
    persist: true,
    waitDebt: true,
    liveFollowers: false,
    hydrateFirst: false,
    maxScan: opts.maxScan,
    maxDepth: opts.maxDepth,
    maxPerf: true,
    walkEngine: 'js', // stable for small trees / CI
  });
  const coldMs = Math.round(performance.now() - tCold0);
  const coldSt = indexStatus(root);
  console.log(`  cold ${coldMs}ms size=${coldSt.size} src=${coldSt.source}`);

  disposeVolumeIndex(root);

  console.log(`[hydrate] second open hydrateFirst…`);
  const phases = [];
  const t0 = performance.now();
  await ensureIndexed(root, {
    rebuild: false,
    leanMemory: true,
    persist: true,
    liveFollowers: false,
    hydrateFirst: true,
    waitRefresh: false,
    maxScan: opts.maxScan,
    maxDepth: opts.maxDepth,
    onPhase: (phase, snap) => {
      phases.push({ phase, at: Math.round(performance.now() - t0), ...snap });
      console.log(`  [${phase}] at=${Math.round(performance.now() - t0)}ms size=${snap.size}`);
    },
  });
  const searchableMs = Math.round(performance.now() - t0);
  const st = indexStatus(root);

  const tHot = performance.now();
  const hot = await queryIndex(root, opts.query, { maxResults: 50 });
  const hotMs = Math.round(performance.now() - tHot);

  const result = {
    kind: 'aurora-perf-hydrate-first',
    runId,
    root,
    cold_build_ms: coldMs,
    searchable_ms: searchableMs,
    hot_ms: hotMs,
    hot_hits: hot.items?.length ?? 0,
    source: st.source,
    size: st.size,
    rss_mb: rssMb(),
    phases,
    pass: {
      searchable_lt_2000ms: searchableMs < 2000,
      hot_lt_50ms: hotMs < 50,
      source_hydrate: String(st.source).includes('hydrate'),
    },
  };
  result.ok = result.pass.searchable_lt_2000ms && result.pass.hot_lt_50ms;

  await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(result, null, 2));
  await fs.writeFile(
    path.join(REPO, 'perf-out', 'latest-hydrate.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(
    `[hydrate] searchable=${searchableMs}ms hot=${hotMs}ms hits=${result.hot_hits} src=${st.source} ok=${result.ok}`,
  );
  console.log(`wrote ${path.join(outDir, 'summary.json')}`);

  disposeVolumeIndex(root);
  try { await fs.rm(idxDir, { recursive: true, force: true }); } catch { /* */ }
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
