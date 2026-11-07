import { describe, expect, it } from 'vitest';
import { horizontalWindowFromScroll, listWindowFromScroll } from './useVirtualWindow';

describe('listWindowFromScroll', () => {
  it('covers viewport with overscan', () => {
    const w = listWindowFromScroll(0, 320, 5000, 32, 8);
    expect(w.start).toBe(0);
    expect(w.end).toBeGreaterThan(10);
    expect(w.end).toBeLessThan(30);
    expect(w.totalHeight).toBe(5000 * 32);
  });

  it('same row pixel scroll keeps identical start/end', () => {
    const a = listWindowFromScroll(100, 640, 5000, 32, 8);
    const b = listWindowFromScroll(110, 640, 5000, 32, 8); // still same floor rows + overscan
    expect(a.start).toBe(b.start);
    expect(a.end).toBe(b.end);
    expect(a.offsetY).toBe(b.offsetY);
  });

  it('crossing a row advances the window', () => {
    const a = listWindowFromScroll(0, 640, 5000, 32, 0);
    const b = listWindowFromScroll(64, 640, 5000, 32, 0);
    expect(b.start).toBeGreaterThan(a.start);
  });
});

describe('horizontalWindowFromScroll', () => {
  const SLOT = 96; // 88 + gap

  it('same slot pixel scroll keeps identical start/end', () => {
    // Both in slot 0 (0..95); ceil((scroll+800)/96) stays stable for small deltas
    const a = horizontalWindowFromScroll(10, 800, 2000, SLOT, 4);
    const b = horizontalWindowFromScroll(20, 800, 2000, SLOT, 4);
    expect(a.start).toBe(b.start);
    expect(a.end).toBe(b.end);
  });

  it('advances when crossing item width', () => {
    const a = horizontalWindowFromScroll(0, 800, 2000, SLOT, 0);
    const b = horizontalWindowFromScroll(SLOT * 3, 800, 2000, SLOT, 0);
    expect(b.start).toBe(3);
    expect(b.offsetX).toBe(SLOT * 3);
    expect(b.totalWidth).toBe(2000 * SLOT);
  });
});
