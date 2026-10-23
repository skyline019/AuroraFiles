/**
 * 可取消深搜（无 Electron 依赖，便于 CLI / 压测引用）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureIndexed, queryIndex, noteFsChange } from './fsIndex.mjs';
import { effectiveSkipSet } from './indexPrefs.mjs';

let searchJobId = 0;

export function cancelSearch() {
  searchJobId += 1;
  return { cancelled: true, jobId: searchJobId };
}

function normalizePath(p) {
  if (!p || typeof p !== 'string') throw new Error('无效路径');
  const n = path.win32.normalize(p);
  if (!path.win32.isAbsolute(n)) throw new Error('仅支持绝对路径');
  return n;
}

/**
 * 优先走内存索引；未就绪时浅层 walk。新搜索或 cancelSearch 作废旧任务。
 */
export async function searchFiles(rootPath, query, opts = {}) {
  const root = normalizePath(rootPath);
  const q = String(query || '').trim().toLowerCase();
  if (!q || q.length < 1) return { items: [], truncated: false, scanned: 0, source: 'empty' };

  const jobId = ++searchJobId;
  const aborted = () => jobId !== searchJobId;
  const skip = effectiveSkipSet();

  if (opts.indexDepth !== 0) {
    void ensureIndexed(root, { maxDepth: opts.indexDepth ?? 10, maxScan: opts.maxScan ?? 80_000 });
  }

  const indexed = await queryIndex(root, q, {
    maxResults: opts.maxResults || 400,
  });
  if (aborted()) {
    return { items: [], truncated: true, scanned: indexed.scanned || 0, source: 'cancelled', cancelled: true };
  }
  if (indexed.items.length || indexed.source?.startsWith('index')) {
    return indexed;
  }

  const maxResults = Math.min(Number(opts.maxResults) || 400, 2000);
  const maxDepth = Math.min(Number(opts.maxDepth) || 3, 6);
  const maxScan = Math.min(Number(opts.maxScan) || 4_000, 50_000);
  const items = [];
  let scanned = 0;
  let truncated = false;

  async function walk(dir, depth) {
    if (aborted()) return;
    if (truncated || items.length >= maxResults || scanned >= maxScan) {
      truncated = true;
      return;
    }
    let names;
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (aborted()) return;
      if (truncated || items.length >= maxResults || scanned >= maxScan) {
        truncated = true;
        return;
      }
      if (skip.has(name.toLowerCase())) continue;
      const full = path.join(dir, name);
      scanned += 1;
      let st;
      try {
        st = await fs.stat(full);
      } catch {
        continue;
      }
      if (name.toLowerCase().includes(q)) {
        const entry = {
          path: full,
          name,
          kind: st.isDirectory() ? 'folder' : 'file',
          size: st.isFile() ? st.size : 0,
          modifiedAt: st.mtimeMs,
        };
        items.push(entry);
        noteFsChange(root, full, entry);
      }
      if (st.isDirectory() && depth < maxDepth) await walk(full, depth + 1);
    }
  }

  await walk(root, 0);
  if (aborted()) {
    return { items: [], truncated: true, scanned, source: 'cancelled', cancelled: true };
  }
  return { items, truncated, scanned, source: 'walk-fallback' };
}
