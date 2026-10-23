import { describe, expect, it } from 'vitest';
import { parseSearchQuery, rankSearchResults, scoreMatch } from './searchRank';

describe('scoreMatch', () => {
  it('ranks exact and prefix higher than contains', () => {
    expect(scoreMatch({ name: 'Report.pdf' }, 'report.pdf')).toBeGreaterThan(
      scoreMatch({ name: 'my-report.pdf' }, 'report'),
    );
    expect(scoreMatch({ name: 'readme.md' }, 'read')).toBeGreaterThan(
      scoreMatch({ name: 'spread.md' }, 'read'),
    );
  });

  it('returns 0 when no match', () => {
    expect(scoreMatch({ name: 'a.txt' }, 'zzz')).toBe(0);
  });
});

describe('rankSearchResults', () => {
  it('orders and limits', () => {
    const items = [
      { name: 'notes.txt' },
      { name: 'note.md' },
      { name: 'readme.md' },
      { name: 'denote.ts' },
    ];
    const ranked = rankSearchResults(items, 'note', 2);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].name.toLowerCase().startsWith('note')).toBe(true);
  });
});

describe('parseSearchQuery', () => {
  it('extracts tag and type filters', () => {
    const p = parseSearchQuery('预算 type:xlsx tag:工作');
    expect(p.type).toBe('xlsx');
    expect(p.tag).toBe('工作');
    expect(p.text).toContain('预算');
  });
});
