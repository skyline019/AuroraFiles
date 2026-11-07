/**
 * 高吞吐整卷遍历（现栈极限向）：
 * - 并行 BFS，队列用 head 指针避免 shift O(n)
 * - Dirent 优先；深路径 fsPath / 逻辑 path
 * - 少 yield、可配高并发
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fsPath, logicalPath } from './winPath.mjs';
import { walkKnobsFromOpts } from './indexTrack.mjs';

function isReparseOrLink(direntOrStat) {
  try {
    if (typeof direntOrStat.isSymbolicLink === 'function' && direntOrStat.isSymbolicLink()) return true;
  } catch { /* */ }
  return false;
}

/** 文件省略 kind（缺省=file）；仅目录写 kind，压百万级对象字段 */
function entryFromDirent(fullLogical, name, ent) {
  const entry = { path: fullLogical, name };
  if (ent.isDirectory()) entry.kind = 'folder';
  return entry;
}

function entryFromStat(fullLogical, name, st) {
  const entry = { path: fullLogical, name };
  if (st.isDirectory()) entry.kind = 'folder';
  else if (st.size) entry.size = st.size;
  if (st.mtimeMs) entry.modifiedAt = st.mtimeMs;
  if (st.ino != null) entry.frn = String(st.ino);
  return entry;
}

/** 已是逻辑路径时避免 path.join 开销 */
function joinLogical(dir, name) {
  if (!dir) return name;
  const last = dir.charCodeAt(dir.length - 1);
  if (last === 92 || last === 47) return dir + name;
  return `${dir}\\${name}`;
}

/**
 * @param {string} root
 * @param {object} opts
 */
export async function parallelDirentWalk(root, opts = {}) {
  const maxDepth = opts.maxDepth ?? 64;
  const maxScan = opts.maxScan ?? 5_000_000;
  const deadline = Number(opts.deadlineMs) > 0 ? Date.now() + Number(opts.deadlineMs) : 0;
  const skipDir = opts.skipDir || (() => false);
  const followReparse = opts.followReparse === true;
  const onEntry = opts.onEntry;
  const aborted = opts.aborted || (() => false);
  const knobs = walkKnobsFromOpts(opts);
  const maxPerf = knobs.maxPerf;
  const interactive = knobs.interactive;
  const cpus = os.cpus()?.length || 4;
  const concurrency = Math.max(
    2,
    Math.min(
      maxPerf ? 128 : 24,
      Number(opts.concurrency) > 0
        ? Number(opts.concurrency)
        : (maxPerf ? Math.max(32, cpus * 4) : Math.max(4, Math.min(12, cpus))),
    ),
  );
  const yieldEvery = Number(knobs.yieldEvery) > 0 ? Number(knobs.yieldEvery) : (maxPerf ? 8192 : 512);
  const progressMs = Number(knobs.progressMs) > 0 ? Number(knobs.progressMs) : (maxPerf ? 250 : 600);

  const rootLogical = logicalPath(path.win32.normalize(root));
  /** @type {{ dir: string, depth: number }[]} */
  const queue = [{ dir: rootLogical, depth: 0 }];
  let qHead = 0;
  const seenDirs = new Set([rootLogical.toLowerCase()]);
  let scanned = 0;
  let inFlight = 0;
  let lastProgressAt = 0;
  /** @type {((v?: void) => void) | null} */
  let wake = null;

  const stop = () =>
    aborted()
    || scanned >= maxScan
    || (deadline > 0 && Date.now() > deadline);

  const queueLen = () => queue.length - qHead;

  const bumpProgress = () => {
    if (typeof opts.onProgress !== 'function') return;
    const now = Date.now();
    if (now - lastProgressAt < progressMs) return;
    lastProgressAt = now;
    opts.onProgress({ scanned, queued: queueLen() });
  };

  const notify = () => {
    if (wake) {
      const r = wake;
      wake = null;
      r();
    }
  };

  function enqueueDir(dirLogical, depth) {
    if (depth > maxDepth || stop()) return;
    const key = dirLogical.toLowerCase();
    if (seenDirs.has(key)) return;
    seenDirs.add(key);
    queue.push({ dir: dirLogical, depth });
    notify();
  }

  async function processDir(dirLogical, depth) {
    let ents;
    try {
      ents = await fs.readdir(fsPath(dirLogical), { withFileTypes: true });
    } catch {
      return;
    }
    if (stop()) return;

    for (const ent of ents) {
      if (stop()) return;
      const name = ent.name;
      if (skipDir(name)) continue;
      const fullLogical = joinLogical(dirLogical, name);
      const isLink = isReparseOrLink(ent);

      if (isLink && !followReparse) continue;

      scanned += 1;

      if (isLink && followReparse) {
        let st;
        try {
          st = await fs.stat(fsPath(fullLogical));
        } catch {
          continue;
        }
        let realLogical = fullLogical;
        try {
          realLogical = logicalPath(await fs.realpath(fsPath(fullLogical)));
        } catch { /* keep */ }
        const entry = entryFromStat(fullLogical, name, st);
        onEntry(entry, { isDir: st.isDirectory() });
        if (st.isDirectory()) enqueueDir(realLogical, depth + 1);
      } else {
        const isDir = ent.isDirectory();
        onEntry(entryFromDirent(fullLogical, name, ent), { isDir });
        if (isDir) enqueueDir(fullLogical, depth + 1);
      }

      if (scanned % yieldEvery === 0) {
        bumpProgress();
        await new Promise((r) => setImmediate(r));
        // 压缩已消费队列，避免长期占用
        if (qHead > 2048 && qHead * 2 > queue.length) {
          queue.splice(0, qHead);
          qHead = 0;
        }
      }
    }
    bumpProgress();
  }

  async function worker() {
    for (;;) {
      if (stop() && queueLen() === 0 && inFlight === 0) return;

      if (qHead >= queue.length) {
        if (inFlight === 0) return;
        try {
          if (typeof opts.onIdle === 'function') opts.onIdle();
        } catch { /* */ }
        await new Promise((resolve) => {
          wake = resolve;
          setTimeout(resolve, maxPerf ? 2 : 5);
        });
        continue;
      }

      const job = queue[qHead++];
      inFlight += 1;
      try {
        await processDir(job.dir, job.depth);
      } finally {
        inFlight -= 1;
        notify();
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return {
    scanned,
    timedOut: !!(deadline && Date.now() > deadline && scanned < maxScan),
    hitMax: scanned >= maxScan,
    concurrency,
  };
}

export { entryFromDirent, entryFromStat, isReparseOrLink, joinLogical };
