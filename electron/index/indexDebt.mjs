/**
 * 延时记债、错峰清偿：热路径只 owe，idle 按预算 paySlice。
 * 优先级：fts(0) < frn(1) < secondary(2) < persist(2) < space(3) < stat_meta(4)
 * —— 数字越小越先还。space 不挡可搜/落盘。
 */

/** @typedef {'fts'|'frn'|'secondary'|'persist'|'space'|'stat_meta'} DebtKind */

const PRIORITY = {
  fts: 0,
  frn: 1,
  secondary: 2,
  persist: 2,
  space: 3,
  stat_meta: 4,
};

export class IndexDebt {
  constructor() {
    /** @type {Map<DebtKind, { owed: boolean, paid: number, meta?: object }>} */
    this.kinds = new Map();
    this.paused = false;
    this.paying = false;
    this.totalPaid = 0;
    this._timer = null;
    /** @type {((kind: DebtKind, budget: { ms: number, ops: number }) => number|Promise<number>) | null} */
    this.payer = null;
  }

  /**
   * @param {DebtKind} kind
   * @param {object} [meta]
   */
  owe(kind, meta = undefined) {
    const cur = this.kinds.get(kind);
    if (cur?.owed) {
      if (meta) cur.meta = { ...cur.meta, ...meta };
      return;
    }
    this.kinds.set(kind, { owed: true, paid: cur?.paid || 0, meta });
  }

  /** @param {DebtKind} kind */
  clear(kind) {
    const cur = this.kinds.get(kind);
    if (!cur) return;
    cur.owed = false;
  }

  /** @param {DebtKind} kind */
  isOwed(kind) {
    return !!this.kinds.get(kind)?.owed;
  }

  depth() {
    let n = 0;
    for (const v of this.kinds.values()) if (v.owed) n += 1;
    return n;
  }

  snapshot() {
    const out = {};
    for (const [k, v] of this.kinds) {
      out[k] = { owed: v.owed, paid: v.paid, meta: v.meta || null };
    }
    return {
      depth: this.depth(),
      totalPaid: this.totalPaid,
      paused: this.paused,
      kinds: out,
    };
  }

  pauseForQuery() {
    this.paused = true;
  }

  resumeAfterQuery() {
    this.paused = false;
  }

  /**
   * @param {{ ms?: number, ops?: number }} budget
   * @returns {Promise<{ paid: number, kind: DebtKind|null }>}
   */
  async paySlice(budget = {}) {
    if (this.paused || this.paying || !this.payer) {
      return { paid: 0, kind: null };
    }
    const ms = Number(budget.ms) > 0 ? Number(budget.ms) : 12;
    const ops = Number(budget.ops) > 0 ? Number(budget.ops) : 400;
    const ordered = [...this.kinds.entries()]
      .filter(([, v]) => v.owed)
      .sort((a, b) => (PRIORITY[a[0]] ?? 9) - (PRIORITY[b[0]] ?? 9));
    if (!ordered.length) return { paid: 0, kind: null };

    const [kind] = ordered[0];
    this.paying = true;
    try {
      const n = await this.payer(kind, { ms, ops });
      const paid = Number(n) || 0;
      const cur = this.kinds.get(kind);
      if (cur) {
        cur.paid += paid;
        if (paid === 0 && kind !== 'fts') {
          // 无进展：非 fts 视为本轮暂无工作，清除以免空转（fts 由 payer 显式 clear）
        }
      }
      this.totalPaid += paid;
      return { paid, kind };
    } finally {
      this.paying = false;
    }
  }

  /**
   * 调度错峰清偿直到债清或 aborted。
   * @param {object} opts
   */
  schedule(opts = {}) {
    const intervalMs = opts.intervalMs ?? 16;
    const budgetMs = opts.budgetMs ?? 12;
    const budgetOps = opts.budgetOps ?? 400;
    const onSlice = opts.onSlice;
    const aborted = opts.aborted || (() => false);

    this.stopSchedule();
    const tick = async () => {
      if (aborted()) {
        this._timer = null;
        return;
      }
      if (!this.paused && this.depth() > 0) {
        const r = await this.paySlice({ ms: budgetMs, ops: budgetOps });
        if (typeof onSlice === 'function') onSlice(r, this.snapshot());
      }
      if (aborted() || this.depth() === 0) {
        this._timer = null;
        if (typeof opts.onDone === 'function') opts.onDone(this.snapshot());
        return;
      }
      this._timer = setTimeout(tick, intervalMs);
    };
    this._timer = setTimeout(tick, 0);
  }

  stopSchedule() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}

export { PRIORITY };
