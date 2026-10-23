import { describe, expect, it } from 'vitest';
import { COLUMN_ROW_H, hitTestColumnMarquee } from './columnMarquee';

describe('hitTestColumnMarquee', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];

  it('hits a single row', () => {
    const hit = hitTestColumnMarquee(ids, { x: 0, y: COLUMN_ROW_H + 4, w: 40, h: 8 });
    expect(hit).toContain('b');
  });

  it('hits a range of rows', () => {
    const hit = hitTestColumnMarquee(ids, {
      x: 0,
      y: 4,
      w: 100,
      h: COLUMN_ROW_H * 3,
    });
    expect(hit.length).toBeGreaterThanOrEqual(2);
    expect(hit[0]).toBe('a');
  });
});
