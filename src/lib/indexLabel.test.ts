import { describe, expect, it } from 'vitest';
import { indexStatusLabel, searchSourceLabel } from './indexLabel';

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
    expect(indexStatusLabel({ ready: true, size: 5000, disk: { exists: true }, watching: true })).toContain('监视');
    expect(indexStatusLabel({ ready: true, size: 1, disk: { exists: true, deltaLines: 3 } })).toContain('增量落盘');
    expect(indexStatusLabel({ ready: true, size: 9, fts: { ok: true }, usnReadable: true })).toContain('USN');
  });
});
