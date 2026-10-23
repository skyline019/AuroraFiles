/**
 * 局部红黑树：按 key(string) 有序，支持前缀区间扫描（O(log n + k)）
 */
const RED = 1;
const BLACK = 0;

function node(key, value) {
  return { key, value, left: null, right: null, parent: null, color: RED };
}

export class RbTree {
  constructor(compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0)) {
    this.root = null;
    this.size = 0;
    this.compare = compare;
  }

  clear() {
    this.root = null;
    this.size = 0;
  }

  insert(key, value) {
    let y = null;
    let x = this.root;
    while (x) {
      y = x;
      const c = this.compare(key, x.key);
      if (c === 0) {
        x.value = value;
        return;
      }
      x = c < 0 ? x.left : x.right;
    }
    const z = node(key, value);
    z.parent = y;
    if (!y) this.root = z;
    else if (this.compare(key, y.key) < 0) y.left = z;
    else y.right = z;
    this.size += 1;
    this.#insertFix(z);
  }

  remove(key) {
    const z = this.#findNode(key);
    if (!z) return false;
    this.#deleteNode(z);
    this.size -= 1;
    return true;
  }

  get(key) {
    const n = this.#findNode(key);
    return n ? n.value : undefined;
  }

  /** 所有 key 以 prefix 开头的条目（有序） */
  *rangeByPrefix(prefix) {
    if (!prefix) {
      yield* this.#inOrder(this.root);
      return;
    }
    let n = this.root;
    let start = null;
    while (n) {
      if (n.key.startsWith(prefix) || this.compare(n.key, prefix) >= 0) {
        start = n;
        n = n.left;
      } else n = n.right;
    }
    let cur = start;
    while (cur && cur.key.startsWith(prefix)) {
      yield { key: cur.key, value: cur.value };
      cur = this.#successor(cur);
    }
  }

  /** 子串包含（全树扫描）；key 可含 \0 后缀时只匹配前缀段 */
  *contains(substr, limit = 200) {
    let n = 0;
    for (const item of this.#inOrder(this.root)) {
      const head = item.key.split('\0')[0];
      if (head.includes(substr)) {
        yield item;
        if (++n >= limit) return;
      }
    }
  }

  *#inOrder(n) {
    if (!n) return;
    yield* this.#inOrder(n.left);
    yield { key: n.key, value: n.value };
    yield* this.#inOrder(n.right);
  }

  #findNode(key) {
    let x = this.root;
    while (x) {
      const c = this.compare(key, x.key);
      if (c === 0) return x;
      x = c < 0 ? x.left : x.right;
    }
    return null;
  }

  #successor(n) {
    if (n.right) {
      let x = n.right;
      while (x.left) x = x.left;
      return x;
    }
    let y = n.parent;
    let x = n;
    while (y && x === y.right) {
      x = y;
      y = y.parent;
    }
    return y;
  }

  #rotateLeft(x) {
    const y = x.right;
    x.right = y.left;
    if (y.left) y.left.parent = x;
    y.parent = x.parent;
    if (!x.parent) this.root = y;
    else if (x === x.parent.left) x.parent.left = y;
    else x.parent.right = y;
    y.left = x;
    x.parent = y;
  }

  #rotateRight(x) {
    const y = x.left;
    x.left = y.right;
    if (y.right) y.right.parent = x;
    y.parent = x.parent;
    if (!x.parent) this.root = y;
    else if (x === x.parent.right) x.parent.right = y;
    else x.parent.left = y;
    y.right = x;
    x.parent = y;
  }

  #insertFix(z) {
    while (z.parent && z.parent.color === RED) {
      if (z.parent === z.parent.parent?.left) {
        const y = z.parent.parent.right;
        if (y && y.color === RED) {
          z.parent.color = BLACK;
          y.color = BLACK;
          z.parent.parent.color = RED;
          z = z.parent.parent;
        } else {
          if (z === z.parent.right) {
            z = z.parent;
            this.#rotateLeft(z);
          }
          z.parent.color = BLACK;
          z.parent.parent.color = RED;
          this.#rotateRight(z.parent.parent);
        }
      } else {
        const y = z.parent.parent?.left;
        if (y && y.color === RED) {
          z.parent.color = BLACK;
          y.color = BLACK;
          z.parent.parent.color = RED;
          z = z.parent.parent;
        } else {
          if (z === z.parent.left) {
            z = z.parent;
            this.#rotateRight(z);
          }
          z.parent.color = BLACK;
          z.parent.parent.color = RED;
          this.#rotateLeft(z.parent.parent);
        }
      }
    }
    if (this.root) this.root.color = BLACK;
  }

  #transplant(u, v) {
    if (!u.parent) this.root = v;
    else if (u === u.parent.left) u.parent.left = v;
    else u.parent.right = v;
    if (v) v.parent = u.parent;
  }

  #minimum(n) {
    while (n.left) n = n.left;
    return n;
  }

  #deleteNode(z) {
    let y = z;
    let yOrig = y.color;
    let x;
    if (!z.left) {
      x = z.right;
      this.#transplant(z, z.right);
    } else if (!z.right) {
      x = z.left;
      this.#transplant(z, z.left);
    } else {
      y = this.#minimum(z.right);
      yOrig = y.color;
      x = y.right;
      if (y.parent === z) {
        if (x) x.parent = y;
      } else {
        this.#transplant(y, y.right);
        y.right = z.right;
        if (y.right) y.right.parent = y;
      }
      this.#transplant(z, y);
      y.left = z.left;
      if (y.left) y.left.parent = y;
      y.color = z.color;
    }
    if (yOrig === BLACK) this.#deleteFix(x, z.parent);
  }

  #deleteFix(x, parent) {
    while ((x !== this.root) && (!x || x.color === BLACK)) {
      const p = x ? x.parent : parent;
      if (!p) break;
      if (x === p.left) {
        let w = p.right;
        if (w && w.color === RED) {
          w.color = BLACK;
          p.color = RED;
          this.#rotateLeft(p);
          w = p.right;
        }
        if (w && (!w.left || w.left.color === BLACK) && (!w.right || w.right.color === BLACK)) {
          w.color = RED;
          x = p;
          parent = p.parent;
        } else if (w) {
          if (!w.right || w.right.color === BLACK) {
            if (w.left) w.left.color = BLACK;
            w.color = RED;
            this.#rotateRight(w);
            w = p.right;
          }
          if (w) {
            w.color = p.color;
            p.color = BLACK;
            if (w.right) w.right.color = BLACK;
            this.#rotateLeft(p);
          }
          x = this.root;
        } else break;
      } else {
        let w = p.left;
        if (w && w.color === RED) {
          w.color = BLACK;
          p.color = RED;
          this.#rotateRight(p);
          w = p.left;
        }
        if (w && (!w.right || w.right.color === BLACK) && (!w.left || w.left.color === BLACK)) {
          w.color = RED;
          x = p;
          parent = p.parent;
        } else if (w) {
          if (!w.left || w.left.color === BLACK) {
            if (w.right) w.right.color = BLACK;
            w.color = RED;
            this.#rotateLeft(w);
            w = p.left;
          }
          if (w) {
            w.color = p.color;
            p.color = BLACK;
            if (w.left) w.left.color = BLACK;
            this.#rotateRight(p);
          }
          x = this.root;
        } else break;
      }
    }
    if (x) x.color = BLACK;
  }
}
