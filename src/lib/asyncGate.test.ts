import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bumpGen,
  createDebouncedRefCount,
  galleryStepPool,
  isCurrentGen,
  stepInPool,
} from './asyncGate';

describe('createDebouncedRefCount', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays active across overlapping enter/leave', () => {
    vi.useFakeTimers();
    const seen: boolean[] = [];
    const gate = createDebouncedRefCount({
      hideDelayMs: 100,
      onChange: (v) => seen.push(v),
    });
    gate.enter();
    gate.enter();
    expect(gate.count).toBe(2);
    expect(gate.active).toBe(true);
    gate.leave();
    expect(gate.active).toBe(true);
    gate.leave();
    expect(gate.count).toBe(0);
    // 防抖：尚未关
    expect(gate.active).toBe(true);
    vi.advanceTimersByTime(100);
    expect(gate.active).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it('re-enter during hide delay keeps visible', () => {
    vi.useFakeTimers();
    const gate = createDebouncedRefCount({ hideDelayMs: 80, onChange: () => undefined });
    gate.enter();
    gate.leave();
    vi.advanceTimersByTime(40);
    gate.enter();
    vi.advanceTimersByTime(80);
    expect(gate.active).toBe(true);
    expect(gate.count).toBe(1);
  });
});

describe('deep search gen', () => {
  it('invalidates stale gens after bump', () => {
    let gen = 0;
    const mine = bumpGen(gen);
    gen = mine;
    expect(isCurrentGen(mine, gen)).toBe(true);
    gen = bumpGen(gen);
    expect(isCurrentGen(mine, gen)).toBe(false);
  });
});

describe('galleryStepPool / stepInPool', () => {
  it('skips folders when files exist', () => {
    const items = [
      { id: 'a', kind: 'folder' },
      { id: 'b', kind: 'file' },
      { id: 'c', kind: 'folder' },
      { id: 'd', kind: 'file' },
    ];
    const pool = galleryStepPool(items);
    expect(pool.map((x) => x.id)).toEqual(['b', 'd']);
    expect(stepInPool(pool.map((x) => x.id), 'b', 1)).toBe('d');
    expect(stepInPool(pool.map((x) => x.id), 'd', 1)).toBe('d');
  });

  it('falls back to all items when no files', () => {
    const items = [
      { id: 'a', kind: 'folder' },
      { id: 'b', kind: 'folder' },
    ];
    expect(galleryStepPool(items).map((x) => x.id)).toEqual(['a', 'b']);
  });
});
