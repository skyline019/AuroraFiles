#!/usr/bin/env node
/**
 * Backend perf matrix: seed → cold search → ensureIndexed → hot search + RSS samples.
 *
 *   node scripts/perf/measure-backend.mjs
 *   AURORA_PERF_PROFILES=S-mem,S-search node scripts/perf/measure-backend.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { selectedProfiles } from './profiles.mjs';
import { seedTree, rssMb } from './seed-tree.mjs';
import {
  configureIndexDir,
  ensureIndexed,
  disposeVolumeIndex,
} from '../../electron/index/fsIndex.mjs';
import { searchFiles, cancelSearch } from '../../electron/index/searchFiles.mjs';
import { saveIndexPrefs, resetIndexPrefsCache } from '../../electron/index/indexPrefs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootOut = process.env.AURORA_PERF_OUT || path.join(process.cwd(), 'perf-out');

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function runProfile(profile, runDir) {
  const idxDir = await fs.mkdtemp(path.join(os.tmpdir(), `aurora-perf-idx-${profile.id}-`));
  const tree = await fs.mkdtemp(path.join(os.tmpdir(), `aurora-perf-tree-${profile.id}-`));
  configureIndexDir(idxDir);
  resetIndexPrefsCache();
  await saveIndexPrefs({ maxScan: profile.maxScan, excludeNames: ['node_modules', '.git'] });

  const idleRss = rssMb();
  const tSeed0 = Date.now();
  const seeded = await seedTree(tree, profile.files, profile.depth, {
    namePrefix: profile.id === 'S-preview' ? 'IMG' : 'file',
    needleEvery: profile.id === 'S-search' ? 11 : 17,
  });
  const seedMs = Date.now() - tSeed0;

  disposeVolumeIndex(tree);
  cancelSearch();

  // True cold: walk only (no index side-effects)
  process.stdout.write(`[${profile.id}] cold walk… `);
  const tCold0 = performance.now();
  const cold = await searchFiles(tree, profile.query, {
    maxResults: 200,
    maxDepth: Math.min(profile.depth + 1, 5),
    maxScan: Math.min(profile.maxScan, 20_000),
    forceWalk: true,
  });
  const searchColdMs = Math.round(performance.now() - tCold0);
  console.log(`${searchColdMs}ms hits=${cold.items?.length ?? 0}`);
  const afterColdRss = rssMb();

  disposeVolumeIndex(tree);
  process.stdout.write(`[${profile.id}] indexing… `);
  const tIdx0 = performance.now();
  await ensureIndexed(tree, { maxDepth: profile.depth + 2, maxScan: profile.maxScan, rebuild: true });
  const indexMs = Math.round(performance.now() - tIdx0);
  console.log(`${indexMs}ms`);
  const afterIndexRss = rssMb();

  const tHot0 = performance.now();
  const hot = await searchFiles(tree, profile.query, {
    maxResults: 400,
    maxDepth: 8,
    maxScan: profile.maxScan,
  });
  const searchHotMs = Math.round(performance.now() - tHot0);
  const afterHotRss = rssMb();

  const tHot2 = performance.now();
  const hot2 = await searchFiles(tree, profile.query, { maxResults: 400 });
  const searchHot2Ms = Math.round(performance.now() - tHot2);

  const result = {
    profile: profile.id,
    label: profile.label,
    fixture: { files: profile.files, depth: profile.depth, maxScan: profile.maxScan, seeded },
    query: profile.query,
    metrics: {
      seed_ms: seedMs,
      search_cold_ms: searchColdMs,
      index_ms: indexMs,
      search_hot_ms: searchHotMs,
      search_hot2_ms: searchHot2Ms,
      cold_hits: cold.items?.length ?? 0,
      hot_hits: hot.items?.length ?? 0,
      hot2_hits: hot2.items?.length ?? 0,
      cold_source: cold.source,
      hot_source: hot.source,
      rss_mb: {
        idle: idleRss,
        after_cold: afterColdRss,
        after_index: afterIndexRss,
        after_hot: afterHotRss,
      },
    },
    warn: [],
  };

  if (searchHotMs > searchColdMs && (hot.source || '').startsWith('index')) {
    /* hot may still be slower on tiny trees; only warn if dramatically worse */
    if (searchHotMs > searchColdMs * 2 && searchHotMs > 200) {
      result.warn.push('hot_search_slower_than_cold');
    }
  }
  if (afterIndexRss > 500) result.warn.push('rss_after_index_gt_500mb');
  if (Math.abs((hot.items?.length || 0) - (hot2.items?.length || 0)) > 0) {
    result.warn.push('hot_hit_count_unstable');
  }

  disposeVolumeIndex(tree);
  try {
    await fs.rm(tree, { recursive: true, force: true });
    await fs.rm(idxDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }

  const outFile = path.join(runDir, `${profile.id}.backend.json`);
  await fs.writeFile(outFile, JSON.stringify(result, null, 2), 'utf8');
  console.log(
    `[${profile.id}] cold=${searchColdMs}ms hot=${searchHotMs}ms idx=${indexMs}ms rss_idx=${afterIndexRss}MB hits=${hot.items?.length ?? 0} warn=${result.warn.join(',') || 'none'}`,
  );
  return result;
}

async function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(rootOut, runId);
  await ensureDir(runDir);
  await ensureDir(path.join(runDir, 'screenshots'));

  const profiles = selectedProfiles();
  console.log(`perf backend → ${runDir}`);
  console.log(`profiles: ${profiles.map((p) => p.id).join(', ')}`);

  const results = [];
  for (const p of profiles) {
    results.push(await runProfile(p, runDir));
  }

  const summary = {
    kind: 'aurora-perf-backend',
    runId,
    at: new Date().toISOString(),
    cwd: process.cwd(),
    platform: `${os.platform()} ${os.arch()}`,
    node: process.version,
    profiles: results,
    warns: results.flatMap((r) => r.warn.map((w) => `${r.profile}:${w}`)),
  };
  await fs.writeFile(path.join(runDir, 'summary.backend.json'), JSON.stringify(summary, null, 2), 'utf8');
  await fs.writeFile(path.join(rootOut, 'latest-backend.json'), JSON.stringify({ runId, dir: runDir }, null, 2), 'utf8');
  console.log(`wrote ${path.join(runDir, 'summary.backend.json')}`);
  if (summary.warns.length) {
    console.warn('WARN:', summary.warns.join('; '));
    process.exitCode = 0; // v1: warn only
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
