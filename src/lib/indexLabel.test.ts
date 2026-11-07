import { describe, expect, it } from 'vitest';
import { indexChipState, indexStatusLabel, searchSourceLabel } from './indexLabel';

describe('searchSourceLabel', () => {
  it('maps known sources', () => {
    expect(searchSourceLabel('index-segment')).toBe('段倒排');
    expect(searchSourceLabel('index-rb-prefix')).toBe('红黑树');
    expect(searchSourceLabel('index-skip')).toBe('跳跃表');
    expect(searchSourceLabel('index-fts')).toBe('SQLite FTS');
    expect(searchSourceLabel('dirty-dirs:3')).toBe('脏目录增量');
    expect(searchSourceLabel('usn-frn:12')).toBe('USN/FRN');
    expect(searchSourceLabel('usn-mtime-delta')).toBe('mtime 增量');
    expect(searchSourceLabel('watch-only')).toBe('目录监视');
    expect(searchSourceLabel('index', true)).toBe('查询缓存');
    expect(searchSourceLabel('walk-fallback')).toBe('扫盘');
  });
});

describe('indexStatusLabel', () => {
  it('formats building and ready', () => {
    expect(indexStatusLabel({ building: true, size: 1200 })).toContain('索引中');
    expect(indexStatusLabel({ building: true, size: 0 })).toBe('正在建立索引…');
    // native 冷扫：size 仍 0 时用 scanned 显示进度
    expect(indexStatusLabel({ building: true, size: 0, scanned: 42_000 })).toContain('42,000');
    expect(indexStatusLabel({ ready: true, size: 5000, disk: { exists: true }, watching: true })).toContain('监视');
    expect(indexStatusLabel({ ready: true, size: 1, disk: { exists: true, deltaLines: 3 } })).toContain('增量落盘');
    expect(indexStatusLabel({ ready: true, size: 9, fts: { ok: true }, usnReadable: true })).toContain('USN');
  });

  it('does not look like cold build while soft-refreshing a ready index', () => {
    const label = indexStatusLabel({
      ready: true,
      building: false,
      refreshing: true,
      size: 12_000,
      watching: true,
    });
    expect(label).toContain('索引就绪');
    expect(label).toContain('同步中');
    expect(label).not.toContain('正在建立索引');
  });

  it('maps chip state for soft-refresh vs cold build', () => {
    expect(indexChipState('demo', null)).toBe('demo');
    expect(indexChipState('real', { building: true, ready: false })).toBe('building');
    expect(indexChipState('real', { ready: true, building: false, refreshing: true })).toBe('refreshing');
    expect(indexChipState('real', { ready: true, building: false })).toBe('ready');
    // Mis-flagged legacy: building while ready → still ready/同步中, never cold-build copy
    const legacy = indexStatusLabel({ ready: true, building: true, size: 9 });
    expect(legacy).toContain('索引就绪');
    expect(legacy).toContain('同步中');
    expect(legacy).not.toContain('正在建立索引');
    expect(indexChipState('real', { ready: true, building: true })).toBe('refreshing');
  });
});
