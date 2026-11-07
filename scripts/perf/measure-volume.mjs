#!/usr/bin/env node
/**
 * High-pressure whole-volume index (include hidden / recycle; minimal skip).
 *
 *   npm run test:perf-volume
 *   node scripts/perf/measure-volume.mjs --volume E:\
 *   node scripts/perf/measure-volume.mjs --volume C:\ --volume D:\ --deadline-ms 600000
 *
 * Defaults: skipMode=minimal, followReparse=true, maxDepth=64, maxScan=5e6, deadline=5min.
 * Only skips "System Volume Information". Uses realpath de-dup when following reparse points.
 */
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rssMb } from './seed-tree.mjs';
import {
  configureIndexDir,
  ensureIndexed,
  disposeVolumeIndex,
  indexStatus,
  waitIndexDebt,
} from '../../electron/index/fsIndex.mjs';
import { searchFiles, cancelSearch } from '../../electron/index/searchFiles.mjs';
import { saveIndexPrefs, resetIndexPrefsCache, MINIMAL_SKIP } from '../../electron/index/indexPrefs.mjs';

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const out = {
    volumes: [],
    query: 'png',
    maxScan: Number(process.env.AURORA_PERF_VOLUME_MAX_SCAN) || 5_000_000,
    maxDepth: Number(process.env.AURORA_PERF_VOLUME_MAX_DEPTH) || 64,
    deadlineMs: Number(process.env.AURORA_PERF_VOLUME_DEADLINE_MS) || 300_000,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--volume' || a === '--root') out.volumes.push(argv[++i]);
    else if (a === '--query') out.query = argv[++i];
    else if (a === '--max-scan') out.maxScan = Number(argv[++i]) || out.maxScan;
    else if (a === '--max-depth') out.maxDepth = Number(argv[++i]) || out.maxDepth;
    else if (a === '--deadline-ms') out.deadlineMs = Number(argv[++i]) || out.deadlineMs;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function normalizeVolumeRoot(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  // Accept "E", "E:", "E:\", "E:/"
  const m = /^([A-Za-z]):?\\?$/.exec(s) || /^([A-Za-z]):[\\/]?$/.exec(s);
  if (m) return `${m[1].toUpperCase()}:\\`;
  const n = path.win32.normalize(path.win32.resolve(s));
  // Prefer drive root when path is already a drive root
  if (/^[A-Za-z]:\\?$/.test(n.replace(/\//g, '\\'))) {
    return `${n[0].toUpperCase()}:\\`;
  }
  return n;
}

async function listFixedDrives() {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "Get-Volume | Where-Object { $_.DriveLetter -and $_.FileSystem -and $_.DriveType -eq 'Fixed' } | ForEach-Object { \"$($_.DriveLetter)|$([int]$_.Size)|$([int]$_.SizeRemaining)\" }",
      ],
      { windowsHide: true, timeout: 15_000 },
    );
    return String(stdout)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [letter, size, free] = line.split('|');
        return {
          root: `${String(letter).toUpperCase()}:\\`,
          sizeBytes: Number(size) || 0,
          freeBytes: Number(free) || 0,
        };
      })
      .filter((d) => fssync.existsSync(d.root));
  } catch {
    return ['C:\\', 'D:\\', 'E:\\']
      .filter((r) => fssync.existsSync(r))
      .map((root) => ({ root, sizeBytes: 0, freeBytes: 0 }));
  }
}

function defaultVolumes(drives) {
  // Prefer data volume E: then others with free space; skip empty letters
  const order = ['E:\\', 'D:\\', 'C:\\'];
  const byRoot = new Map(drives.map((d) => [d.root, d]));
  const picked = [];
  for (const r of order) {
    if (byRoot.has(r)) picked.push(r);
  }
  for (const d of drives) {
    if (!picked.includes(d.root)) picked.push(d.root);
  }
  return picked.slice(0, 1); // default: one volume (prefer E:) for harness length
}

async function runVolume(volumeRoot, opts, runDir, driveMeta) {
  const root = normalizeVolumeRoot(volumeRoot);
  if (!root || !fssync.existsSync(root)) {
    return { root: volumeRoot, error: 'not_found' };
  }

  const id = root.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 16) || 'vol';
  const idxDir = await fs.mkdtemp(path.join(os.tmpdir(), `aurora-vol-idx-${id}-`));
  configureIndexDir(idxDir);
  resetIndexPrefsCache();
  // High pressure: no extra excludes; only MINIMAL_SKIP via skipMode
  await saveIndexPrefs({
    maxScan: opts.maxScan,
    excludeNames: [],
  });

  const query = opts.query || 'png';
  const idleRss = rssMb();
  disposeVolumeIndex(root);
  cancelSearch();

  const progressLog = [];
  const phases = [];
  let lastLog = 0;
  const heapMb = () => Math.round((process.memoryUsage().heapUsed / (1024 * 1024)) * 10) / 10;
  phases.push({
    phase: 'T0_idle',
    at: 0,
    rss_mb: idleRss,
    heap_mb: heapMb(),
    size: 0,
    debt: null,
  });
  process.stdout.write(
    `[volume ${root}] HIGH-PRESSURE lean+debt skip=minimal followReparse include-hidden maxScan=${opts.maxScan} depth=${opts.maxDepth} deadline=${opts.deadlineMs}ms…\n`,
  );
  const tIdx0 = performance.now();
  await ensureIndexed(root, {
    maxDepth: opts.maxDepth,
    maxScan: opts.maxScan,
    rebuild: true,
    deadlineMs: opts.deadlineMs,
    liveFollowers: false,
    skipMode: 'minimal',
    followReparse: true,
    leanMemory: true,
    persist: false,
    waitDebt: true,
    track: 'perf',
    maxPerf: true,
    debtOps: 10_000,
    dripFtsDuringWalk: true,
    dripBelowRate: 55_000,
    dripOps: 3_000,
    yieldEvery: 8192,
    onPhase: (phase, snap) => {
      const at = Math.round(performance.now() - tIdx0);
      const last = phases[phases.length - 1];
      // T2 切片只抽样写入，避免日志爆炸
      if (phase === 'T2_debt_slice' && last?.phase === 'T2_debt_slice' && at - (last.at || 0) < 2000) {
        return;
      }
      phases.push({ phase, at, ...snap });
      process.stdout.write(
        `  [${phase}] at=${at}ms rss=${snap.rss_mb}MB heap=${snap.heap_mb}MB size=${snap.size} debt=${snap.debt?.depth ?? '?'}\n`,
      );
    },
    onProgress: ({ scanned, size, debt, t1_drip_paid: drip }) => {
      const now = Date.now();
      if (now - lastLog < 3000) return;
      lastLog = now;
      const elapsed = Math.round(performance.now() - tIdx0);
      const line = {
        at: elapsed,
        scanned,
        size,
        debt_depth: debt?.depth ?? null,
        t1_drip_paid: drip ?? 0,
        fts_paid: debt?.kinds?.fts?.paid ?? 0,
      };
      progressLog.push(line);
      process.stdout.write(
        `  … scanned=${scanned} indexed=${size} elapsed=${elapsed}ms rss=${rssMb()}MB drip=${drip ?? 0} debt=${debt?.depth ?? 0}\n`,
      );
    },
  });
  // 确保债清（waitDebt 已同步；再兜底）
  const debtFinal = await waitIndexDebt(root, { timeoutMs: Math.min(opts.deadlineMs, 180_000) });
  phases.push({
    phase: 'T5_after_gc_hint',
    at: Math.round(performance.now() - tIdx0),
    rss_mb: rssMb(),
    heap_mb: heapMb(),
    size: indexStatus(root).size,
    debt: debtFinal,
  });
  const indexMs = Math.round(performance.now() - tIdx0);
  const st = indexStatus(root);
  console.log(
    `  index done ${indexMs}ms size=${st.size} scanned=${st.scanned} src=${st.source} lean=${st.lean} rss=${rssMb()}MB debt=${st.debt?.depth}`,
  );

  process.stdout.write(`[volume ${root}] hot search q="${query}"… `);
  const tHot0 = performance.now();
  const hot = await searchFiles(root, query, {
    maxResults: 400,
    skipMode: 'minimal',
    followReparse: true,
  });
  const searchHotMs = Math.round(performance.now() - tHot0);
  console.log(`${searchHotMs}ms hits=${hot.items?.length ?? 0} src=${hot.source}`);

  const tHot2 = performance.now();
  const hot2 = await searchFiles(root, query, { maxResults: 400, skipMode: 'minimal' });
  const searchHot2Ms = Math.round(performance.now() - tHot2);

  const q2 = query === 'png' ? 'txt' : 'png';
  const tAlt0 = performance.now();
  const alt = await searchFiles(root, q2, { maxResults: 200, skipMode: 'minimal' });
  const searchAltMs = Math.round(performance.now() - tAlt0);

  // Shallow cold sample only (full-volume forceWalk is not the product path after index)
  process.stdout.write(`[volume ${root}] cold walk sample q="${query}"… `);
  const tCold0 = performance.now();
  const cold = await searchFiles(root, query, {
    maxResults: 20,
    maxDepth: 1,
    maxScan: 400,
    forceWalk: true,
    skipMode: 'minimal',
  });
  const searchColdMs = Math.round(performance.now() - tCold0);
  console.log(`${searchColdMs}ms hits=${cold.items?.length ?? 0} src=${cold.source}`);

  const afterRss = rssMb();
  const result = {
    kind: 'aurora-perf-volume-high-pressure',
    root,
    drive: driveMeta || null,
    query,
    query_alt: q2,
    pressure: {
      skipMode: 'minimal',
      minimalSkip: [...MINIMAL_SKIP],
      followReparse: true,
      includeHidden: true,
      note: 'readdir includes hidden; only System Volume Information skipped; reparse followed with realpath de-dup',
    },
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
      frnSize: st.frnSize,
      lean: st.lean,
      debt: st.debt,
    },
    phases,
    progress: progressLog,
    metrics: {
      index_ms: indexMs,
      searchable_ms: phases.find((p) => p.phase === 'T1_walk_searchable')?.at ?? null,
      debt_cleared_ms: phases.find((p) => p.phase === 'T3_debt_cleared')?.at ?? null,
      t1_drip_paid: phases.find((p) => p.phase === 'T1_walk_searchable')?.t1_drip_paid ?? 0,
      search_hot_ms: searchHotMs,
      search_hot2_ms: searchHot2Ms,
      search_alt_ms: searchAltMs,
      search_cold_sample_ms: searchColdMs,
      hot_hits: hot.items?.length ?? 0,
      hot2_hits: hot2.items?.length ?? 0,
      alt_hits: alt.items?.length ?? 0,
      cold_hits: cold.items?.length ?? 0,
      hot_source: hot.source,
      alt_source: alt.source,
      cold_source: cold.source,
      rss_mb: {
        idle: idleRss,
        after: afterRss,
        peak_phase: phases.reduce(
          (m, p) => (p.rss_mb > (m?.rss_mb || 0) ? p : m),
          null,
        ),
      },
      indexed_per_sec:
        indexMs > 0 ? Math.round((st.size / (indexMs / 1000)) * 10) / 10 : null,
      scanned_per_sec:
        indexMs > 0 ? Math.round((st.scanned / (indexMs / 1000)) * 10) / 10 : null,
      algo: 'lean-debt-offpeak-dirent',
    },
    warn: [],
  };

  if (String(st.source || '').includes('timeout')) result.warn.push('index_deadline');
  if (st.scanned >= opts.maxScan) result.warn.push('max_scan_hit');
  if (afterRss > 1500) result.warn.push('rss_gt_1500mb');
  if (st.size === 0) result.warn.push('index_empty');
  if ((hot.items?.length || 0) !== (hot2.items?.length || 0)) result.warn.push('hot_unstable');
  if (searchHotMs > 500) result.warn.push('hot_gt_500ms');
  if (st.debt?.kinds?.fts?.owed) result.warn.push('fts_debt_remaining');
  else if ((st.debt?.depth || 0) > 0) result.warn.push('frn_debt_background'); // expected off-peak

  disposeVolumeIndex(root);
  try {
    await fs.rm(idxDir, { recursive: true, force: true });
  } catch { /* */ }

  const outFile = path.join(runDir, `volume-${id}.json`);
  await fs.writeFile(outFile, JSON.stringify(result, null, 2), 'utf8');
  console.log(
    `[volume ${root}] idx=${indexMs}ms size=${st.size} scanned=${st.scanned} hot=${searchHotMs}ms rss=${afterRss}MB warn=${result.warn.join(',') || 'none'}`,
  );
  return result;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage: node scripts/perf/measure-volume.mjs [--volume E:\\]... [--query TOKEN]
  [--max-scan N] [--max-depth N] [--deadline-ms N]

High-pressure whole volume: include hidden + $Recycle.Bin, skipMode=minimal,
follow reparse with realpath de-dup. Default volume: E:\\ if present.`);
    process.exit(0);
  }

  const drives = await listFixedDrives();
  const volumes = args.volumes.length
    ? args.volumes.map(normalizeVolumeRoot).filter(Boolean)
    : defaultVolumes(drives);

  const outRoot = process.env.AURORA_PERF_OUT || path.join(process.cwd(), 'perf-out');
  const runId = `volume-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const runDir = path.join(outRoot, runId);
  await fs.mkdir(runDir, { recursive: true });

  console.log(`volume HIGH-PRESSURE perf → ${runDir}`);
  console.log(`volumes: ${volumes.join(' | ')}`);
  console.log(
    `deadline=${args.deadlineMs}ms maxScan=${args.maxScan} depth=${args.maxDepth} skip=${MINIMAL_SKIP.join(',')}`,
  );
  console.log(`fixed drives seen: ${drives.map((d) => d.root).join(' ') || '(none)'}`);

  const driveByRoot = new Map(drives.map((d) => [d.root, d]));
  const results = [];
  for (const v of volumes) {
    results.push(await runVolume(v, args, runDir, driveByRoot.get(v) || null));
  }

  const summary = {
    kind: 'aurora-perf-volume-high-pressure-summary',
    runId,
    at: new Date().toISOString(),
    platform: `${os.platform()} ${os.arch()}`,
    node: process.version,
    pressure: {
      skipMode: 'minimal',
      followReparse: true,
      includeHidden: true,
    },
    volumes: results,
    warns: results.flatMap((r) => (r.warn || []).map((w) => `${r.root}:${w}`)),
  };
  await fs.writeFile(path.join(runDir, 'summary.volume.json'), JSON.stringify(summary, null, 2), 'utf8');
  await fs.writeFile(
    path.join(outRoot, 'latest-volume.json'),
    JSON.stringify({ runId, dir: runDir }, null, 2),
    'utf8',
  );
  console.log(`wrote ${path.join(runDir, 'summary.volume.json')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
