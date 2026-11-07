#!/usr/bin/env node
/**
 * Native indexd resident gate (E:\\ lean ~1.1M when available).
 *
 *   npm run test:perf-indexd
 *   node scripts/perf/measure-indexd.mjs --volume E:\\
 *
 * Gates (plan):
 *   node_rss_mb   ≤ 90   (post-searchable GC / small walk buffers)
 *   indexd_rss_mb ≤ 90   (compact path_slots open-addressing)
 *   hot_ms        ≤ 40
 *   T1 within +20% of prior rust-walk baseline when comparable
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
  refreshIndexStatus,
  waitIndexDebt,
  queryIndex,
  getIndex,
} from '../../electron/index/fsIndex.mjs';
import { resolveIndexdBin } from '../../electron/index/indexdClient.mjs';
import { saveIndexPrefs, resetIndexPrefsCache } from '../../electron/index/indexPrefs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

const GATE = {
  node_rss_mb: 90, // aggressive post-T1 GC + small walk chunks
  indexd_rss_mb: 90, // path_slots OA (~4B/slot) + dense FRN
  hot_ms: 40,
};

function parseArgs(argv) {
  const out = {
    volume: process.env.AURORA_PERF_INDEXD_VOLUME || 'E:\\',
    query: 'png',
    maxScan: Number(process.env.AURORA_PERF_VOLUME_MAX_SCAN) || 5_000_000,
    maxDepth: 64,
    deadlineMs: 300_000,
    smoke: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--volume' || a === '--root') out.volume = argv[++i];
    else if (a === '--query') out.query = argv[++i];
    else if (a === '--max-scan') out.maxScan = Number(argv[++i]) || out.maxScan;
    else if (a === '--max-depth') out.maxDepth = Number(argv[++i]) || out.maxDepth;
    else if (a === '--deadline-ms') out.deadlineMs = Number(argv[++i]) || out.deadlineMs;
    else if (a === '--smoke') out.smoke = true;
  }
  return out;
}

function normalizeVolumeRoot(raw) {
  const s = String(raw || '').trim();
  const m = /^([A-Za-z]):?\\?$/.exec(s) || /^([A-Za-z]):[\\/]?$/.exec(s);
  if (m) return `${m[1].toUpperCase()}:\\`;
  return path.win32.normalize(path.win32.resolve(s));
}

async function main() {
  const bin = resolveIndexdBin();
  if (!bin) {
    console.error('[indexd] aurora-indexd binary missing — build native/indexd first');
    process.exit(2);
  }

  const opts = parseArgs(process.argv);
  let root = normalizeVolumeRoot(opts.volume);
  if (opts.smoke || !fssync.existsSync(root)) {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-indexd-smoke-'));
    for (let i = 0; i < 200; i++) {
      await fs.mkdir(path.join(root, `d${i}`), { recursive: true });
      await fs.writeFile(path.join(root, `d${i}`, `f${i}.png`), 'x');
    }
    opts.maxScan = 5_000;
    opts.maxDepth = 4;
    console.log(`[indexd] smoke tree ${root}`);
  }

  process.env.AURORA_INDEX_BACKEND = 'native';

  const runId = `indexd-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const outDir = path.join(REPO, 'perf-out', runId);
  await fs.mkdir(outDir, { recursive: true });
  const idxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-indexd-idx-'));
  configureIndexDir(idxDir);
  resetIndexPrefsCache();
  await saveIndexPrefs({ maxScan: opts.maxScan, excludeNames: [] });

  disposeVolumeIndex(root);
  const phases = [];
  const t0 = performance.now();
  let t1Ms = null;
  console.log(`[indexd] build root=${root} bin=${bin}`);
  await ensureIndexed(root, {
    rebuild: true,
    leanMemory: true,
    persist: true,
    waitDebt: true,
    liveFollowers: false,
    hydrateFirst: false,
    maxScan: opts.maxScan,
    maxDepth: opts.maxDepth,
    deadlineMs: opts.deadlineMs,
    maxPerf: true,
    indexBackend: 'native',
    followReparse: !opts.smoke && /^[A-Za-z]:\\$/.test(root),
    skipMode: opts.smoke ? 'none' : 'minimal',
    onPhase: (phase, snap) => {
      const at = Math.round(performance.now() - t0);
      phases.push({ phase, at, ...snap });
      console.log(`  phase ${phase} @${at}ms size=${snap.size} node_rss=${snap.rss_mb} backend=${snap.backend}`);
      if (phase === 'T1_walk_searchable') t1Ms = at;
    },
  });
  // Persist/space async — gate searchable path on FTS only
  await waitIndexDebt(root, { timeoutMs: 60_000, kinds: ['fts'] });
  const searchableMs = Math.round(performance.now() - t0);
  // Drain persist for disk artifact (timed separately)
  const tPersist0 = performance.now();
  await waitIndexDebt(root, { timeoutMs: 180_000, kinds: ['persist'] });
  const persistMs = Math.round(performance.now() - tPersist0);
  // Space normalize (path index / shrink) — must not affect T1
  const tSpace0 = performance.now();
  await waitIndexDebt(root, { timeoutMs: 180_000, kinds: ['space'] });
  const spaceMs = Math.round(performance.now() - tSpace0);
  // Let V8 settle after million-entry upsert stream (objects are short-lived)
  try { getIndex(root)?._indexd?.releaseWalkBuffers?.(); } catch { /* */ }
  let nodeRssSettled = Infinity;
  let indexdRssSettled = null;
  let st = null;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setImmediate(r));
    if (typeof global.gc === 'function') global.gc();
    if (i % 3 === 2) {
      await new Promise((r) => setTimeout(r, 30));
      st = await refreshIndexStatus(root);
      const n = st.node_rss_mb ?? rssMb();
      if (n < nodeRssSettled) nodeRssSettled = n;
      if (st.indexd_rss_mb != null) {
        indexdRssSettled = indexdRssSettled == null
          ? st.indexd_rss_mb
          : Math.min(indexdRssSettled, st.indexd_rss_mb);
      }
    }
  }
  if (!st) st = await refreshIndexStatus(root);
  const totalMs = Math.round(performance.now() - t0);

  const hotSamples = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    const q = await queryIndex(root, opts.query, { maxResults: 50 });
    hotSamples.push({
      ms: Math.round((performance.now() - t) * 10) / 10,
      hits: q.items?.length || 0,
      source: q.source,
    });
  }
  const coldMs = hotSamples[0]?.ms ?? null;
  const hotMs = Math.min(...hotSamples.map((s) => s.ms));

  const nodeRss = Number.isFinite(nodeRssSettled) ? nodeRssSettled : (st.node_rss_mb ?? rssMb());
  const indexdRss = indexdRssSettled ?? st.indexd_rss_mb ?? null;
  const warns = [];
  if (!opts.smoke) {
    if (nodeRss > GATE.node_rss_mb) warns.push(`node_rss ${nodeRss}>${GATE.node_rss_mb}`);
    if (indexdRss != null && indexdRss > GATE.indexd_rss_mb) {
      warns.push(`indexd_rss ${indexdRss}>${GATE.indexd_rss_mb}`);
    }
    // Gate on hot (cached) and cold first sample
    if (hotMs > GATE.hot_ms) warns.push(`hot ${hotMs}>${GATE.hot_ms}`);
    if (coldMs != null && coldMs > 120) warns.push(`cold ${coldMs}>120`);
  }
  if ((hotSamples[0]?.hits || 0) < 1) warns.push('query_no_hits');
  if (st.backend !== 'native') warns.push('backend_not_native');
  if ((st.metaSize || 0) > 1000 && !opts.smoke) warns.push(`meta_filled ${st.metaSize}`);
  if (!opts.smoke && st.path_index_ready === false) warns.push('path_index_not_ready');
  if (!opts.smoke && spaceMs > 30_000) warns.push(`space_slow ${spaceMs}>30000`);

  const summary = {
    runId,
    root,
    smoke: !!opts.smoke,
    backend: st.backend,
    size: st.size,
    metaSize: st.metaSize,
    source: st.source,
    walk_engine: process.env.AURORA_WALK_ENGINE || st.walkEngine || null,
    t1_ms: t1Ms,
    searchable_ms: searchableMs,
    persist_ms: persistMs,
    space_cleared_ms: spaceMs,
    total_ms: totalMs,
    node_rss_mb: nodeRss,
    indexd_rss_mb: indexdRss,
    indexd_mem: st.indexd_mem ?? null,
    approx_bytes: st.approx_bytes ?? null,
    path_index_ready: st.path_index_ready ?? null,
    cold_ms: coldMs,
    hot_ms: hotMs,
    hotSamples,
    phases,
    gate: GATE,
    warn: warns,
    ok: warns.length === 0,
  };

  await fs.writeFile(path.join(outDir, 'summary.indexd.json'), JSON.stringify(summary, null, 2));
  await fs.writeFile(
    path.join(REPO, 'perf-out', 'latest-indexd.json'),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify({
    ok: summary.ok,
    size: summary.size,
    metaSize: summary.metaSize,
    walk_engine: summary.walk_engine,
    node_rss_mb: nodeRss,
    indexd_rss_mb: indexdRss,
    indexd_mem: summary.indexd_mem,
    approx_bytes: summary.approx_bytes,
    path_index_ready: summary.path_index_ready,
    cold_ms: coldMs,
    hot_ms: hotMs,
    t1_ms: t1Ms,
    searchable_ms: searchableMs,
    persist_ms: persistMs,
    space_cleared_ms: spaceMs,
    total_ms: totalMs,
    warn: warns,
    out: outDir,
  }, null, 2));

  disposeVolumeIndex(root);
  process.exit(summary.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
