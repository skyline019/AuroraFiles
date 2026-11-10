/**
 * 可取消深搜（无 Electron 依赖，便于 CLI / 压测引用）
 *
 * 策略：
 * 1. 有卷索引且就绪 → 瞬时按「当前位置前缀」过滤返回（无 warm 等待）
 * 2. 否则立刻从当前位置 Dirent 深 walk（默认深度 64，扫描可无上限）
 * 不在子文件夹路径上另开 VolumeIndex，避免空索引 + warmShallow 卡顿。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureIndexed, queryIndex, noteFsChange, getIndex } from './fsIndex.mjs';
import { effectiveSkipSet, resolveScanLimit } from './indexPrefs.mjs';

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

function joinUnder(dir, name) {
  if (process.platform === 'win32') {
    const last = dir.charCodeAt(dir.length - 1);
    if (last === 92 || last === 47) return dir + name;
    return `${dir}\\${name}`;
  }
  return path.join(dir, name);
}

/**
 * 优先走卷索引（作用域=当前位置）；否则立刻深 walk。
 * 新搜索或 cancelSearch 作废旧任务。
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
  // 深度：默认 64；硬顶 256（不再截成 6）
  const maxDepth = Math.min(
    Math.max(1, Number(opts.maxDepth) > 0 ? Number(opts.maxDepth) : 64),
    256,
  );
  // 扫描：0 / 缺省偏深搜 → resolveScanLimit；显式正数尊重（仍受 prefs 软顶）
  const maxScan = opts.maxScan === 0 || opts.maxScan === '0'
    ? resolveScanLimit(0)
    : (Number(opts.maxScan) > 0
      ? resolveScanLimit(Number(opts.maxScan))
      : resolveScanLimit(0));

  const vol = volumeRootOf(root);

  // 后台催热卷索引；不 await，不阻塞本次查询
  if (!forceWalk && opts.indexDepth !== 0) {
    void ensureIndexed(vol, {
      maxDepth: opts.indexDepth ?? 64,
      maxScan: opts.indexMaxScan,
      skipMode,
      followReparse: opts.followReparse === true,
      track: 'ui',
    }).catch(() => undefined);
  }

  if (!forceWalk) {
    const idx = getIndex(vol);
    // 仅当卷索引已就绪且非冷建中：瞬时前缀过滤（当前位置子树）
    if (idx.ready && !idx.building) {
      const indexed = await queryIndex(vol, q, {
        maxResults: Math.min(maxResults * 4, 2000), // 多取再过滤到当前目录
        skipWarm: true,
      });
      if (aborted()) {
        return { items: [], truncated: true, scanned: indexed.scanned || 0, source: 'cancelled', cancelled: true };
      }
      const scoped = (indexed.items || []).filter((it) => isPathUnder(it.path, root));
      const items = scoped.slice(0, maxResults);
      return {
        items,
        truncated: scoped.length > maxResults || !!indexed.truncated,
        scanned: indexed.scanned || scoped.length,
        source: `${indexed.source || 'index'}-under`,
        cached: !!indexed.cached,
      };
    }
  }

  // 索引未就绪 / 强制 walk：从当前位置立刻深扫（Dirent，避免逐文件 lstat）
  const items = [];
  let scanned = 0;
  let truncated = false;

  async function walk(dir, depth) {
    if (aborted()) return;
    if (truncated || items.length >= maxResults || scanned >= maxScan) {
      truncated = true;
      return;
    }
    let ents;
    try {
      ents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (aborted()) return;
      if (truncated || items.length >= maxResults || scanned >= maxScan) {
        truncated = true;
        return;
      }
      const name = ent.name;
      if (skip.has(name.toLowerCase())) continue;
      if (ent.isSymbolicLink?.()) continue;
      const full = joinUnder(dir, name);
      scanned += 1;
      const isDir = ent.isDirectory();
      // 部分平台 Dirent 对特殊项不可靠时再 lstat
      let kindDir = isDir;
      let size = 0;
      let modifiedAt = 0;
      if (typeof ent.isDirectory !== 'function' || (!isDir && !ent.isFile?.())) {
        try {
          const st = await fs.lstat(full);
          if (st.isSymbolicLink?.()) continue;
          kindDir = st.isDirectory();
          size = st.isFile() ? st.size : 0;
          modifiedAt = st.mtimeMs || 0;
        } catch {
          continue;
        }
      }
      if (name.toLowerCase().includes(q)) {
        const entry = {
          path: full,
          name,
          kind: kindDir ? 'folder' : 'file',
          size,
          modifiedAt,
        };
        items.push(entry);
        noteFsChange(vol, full, entry);
      }
      if (kindDir && depth < maxDepth) await walk(full, depth + 1);
    }
  }

  await walk(root, 0);
  if (aborted()) {
    return { items: [], truncated: true, scanned, source: 'cancelled', cancelled: true };
  }
  return { items, truncated, scanned, source: 'walk-fallback' };
}
