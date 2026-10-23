/**
 * 轻量路径段倒排：segment → Set<entryPath>
 *
 * 评估结论（见模块尾注释）：
 * - 有用：多段路径查询（users\docs）O(k) 交集，比全表扫快
 * - 无用：自研「段页多重映射 / OS 式 page cache」——80k 级条目全在堆内，
 *   V8 已管内存；页框/TLB/多级页表只会增加代码量与同步成本
 */

export class SegmentInvertedMap {
  constructor() {
    /** @type {Map<string, Set<string>>} */
    this.seg = new Map();
    /** @type {Map<string, string[]>} path -> segments owned */
    this.owned = new Map();
  }

  clear() {
    this.seg.clear();
    this.owned.clear();
  }

  static segmentsOf(absPath) {
    return String(absPath)
      .toLowerCase()
      .split(/[\\/]+/)
      .filter((s) => s && s !== '.' && !/^[a-z]:$/.test(s));
  }

  upsert(absPath) {
    const key = absPath.toLowerCase();
    this.remove(absPath);
    const parts = SegmentInvertedMap.segmentsOf(absPath);
    this.owned.set(key, parts);
    for (const p of parts) {
      let set = this.seg.get(p);
      if (!set) {
        set = new Set();
        this.seg.set(p, set);
      }
      set.add(key);
    }
  }

  remove(absPath) {
    const key = absPath.toLowerCase();
    const prev = this.owned.get(key);
    if (!prev) return;
    for (const p of prev) {
      const set = this.seg.get(p);
      if (!set) continue;
      set.delete(key);
      if (set.size === 0) this.seg.delete(p);
    }
    this.owned.delete(key);
  }

  /**
   * 多段交集；最短倒排优先。
   * @returns {string[]} lowercased paths
   */
  intersect(segments, limit = 400) {
    const segs = segments.map((s) => String(s).toLowerCase()).filter(Boolean);
    if (!segs.length) return [];
    const lists = segs
      .map((s) => this.seg.get(s))
      .filter(Boolean)
      .sort((a, b) => a.size - b.size);
    if (lists.length !== segs.length) return [];
    const [first, ...rest] = lists;
    const out = [];
    for (const pathKey of first) {
      if (rest.every((set) => set.has(pathKey))) {
        out.push(pathKey);
        if (out.length >= limit) break;
      }
    }
    return out;
  }
}

/**
 * 查询结果 LRU（热词二次搜索）。
 * 条目级索引已在内存；此 cache 只缓存「query → hits」避免重复区间扫描。
 */
export class QueryResultCache {
  constructor(capacity = 64) {
    this.capacity = capacity;
    /** @type {Map<string, { items: unknown[], truncated: boolean, source: string }>} */
    this.map = new Map();
  }

  clear() {
    this.map.clear();
  }

  get(key) {
    if (!this.map.has(key)) return null;
    const v = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }
}

/*
 * === 自研段页多重映射 / page cache 评估 ===
 *
 * | 方案 | 对本项目（≤8万条目、Electron 主进程） | 建议 |
 * |------|--------------------------------------|------|
 * | 段倒排 SegmentInvertedMap | 多段路径查询显著加速；内存约 O(段出现次数) | 采用 |
 * | 查询 LRU QueryResultCache | 热词重复搜几乎零成本 | 采用（小容量） |
 * | OS 式多级页表 / 段页映射 | 条目已全部驻留 JS 堆，无缺页；映射表本身占内存 | 不做 |
 * | 自研页框 + 磁盘换出 | Node 无 mmap 控制收益；落盘已用 NDJSON 整卷加载 | 不做 |
 * | 按页懒加载索引 | 冷启动可用分片，但实现复杂；当前整卷 hydrate <100ms 足够 | 暂缓 |
 */
