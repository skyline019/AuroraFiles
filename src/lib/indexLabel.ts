/** 搜索 / 索引来源的短文案 */
export function searchSourceLabel(source?: string, cached?: boolean): string {
  if (cached) return '查询缓存';
  const s = source || '';
  if (s.includes('fts')) return 'SQLite FTS';
  if (s.includes('segment')) return '段倒排';
  if (s.includes('skip')) return '跳跃表';
  if (s.includes('rb-prefix') || s.includes('rb')) return '红黑树';
  if (s.startsWith('index')) return '内存索引';
  if (s === 'disk' || s.includes('disk')) return '落盘索引';
  if (s.includes('dirty')) return '脏目录增量';
  if (s.includes('watch-only')) return '目录监视';
  if (s.includes('frn')) return 'USN/FRN';
  if (s.includes('mtime')) return 'mtime 增量';
  if (s.includes('usn')) return 'USN 追赶';
  if (s.includes('walk') || s === 'walk-fallback') return '扫盘';
  return s ? s : '扫盘';
}

export type IndexChipState = 'demo' | 'building' | 'refreshing' | 'ready' | 'idle';

/** Status-chip tone/state for UI + Playwright. Soft-refresh must never look like cold build. */
export function indexChipState(
  fsMode: 'demo' | 'real' | string | undefined,
  info: {
    ready?: boolean;
    building?: boolean;
    refreshing?: boolean;
  } | null,
): IndexChipState {
  if (fsMode === 'demo') return 'demo';
  if (!info) return 'idle';
  if (info.ready) {
    if (info.refreshing || info.building) return 'refreshing';
    return 'ready';
  }
  if (info.building) return 'building';
  if (info.refreshing) return 'refreshing';
  return 'idle';
}

export function indexStatusLabel(info: {
  ready?: boolean;
  building?: boolean;
  refreshing?: boolean;
  size?: number;
  source?: string;
  watching?: boolean;
  usnReadable?: boolean | null;
  fts?: { ok?: boolean; size?: number };
  disk?: { exists?: boolean; size?: number; deltaLines?: number };
} | null): string {
  if (!info) return '';
  // Prefer ready copy whenever searchable — ignore stale `building` during softRefresh
  if (info.ready) {
    const n = info.size ?? 0;
    const parts = [`索引就绪 · ${n.toLocaleString()} 项`];
    if (info.refreshing || info.building) parts.push('同步中');
    else if (info.disk?.exists) parts.push(info.disk.deltaLines ? '增量落盘' : '已落盘');
    else parts.push('内存');
    if (info.fts?.ok) parts.push('FTS');
    if (info.usnReadable === true) parts.push('USN');
    else if (info.watching) parts.push('监视');
    return parts.join(' · ');
  }
  if (info.building) {
    const n = info.size ?? 0;
    return n > 0 ? `索引中 · ${n.toLocaleString()} 项` : '正在建立索引…';
  }
  if (info.refreshing) return '索引同步中…';
  return '索引未就绪';
}
