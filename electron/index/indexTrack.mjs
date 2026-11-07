/**
 * 索引双轨：UI（保交互）与 Perf（冲吞吐）完全分轨，互不掺默认。
 *
 * - UI：低并发、勤 yield、建索中不涓流 FTS → 主进程不饿死渲染
 * - Perf：高并发、稀 yield、walk 中涓流 FTS → 压测 / bakeoff / 极限建索
 *
 * 解析优先级：显式 opts.track / opts.maxPerf → env AURORA_INDEX_TRACK → prefs.indexTrack → ui
 */

/** @typedef {'ui'|'perf'} IndexTrackId */

/** @type {Record<IndexTrackId, object>} */
export const INDEX_TRACKS = {
  ui: {
    id: 'ui',
    label: 'UI（保交互）',
    maxPerf: false,
    interactive: true,
    /** null = walk 按 CPU 自适应（见 fastWalk） */
    concurrency: null,
    yieldEvery: 512,
    progressMs: 600,
    dripFtsDuringWalk: false,
    dripBelowRate: 50_000,
    dripOps: 800,
    debtOps: 2_000,
    debtMs: 16,
  },
  perf: {
    id: 'perf',
    label: 'Perf（冲吞吐）',
    maxPerf: true,
    interactive: false,
    concurrency: null,
    yieldEvery: 8192,
    progressMs: 250,
    dripFtsDuringWalk: true,
    dripBelowRate: 65_000,
    dripOps: 4_000,
    debtOps: 10_000,
    debtMs: 32,
  },
};

/**
 * @param {unknown} raw
 * @returns {IndexTrackId}
 */
export function normalizeTrackId(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'perf' || s === 'maxperf' || s === 'performance' || s === 'bench') return 'perf';
  return 'ui';
}

/**
 * @param {object} [opts]
 * @param {{ indexTrack?: string }} [prefs]
 * @returns {IndexTrackId}
 */
export function resolveTrackId(opts = {}, prefs = {}) {
  if (opts.maxPerf === true) return 'perf';
  if (opts.track != null) return normalizeTrackId(opts.track);
  if (opts.indexTrack != null) return normalizeTrackId(opts.indexTrack);
  const env = process.env.AURORA_INDEX_TRACK;
  if (env) return normalizeTrackId(env);
  if (prefs?.indexTrack) return normalizeTrackId(prefs.indexTrack);
  // 兼容旧调用：interactive:false 且未声明 track → 仍默认 ui（避免误进 perf）
  return 'ui';
}

/**
 * 把轨配置并入 opts；调用方已显式给出的字段优先生效。
 * @param {object} [opts]
 * @param {{ indexTrack?: string }} [prefs]
 */
export function applyIndexTrack(opts = {}, prefs = {}) {
  const id = resolveTrackId(opts, prefs);
  const profile = INDEX_TRACKS[id] || INDEX_TRACKS.ui;
  const out = { ...opts };
  out.track = id;
  out.maxPerf = profile.maxPerf;
  out.interactive = profile.interactive;

  const fill = (key) => {
    if (out[key] == null) out[key] = profile[key];
  };
  fill('concurrency');
  fill('yieldEvery');
  fill('progressMs');
  fill('dripFtsDuringWalk');
  fill('dripBelowRate');
  fill('dripOps');
  fill('debtOps');
  fill('debtMs');

  return out;
}

/** Walk 层用的精简旋钮（已 apply 后） */
export function walkKnobsFromOpts(opts = {}) {
  const track = normalizeTrackId(opts.track || (opts.maxPerf ? 'perf' : 'ui'));
  const profile = INDEX_TRACKS[track];
  return {
    track,
    maxPerf: opts.maxPerf === true || profile.maxPerf,
    interactive: opts.interactive !== false && track === 'ui',
    concurrency: opts.concurrency,
    yieldEvery: opts.yieldEvery ?? profile.yieldEvery,
    progressMs: opts.progressMs ?? profile.progressMs,
  };
}
