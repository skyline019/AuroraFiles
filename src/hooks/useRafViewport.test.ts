import { describe, expect, it } from 'vitest';
import { visibleIndexRange, computeGridMetrics } from '@/lib/gridLayout';

/** Sanity: tighter overscan still covers a viewport (paired with rAF scroll). */
describe('grid visible range with overscan 1', () => {
  it('covers viewport rows', () => {
    const m = computeGridMetrics(800, 76);
    const range = visibleIndexRange(0, 600, 5000, m, 1);
    expect(range.end).toBeGreaterThan(range.start);
    expect(range.end - range.start).toBeLessThan(200);
  });
});
