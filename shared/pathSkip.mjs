/**
 * 路径跳跃表：有序路径 + 多层前进指针，前缀查询 O(log n)。
 * 「图路跳跃收敛」：从查询片段逐级跳跃，收敛到最长匹配前缀后展开子树。
 */
const MAX_LEVEL = 16;

function randomLevel() {
  let lvl = 1;
  while (Math.random() < 0.5 && lvl < MAX_LEVEL) lvl += 1;
  return lvl;
}

function makeNode(key, value, level) {
  return { key, value, forward: new Array(level).fill(null) };
}

export class PathSkipList {
  constructor() {
    this.header = makeNode('', null, MAX_LEVEL);
    this.level = 1;
    this.size = 0;
  }

  clear() {
    this.header = makeNode('', null, MAX_LEVEL);
    this.level = 1;
    this.size = 0;
  }

  insert(key, value) {
    const update = new Array(MAX_LEVEL).fill(null);
    let x = this.header;
    for (let i = this.level - 1; i >= 0; i--) {
      while (x.forward[i] && x.forward[i].key < key) x = x.forward[i];
      update[i] = x;
    }
    x = x.forward[0];
    if (x && x.key === key) {
      x.value = value;
      return;
    }
    const lvl = randomLevel();
    if (lvl > this.level) {
      for (let i = this.level; i < lvl; i++) update[i] = this.header;
      this.level = lvl;
    }
    const n = makeNode(key, value, lvl);
    for (let i = 0; i < lvl; i++) {
      n.forward[i] = update[i].forward[i];
      update[i].forward[i] = n;
    }
    this.size += 1;
  }

  remove(key) {
    const update = new Array(MAX_LEVEL).fill(null);
    let x = this.header;
    for (let i = this.level - 1; i >= 0; i--) {
      while (x.forward[i] && x.forward[i].key < key) x = x.forward[i];
      update[i] = x;
    }
    x = x.forward[0];
    if (!x || x.key !== key) return false;
    for (let i = 0; i < this.level; i++) {
      if (update[i].forward[i] !== x) break;
      update[i].forward[i] = x.forward[i];
    }
    while (this.level > 1 && !this.header.forward[this.level - 1]) this.level -= 1;
    this.size -= 1;
    return true;
  }

  /** 跳跃到 >= key 的首节点 */
  lowerBound(key) {
    let x = this.header;
    for (let i = this.level - 1; i >= 0; i--) {
      while (x.forward[i] && x.forward[i].key < key) x = x.forward[i];
    }
    return x.forward[0];
  }

  /**
   * 路径前缀收敛：规范化前缀后跳跃命中，再线性展开同前缀节点。
   */
  *byPathPrefix(prefix, limit = 500) {
    const p = prefix.toLowerCase();
    let n = this.lowerBound(p);
    let count = 0;
    while (n && n.key.startsWith(p)) {
      yield { key: n.key, value: n.value };
      if (++count >= limit) return;
      n = n.forward[0];
    }
  }

  /** 多段路径片段跳跃：逐段收敛到更长前缀 */
  convergeSegments(segments, limit = 500) {
    if (!segments.length) return [];
    let prefix = '';
    const out = [];
    for (const seg of segments) {
      const next = prefix ? `${prefix}\\${seg}` : seg;
      const hits = [...this.byPathPrefix(next.toLowerCase(), limit)];
      if (!hits.length) break;
      prefix = next;
      out.length = 0;
      out.push(...hits);
      if (out.length === 1 && out[0].key === next.toLowerCase()) {
        // 精确收敛到单节点，可继续加深
        continue;
      }
    }
    return out.length ? out : [...this.byPathPrefix(segments[0].toLowerCase(), limit)];
  }
}
