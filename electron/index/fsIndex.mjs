/**
 * 高速文件索引：
 * - 内存：红黑树 + 跳跃表 + 段倒排 + FRN 地图
 * - 跟盘：watch 脏目录 + ReadUsn(FRN) + USN 游标
 * - 落盘：NDJSON 基线/delta + SQLite FTS5 侧车
 */
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { RbTree } from '../../shared/rbTree.mjs';
import { PathSkipList } from '../../shared/pathSkip.mjs';
import {
  loadIndexDisk, saveIndexDisk, appendIndexDelta, diskCacheStat,
  configureIndexDir, getIndexDir, getIndexFilePaths,
} from './persist.mjs';
import { IndexdClient, resolveIndexdBin } from './indexdClient.mjs';
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
  MINIMAL_SKIP,
} from './indexPrefs.mjs';
import { IndexDebt } from './indexDebt.mjs';
import { fsPath } from './winPath.mjs';
import { walkVolume, resolveWalkEngine } from './walkEngine.mjs';
import { applyIndexTrack } from './indexTrack.mjs';

export {
  configureIndexDir, getIndexDir, ftsAvailable, loadIndexPrefs, saveIndexPrefs,
  BUILTIN_SKIP, MINIMAL_SKIP,
};
export { DEFAULT_MAX_SCAN };

/** `.aidx.d` size above which space-debt coalesce rewrites base `.aidx` (bytes). */
export function coalesceAidxDeltaBytes() {
  const raw = Number(process.env.AURORA_AIDX_COALESCE_BYTES);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return 8 * 1024 * 1024;
}

/** Windows 联接/符号链接 */
function isReparseOrLink(direntOrStat) {
  try {
    if (typeof direntOrStat.isSymbolicLink === 'function' && direntOrStat.isSymbolicLink()) return true;
  } catch { /* */ }
  return false;
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
    /** @type {boolean} 活跟随（watch+USN）是否已挂，防进夹重复 attach */
    this._liveAttached = false;
    this.lastSoftRefreshAt = 0;
    this.lastUsnApplied = 0;
    /** 批量建索：跳过逐条 FTS/pendingOps/queryCache */
    this._bulk = false;
    /** lean：不建二级索引，靠 FTS + byName；债错峰清偿 */
    this._lean = false;
    this.debt = new IndexDebt();
    this._ftsCursor = 0;
    this._frnCursor = 0;
    /** @type {object[]|null} FTS 还债快照，避免每次 values() 跳过 O(n) */
    this._ftsSnap = null;
    /** @type {Map<string, string>} 文件名驻留，重复名共享同一字符串 */
    this._namePool = new Map();
    /** @type {'js'|'native'} */
    this._backend = 'js';
    /** @type {IndexdClient|null} */
    this._indexd = null;
    this._nativeCount = 0;
    this._wireDebtPayer();
  }

  entryCount() {
    return this._backend === 'native' ? (this._nativeCount || 0) : this.meta.size;
  }

  /**
   * Start aurora-indexd and switch VolumeIndex to native backend.
   * @param {{ clear?: boolean }} [opts] clear=true wipes store (default for fresh enable / rebuild)
   * @returns {Promise<boolean>}
   */
  async enableNative({ clear = true } = {}) {
    if (this._backend === 'native' && this._indexd?._alive) {
      if (clear) {
        try {
          await this._indexd.clear();
        } catch {
          this.disableNative();
          return false;
        }
        this._nativeCount = 0;
      }
      return true;
    }
    const client = new IndexdClient(this.root);
    if (!client.start()) return false;
    try {
      await client.ping();
      if (clear) await client.clear();
    } catch {
      client.stop();
      return false;
    }
    this._indexd = client;
    this._backend = 'native';
    this._nativeCount = 0;
    this.meta.clear();
    this.byName = new RbTree();
    this.frnMap.clear();
    return true;
  }

  disableNative() {
    try { this._indexd?.stop(); } catch { /* */ }
    this._indexd = null;
    this._backend = 'js';
    this._nativeCount = 0;
  }

  /** lean + FTS 可用时不建 byName（热搜走 FTS；省整棵 RbTree） */
  _useByName() {
    return !(this._lean && this.fts.ok);
  }

  _internName(name) {
    if (!name) return name;
    const hit = this._namePool.get(name);
    if (hit !== undefined) return hit;
    this._namePool.set(name, name);
    return name;
  }

  /**
   * 路径小写归一，并与 Map 键共用同一字符串引用。
   * @returns {string}
   */
  _canonEntryPath(entry) {
    const raw = String(entry.path);
    const key = raw.toLowerCase();
    if (key !== entry.path) entry.path = key;
    return key;
  }

  _wireDebtPayer() {
    this.debt.payer = async (kind, budget) => {
      if (kind === 'fts') {
        if (this._backend === 'native') return this._payFtsDebtNative(budget);
        return this._payFtsDebt(budget);
      }
      if (kind === 'frn') return this._payFrnDebt(budget);
      if (kind === 'secondary') return this._paySecondaryDebt(budget);
      if (kind === 'persist') return this._payPersistDebt(budget);
      if (kind === 'space') return this._paySpaceDebt(budget);
      return 0;
    };
  }

  /**
   * Space debt: path index batches → shrink → optional arena compact;
   * on done, coalesce `.aidx.d` into base if over threshold.
   */
  async _paySpaceDebt(budget) {
    if (this._backend !== 'native' || !this._indexd) {
      this.debt.clear('space');
      return 0;
    }
    const ops = budget.ops || 4_000;
    try {
      const res = await this._indexd.normalizeSlice(ops);
      const did = Number(res?.did) || 0;
      if (!res?.done) return did || 1;
      // Normalize finished — maybe coalesce binary delta into base snapshot
      const files = getIndexFilePaths(this.root);
      const deltaPath = `${files.aidx}.d`;
      let deltaBytes = 0;
      try {
        deltaBytes = (await fs.stat(deltaPath)).size;
      } catch { /* no delta */ }
      const COALESCE_BYTES = coalesceAidxDeltaBytes();
      if (deltaBytes > COALESCE_BYTES) {
        await this._indexd.persistBin(files.aidx);
        this.lastPersistAt = Date.now();
        this.dirtyPersist = false;
        try { await fs.unlink(deltaPath); } catch { /* persist_bin already removed */ }
      }
      this.debt.clear('space');
      return did || 1;
    } catch {
      this.debt.clear('space');
      return 0;
    }
  }

  beginBulk({ lean = false } = {}) {
    this._bulk = true;
    this._lean = !!lean;
    this._ftsCursor = 0;
    this._frnCursor = 0;
    this._ftsSnap = null;
  }

  /**
   * 结束 bulk：lean 时不建二级索引（记债）；非 lean 同步封口以兼容小树测试。
   */
  endBulk() {
    this._bulk = false;
    this.queryCache.clear();
    if (this._lean) {
      // native：FTS 债在 barrier 后由 ensureIndexed 根据 stats 决定
      if (this._backend === 'native') return;
      // 保留 walk 期已 owe/已付的 FTS 债；勿覆盖 drip meta
      if (this.fts.ok && this.fts.size() < this.meta.size) {
        this.debt.owe('fts', { mode: 'stream-drip' });
      }
      return;
    }
    for (const e of this.meta.values()) {
      const key = e.path.toLowerCase();
      this.byPath.insert(key, e);
      this.segments.upsert(e.path);
      this.linkChild(e.path);
      if (e.frn) this.frnMap.set(String(e.frn), e.path);
    }
  }

  _refreshFtsSnap() {
    this._ftsSnap = [...this.meta.values()];
  }

  /** Native backend: pull slices from indexd (never materialize full meta in V8). */
  async _payFtsDebtNative(budget) {
    if (!this.fts.ok || !this._indexd) {
      this.debt.clear('fts');
      return 0;
    }
    const ops = budget.ops || 400;
    if (!this.fts._inRebuild) {
      if (!this.fts.beginRebuild()) {
        this.debt.clear('fts');
        return 0;
      }
      this._ftsCursor = 0;
    }
    const res = await this._indexd.exportSlice(this._ftsCursor, ops);
    const items = res.items || [];
    for (const e of items) this.fts.insertFast(e);
    this._ftsCursor = res.cursor || (this._ftsCursor + items.length);
    if (!this._bulk && res.done) {
      this.fts.endRebuild();
      this.debt.clear('fts');
      this._ftsCursor = 0;
    }
    return items.length;
  }

  /** 同步 FTS 还债（数组游标，避免反复跳过 iterator） */
  _payFtsDebt(budget) {
    if (!this.fts.ok) {
      this.debt.clear('fts');
      return 0;
    }
    if (this.meta.size === 0) return 0;
    const ops = budget.ops || 400;
    if (!this.fts._inRebuild) {
      // bulk 扫描中只 begin 一次；禁止中途 end→再 begin 清空库
      if (!this.fts.beginRebuild()) {
        this.debt.clear('fts');
        return 0;
      }
      this._ftsCursor = 0;
      this._refreshFtsSnap();
    }
    // walk 中 meta 增长：刷新快照，游标不变（只追新尾部）
    if (!this._ftsSnap || this._ftsSnap.length < this.meta.size) {
      this._refreshFtsSnap();
    }
    const snap = this._ftsSnap;
    let n = 0;
    while (n < ops && this._ftsCursor < snap.length) {
      this.fts.insertFast(snap[this._ftsCursor++]);
      n += 1;
    }
    // 仅非 bulk（冷扫已结束）且追平 meta 时才封事务
    if (
      !this._bulk
      && snap.length > 0
      && this._ftsCursor >= snap.length
      && this._ftsCursor >= this.meta.size
    ) {
      this.fts.endRebuild();
      this.debt.clear('fts');
      this._ftsCursor = 0;
      this._ftsSnap = null;
    }
    return n;
  }

  /**
   * 谷期同步涓流一片 FTS，并记入 debt.paid
   * @returns {number}
   */
  dripFtsSync(ops) {
    // native：走盘期不做同步 FTS 涓流（需 async export_slice）；债清在 T2
    if (this._backend === 'native') return 0;
    if (!this.debt.isOwed('fts') || this.debt.paused || this.debt.paying) return 0;
    this.debt.paying = true;
    try {
      const n = this._payFtsDebt({ ops });
      const cur = this.debt.kinds.get('fts');
      if (cur) cur.paid += n;
      this.debt.totalPaid += n;
      return n;
    } finally {
      this.debt.paying = false;
    }
  }

  async _payFrnDebt(budget) {
    const ops = Math.min(budget.ops || 200, 500);
    const meta = this.debt.kinds.get('frn')?.meta || {};
    // USN miss 触发的 nudge：每轮少量即可，避免吞满盘
    const softCap = meta.nudge ? Math.min(ops, 64) : ops;
    let n = 0;
    let examined = 0;
    const start = this._frnCursor;
    let i = 0;
    for (const e of this.meta.values()) {
      if (i < start) {
        i += 1;
        continue;
      }
      i += 1;
      examined += 1;
      this._frnCursor = i;
      if (e.frn) continue;
      try {
        const st = await fs.stat(fsPath(e.path));
        if (st.ino == null) continue;
        e.frn = String(st.ino);
        this.frnMap.set(e.frn, e.path);
        n += 1;
        if (n >= softCap) break;
      } catch { /* */ }
      if (examined >= softCap * 8) break;
    }
    if (this._frnCursor >= this.meta.size) {
      this.debt.clear('frn');
      this._frnCursor = 0;
    } else if (meta.nudge && n > 0) {
      // nudge 还完本片就清，等下次 USN miss 再欠
      this.debt.clear('frn');
    }
    return n;
  }

  async _paySecondaryDebt(budget) {
    const ops = budget.ops || 400;
    let n = 0;
    for (const e of this.meta.values()) {
      if (this.byPath.size >= this.meta.size) break;
      if (n >= ops) break;
      const key = e.path.toLowerCase();
      this.byPath.insert(key, e);
      this.segments.upsert(e.path);
      this.linkChild(e.path);
      n += 1;
    }
    if (this.byPath.size >= this.meta.size) this.debt.clear('secondary');
    return n;
  }

  async _payPersistDebt() {
    try {
      if (this._backend === 'native' && this._indexd) {
        const files = getIndexFilePaths(this.root);
        await this._indexd.barrier();
        // Prefer compact binary snapshot; keep ndjson only as optional compat
        await this._indexd.persistBin(files.aidx);
        const st = await this._indexd.stats();
        const meta = {
          version: 3,
          root: String(this.root).replace(/\\+$/, '') + '\\',
          savedAt: Date.now(),
          scanned: st.count || this.scanned,
          size: st.count || this.scanned,
          usn: this.usn || null,
          dirMtimes: Object.fromEntries(this.dirMtimes),
          deltaLines: 0,
          backend: 'native',
          snapshot: 'aidx',
        };
        await fs.mkdir(files.dir, { recursive: true });
        await fs.writeFile(files.meta, JSON.stringify(meta), 'utf8');
        try { await fs.writeFile(files.delta, '', 'utf8'); } catch { /* */ }
      } else {
        await saveIndexDisk(this.root, {
          entries: [...this.meta.values()],
          scanned: this.scanned,
          usn: this.usn,
          dirMtimes: Object.fromEntries(this.dirMtimes),
        });
      }
      this.lastPersistAt = Date.now();
      this.dirtyPersist = false;
      this.pendingOps = [];
    } catch { /* */ }
    this.debt.clear('persist');
    return 1;
  }

  clearStructures() {
    this.debt.stopSchedule();
    this.debt = new IndexDebt();
    this._wireDebtPayer();
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
    this._lean = false;
    this._ftsCursor = 0;
    this._frnCursor = 0;
    this._ftsSnap = null;
    this._namePool = new Map();
    // native clear is awaited by enableNative({ clear: true }) on next full build
    this._nativeCount = 0;
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
    const key = this._canonEntryPath(entry);
    if (entry.name) entry.name = this._internName(entry.name);
    if (entry.kind === 'file') delete entry.kind;

    if (this._backend === 'native' && this._indexd) {
      this._indexd.upsertSilent(entry);
      this.dirtyPersist = true;
      if (this._bulk) return;
      this.fts.upsert(entry);
      this.queryCache.clear();
      this.pendingOps.push({ op: 'upsert', e: entry });
      return;
    }

    const prev = this.meta.get(key);
    const useByName = this._useByName();
    if (prev) {
      if (useByName) this.byName.remove(nameKey(prev.name, prev.path));
      if (!this._lean && !this._bulk) {
        this.byPath.remove(prev.path.toLowerCase());
        this.segments.remove(prev.path);
        this.unlinkChild(prev.path);
      }
      if (prev.frn) this.frnMap.delete(String(prev.frn));
      if (!this._bulk) this.fts.remove(prev.path);
    }
    this.meta.set(key, entry);
    if (useByName) this.byName.insert(nameKey(entry.name, entry.path), entry);
    this.dirtyPersist = true;
    if (this._bulk) return;
    if (!this._lean) {
      this.byPath.insert(key, entry);
      this.segments.upsert(entry.path);
      this.linkChild(entry.path);
    }
    if (entry.frn) this.frnMap.set(String(entry.frn), entry.path);
    this.fts.upsert(entry);
    this.queryCache.clear();
    this.pendingOps.push({ op: 'upsert', e: entry });
  }

  remove(absPath) {
    const key = String(absPath).toLowerCase();
    if (this._backend === 'native' && this._indexd) {
      void this._indexd.remove(key);
      this.fts.remove(absPath);
      this.queryCache.clear();
      this.dirtyPersist = true;
      this.pendingOps.push({ op: 'del', p: absPath });
      return;
    }
    const prev = this.meta.get(key);
    if (!prev) return;
    if (this._useByName()) this.byName.remove(nameKey(prev.name, prev.path));
    if (!this._lean) {
      this.byPath.remove(key);
      this.segments.remove(prev.path);
      this.unlinkChild(prev.path);
    }
    if (prev.frn) this.frnMap.delete(String(prev.frn));
    this.fts.remove(prev.path);
    this.meta.delete(key);
    this.queryCache.clear();
    this.dirtyPersist = true;
    this.pendingOps.push({ op: 'del', p: prev.path });
  }

  removeTree(absPath) {
    const key = absPath.toLowerCase().replace(/\\+$/, '');
    if (this._backend === 'native' && this._indexd) {
      void this._indexd.removePrefix(key);
      this.queryCache.clear();
      this.dirtyPersist = true;
      return;
    }
    const kids = this.children.get(key);
    if (kids && kids.size) {
      for (const child of [...kids]) this.removeTree(child);
      this.remove(absPath);
      return;
    }
    if (this._lean || this.children.size === 0) {
      const prefix = `${key}\\`;
      const toRemove = [];
      for (const [k, e] of this.meta) {
        if (k === key || k.startsWith(prefix)) toRemove.push(e.path);
      }
      for (const p of toRemove) this.remove(p);
      return;
    }
    this.remove(absPath);
  }

  hydrate(entries) {
    for (const e of entries) {
      if (!e?.path || !e?.name) continue;
      const key = this._canonEntryPath(e);
      e.name = this._internName(e.name);
      if (e.kind === 'file') delete e.kind;
      if (this._backend === 'native' && this._indexd) {
        this._indexd.upsertSilent(e);
        continue;
      }
      this.meta.set(key, e);
      if (this._useByName()) this.byName.insert(nameKey(e.name, e.path), e);
      this.byPath.insert(key, e);
      this.segments.upsert(e.path);
      this.linkChild(e.path);
      if (e.frn) this.frnMap.set(String(e.frn), e.path);
    }
    if (this._backend === 'native' && this._indexd) {
      this._indexd.flushBatchSync();
      // scanned refreshed by caller via barrier/stats
      this.dirtyPersist = false;
      return;
    }
    this.scanned = this.meta.size;
    this.dirtyPersist = false;
    if (this.fts.ok && entries.length) {
      this.fts.rebuild(entries);
    }
  }

  /** Hydrate from disk inside indexd (binary .aidx preferred; NDJSON fallback). */
  async hydrateNativeFromDisk() {
    if (!(await this.enableNative())) return false;
    const files = getIndexFilePaths(this.root);
    let res = null;
    let fromNdjson = false;

    const ndjsonBytes = (() => {
      try { return fssync.statSync(files.data).size; } catch { return 0; }
    })();
    const aidxBytes = (() => {
      try { return fssync.statSync(files.aidx).size; } catch { return 0; }
    })();

    // 损坏/空壳 .aidx（例如仅百字节）若仍优先加载，会导致 ready 但几乎 0 条 → 深搜整卷 walk
    const aidxTooSmall = aidxBytes > 0 && aidxBytes < 4096 && ndjsonBytes > 1_000_000;

    if (aidxBytes > 0 && !aidxTooSmall) {
      try {
        res = await this._indexd.hydrateBin(files.aidx);
        try {
          await this._indexd.hydrateDelta(files.aidx);
        } catch { /* no binary delta */ }
        this.debt.owe('space', { reason: 'hydrate' });
      } catch {
        res = null;
      }
    }

    let countGuess = Number(res?.hydrated) || 0;
    try {
      const st0 = await this._indexd.stats();
      countGuess = Math.max(countGuess, Number(st0.count) || 0);
    } catch { /* */ }

    // aidx 加载后条目极少，但磁盘有大 NDJSON → 回退 NDJSON 并重写 aidx
    const needNdjson = !res
      || aidxTooSmall
      || (ndjsonBytes > 1_000_000 && countGuess < 500);

    if (needNdjson && ndjsonBytes > 0) {
      try {
        if (countGuess > 0 || res) {
          try { await this._indexd.clear(); } catch { /* */ }
        }
        res = await this._indexd.hydrateNdjson(files.data);
        fromNdjson = true;
      } catch {
        if (!res) return false;
      }
    } else if (!res) {
      return false;
    }

    // Apply NDJSON delta ops if any (stream lines; do not keep full array)
    try {
      const deltaText = await fs.readFile(files.delta, 'utf8');
      for (const line of deltaText.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let op;
        try { op = JSON.parse(line); } catch { continue; }
        if (op.op === 'del' && op.p) await this._indexd.remove(op.p);
        else if (op.op === 'upsert' && op.e) this._indexd.upsertSilent(op.e);
        else if (op.path && op.name) this._indexd.upsertSilent(op);
      }
      this._indexd.flushBatchSync();
      await this._indexd.barrier();
    } catch { /* no delta */ }

    const st = await this._indexd.stats();
    this._nativeCount = st.count || res?.hydrated || 0;
    this.scanned = this._nativeCount;
    this.dirtyPersist = false;
    this.ready = true;

    // 仅在从 NDJSON 恢复且条目足够时重写 aidx，避免把空壳写回磁盘
    if (fromNdjson && this._nativeCount >= 500) {
      try {
        await this._indexd.persistBin(files.aidx);
        await fs.writeFile(files.delta, '');
      } catch { /* best-effort */ }
    }
    return this._nativeCount > 0;
  }

  markDirtyDir(dir) {
    if (dir) this.dirtyDirs.add(String(dir).toLowerCase());
  }

  async query(q, opts = {}) {
    const limit = Math.min(opts.maxResults || 400, 2000);
    const needle = String(q || '').trim().toLowerCase();
    if (!needle) return { items: [], truncated: false, scanned: this.scanned, source: 'index' };

    this.debt.pauseForQuery();
    try {
      if (this._backend === 'native' && this._indexd) {
        return await this._queryNative(needle, limit, opts);
      }
      return this._queryInner(q, opts, needle, limit);
    } finally {
      this.debt.resumeAfterQuery();
    }
  }

  async _queryNative(needle, limit, opts = {}) {
    const cjk = /[\u3400-\u9fff\uf900-\ufaff]/.test(needle);
    const preferContains = !!opts.preferContains || cjk || [...needle].length <= 2;
    const cacheKey = `n|${needle}|${limit}|${preferContains ? 'c' : 'p'}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached) {
      return { items: cached.items, truncated: cached.truncated, source: cached.source, scanned: this.scanned, cached: true };
    }
    const seen = new Set();
    const items = [];
    const pushItem = (value) => {
      if (!value?.path || seen.has(value.path)) return false;
      seen.add(value.path);
      items.push(value);
      return items.length >= limit;
    };

    // indexd handles multi-token AND + prefix/contains. Optional FTS only when enabled.
    const multi = /\s/.test(needle);
    if (multi && !cjk && this.fts.ok && this.fts.size() > 0) {
      for (const row of this.fts.search(needle, limit)) {
        if (pushItem({ path: row.path, name: row.name || '' })) {
          return finish(this, cacheKey, items, true, 'index-fts-native');
        }
      }
    }
    if (items.length < limit) {
      const pathish = needle.includes('\\') || needle.includes('/');
      const want = limit - items.length;
      const mode = pathish || multi || preferContains ? 'contains' : 'prefix';
      let res = await this._indexd.query(needle, { limit: want, mode });
      if (!(res.items || []).length && mode === 'prefix') {
        res = await this._indexd.query(needle, { limit: want, mode: 'contains' });
      }
      for (const it of res.items || []) {
        if (pushItem(it)) break;
      }
    }
    return finish(this, cacheKey, items.slice(0, limit), items.length >= limit, 'index-native');
  }

  _queryInner(q, opts, needle, limit) {
    const cjk = /[\u3400-\u9fff\uf900-\ufaff]/.test(needle);
    const cacheKey = `${needle}|${limit}|${cjk ? 'cjk' : 'a'}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached) {
      return { items: cached.items, truncated: cached.truncated, source: cached.source, scanned: this.scanned, cached: true };
    }

    const seen = new Set();
    const items = [];

    // FTS 优先（大库 / lean / 多词 / 已有 FTS 数据）；CJK 单字/词跳过 FTS（unicode61 易漏）
    if (!cjk && this.fts.ok && (
      this._lean
      || this.meta.size > 20_000
      || needle.includes(' ')
      || opts.preferFts
      || this.fts.size() > 0
    )) {
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

/** 64-bit 风格 path 指纹，避免 byName 键复制整段绝对路径（百万级省堆） */
function pathTag(p) {
  let h1 = 2166136261 >>> 0;
  let h2 = 0x811c9dc5 >>> 0;
  for (let i = 0; i < p.length; i++) {
    const c = p.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000193) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

function nameKey(name, absPath) {
  return `${name.toLowerCase()}\0${pathTag(String(absPath).toLowerCase())}`;
}

function entryFromStat(full, name, st) {
  const entry = { path: full, name };
  if (st.isDirectory()) entry.kind = 'folder';
  else if (st.size) entry.size = st.size;
  if (st.mtimeMs) entry.modifiedAt = st.mtimeMs;
  if (st.ino != null) entry.frn = String(st.ino);
  return entry;
}

function entryKind(e) {
  return e?.kind === 'folder' ? 'folder' : 'file';
}

/** 粗估堆占用（调试/压测相位）；path 与 Map 键已共享时不再双计 */
export function estimateIndexBytes(idx) {
  if (idx._backend === 'native') {
    const n = idx.entryCount();
    return {
      entries: n,
      pathChars: 0,
      nameChars: 0,
      uniqueNames: 0,
      byNameSize: 0,
      namePoolSize: 0,
      backend: 'native',
      // V8-side residual only (FTS sidecar not counted here)
      approx_mb: Math.round(((idx.meta.size * 120) / (1024 * 1024)) * 10) / 10,
    };
  }
  let pathChars = 0;
  let nameChars = 0;
  let uniqueNames = 0;
  let n = 0;
  const seenName = new Set();
  for (const e of idx.meta.values()) {
    n += 1;
    pathChars += (e.path?.length || 0);
    const nm = e.name || '';
    if (!seenName.has(nm)) {
      seenName.add(nm);
      nameChars += nm.length;
      uniqueNames += 1;
    }
  }
  const strBytes = (pathChars + nameChars) * 2;
  const byNameN = idx.byName?.size || 0;
  // Map 条目 ~72；entry 对象 ~48；byName 节点+键 ~120（若启用）
  const structural = n * 120 + byNameN * 120 + (idx._namePool?.size || 0) * 24;
  return {
    entries: n,
    pathChars,
    nameChars,
    uniqueNames,
    byNameSize: byNameN,
    namePoolSize: idx._namePool?.size || 0,
    backend: 'js',
    approx_mb: Math.round(((strBytes + structural) / (1024 * 1024)) * 10) / 10,
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
  // 已挂活跟随则跳过：避免每次 ensureIndex/进夹重复 probe USN + 重启轮询
  if (idx._liveAttached) return;
  idx._liveAttached = true;

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
  // 3s：降低与 UI 进夹争主线程；有脏目录/USN 前进仍会 softRefresh
  startUsnPoll(root, (live, delta) => {
    idx.usn = live;
    noteUsnCursor(root, live);
    if (delta < 0) {
      idx._liveAttached = false;
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
  }, 3000);
}

/**
 * 忙盘优化：ReadUsn(FRN) + 只刷 watch 脏目录，绝不整卷 mtime 扫。
 */
export async function softRefresh(root) {
  const idx = getIndex(root);
  if (!idx.ready || idx.building || idx.refreshing || idx._disposed) return idx;
  const now = Date.now();
  // 进夹高峰时拉长 debounce，避免与 listDir 抢主线程
  if (idx.lastSoftRefreshAt && now - idx.lastSoftRefreshAt < 2_400) return idx;
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
      const elevated = process.argv.includes('--elevated')
        || process.env.AURORA_ELEVATED === '1';
      const usnMax = elevated ? 16_000 : 8_000;
      records = await readUsnRecords(root, startUsn, usnMax);
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

    // Persist off the refresh critical path (debounced)
    schedulePersist(root);
    if (idx._backend === 'native' && idx.dirtyPersist) {
      idx.debt.owe('space', { reason: 'usn' });
      if (idx.debt.depth() > 0 && !idx.building) {
        idx.debt.schedule({
          intervalMs: 48,
          budgetMs: 8,
          budgetOps: 2_000,
          aborted: () => idx._disposed || idx.building,
        });
      }
    }
  } finally {
    idx.refreshing = false;
  }
  return idx;
}

async function resolveFrnPath(idx, frn) {
  if (!frn) return null;
  if (idx._backend === 'native' && idx._indexd) {
    try {
      const got = await idx._indexd.resolveFrn(frn);
      return got?.item?.path || null;
    } catch {
      return null;
    }
  }
  return idx.frnMap.get(String(frn)) || null;
}

async function applyUsnRecords(idx, records) {
  let hits = 0;
  let missParent = 0;
  const native = idx._backend === 'native' && idx._indexd;
  for (const r of records) {
    if (!r?.frn) continue;
    if (usnIsDelete(r.reason)) {
      if (native) {
        try {
          await idx._indexd.removeFrn(r.frn);
          hits += 1;
        } catch { /* */ }
      } else {
        const p = await resolveFrnPath(idx, r.frn);
        if (p) {
          idx.removeTree(p);
          hits += 1;
        }
      }
      idx.frnMap.delete(r.frn);
      continue;
    }
    // Native fast path: FRN-link upsert without stat (Everything-style journal apply)
    if (native && r.name && r.parentFrn) {
      idx._indexd.upsertNodeSilent({
        name: r.name,
        frn: r.frn,
        parent: r.parentFrn,
      });
      hits += 1;
      continue;
    }
    const parent = await resolveFrnPath(idx, r.parentFrn);
    if (!parent || !r.name) {
      missParent += 1;
      // 懒补齐：欠一点 FRN 债（有预算），提高后续 parentFrn 命中
      if (idx._lean) idx.debt.owe('frn', { mode: 'usn-miss', nudge: true });
      if (parent) idx.markDirtyDir(parent);
      continue;
    }
    const full = path.join(parent, r.name);
    try {
      const st = await fs.stat(fsPath(full));
      const entry = entryFromStat(full, r.name, st);
      idx.upsert(entry);
      if (entry.frn) idx.frnMap.set(String(entry.frn), entry.path);
      hits += 1;
    } catch {
      const old = await resolveFrnPath(idx, r.frn);
      if (old) {
        idx.removeTree(old);
        hits += 1;
      }
    }
  }
  if (native) {
    try {
      await idx._indexd.barrier();
      const st = await idx._indexd.stats();
      idx._nativeCount = st.count || idx._nativeCount;
    } catch { /* */ }
    idx.dirtyPersist = true;
  }
  if (missParent && idx._lean) idx.debt.owe('frn', { mode: 'usn-miss' });
  return hits;
}

async function walkDeltaLimited(idx, dir, depth, maxDepth, gen, maxScan) {
  if (gen !== idx.generation) return;
  if (idx.entryCount() >= maxScan) return;
  const skipSet = effectiveSkipSet();
  let stDir;
  try {
    stDir = await fs.stat(dir);
  } catch {
    return;
  }
  const key = dir.toLowerCase();
  idx.dirMtimes.set(key, stDir.mtimeMs);

  const seen = new Set();
  let ents;
  try {
    ents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of ents) {
    if (gen !== idx.generation) return;
    const name = ent.name;
    if (skipSet.has(String(name).toLowerCase())) continue;
    if (isReparseOrLink(ent)) continue;
    const full = path.join(dir, name);
    seen.add(full.toLowerCase());
    let st;
    try {
      st = await fs.lstat(full);
    } catch {
      continue;
    }
    if (isReparseOrLink(st)) continue;
    const entry = entryFromStat(full, name, st);
    let old = idx.meta.get(full.toLowerCase());
    if (!old && idx._backend === 'native' && idx._indexd) {
      try {
        const got = await idx._indexd.get(full.toLowerCase());
        old = got?.item || null;
      } catch { /* */ }
    }
    if (
      !old
      || (old.modifiedAt || 0) !== (entry.modifiedAt || 0)
      || (old.size || 0) !== (entry.size || 0)
      || entryKind(old) !== entryKind(entry)
    ) {
      idx.upsert(entry);
    } else if (entry.frn && !old.frn) {
      old.frn = entry.frn;
      idx.frnMap.set(entry.frn, old.path);
      if (idx._backend === 'native') idx.upsert(old);
    }
    idx.scanned += 1;
    if (st.isDirectory() && !st.isSymbolicLink() && depth < maxDepth) {
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
  const prefs = getIndexPrefsSync();
  opts = applyIndexTrack(opts, prefs);
  const idx = getIndex(root);
  idx.indexTrack = opts.track;
  if (idx.ready && !opts.rebuild && !opts.refresh) {
    // 已就绪：仅确保活跟随挂过一次，不再做重活
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
  /** @type {'builtin'|'minimal'|'none'} */
  const skipMode = opts.skipMode || 'builtin';
  const skipSet = effectiveSkipSet(getIndexPrefsSync(), skipMode);
  const skipDir = (name) => skipSet.has(String(name).toLowerCase());
  /** 高压：跟随联接但用 realpath 去重，覆盖隐藏项与整卷 */
  const followReparse = opts.followReparse === true;

  try {
    let mode = 'full';
    let hydratedFromDisk = false;

    // Decide native backend early (volume lean + binary)
    const wantNative = (() => {
      const env = process.env.AURORA_INDEX_BACKEND || opts.indexBackend;
      if (env === 'js') return false;
      if (env === 'native') return !!resolveIndexdBin();
      // default: native when volume root + lean path + bin present
      return isVolumeRoot(root) && !!resolveIndexdBin() && opts.indexBackend !== 'js';
    })();

    if (!opts.rebuild && !idx.ready) {
      if (wantNative) {
        const diskStat = diskCacheStat(root);
        if (diskStat.exists && (diskStat.size > 0 || diskStat.baseBytes > 0 || diskStat.aidxBytes > 0)) {
          idx.clearStructures();
          const ok = await idx.hydrateNativeFromDisk();
          if (ok) {
            try {
              const metaRaw = await fs.readFile(getIndexFilePaths(root).meta, 'utf8');
              const meta = JSON.parse(metaRaw);
              idx.usn = meta.usn || null;
              idx.lastUsnApplied = Number(meta.usn?.nextUsn) || 0;
              if (meta.dirMtimes) {
                for (const [d, t] of Object.entries(meta.dirMtimes)) idx.dirMtimes.set(d, t);
              }
              idx.lastPersistAt = meta.savedAt || 0;
            } catch { /* */ }
            idx.source = 'disk-native';
            hydratedFromDisk = true;
            const wantNativeFts = opts.nativeFts === true || process.env.AURORA_INDEXD_FTS === '1';
            if (
              wantNativeFts
              && idx.fts.ok
              && idx.fts.size() < idx.entryCount()
            ) {
              const hydrateGen = idx.generation;
              idx.debt.owe('fts', { mode: 'hydrate' });
              idx.debt.schedule({
                intervalMs: 12,
                budgetMs: 16,
                budgetOps: 2_000,
                aborted: () => idx.generation !== hydrateGen || idx._disposed,
              });
            }
          }
        }
      } else {
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
          hydratedFromDisk = true;
        }
      }
    }

    const liveUsn = await queryUsnJournal(root);
    const decision = usnNeedsRebuild(idx.usn, liveUsn);

    if (opts.rebuild || decision.rebuild) {
      idx.clearStructures();
      idx.ready = false;
      idx.source = decision.rebuild ? `rebuild:${decision.reason}` : 'rebuild:forced';
      mode = 'full';
      hydratedFromDisk = false;
    } else if (
      hydratedFromDisk
      && opts.hydrateFirst !== false
      && opts.forceWalk !== true
    ) {
      // 创新：二次打开 hydrate 优先可搜，异步 softRefresh 追赶（非整卷 mtime）
      idx.source = 'disk-hydrate-first';
      if (typeof opts.onPhase === 'function') {
        const mu = process.memoryUsage();
        opts.onPhase('T1_hydrate_searchable', {
          rss_mb: Math.round((mu.rss / (1024 * 1024)) * 10) / 10,
          heap_mb: Math.round((mu.heapUsed / (1024 * 1024)) * 10) / 10,
          size: idx.entryCount(),
          debt: idx.debt.snapshot(),
          backend: idx._backend,
        });
      }
      if (opts.liveFollowers !== false) {
        attachLiveFollowers(root);
        if (liveUsn) noteUsnCursor(root, liveUsn);
      }
      // softRefresh 拒绝 building 中调用；先释放再建异步追赶
      idx.building = false;
      if (idx.debt.isOwed('space')) {
        idx.debt.schedule({
          intervalMs: 48,
          budgetMs: 8,
          budgetOps: 2_000,
          aborted: () => idx._disposed || idx.building,
        });
      }
      const refreshP = softRefresh(root);
      if (opts.waitRefresh === true) await refreshP;
      else void refreshP.catch(() => {});
      return idx;
    } else if (idx.ready && (decision.useMtimeDelta || idx.source === 'disk')) {
      // 冷启动追赶：仍可整卷 mtime 一次；之后靠 USN+脏目录
      mode = 'mtime-delta';
      idx.source = 'usn-mtime-delta';
    }

    const deadline = Number(opts.deadlineMs) > 0 ? Date.now() + Number(opts.deadlineMs) : 0;
    const lean = opts.leanMemory === true
      || (opts.leanMemory !== false && (skipMode === 'minimal' || followReparse || isVolumeRoot(root)));
    const noPersist = opts.persist === false;
    const waitDebt = opts.waitDebt === true;
    /** Persist is async by default; set waitPersist to block T1→ready on disk write */
    const waitPersist = opts.waitPersist === true;
    const phases = typeof opts.onPhase === 'function' ? opts.onPhase : null;
    if (wantNative && mode === 'full') {
      const ok = await idx.enableNative({ clear: true });
      if (!ok) {
        // missing binary / spawn fail → js degraded
        idx._backend = 'js';
        idx._indexd = null;
      }
    }
    const memSnap = () => {
      const mu = process.memoryUsage();
      return {
        rss_mb: Math.round((mu.rss / (1024 * 1024)) * 10) / 10,
        heap_mb: Math.round((mu.heapUsed / (1024 * 1024)) * 10) / 10,
        size: idx.entryCount(),
        debt: idx.debt.snapshot(),
        backend: idx._backend,
      };
    };

    async function walkDelta(dir, depth) {
      await walkDeltaLimited(idx, dir, depth, maxDepth, gen, maxScan);
    }

    let timedOut = false;
    let t1DripPaid = 0;
    if (mode === 'full') {
      idx.scanned = 0;
      idx.beginBulk({ lean });
      const maxPerf = opts.maxPerf === true;
      /** 谷期涓流：由 indexTrack 决定（ui=关，perf=开）；显式 opts 可覆盖 */
      // native：默认不建 FTS（indexd 覆盖前缀/子串；多词在 query 侧过滤）→ 大幅压 Node RSS
      const wantNativeFts = opts.nativeFts === true || process.env.AURORA_INDEXD_FTS === '1';
      const dripWalk = lean
        && opts.dripFtsDuringWalk === true
        && idx.fts.ok
        && (idx._backend !== 'native' || wantNativeFts);
      const dripBelow = Number(opts.dripBelowRate) > 0 ? Number(opts.dripBelowRate) : 50_000;
      const dripOps = Number(opts.dripOps) > 0 ? Number(opts.dripOps) : 800;
      let rateWindow = { at: Date.now(), scanned: 0 };
      let lastRate = Infinity;
      let lastIdleDripAt = 0;
      const tryDrip = (reason) => {
        if (!dripWalk || !idx.debt.isOwed('fts') || idx.debt.paused) return 0;
        // 调用方已判定空窗；此处只做 ops 自适应
        let mult = 1;
        if (Number.isFinite(lastRate)) {
          if (lastRate < 22_000) mult = 3;
          else if (lastRate < 35_000) mult = 2;
        }
        if (reason === 'idle') mult = Math.max(mult, 1);
        const cap = maxPerf ? Math.min(dripOps * mult, 6_000) : Math.min(dripOps * mult, 2_400);
        const paid = idx.dripFtsSync(cap);
        if (paid) {
          t1DripPaid += paid;
          if (typeof opts.onDrip === 'function') {
            opts.onDrip({ paid, rate: lastRate, reason, totalDrip: t1DripPaid });
          }
        }
        return paid;
      };
      if (dripWalk) {
        idx.debt.owe('fts', { mode: 'stream-drip' });
      }
      const walkEngine = resolveWalkEngine(root, {
        engine: opts.walkEngine || opts.engine,
        leanMemory: lean,
      });
      idx.walkEngine = walkEngine;
      try {
        const walkStats = await walkVolume(root, {
          maxDepth,
          maxScan,
          deadlineMs: opts.deadlineMs,
          skipDir,
          followReparse,
          concurrency: opts.concurrency,
          maxPerf,
          interactive: opts.interactive === true,
          track: opts.track,
          yieldEvery: opts.yieldEvery,
          progressMs: opts.progressMs,
          engine: walkEngine,
          aborted: () => gen !== idx.generation,
          onIdle: () => {
            const now = Date.now();
            if (now - lastIdleDripAt < 8) return;
            lastIdleDripAt = now;
            // 仅当近期速率已落入谷，或尚无速率样本时，用 idle 空窗还债
            if (!Number.isFinite(lastRate) || lastRate < dripBelow) tryDrip('idle');
          },
          onProgress: (p) => {
            idx.scanned = p.scanned;
            if (dripWalk && idx.debt.isOwed('fts') && !idx.debt.paused) {
              const now = Date.now();
              const dt = (now - rateWindow.at) / 1000;
              if (dt >= 0.25) {
                lastRate = (p.scanned - rateWindow.scanned) / Math.max(dt, 0.001);
                rateWindow = { at: now, scanned: p.scanned };
                if (lastRate < dripBelow) tryDrip('valley');
              }
            }
            if (typeof opts.onProgress === 'function') {
              opts.onProgress({
                scanned: p.scanned,
                size: idx.entryCount() || idx.meta.size,
                queued: p.queued,
                debt: idx.debt.snapshot(),
                t1_drip_paid: t1DripPaid,
                walkEngine,
                backend: idx._backend,
              });
            }
          },
          onEntry: (entry) => {
            idx.upsert(entry);
          },
          // rust/mft → indexd: skip JSON.parse × N (Node RSS)
          // mft stream-nodes: FRN-link (no path strings); rust still sends full paths
          ...(idx._backend === 'native' && idx._indexd
            ? (() => {
                const buf = [];
                let bytes = 0;
                let nodeMode = walkEngine === 'mft';
                // Smaller chunks → shorter-lived stdin bodies → lower Node RSS after T1
                const maxLines = nodeMode ? 600 : 800;
                const maxBytes = nodeMode ? 96_000 : 160_000;
                const flush = () => {
                  if (!buf.length) return;
                  const chunk = buf.splice(0, buf.length);
                  bytes = 0;
                  if (nodeMode) idx._indexd.upsertRawNodeLines(chunk);
                  else idx._indexd.upsertRawLines(chunk);
                };
                idx._flushNativeRaw = flush;
                return {
                  onStreamMeta: (meta) => {
                    if (meta?.fmt === 'frn' || meta?.root_frn != null) {
                      nodeMode = true;
                      const driveCh = String(meta.drive || root).replace(/[^A-Za-z]/g, '').slice(0, 1);
                      if (driveCh) {
                        idx._indexd.ensureRootSilent(`${driveCh}:`, meta.root_frn);
                      }
                    }
                  },
                  onRawLine: (line) => {
                    buf.push(line);
                    bytes += line.length;
                    if (buf.length >= maxLines || bytes >= maxBytes) flush();
                  },
                };
              })()
            : {}),
        });
        if (typeof idx._flushNativeRaw === 'function') {
          try { idx._flushNativeRaw(); } catch { /* */ }
          idx._flushNativeRaw = null;
        }
        if (idx._backend === 'native' && idx._indexd) {
          await idx._indexd.barrier();
          const st = await idx._indexd.stats();
          idx._nativeCount = st.count || 0;
          idx.scanned = Math.max(idx.scanned, idx._nativeCount, walkStats.scanned);
          // Space debt: path index / shrink / compact off T1 critical path
          idx.debt.owe('space', { reason: 'post-build' });
          // Drop walk buffers; aggressive GC so Node RSS settles ≤90 after searchable
          idx._flushNativeRaw = null;
          try { idx._indexd.releaseWalkBuffers?.(); } catch { /* */ }
          if (typeof global.gc === 'function') {
            try { global.gc(); } catch { /* */ }
            await new Promise((r) => setImmediate(r));
            try { global.gc(); } catch { /* */ }
          }
        } else {
          idx.scanned = Math.max(idx.scanned, idx.meta.size, walkStats.scanned);
        }
        timedOut = !!(walkStats.timedOut || (deadline && Date.now() > deadline && idx.scanned < maxScan));
        const engTag = walkStats.engine === 'mft'
          ? '-mft'
          : (walkStats.engine === 'rust' ? '-rust' : '');
        const backendTag = idx._backend === 'native' ? '-indexd' : '';
        idx.source = timedOut
          ? 'full-scan-timeout'
          : (lean
            ? (followReparse ? `full-scan-lean-hp${engTag}${backendTag}` : `full-scan-lean${engTag}${backendTag}`)
            : (followReparse ? `full-scan-parallel-hp${engTag}` : `full-scan-parallel${engTag}`));
      } finally {
        idx.endBulk();
      }
      if (phases) {
        phases('T1_walk_searchable', { ...memSnap(), t1_drip_paid: t1DripPaid });
      }

      // 非 lean：同步 FTS；lean：若谷期未还完则继续欠债（勿在已建满时重新 owe→wipe）
      // native 默认跳过 FTS（除非 nativeFts / AURORA_INDEXD_FTS）
      if (idx._backend === 'native' && !wantNativeFts) {
        idx.debt.clear('fts');
      } else if (idx.fts.ok && !lean) {
        if (idx._backend === 'native' && idx._indexd) {
          idx.debt.owe('fts', { mode: 'stream' });
        } else {
          idx.fts.rebuild([...idx.meta.values()]);
        }
      } else if (idx.fts.ok && lean) {
        const ftsN = idx.fts.size();
        if (ftsN < idx.entryCount()) {
          idx.debt.owe('fts', { mode: dripWalk ? 'stream-drip' : 'stream' });
        }
      }

      if (lean && !noPersist) idx.debt.owe('persist');
      // FRN 全量 stat 极贵：默认不欠全量债；USN miss / opts.frnDebt 才记债
      if (lean && (opts.frnDebt === true || opts.frnDebt === 'sync')) {
        idx.debt.owe('frn', { mode: 'backfill' });
      }

      // lean 功能债 + native space 债：可搜后错峰（space 不进 waitDebt）
      if ((lean || idx.debt.isOwed('space')) && idx.debt.depth() > 0) {
        if (waitDebt) {
          // 可搜关键路径：只等 FTS；persist 默认异步（压总时间）；永不阻塞 space
          while (
            gen === idx.generation
            && (idx.debt.isOwed('fts') || (waitPersist && idx.debt.isOwed('persist')))
          ) {
            await idx.debt.paySlice({
              ms: Number(opts.debtMs) > 0 ? Number(opts.debtMs) : (maxPerf ? 32 : 16),
              ops: opts.debtOps || (maxPerf ? 10_000 : 2_000),
            });
            if (phases) phases('T2_debt_slice', memSnap());
            await new Promise((r) => setImmediate(r));
          }
          if (phases) phases('T3_debt_cleared', memSnap());
          if (idx.debt.isOwed('frn') && opts.frnDebt === 'sync') {
            while (gen === idx.generation && idx.debt.isOwed('frn')) {
              await idx.debt.paySlice({ ms: 16, ops: 200 });
              await new Promise((r) => setImmediate(r));
            }
          }
          if (idx.debt.depth() > 0) {
            idx.debt.schedule({
              intervalMs: maxPerf ? 16 : 40,
              budgetMs: maxPerf ? 12 : 8,
              budgetOps: opts.debtOps || (maxPerf ? 4_000 : 2_000),
              aborted: () => gen !== idx.generation,
              onDone: () => {
                if (phases) phases('T4_persist_async', memSnap());
              },
            });
          }
        } else {
          idx.debt.schedule({
            intervalMs: maxPerf ? 8 : 40,
            budgetMs: maxPerf ? 12 : 8,
            budgetOps: opts.debtOps || (maxPerf ? 4_000 : 2_000),
            aborted: () => gen !== idx.generation,
            onDone: () => {
              if (phases) phases('T3_debt_cleared', memSnap());
            },
          });
        }
      }
    } else {
      await walkDelta(root, 0);
    }

    if (gen === idx.generation) {
      idx.ready = true;
      if (liveUsn) {
        idx.usn = liveUsn;
        idx.lastUsnApplied = liveUsn.nextUsn;
      }
      if (mode === 'full') {
        if (timedOut) idx.source = 'full-scan-timeout';
        else if (!String(idx.source || '').startsWith('full-scan')) {
          idx.source = lean
            ? (followReparse ? 'full-scan-lean-hp' : 'full-scan-lean')
            : (followReparse ? 'full-scan-parallel-hp' : 'full-scan-parallel');
        }
      } else {
        idx.source = 'usn-mtime-delta';
      }

      try {
        if (noPersist) {
          idx.pendingOps = [];
          idx.dirtyPersist = false;
        } else if (!lean && (mode === 'full' || !idx.lastPersistAt)) {
          idx.pendingOps = [];
          await saveIndexDisk(root, {
            entries: [...idx.meta.values()],
            scanned: idx.scanned,
            usn: idx.usn,
            dirMtimes: Object.fromEntries(idx.dirMtimes),
          });
          idx.lastPersistAt = Date.now();
          idx.dirtyPersist = false;
          if (phases) phases('T4_persist', memSnap());
        } else if (!lean) {
          await flushIndexDisk(root);
        }
        // lean + persist 债：由 paySlice / schedule 错峰写
      } catch { /* */ }
      if (opts.liveFollowers !== false) {
        attachLiveFollowers(root);
        if (liveUsn) noteUsnCursor(root, liveUsn);
      }
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

  // Native: never rewrite NDJSON from empty V8 meta — indexd owns the base file.
  if (idx._backend === 'native' && idx._indexd) {
    const ops = idx.pendingOps.splice(0, idx.pendingOps.length);
    const dirObj = Object.fromEntries(idx.dirMtimes);
    if (!forceCompact && idx.lastPersistAt) {
      // Prefer indexd binary delta (USN-sized); fall back to NDJSON sidecar
      try {
        const files = getIndexFilePaths(root);
        const d = await idx._indexd.persistDelta(files.aidx);
        if ((d?.persisted || 0) > 0 || ops.length) {
          if (ops.length) {
            await appendIndexDelta(root, ops, {
              scanned: idx.scanned,
              size: idx.entryCount(),
              usn: idx.usn,
              dirMtimes: dirObj,
              backend: 'native',
            });
          }
          idx.lastPersistAt = Date.now();
          idx.dirtyPersist = false;
          return true;
        }
      } catch { /* full compact below */ }
      if (ops.length) {
        await appendIndexDelta(root, ops, {
          scanned: idx.scanned,
          size: idx.entryCount(),
          usn: idx.usn,
          dirMtimes: dirObj,
          backend: 'native',
        });
        idx.lastPersistAt = Date.now();
        idx.dirtyPersist = false;
        return true;
      }
    }
    await idx._payPersistDebt();
    return true;
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

  // Guard: empty meta must not wipe an existing on-disk index
  if (idx.meta.size === 0 && idx.lastPersistAt && !forceCompact) {
    idx.dirtyPersist = false;
    idx.pendingOps = [];
    return false;
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
    }, 900),
  );
}

export async function queryIndex(root, query, opts = {}) {
  const idx = getIndex(root);
  if (!idx.ready && !idx.building) {
    void ensureIndexed(root, { maxDepth: opts.indexDepth ?? 8, maxScan: effectiveMaxScan(opts.maxScan) });
  }
  // 深搜路径请传 skipWarm:true，避免 warmShallow 阻塞「无延迟」查询
  if (!opts.skipWarm && !idx.ready && idx.scanned < 200) {
    await warmShallow(idx, root, 2, 3000);
  }
  return idx.query(query, opts);
}

async function warmShallow(idx, root, depth, budget) {
  const skipSet = effectiveSkipSet();
  async function walk(dir, d) {
    if (idx.scanned >= budget) return;
    let ents;
    try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      if (idx.scanned >= budget) return;
      if (skipSet.has(String(ent.name).toLowerCase())) continue;
      if (isReparseOrLink(ent)) continue;
      const full = path.join(dir, ent.name);
      idx.scanned += 1;
      try {
        const st = await fs.lstat(full);
        if (isReparseOrLink(st)) continue;
        idx.upsert(entryFromStat(full, ent.name, st));
        if (st.isDirectory() && !st.isSymbolicLink() && d < depth) await walk(full, d + 1);
      } catch { /* */ }
    }
  }
  await walk(root, 0);
}

export function indexStatus(root) {
  const idx = getIndex(root);
  const disk = diskCacheStat(root);
  const mu = process.memoryUsage();
  const nodeRss = Math.round((mu.rss / (1024 * 1024)) * 10) / 10;
  // native 冷扫时 _nativeCount 要等 barrier 才更新；scanned 由 onProgress 推进。
  // 状态栏用 max(size, scanned) 避免长时间停在「正在建立索引…」且无进度。
  const entries = idx.entryCount();
  const scanned = Math.max(0, Number(idx.scanned) || 0);
  const size = Math.max(entries, idx.building ? scanned : 0);
  return {
    ready: idx.ready,
    // Cold build only — do NOT OR refreshing (softRefresh) or the status bar
    // stays on「正在建立索引」forever while USN/dirty catch-up runs.
    building: !!idx.building,
    refreshing: !!idx.refreshing,
    scanned,
    size,
    metaSize: idx.meta.size,
    backend: idx._backend || 'js',
    indexd_rss_mb: null, // refreshed async via refreshIndexdStats
    node_rss_mb: nodeRss,
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
    indexTrack: idx.indexTrack || getIndexPrefsSync().indexTrack || 'ui',
    builtinSkip: [...BUILTIN_SKIP],
    lean: !!idx._lean,
    walkEngine: idx.walkEngine || null,
    byNameSize: idx.byName?.size || 0,
    namePoolSize: idx._namePool?.size || 0,
    debt: idx.debt.snapshot(),
    memEstimate: estimateIndexBytes(idx),
  };
}

/** Pull indexd RSS/count into a status-shaped object (async). */
export async function refreshIndexStatus(root) {
  const st = indexStatus(root);
  const idx = getIndex(root);
  if (idx._backend === 'native' && idx._indexd?._alive) {
    try {
      const s = await idx._indexd.stats();
      st.indexd_rss_mb = s.rss_mb ?? null;
      st.size = s.count ?? st.size;
      idx._nativeCount = s.count || idx._nativeCount;
      st.approx_bytes = s.approx_bytes;
      st.path_index_ready = s.path_index_ready ?? s.mem?.path_index_ready ?? null;
      st.indexd_mem = s.mem || null;
      st.free = s.free ?? null;
    } catch { /* */ }
  }
  return st;
}

/** 错峰清偿一片债（压测/主进程可调） */
export async function payIndexDebt(root, budget = {}) {
  const idx = getIndex(root);
  return idx.debt.paySlice(budget);
}

/**
 * 等到指定债清或超时。默认只等 fts/persist（FRN 全量太贵，后台涓流）。
 * @param {{ timeoutMs?: number, kinds?: string[] }} [opts]
 */
export async function waitIndexDebt(root, { timeoutMs = 120_000, kinds = ['fts', 'persist'] } = {}) {
  const idx = getIndex(root);
  const want = new Set(kinds || ['fts', 'persist']);
  const still = () => [...want].some((k) => idx.debt.isOwed(/** @type {any} */ (k)));
  const t0 = Date.now();
  while (still()) {
    if (Date.now() - t0 > timeoutMs) break;
    await idx.debt.paySlice({ ms: 20, ops: 1200 });
    await new Promise((r) => setImmediate(r));
  }
  return idx.debt.snapshot();
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
  idx.debt.owe('frn', { mode: 'backfill' });
  let n = 0;
  const t0 = Date.now();
  while (n < budget && idx.debt.isOwed('frn')) {
    const r = await idx.debt.paySlice({ ms: 12, ops: Math.min(200, budget - n) });
    n += r.paid;
    if (Date.now() - t0 > 30_000) break;
    if (r.paid === 0) break;
  }
  if (n) {
    idx.dirtyPersist = true;
    schedulePersist(root);
  }
  return n;
}

/**
 * 多盘建索。UI 轨默认串行：避免多卷并行饿死当前盘 IO，
 * 状态栏长时间卡在「正在建立索引」。Perf / maxPerf 仍并行。
 */
export async function ensureVolumes(roots, opts = {}) {
  const list = (roots || []).filter(Boolean);
  const parallel = opts.maxPerf === true
    || opts.track === 'perf'
    || opts.parallel === true;
  if (!parallel) {
    const out = [];
    for (const root of list) {
      out.push(await ensureIndexed(root, opts));
    }
    return out;
  }
  return Promise.all(list.map((root) => ensureIndexed(root, opts)));
}

export function disposeVolumeIndex(root) {
  stopVolumeWatch(root);
  stopUsnPoll(root);
  const key = root.replace(/\\+$/, '').toLowerCase();
  const idx = volumes.get(key);
  if (idx) {
    idx._liveAttached = false;
    idx._disposed = true;
    idx.generation += 1;
    idx.building = false;
    idx.refreshing = false;
    try { idx.debt?.stopSchedule?.(); } catch { /* */ }
    try { idx.fts?.close?.(); } catch { /* */ }
    try { idx.disableNative?.(); } catch { /* */ }
  }
  volumes.delete(key);
}
