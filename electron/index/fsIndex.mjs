/**
 * 高速文件索引：
 * - 内存：红黑树 + 跳跃表 + 段倒排 + FRN 地图
 * - 跟盘：watch 脏目录 + ReadUsn(FRN) + USN 游标
 * - 落盘：NDJSON 基线/delta + SQLite FTS5 侧车
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { RbTree } from '../../shared/rbTree.mjs';
import { PathSkipList } from '../../shared/pathSkip.mjs';
import {
  loadIndexDisk, saveIndexDisk, appendIndexDelta, diskCacheStat,
  configureIndexDir, getIndexDir,
} from './persist.mjs';
import { queryUsnJournal, usnNeedsRebuild, startUsnPoll, stopUsnPoll, noteUsnCursor } from './usn.mjs';
import { readUsnRecords, usnIsDelete } from './usnRead.mjs';
import { startVolumeWatch, stopVolumeWatch, isWatching, takeDirtyDirs, peekDirtyDirs } from './watch.mjs';
import { SegmentInvertedMap, QueryResultCache } from './segmentMap.mjs';
import { FtsIndex, ftsAvailable } from './fts.mjs';
import {
  DEFAULT_MAX_SCAN,
  effectiveMaxScan,
  effectiveSkipSet,
  loadIndexPrefs,
  saveIndexPrefs,
  getIndexPrefsSync,
  BUILTIN_SKIP,
} from './indexPrefs.mjs';

export { configureIndexDir, getIndexDir, ftsAvailable, loadIndexPrefs, saveIndexPrefs, BUILTIN_SKIP };
export { DEFAULT_MAX_SCAN };

function skipDir(name) {
  return effectiveSkipSet().has(String(name).toLowerCase());
}

class VolumeIndex {
  constructor(root) {
    this.root = root;
    this.byName = new RbTree();
    this.byPath = new PathSkipList();
    this.segments = new SegmentInvertedMap();
    this.queryCache = new QueryResultCache(64);
    this.meta = new Map();
    this.children = new Map();
    /** @type {Map<string, string>} frn → abs path */
    this.frnMap = new Map();
    this.dirMtimes = new Map();
    /** @type {Set<string>} */
    this.dirtyDirs = new Set();
    this.fts = new FtsIndex(root);
    this.building = false;
    this.ready = false;
    this.scanned = 0;
    this.generation = 0;
    this.usn = null;
    this.source = 'empty';
    this.lastPersistAt = 0;
    this.dirtyPersist = false;
    this.pendingOps = [];
    this.refreshing = false;
    this.watchEnabled = false;
    this.lastSoftRefreshAt = 0;
    this.lastUsnApplied = 0;
  }

  clearStructures() {
    this.byName = new RbTree();
    this.byPath = new PathSkipList();
    this.segments.clear();
    this.queryCache.clear();
    this.meta.clear();
    this.children.clear();
    this.frnMap.clear();
    this.dirMtimes.clear();
    this.dirtyDirs.clear();
    this.fts.clear();
    this.scanned = 0;
    this.dirtyPersist = false;
    this.pendingOps = [];
  }

  linkChild(entryPath) {
    const key = entryPath.toLowerCase();
    const parent = path.dirname(entryPath).toLowerCase();
    let set = this.children.get(parent);
    if (!set) {
      set = new Set();
      this.children.set(parent, set);
    }
    set.add(key);
  }

  unlinkChild(entryPath) {
    const key = entryPath.toLowerCase();
    const parent = path.dirname(entryPath).toLowerCase();
    const set = this.children.get(parent);
    if (!set) return;
    set.delete(key);
    if (set.size === 0) this.children.delete(parent);
  }

  upsert(entry) {
    const key = entry.path.toLowerCase();
    const prev = this.meta.get(key);
    if (prev) {
      this.byName.remove(nameKey(prev.name, prev.path));
      this.byPath.remove(prev.path.toLowerCase());
      this.segments.remove(prev.path);
      this.unlinkChild(prev.path);
      if (prev.frn) this.frnMap.delete(String(prev.frn));
      this.fts.remove(prev.path);
    }
    this.meta.set(key, entry);
    this.byName.insert(nameKey(entry.name, entry.path), entry);
    this.byPath.insert(key, entry);
    this.segments.upsert(entry.path);
    this.linkChild(entry.path);
    if (entry.frn) this.frnMap.set(String(entry.frn), entry.path);
    this.fts.upsert(entry);
    this.queryCache.clear();
    this.dirtyPersist = true;
    this.pendingOps.push({ op: 'upsert', e: entry });
  }

  remove(absPath) {
    const key = absPath.toLowerCase();
    const prev = this.meta.get(key);
    if (!prev) return;
    this.byName.remove(nameKey(prev.name, prev.path));
    this.byPath.remove(key);
    this.segments.remove(prev.path);
    this.unlinkChild(prev.path);
    if (prev.frn) this.frnMap.delete(String(prev.frn));
    this.fts.remove(prev.path);
    this.meta.delete(key);
    this.queryCache.clear();
    this.dirtyPersist = true;
    this.pendingOps.push({ op: 'del', p: prev.path });
  }

  removeTree(absPath) {
    const key = absPath.toLowerCase();
    const kids = this.children.get(key);
    if (kids) {
      for (const child of [...kids]) this.removeTree(child);
    }
    this.remove(absPath);
  }

  hydrate(entries) {
    for (const e of entries) {
      if (!e?.path || !e?.name) continue;
      const key = e.path.toLowerCase();
      this.meta.set(key, e);
      this.byName.insert(nameKey(e.name, e.path), e);
      this.byPath.insert(key, e);
      this.segments.upsert(e.path);
      this.linkChild(e.path);
      if (e.frn) this.frnMap.set(String(e.frn), e.path);
    }
    this.scanned = this.meta.size;
    this.dirtyPersist = false;
    if (this.fts.ok && entries.length) {
      this.fts.rebuild(entries);
    }
  }

  markDirtyDir(dir) {
    if (dir) this.dirtyDirs.add(String(dir).toLowerCase());
  }

  query(q, opts = {}) {
    const limit = Math.min(opts.maxResults || 400, 2000);
    const needle = String(q || '').trim().toLowerCase();
    if (!needle) return { items: [], truncated: false, scanned: this.scanned, source: 'index' };

    const cacheKey = `${needle}|${limit}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached) {
      return { items: cached.items, truncated: cached.truncated, source: cached.source, scanned: this.scanned, cached: true };
    }

    const seen = new Set();
    const items = [];

    // FTS 优先补召回（大库 / 多词）
    if (this.fts.ok && (needle.includes(' ') || this.meta.size > 20_000 || opts.preferFts)) {
      for (const row of this.fts.search(needle, limit)) {
        const value = this.meta.get(String(row.path).toLowerCase());
        if (value && !seen.has(value.path)) {
          seen.add(value.path);
          items.push(value);
          if (items.length >= limit) {
            return finish(this, cacheKey, items, true, 'index-fts');
          }
        }
      }
    }

    for (const { value } of this.byName.rangeByPrefix(needle)) {
      if (value.name.toLowerCase().startsWith(needle) && !seen.has(value.path)) {
        seen.add(value.path);
        items.push(value);
        if (items.length >= limit) {
          return finish(this, cacheKey, items, true, 'index-rb-prefix');
        }
      }
    }

    const multiSeg = needle.includes('\\') || needle.includes('/') || needle.includes(' ');
    if (multiSeg) {
      const segs = needle.split(/[\\/\s]+/).filter(Boolean);
      for (const pk of this.segments.intersect(segs, limit)) {
        const value = this.meta.get(pk);
        if (value && !seen.has(value.path)) {
          seen.add(value.path);
          items.push(value);
          if (items.length >= limit) {
            return finish(this, cacheKey, items, true, 'index-segment');
          }
        }
      }
      for (const { value } of this.byPath.convergeSegments(segs, limit)) {
        if (!seen.has(value.path)) {
          seen.add(value.path);
          items.push(value);
          if (items.length >= limit) {
            return finish(this, cacheKey, items, true, 'index-skip');
          }
        }
      }
    }

    if (items.length < limit) {
      for (const { value } of this.byName.contains(needle, limit * 3)) {
        if (!seen.has(value.path)) {
          seen.add(value.path);
          items.push(value);
          if (items.length >= limit) break;
        }
      }
    }

    // 内存不足时再打 FTS
    if (items.length < limit && this.fts.ok) {
      for (const row of this.fts.search(needle, limit)) {
        const value = this.meta.get(String(row.path).toLowerCase());
        if (value && !seen.has(value.path)) {
          seen.add(value.path);
          items.push(value);
          if (items.length >= limit) break;
        }
      }
      if (items.length && items.length >= Math.min(limit, 1)) {
        return finish(this, cacheKey, items.slice(0, limit), items.length >= limit, 'index-fts-mix');
      }
    }

    return finish(this, cacheKey, items.slice(0, limit), items.length >= limit, 'index');
  }
}

function finish(idx, cacheKey, items, truncated, source) {
  const result = { items, truncated, scanned: idx.scanned, source };
  idx.queryCache.set(cacheKey, { items, truncated, source });
  return result;
}

function nameKey(name, absPath) {
  return `${name.toLowerCase()}\0${absPath.toLowerCase()}`;
}

function entryFromStat(full, name, st) {
  return {
    path: full,
    name,
    kind: st.isDirectory() ? 'folder' : 'file',
    size: st.isFile() ? st.size : 0,
    modifiedAt: st.mtimeMs,
    frn: st.ino != null ? String(st.ino) : undefined,
  };
}

const volumes = new Map();

export function getIndex(root) {
  const key = root.replace(/\\+$/, '').toLowerCase();
  let v = volumes.get(key);
  if (!v) {
    v = new VolumeIndex(root);
    volumes.set(key, v);
  }
  return v;
}

/** 仅盘符根（C: / C:\）才走 USN；子目录压测树不拉起 journal */
function isVolumeRoot(root) {
  const s = String(root).replace(/[/\\]+$/, '');
  return /^[A-Za-z]:$/.test(s);
}

function attachLiveFollowers(root) {
  const idx = getIndex(root);
  if (!idx.watchEnabled) {
    const ok = startVolumeWatch(
      root,
      (abs, entry) => noteFsChange(root, abs, entry),
      (dir) => idx.markDirtyDir(dir),
    );
    idx.watchEnabled = ok;
  }
  // 非盘符根（含临时压测树）：跳过 USN，避免空转 PowerShell
  if (!isVolumeRoot(root)) {
    idx.usnReadable = false;
    return;
  }
  void import('./usnRead.mjs').then(async ({ probeUsnReadable, resetUsnProbe }) => {
    const elevated = process.argv.includes('--elevated') || process.env.AURORA_ELEVATED === '1';
    if (elevated) resetUsnProbe();
    idx.usnReadable = await probeUsnReadable(root, { force: elevated });
    if (idx.usnReadable) void backfillFrn(root, 3_000);
  });
  startUsnPoll(root, (live, delta) => {
    idx.usn = live;
    noteUsnCursor(root, live);
    if (delta < 0) {
      void ensureIndexed(root, { rebuild: true, maxScan: effectiveMaxScan() });
      return;
    }
    const hasDirty = idx.dirtyDirs.size > 0 || peekDirtyDirs(root).length > 0;
    if (!hasDirty && idx.usnReadable === false) {
      idx.lastUsnApplied = live.nextUsn;
      idx.source = 'watch-only';
      return;
    }
    if (!hasDirty && idx.usnReadable !== true) {
      idx.lastUsnApplied = live.nextUsn;
      return;
    }
    void softRefresh(root);
  }, 4000);
}

/**
 * 忙盘优化：ReadUsn(FRN) + 只刷 watch 脏目录，绝不整卷 mtime 扫。
 */
export async function softRefresh(root) {
  const idx = getIndex(root);
  if (!idx.ready || idx.building || idx.refreshing) return idx;
  const now = Date.now();
  if (idx.lastSoftRefreshAt && now - idx.lastSoftRefreshAt < 5_000) return idx;
  idx.lastSoftRefreshAt = now;
  idx.refreshing = true;
  const gen = idx.generation;
  try {
    let usnHits = 0;
    /** @type {Awaited<ReturnType<typeof readUsnRecords>>} */
    let records = null;
    // 已确认无权限则跳过 ReadUsn，避免每轮拉起 PowerShell
    if (idx.usnReadable !== false) {
      const startUsn = idx.lastUsnApplied || Number(idx.usn?.nextUsn) || 0;
      records = await readUsnRecords(root, startUsn, 4000);
      if (records === null) idx.usnReadable = false;
      else idx.usnReadable = true;
      if (records?.length) {
        usnHits = await applyUsnRecords(idx, records);
        const maxUsn = records.reduce((m, r) => Math.max(m, r.usn), startUsn);
        idx.lastUsnApplied = maxUsn + 1;
        const live = await queryUsnJournal(root);
        if (live) {
          idx.usn = live;
          noteUsnCursor(root, live);
        }
        idx.source = `usn-frn:${usnHits}`;
      }
    }

    const dirty = new Set([
      ...idx.dirtyDirs,
      ...takeDirtyDirs(root),
    ]);
    idx.dirtyDirs.clear();

    for (const dir of dirty) {
      if (gen !== idx.generation) break;
      await walkDeltaLimited(idx, dir, 0, 6, gen, effectiveMaxScan());
    }

    if (!records?.length && dirty.size === 0) {
      const live = await queryUsnJournal(root);
      if (live) {
        idx.usn = live;
        idx.lastUsnApplied = live.nextUsn;
        noteUsnCursor(root, live);
      }
      idx.source = idx.usnReadable ? 'usn-cursor-only' : 'watch-only';
    } else if (dirty.size) {
      idx.source = usnHits
        ? `usn-frn+dirty:${dirty.size}`
        : `dirty-dirs:${dirty.size}`;
    }

    await flushIndexDisk(root);
  } finally {
    idx.refreshing = false;
  }
  return idx;
}

async function applyUsnRecords(idx, records) {
  let hits = 0;
  for (const r of records) {
    if (!r?.frn) continue;
    if (usnIsDelete(r.reason)) {
      const p = idx.frnMap.get(r.frn);
      if (p) {
        idx.removeTree(p);
        hits += 1;
      }
      idx.frnMap.delete(r.frn);
      continue;
    }
    const parent = idx.frnMap.get(r.parentFrn);
    if (!parent || !r.name) {
      // 无法解析：记脏，留给 watch/局部扫
      if (parent) idx.markDirtyDir(parent);
      continue;
    }
    const full = path.join(parent, r.name);
    try {
      const st = await fs.stat(full);
      idx.upsert(entryFromStat(full, r.name, st));
      hits += 1;
    } catch {
      const old = idx.frnMap.get(r.frn);
      if (old) {
        idx.removeTree(old);
        hits += 1;
      }
    }
  }
  return hits;
}

async function walkDeltaLimited(idx, dir, depth, maxDepth, gen, maxScan) {
  if (gen !== idx.generation) return;
  if (idx.meta.size >= maxScan) return;
  let stDir;
  try {
    stDir = await fs.stat(dir);
  } catch {
    return;
  }
  const key = dir.toLowerCase();
  idx.dirMtimes.set(key, stDir.mtimeMs);

  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  const seen = new Set();
  for (const name of names) {
    if (gen !== idx.generation) return;
    if (skipDir(name)) continue;
    const full = path.join(dir, name);
    seen.add(full.toLowerCase());
    let st;
    try {
      st = await fs.stat(full);
    } catch {
      continue;
    }
    const entry = entryFromStat(full, name, st);
    const old = idx.meta.get(full.toLowerCase());
    if (!old || old.modifiedAt !== entry.modifiedAt || old.size !== entry.size || old.kind !== entry.kind) {
      idx.upsert(entry);
    } else if (entry.frn && !old.frn) {
      old.frn = entry.frn;
      idx.frnMap.set(entry.frn, old.path);
    }
    idx.scanned += 1;
    if (st.isDirectory() && depth < maxDepth) {
      await walkDeltaLimited(idx, full, depth + 1, maxDepth, gen, maxScan);
    }
  }
  const kids = idx.children.get(key);
  if (kids) {
    for (const childKey of [...kids]) {
      if (!seen.has(childKey)) {
        const e = idx.meta.get(childKey);
        if (e) idx.removeTree(e.path);
      }
    }
  }
}

export async function ensureIndexed(root, opts = {}) {
  const idx = getIndex(root);
  if (idx.ready && !opts.rebuild && !opts.refresh) {
    attachLiveFollowers(root);
    return idx;
  }
  // refresh 走 softRefresh，避免整卷
  if (opts.refresh && idx.ready && !opts.rebuild) {
    return softRefresh(root);
  }
  if (idx.building) return idx;
  idx.building = true;
  const gen = ++idx.generation;
  const maxScan = effectiveMaxScan(opts.maxScan);
  const maxDepth = opts.maxDepth ?? 10;

  try {
    let mode = 'full';
    if (!opts.rebuild && !idx.ready) {
      const disk = await loadIndexDisk(root);
      if (disk?.entries?.length) {
        idx.clearStructures();
        idx.hydrate(disk.entries);
        idx.usn = disk.meta.usn || null;
        idx.lastUsnApplied = Number(disk.meta.usn?.nextUsn) || 0;
        if (disk.meta.dirMtimes) {
          for (const [d, t] of Object.entries(disk.meta.dirMtimes)) {
            idx.dirMtimes.set(d, t);
          }
        }
        idx.ready = true;
        idx.source = 'disk';
        idx.scanned = disk.meta.scanned || idx.meta.size;
        idx.lastPersistAt = disk.meta.savedAt || 0;
      }
    }

    const liveUsn = await queryUsnJournal(root);
    const decision = usnNeedsRebuild(idx.usn, liveUsn);

    if (opts.rebuild || decision.rebuild) {
      idx.clearStructures();
      idx.ready = false;
      idx.source = decision.rebuild ? `rebuild:${decision.reason}` : 'rebuild:forced';
      mode = 'full';
    } else if (idx.ready && (decision.useMtimeDelta || idx.source === 'disk')) {
      // 冷启动追赶：仍可整卷 mtime 一次；之后靠 USN+脏目录
      mode = 'mtime-delta';
      idx.source = 'usn-mtime-delta';
    }

    async function noteDir(dir) {
      try {
        const st = await fs.stat(dir);
        idx.dirMtimes.set(dir.toLowerCase(), st.mtimeMs);
      } catch { /* */ }
    }

    async function walkFull(dir, depth) {
      if (gen !== idx.generation) return;
      if (idx.scanned >= maxScan) return;
      await noteDir(dir);
      let names;
      try {
        names = await fs.readdir(dir);
      } catch {
        return;
      }
      for (const name of names) {
        if (gen !== idx.generation) return;
        if (idx.scanned >= maxScan) return;
        if (skipDir(name)) continue;
        const full = path.join(dir, name);
        idx.scanned += 1;
        let st;
        try {
          st = await fs.stat(full);
        } catch {
          continue;
        }
        idx.upsert(entryFromStat(full, name, st));
        if (idx.scanned % 400 === 0) await new Promise((r) => setImmediate(r));
        if (st.isDirectory() && depth < maxDepth) await walkFull(full, depth + 1);
      }
    }

    async function walkDelta(dir, depth) {
      await walkDeltaLimited(idx, dir, depth, maxDepth, gen, maxScan);
    }

    if (mode === 'full') {
      idx.scanned = 0;
      await walkFull(root, 0);
      if (idx.fts.ok) idx.fts.rebuild([...idx.meta.values()]);
    } else {
      await walkDelta(root, 0);
    }

    if (gen === idx.generation) {
      idx.ready = true;
      if (liveUsn) {
        idx.usn = liveUsn;
        idx.lastUsnApplied = liveUsn.nextUsn;
      }
      idx.source = mode === 'full'
        ? (idx.source.startsWith('rebuild') ? idx.source : 'full-scan')
        : 'usn-mtime-delta';

      try {
        if (mode === 'full' || !idx.lastPersistAt) {
          idx.pendingOps = [];
          await saveIndexDisk(root, {
            entries: [...idx.meta.values()],
            scanned: idx.scanned,
            usn: idx.usn,
            dirMtimes: Object.fromEntries(idx.dirMtimes),
          });
          idx.lastPersistAt = Date.now();
          idx.dirtyPersist = false;
        } else {
          await flushIndexDisk(root);
        }
      } catch { /* */ }
      attachLiveFollowers(root);
      if (liveUsn) noteUsnCursor(root, liveUsn);
    }
  } finally {
    idx.building = false;
  }
  return idx;
}

const persistTimers = new Map();

export async function flushIndexDisk(root, { forceCompact = false } = {}) {
  const idx = getIndex(root);
  if (!idx.dirtyPersist && !idx.pendingOps.length && idx.lastPersistAt && !forceCompact) {
    return false;
  }
  const dirObj = Object.fromEntries(idx.dirMtimes);
  const ops = idx.pendingOps.splice(0, idx.pendingOps.length);

  if (!forceCompact && ops.length && idx.lastPersistAt) {
    const { shouldCompact } = await appendIndexDelta(root, ops, {
      scanned: idx.scanned,
      size: idx.meta.size,
      usn: idx.usn,
      dirMtimes: dirObj,
    });
    idx.lastPersistAt = Date.now();
    idx.dirtyPersist = false;
    if (shouldCompact) {
      await saveIndexDisk(root, {
        entries: [...idx.meta.values()],
        scanned: idx.scanned,
        usn: idx.usn,
        dirMtimes: dirObj,
      });
      if (idx.fts.ok) idx.fts.rebuild([...idx.meta.values()]);
    }
    return true;
  }

  await saveIndexDisk(root, {
    entries: [...idx.meta.values()],
    scanned: idx.scanned,
    usn: idx.usn,
    dirMtimes: dirObj,
  });
  idx.lastPersistAt = Date.now();
  idx.dirtyPersist = false;
  idx.pendingOps = [];
  return true;
}

function schedulePersist(root) {
  const key = root.replace(/\\+$/, '').toLowerCase();
  const prev = persistTimers.get(key);
  if (prev) clearTimeout(prev);
  persistTimers.set(
    key,
    setTimeout(() => {
      persistTimers.delete(key);
      void flushIndexDisk(root).catch(() => undefined);
    }, 3200),
  );
}

export async function queryIndex(root, query, opts = {}) {
  const idx = getIndex(root);
  if (!idx.ready && !idx.building) {
    void ensureIndexed(root, { maxDepth: opts.indexDepth ?? 8, maxScan: effectiveMaxScan(opts.maxScan) });
  }
  if (!idx.ready && idx.scanned < 200) {
    await warmShallow(idx, root, 2, 3000);
  }
  return idx.query(query, opts);
}

async function warmShallow(idx, root, depth, budget) {
  async function walk(dir, d) {
    if (idx.scanned >= budget) return;
    let names;
    try { names = await fs.readdir(dir); } catch { return; }
    for (const name of names) {
      if (idx.scanned >= budget) return;
      if (skipDir(name)) continue;
      const full = path.join(dir, name);
      idx.scanned += 1;
      try {
        const st = await fs.stat(full);
        idx.upsert(entryFromStat(full, name, st));
        if (st.isDirectory() && d < depth) await walk(full, d + 1);
      } catch { /* */ }
    }
  }
  await walk(root, 0);
}

export function indexStatus(root) {
  const idx = getIndex(root);
  const disk = diskCacheStat(root);
  return {
    ready: idx.ready,
    building: idx.building || idx.refreshing,
    scanned: idx.scanned,
    size: idx.meta.size,
    source: idx.source,
    usn: idx.usn,
    lastPersistAt: idx.lastPersistAt,
    disk,
    indexDir: getIndexDir(),
    segmentKeys: idx.segments.seg.size,
    queryCacheSize: idx.queryCache.map.size,
    watching: isWatching(root) || idx.watchEnabled,
    pendingDelta: idx.pendingOps.length,
    dirtyDirs: idx.dirtyDirs.size,
    frnSize: idx.frnMap.size,
    fts: { available: ftsAvailable(), ok: idx.fts.ok, size: idx.fts.size() },
    usnReadable: idx.usnReadable ?? null,
    maxScan: getIndexPrefsSync().maxScan,
    excludeNames: [...(getIndexPrefsSync().excludeNames || [])],
    builtinSkip: [...BUILTIN_SKIP],
  };
}

export function noteFsChange(root, absPath, entryOrNull) {
  const idx = getIndex(root);
  if (entryOrNull) idx.upsert(entryOrNull);
  else idx.removeTree(absPath);
  idx.markDirtyDir(path.dirname(absPath));
  schedulePersist(root);
}

/**
 * 落盘 hydrate 后条目常缺 frn；后台抽样补全，供 ReadUsn 解析父路径。
 */
export async function backfillFrn(root, budget = 3000) {
  const idx = getIndex(root);
  if (!idx.ready || idx.building) return 0;
  let n = 0;
  for (const e of idx.meta.values()) {
    if (n >= budget) break;
    if (e.frn) continue;
    try {
      const st = await fs.stat(e.path);
      if (st.ino == null) continue;
      e.frn = String(st.ino);
      idx.frnMap.set(e.frn, e.path);
      n += 1;
      if (n % 200 === 0) await new Promise((r) => setImmediate(r));
    } catch { /* 已删 */ }
  }
  if (n) {
    idx.dirtyPersist = true;
    schedulePersist(root);
  }
  return n;
}

/** 主进程：为多个盘符并行建索（可移动盘默认跳过） */
export async function ensureVolumes(roots, opts = {}) {
  const list = (roots || []).filter(Boolean);
  const out = [];
  for (const root of list) {
    out.push(ensureIndexed(root, opts));
  }
  return Promise.all(out);
}

export function disposeVolumeIndex(root) {
  stopVolumeWatch(root);
  stopUsnPoll(root);
  const idx = volumes.get(root.replace(/\\+$/, '').toLowerCase());
  idx?.fts?.close?.();
  volumes.delete(root.replace(/\\+$/, '').toLowerCase());
}
