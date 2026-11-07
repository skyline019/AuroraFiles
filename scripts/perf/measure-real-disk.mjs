#!/usr/bin/env node
/**
 * Real-disk backend stress (read-only). Safe defaults — never whole USERPROFILE unless --allow-home.
 *
 *   npm run test:perf-real
 *   node scripts/perf/measure-real-disk.mjs --root E:\Agent --root %USERPROFILE%\Downloads
 *   node scripts/perf/measure-real-disk.mjs --allow-home --deadline-ms 90000
 */
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { rssMb } from './seed-tree.mjs';
import {
  configureIndexDir,
  ensureIndexed,
  disposeVolumeIndex,
  indexStatus,
} from '../../electron/index/fsIndex.mjs';
import { searchFiles, cancelSearch } from '../../electron/index/searchFiles.mjs';
import { saveIndexPrefs, resetIndexPrefsCache } from '../../electron/index/indexPrefs.mjs';

function parseArgs(argv) {
  const out = {
    roots: [],
    query: 'png',
    maxScan: Number(process.env.AURORA_PERF_MAX_SCAN) || 40_000,
    maxDepth: 8,
    deadlineMs: Number(process.env.AURORA_PERF_DEADLINE_MS) || 90_000,
    allowHome: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') out.roots.push(argv[++i]);
    else if (a === '--query') out.query = argv[++i];
    else if (a === '--max-scan') out.maxScan = Number(argv[++i]) || out.maxScan;
    else if (a === '--max-depth') out.maxDepth = Number(argv[++i]) || out.maxDepth;
    else if (a === '--deadline-ms') out.deadlineMs = Number(argv[++i]) || out.deadlineMs;
    else if (a === '--allow-home') out.allowHome = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function defaultRoots(allowHome) {
  const home = os.homedir();
  const list = [
    path.join(home, 'Downloads'),
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
    'E:\\Agent',
  ];
  if (allowHome) list.unshift(home);
  return list.filter((p) => fssync.existsSync(p));
}

function isHomeRoot(root) {
  try {
    return path.win32.resolve(root).toLowerCase() === path.win32.resolve(os.homedir()).toLowerCase();
  } catch {
    return false;
  }
}

async function runRoot(rootPath, opts, runDir) {
  const root = path.win32.normalize(path.resolve(rootPath));
  if (!fssync.existsSync(root)) return { root, error: 'not_found' };
  if (isHomeRoot(root) && !opts.allowHome) {
    return {
      root,
      error: 'home_blocked',
      hint: 'Refuse whole USERPROFILE without --allow-home (AppData junctions). Use Downloads/Desktop or pass --allow-home.',
    };
  }

  const id = root.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48) || 'root';
  const idxDir = await fs.mkdtemp(path.join(os.tmpdir(), `aurora-real-idx-${id}-`));
  configureIndexDir(idxDir);
  resetIndexPrefsCache();
  await saveIndexPrefs({
    maxScan: opts.maxScan,
    excludeNames: ['AppData', 'OneDriveTemp', '.cache', 'node_modules', '.git'],
  });

  const query = opts.query || 'png';
  const idleRss = rssMb();
  disposeVolumeIndex(root);
  cancelSearch();

  process.stdout.write(`[real ${root}] cold walk q="${query}"… `);
  const tCold0 = performance.now();
  const cold = await searchFiles(root, query, {
    maxResults: 200,
    maxDepth: Math.min(opts.maxDepth, 5),
    maxScan: Math.min(opts.maxScan, 20_000),
    forceWalk: true,
  });
  const searchColdMs = Math.round(performance.now() - tCold0);
  console.log(`${searchColdMs}ms hits=${cold.items?.length ?? 0} src=${cold.source}`);

  disposeVolumeIndex(root);
  let lastLog = 0;
  process.stdout.write(`[real ${root}] indexing… `);
  const tIdx0 = performance.now();
  await ensureIndexed(root, {
    maxDepth: opts.maxDepth,
    maxScan: opts.maxScan,
    rebuild: true,
    deadlineMs: opts.deadlineMs,
    liveFollowers: false,
    onProgress: ({ scanned, size }) => {
      const now = Date.now();
      if (now - lastLog < 2000) return;
      lastLog = now;
      process.stdout.write(`\n  … scanned=${scanned} indexed=${size} elapsed=${Math.round(performance.now() - tIdx0)}ms`);
    },
  });
  const indexMs = Math.round(performance.now() - tIdx0);
  const st = indexStatus(root);
  console.log(`\n  done ${indexMs}ms size=${st.size} scanned=${st.scanned} src=${st.source}`);

  const tHot0 = performance.now();
  const hot = await searchFiles(root, query, {
    maxResults: 400,
    maxDepth: opts.maxDepth,
    maxScan: opts.maxScan,
  });
  const searchHotMs = Math.round(performance.now() - tHot0);

  const tHot2 = performance.now();
  const hot2 = await searchFiles(root, query, { maxResults: 400 });
  const searchHot2Ms = Math.round(performance.now() - tHot2);

  const q2 = query === 'png' ? 'txt' : 'png';
  const tAlt0 = performance.now();
  const alt = await searchFiles(root, q2, { maxResults: 200 });
  const searchAltMs = Math.round(performance.now() - tAlt0);

  const afterRss = rssMb();
  const result = {
    kind: 'aurora-perf-real-disk',
    root,
    query,
    query_alt: q2,
    opts: {
      maxScan: opts.maxScan,
      maxDepth: opts.maxDepth,
      deadlineMs: opts.deadlineMs,
    },
    index: {
      size: st.size,
      scanned: st.scanned,
      source: st.source,
      segmentKeys: st.segmentKeys,
      fts: st.fts,
    },
    metrics: {
      search_cold_ms: searchColdMs,
      index_ms: indexMs,
      search_hot_ms: searchHotMs,
      search_hot2_ms: searchHot2Ms,
      search_alt_ms: searchAltMs,
      cold_hits: cold.items?.length ?? 0,
      hot_hits: hot.items?.length ?? 0,
      hot2_hits: hot2.items?.length ?? 0,
      alt_hits: alt.items?.length ?? 0,
      cold_source: cold.source,
      hot_source: hot.source,
      alt_source: alt.source,
      rss_mb: { idle: idleRss, after: afterRss },
      speedup_cold_to_hot:
        searchColdMs > 0 ? Math.round((searchColdMs / Math.max(1, searchHotMs)) * 10) / 10 : null,
    },
    warn: [],
  };

  if (String(st.source || '').includes('timeout')) result.warn.push('index_deadline');
  if (searchHotMs > 250 && searchHotMs > searchColdMs) result.warn.push('hot_slower_than_cold');
  if (afterRss > 500) result.warn.push('rss_gt_500mb');
  if (st.size === 0) result.warn.push('index_empty');
  if ((hot.items?.length || 0) !== (hot2.items?.length || 0)) result.warn.push('hot_unstable');

  disposeVolumeIndex(root);
  try {
    await fs.rm(idxDir, { recursive: true, force: true });
  } catch { /* */ }

  const outFile = path.join(runDir, `real-${id}.json`);
  await fs.writeFile(outFile, JSON.stringify(result, null, 2), 'utf8');
  console.log(
    `[real ${root}] cold=${searchColdMs}ms hot=${searchHotMs}ms idx=${indexMs}ms rss=${afterRss}MB speedup=${result.metrics.speedup_cold_to_hot}x warn=${result.warn.join(',') || 'none'}`,
  );
  return result;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage: node scripts/perf/measure-real-disk.mjs [--root PATH]... [--query TOKEN]
  [--max-scan N] [--max-depth N] [--deadline-ms N] [--allow-home]`);
    process.exit(0);
  }

  const roots = args.roots.length ? args.roots : defaultRoots(args.allowHome);
  const outRoot = process.env.AURORA_PERF_OUT || path.join(process.cwd(), 'perf-out');
  const runId = `real-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const runDir = path.join(outRoot, runId);
  await fs.mkdir(runDir, { recursive: true });

  console.log(`real-disk perf → ${runDir}`);
  console.log(`roots: ${roots.join(' | ')}`);
  console.log(`deadline=${args.deadlineMs}ms maxScan=${args.maxScan} depth=${args.maxDepth}`);

  const results = [];
  for (const r of roots) {
    results.push(await runRoot(r, args, runDir));
  }

  const summary = {
    kind: 'aurora-perf-real-disk-summary',
    runId,
    at: new Date().toISOString(),
    platform: `${os.platform()} ${os.arch()}`,
    node: process.version,
    roots: results,
    warns: results.flatMap((r) => (r.warn || []).map((w) => `${r.root}:${w}`)),
  };
  await fs.writeFile(path.join(runDir, 'summary.real-disk.json'), JSON.stringify(summary, null, 2), 'utf8');
  await fs.writeFile(
    path.join(outRoot, 'latest-real-disk.json'),
    JSON.stringify({ runId, dir: runDir }, null, 2),
    'utf8',
  );
  console.log(`wrote ${path.join(runDir, 'summary.real-disk.json')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
