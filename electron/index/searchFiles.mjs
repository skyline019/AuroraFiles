/**
 * 可取消深搜（无 Electron 依赖，便于 CLI / 压测引用）
 *
 * 任意词无延迟策略：
 * 1. 卷索引有数据（ready 或已有条目）→ 立刻 contains 查询 + 当前位置前缀过滤
 * 2. 有命中则立即返回（不 await 建索）
 * 3. 索引已封口且有条目、查询为空 → 信任索引，禁止整卷 walk（避免数秒空转）
 * 4. 仅索引未就绪 / 空库 → 并行 Dirent 深 walk（交互默认 deadline，forceWalk 可无上限）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ensureIndexed, queryIndex, noteFsChange, getIndex } from './fsIndex.mjs';
import { effectiveSkipSet, resolveScanLimit } from './indexPrefs.mjs';
import { parallelDirentWalk } from './fastWalk.mjs';

let searchJobId = 0;

export function cancelSearch() {
  searchJobId += 1;
  return { cancelled: true, jobId: searchJobId };
}

function normalizePath(p) {
  if (!p || typeof p !== 'string') throw new Error('无效路径');
  if (process.platform !== 'win32') {
    const n = path.normalize(p);
    if (!path.isAbsolute(n)) throw new Error('仅支持绝对路径');
    return n;
  }
  const n = path.win32.normalize(p);
  if (!path.win32.isAbsolute(n)) throw new Error('仅支持绝对路径');
  return n;
}

/** 卷根：`E:\` / `/` */
export function volumeRootOf(absPath) {
  const s = String(absPath || '');
  if (process.platform === 'win32') {
    const m = s.match(/^([A-Za-z]:)[\\/]/);
    return m ? `${m[1].toUpperCase()}\\` : s;
  }
  return '/';
}

/** path 是否位于 root 之下（含 root 自身） */
export function isPathUnder(absPath, root) {
  const sep = process.platform === 'win32' ? '\\' : '/';
  const norm = (p) => {
    let x = String(p || '');
    if (process.platform === 'win32') x = x.replace(/\//g, '\\');
    x = x.replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? x.toLowerCase() : x;
  };
  const p = norm(absPath);
  const r = norm(root);
  if (!r) return true;
  return p === r || p.startsWith(r + sep);
}

/** 任意词：多分词 AND；匹配文件名或完整路径（子串） */
export function nameMatchesQuery(name, fullPath, queryLower) {
  const tokens = String(queryLower || '').split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  const n = String(name || '').toLowerCase();
  const p = String(fullPath || '').toLowerCase();
  return tokens.every((t) => n.includes(t) || p.includes(t));
}

/**
 * 优先瞬时索引；未命中则并行深 walk。
 */
export async function searchFiles(rootPath, query, opts = {}) {
  const root = normalizePath(rootPath);
  const q = String(query || '').trim().toLowerCase();
  if (!q || q.length < 1) return { items: [], truncated: false, scanned: 0, source: 'empty' };

  const jobId = ++searchJobId;
  const aborted = () => jobId !== searchJobId;
  /** @type {'builtin'|'minimal'|'none'} */
  const skipMode = opts.skipMode || 'builtin';
  const skip = effectiveSkipSet(undefined, skipMode);
  const forceWalk = opts.forceWalk === true;
  const maxResults = Math.min(Number(opts.maxResults) || 400, 2000);
  const maxDepth = Math.min(
    Math.max(1, Number(opts.maxDepth) > 0 ? Number(opts.maxDepth) : 64),
    256,
  );
  const maxScan = opts.maxScan === 0 || opts.maxScan === '0'
    ? resolveScanLimit(0)
    : (Number(opts.maxScan) > 0
      ? resolveScanLimit(Number(opts.maxScan))
      : resolveScanLimit(0));

  const vol = volumeRootOf(root);

  // 深搜默认不触达建索：旧逻辑 `indexDepth ?? 64` 会在每次查询时踢整卷 ensureIndexed，
  // 与 walk 抢磁盘，交互可达数秒。仅当显式传入 indexDepth>0 才后台补建。
  const indexDepthNum = Number(opts.indexDepth);
  if (!forceWalk && indexDepthNum > 0) {
    void ensureIndexed(vol, {
      maxDepth: indexDepthNum,
      maxScan: opts.indexMaxScan,
      skipMode,
      followReparse: opts.followReparse === true,
      track: 'ui',
    }).catch(() => undefined);
  }

  // 索引只要有条目就先查（建索中也可瞬时出结果）
  if (!forceWalk) {
    const idx = getIndex(vol);
    const entryCount = idx.entryCount();
    const hasData = idx.ready || entryCount > 0 || idx.scanned > 200;
    if (hasData) {
      const indexed = await queryIndex(vol, q, {
        maxResults: Math.min(maxResults * 4, 2000),
        skipWarm: true,
        preferContains: true,
      });
      if (aborted()) {
        return { items: [], truncated: true, scanned: indexed.scanned || 0, source: 'cancelled', cancelled: true };
      }
      const scoped = (indexed.items || []).filter((it) => isPathUnder(it.path, root));
      // 有命中 → 立刻返回（无延迟）
      if (scoped.length > 0) {
        const items = scoped.slice(0, maxResults);
        return {
          items,
          truncated: scoped.length > maxResults || !!indexed.truncated || (!idx.ready || !!idx.building),
          scanned: indexed.scanned || scoped.length,
          source: `${indexed.source || 'index'}-under`,
          cached: !!indexed.cached,
        };
      }
      // 封口索引有实质条目却无命中 → 信任空结果，勿整卷 walk
      // 阈值避免「损坏的空 aidx → ready+0/极少条」误信任后仍无结果又去 walk
      if (idx.ready && !idx.building && entryCount >= 500) {
        return {
          items: [],
          truncated: false,
          scanned: indexed.scanned || entryCount,
          source: `${indexed.source || 'index'}-under`,
          cached: !!indexed.cached,
        };
      }
    }
  }

  // 并行 Dirent walk：任意词子串匹配，满额 / deadline / 取消早停
  const items = [];
  const seen = new Set();
  let truncated = false;
  let walkScanned = 0;

  const skipDir = (name) => skip.has(String(name).toLowerCase());
  const cpus = os.cpus()?.length || 4;
  // forceWalk / 显式 0 → 无 deadline；交互默认 2.5s 封顶，避免索引空库时卡死 UI
  const deadlineMs = opts.deadlineMs === 0 || opts.deadlineMs === '0'
    ? 0
    : (Number(opts.deadlineMs) > 0
      ? Number(opts.deadlineMs)
      : (forceWalk ? 0 : 2500));

  const walkAbort = () => aborted() || items.length >= maxResults;

  const stats = await parallelDirentWalk(root, {
    maxDepth,
    maxScan,
    deadlineMs: deadlineMs || undefined,
    concurrency: Math.min(48, Math.max(12, cpus * 3)),
    yieldEvery: 2048,
    interactive: true,
    skipDir,
    followReparse: opts.followReparse === true,
    aborted: walkAbort,
    onEntry: (entry) => {
      if (walkAbort()) {
        truncated = true;
        return;
      }
      walkScanned += 1;
      const name = entry.name || '';
      const full = entry.path || '';
      if (!nameMatchesQuery(name, full, q)) return;
      const key = full.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const row = {
        path: full,
        name,
        kind: entry.kind === 'folder' ? 'folder' : 'file',
        size: entry.size || 0,
        modifiedAt: entry.modifiedAt || 0,
      };
      items.push(row);
      noteFsChange(vol, full, row);
      if (items.length >= maxResults) truncated = true;
    },
  });

  if (aborted()) {
    return { items: [], truncated: true, scanned: stats.scanned || walkScanned, source: 'cancelled', cancelled: true };
  }

  truncated = truncated || !!stats.hitMax || !!stats.timedOut || items.length >= maxResults;
  return {
    items,
    truncated,
    scanned: stats.scanned || walkScanned,
    source: stats.timedOut ? 'walk-parallel-deadline' : 'walk-parallel',
  };
}
