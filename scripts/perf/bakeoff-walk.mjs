/**
 * JS walk bakeoff: count | store modes (parity with native/walk-bench).
 */
import path from 'node:path';
import { parallelDirentWalk } from '../../electron/index/fastWalk.mjs';
import { MINIMAL_SKIP } from '../../electron/index/indexPrefs.mjs';
import { rssMb } from './seed-tree.mjs';

const SKIP = new Set(
  [...(MINIMAL_SKIP || [])].map((s) => String(s).toLowerCase()),
);
function skipDir(name) {
  return SKIP.has(String(name).toLowerCase());
}

/**
 * @param {string} root
 * @param {{ mode?: 'count'|'store', maxDepth?: number, maxScan?: number, followReparse?: boolean }} opts
 */
export async function bakeoffJsWalk(root, opts = {}) {
  const mode = opts.mode || 'count';
  const maxDepth = opts.maxDepth ?? 64;
  const maxScan = opts.maxScan ?? 5_000_000;
  const followReparse = opts.followReparse !== false;
  const paths = mode === 'store' ? [] : null;
  let pathBytes = 0;
  const t0 = performance.now();
  const idleRss = rssMb();

  const stats = await parallelDirentWalk(root, {
    maxDepth,
    maxScan,
    followReparse,
    maxPerf: true,
    skipDir,
    onEntry: (entry) => {
      if (paths) {
        paths.push(entry.path);
        pathBytes += entry.path.length;
      }
    },
  });

  const ms = Math.round(performance.now() - t0);
  const count = paths ? paths.length : stats.scanned;
  // keep store alive for RSS
  if (paths) void paths.length;
  const afterRss = rssMb();
  const eps = ms > 0 ? Math.round((count / ms) * 1000 * 10) / 10 : 0;

  return {
    engine: 'js',
    mode,
    root: path.win32.normalize(root),
    count,
    scanned: stats.scanned,
    ms,
    entries_per_s: eps,
    rss_mb: afterRss,
    rss_idle_mb: idleRss,
    path_bytes: pathBytes,
    ok: true,
    error: null,
  };
}

async function main() {
  const args = process.argv.slice(2);
  let root = 'E:\\';
  let mode = 'count';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') root = args[++i];
    else if (args[i] === '--mode') mode = args[++i];
  }
  const r = await bakeoffJsWalk(root, { mode });
  console.log(JSON.stringify(r));
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`
  || process.argv[1]?.endsWith('bakeoff-walk.mjs')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
