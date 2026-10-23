import { describe, expect, it } from 'vitest';
import {
  cellRect,
  computeGridMetrics,
  hitTestMarquee,
  rectsIntersect,
  totalGridHeight,
  visibleIndexRange,
} from './gridLayout';

describe('computeGridMetrics', () => {
  it('computes at least one column', () => {
    const m = computeGridMetrics(100, 76);
    expect(m.cols).toBeGreaterThanOrEqual(1);
    expect(m.cellW).toBe(110);
  });

  it('fits more columns in a wider container', () => {
    const narrow = computeGridMetrics(300, 76);
    const wide = computeGridMetrics(1200, 76);
    expect(wide.cols).toBeGreaterThan(narrow.cols);
  });
});

describe('visibleIndexRange', () => {
  it('returns a window covering the viewport', () => {
    const m = computeGridMetrics(800, 64);
    const count = 500;
    const { start, end } = visibleIndexRange(0, 400, count, m, 1);
    expect(start).toBe(0);
    expect(end).toBeGreaterThan(m.cols);
    expect(end).toBeLessThanOrEqual(count);
  });

  it('advances when scrolled', () => {
    const m = computeGridMetrics(800, 64);
    const a = visibleIndexRange(0, 300, 1000, m, 0);
    const b = visibleIndexRange(2000, 300, 1000, m, 0);
    expect(b.start).toBeGreaterThan(a.start);
  });
});

describe('hitTestMarquee', () => {
  it('hits cells by geometry without DOM', () => {
    const m = computeGridMetrics(500, 48);
    const ids = Array.from({ length: 20 }, (_, i) => `id-${i}`);
    const first = cellRect(0, m);
    const hit = hitTestMarquee(20, ids, first, m);
    expect(hit).toContain('id-0');
  });

  it('selects a row band', () => {
    const m = computeGridMetrics(600, 48);
    const ids = Array.from({ length: m.cols * 3 }, (_, i) => `n${i}`);
    const top = cellRect(0, m);
    const bottom = cellRect(m.cols - 1, m);
    const band = {
      x: top.x,
      y: top.y,
      w: bottom.x + bottom.w - top.x,
      h: top.h,
    };
    const hit = hitTestMarquee(ids.length, ids, band, m);
    expect(hit.length).toBe(m.cols);
  });
});

describe('rectsIntersect', () => {
  it('detects overlap and separation', () => {
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 5, h: 5 })).toBe(false);
  });
});

describe('totalGridHeight', () => {
  it('grows with item count', () => {
    const m = computeGridMetrics(800, 64);
    expect(totalGridHeight(0, m)).toBeLessThan(totalGridHeight(100, m));
  });
});
