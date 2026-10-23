/**
 * 索引压测 / 运行时指标
 */
export class Metrics {
  constructor(label = 'index') {
    this.label = label;
    /** @type {Map<string, number[]>} */
    this.timings = new Map();
    /** @type {Record<string, number | string | boolean | null>} */
    this.gauges = {};
    this.startedAt = Date.now();
  }

  /** @param {string} name */
  start(name) {
    const t0 = performance.now();
    return () => {
      const ms = performance.now() - t0;
      let arr = this.timings.get(name);
      if (!arr) {
        arr = [];
        this.timings.set(name, arr);
      }
      arr.push(ms);
      return ms;
    };
  }

  /** @param {string} name @param {number|string|boolean|null} value */
  gauge(name, value) {
    this.gauges[name] = value;
  }

  /** @param {string} name */
  summary(name) {
    const arr = this.timings.get(name) || [];
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
    return {
      count: sorted.length,
      min: round(sorted[0]),
      max: round(sorted[sorted.length - 1]),
      avg: round(sum / sorted.length),
      p50: round(pct(50)),
      p95: round(pct(95)),
      total: round(sum),
    };
  }

  report() {
    /** @type {Record<string, ReturnType<Metrics['summary']>>} */
    const timings = {};
    for (const key of this.timings.keys()) {
      timings[key] = this.summary(key);
    }
    return {
      label: this.label,
      elapsedMs: Date.now() - this.startedAt,
      gauges: { ...this.gauges },
      timings,
    };
  }

  print() {
    const r = this.report();
    const lines = [
      `═══ ${r.label} ═══`,
      `elapsed: ${r.elapsedMs} ms`,
      '--- gauges ---',
    ];
    for (const [k, v] of Object.entries(r.gauges)) {
      lines.push(`  ${k}: ${v}`);
    }
    lines.push('--- timings (ms) ---');
    for (const [k, s] of Object.entries(r.timings)) {
      if (!s) continue;
      lines.push(
        `  ${k}: n=${s.count} avg=${s.avg} p50=${s.p50} p95=${s.p95} min=${s.min} max=${s.max} total=${s.total}`,
      );
    }
    return lines.join('\n');
  }
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * 从 indexStatus 抽关键指标
 * @param {object} st
 */
export function gaugesFromStatus(st) {
  return {
    size: st.size ?? 0,
    scanned: st.scanned ?? 0,
    ready: !!st.ready,
    building: !!st.building,
    watching: !!st.watching,
    usnReadable: st.usnReadable ?? null,
    frnSize: st.frnSize ?? 0,
    frnCoverage: st.size ? Math.round(((st.frnSize || 0) / st.size) * 1000) / 1000 : 0,
    ftsOk: !!st.fts?.ok,
    ftsSize: st.fts?.size ?? 0,
    segmentKeys: st.segmentKeys ?? 0,
    pendingDelta: st.pendingDelta ?? 0,
    dirtyDirs: st.dirtyDirs ?? 0,
    diskBytes: st.disk?.bytes ?? 0,
    diskDeltaLines: st.disk?.deltaLines ?? 0,
    source: st.source ?? '',
  };
}
