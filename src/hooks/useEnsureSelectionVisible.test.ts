import { describe, expect, it, vi } from 'vitest';
import { listScrollToIndex } from './useEnsureSelectionVisible';

describe('listScrollToIndex', () => {
  it('centers the target row in the viewport', () => {
    const scrollTo = vi.fn();
    const el = {
      clientHeight: 400,
      scrollTo,
    } as unknown as HTMLElement;
    listScrollToIndex(30)(el, 100);
    expect(scrollTo).toHaveBeenCalledWith({
      top: 100 * 30 - 200 + 15,
      behavior: 'auto',
    });
  });

  it('clamps negative tops to 0', () => {
    const scrollTo = vi.fn();
    const el = { clientHeight: 400, scrollTo } as unknown as HTMLElement;
    listScrollToIndex(30)(el, 0);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });
});
