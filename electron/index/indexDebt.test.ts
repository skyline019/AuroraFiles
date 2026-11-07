import { describe, it, expect } from 'vitest';
import { IndexDebt } from './indexDebt.mjs';

describe('IndexDebt', () => {
  it('pays higher priority first and supports pause', async () => {
    const d = new IndexDebt();
    const paid: string[] = [];
    d.payer = async (kind) => {
      paid.push(kind);
      d.clear(kind);
      return 1;
    };
    d.owe('frn');
    d.owe('fts');
    d.owe('persist');
    d.owe('space');
    expect(d.depth()).toBe(4);
    d.pauseForQuery();
    expect((await d.paySlice()).paid).toBe(0);
    d.resumeAfterQuery();
    await d.paySlice();
    expect(paid[0]).toBe('fts');
    await d.paySlice();
    expect(paid[1]).toBe('frn');
    await d.paySlice();
    expect(paid[2]).toBe('persist');
    await d.paySlice();
    expect(paid[3]).toBe('space');
    expect(d.depth()).toBe(0);
  });
});
