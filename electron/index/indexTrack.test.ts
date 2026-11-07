import { afterEach, describe, expect, it } from 'vitest';
import {
  INDEX_TRACKS,
  applyIndexTrack,
  normalizeTrackId,
  resolveTrackId,
  walkKnobsFromOpts,
} from './indexTrack.mjs';

describe('indexTrack', () => {
  const prev = process.env.AURORA_INDEX_TRACK;
  afterEach(() => {
    if (prev == null) delete process.env.AURORA_INDEX_TRACK;
    else process.env.AURORA_INDEX_TRACK = prev;
  });

  it('normalizes aliases', () => {
    expect(normalizeTrackId('UI')).toBe('ui');
    expect(normalizeTrackId('perf')).toBe('perf');
    expect(normalizeTrackId('maxPerf')).toBe('perf');
    expect(normalizeTrackId('bench')).toBe('perf');
    expect(normalizeTrackId('')).toBe('ui');
  });

  it('maxPerf forces perf track', () => {
    expect(resolveTrackId({ maxPerf: true })).toBe('perf');
    expect(resolveTrackId({ track: 'ui', maxPerf: true })).toBe('perf');
  });

  it('prefs / env resolve when opts silent', () => {
    delete process.env.AURORA_INDEX_TRACK;
    expect(resolveTrackId({}, { indexTrack: 'perf' })).toBe('perf');
    expect(resolveTrackId({}, { indexTrack: 'ui' })).toBe('ui');
    process.env.AURORA_INDEX_TRACK = 'perf';
    expect(resolveTrackId({})).toBe('perf');
  });

  it('applyIndexTrack fills ui vs perf knobs without clobbering explicit', () => {
    const ui = applyIndexTrack({ track: 'ui' });
    expect(ui.track).toBe('ui');
    expect(ui.maxPerf).toBe(false);
    expect(ui.interactive).toBe(true);
    expect(ui.dripFtsDuringWalk).toBe(false);
    expect(ui.yieldEvery).toBe(INDEX_TRACKS.ui.yieldEvery);

    const perf = applyIndexTrack({ maxPerf: true, yieldEvery: 999 });
    expect(perf.track).toBe('perf');
    expect(perf.maxPerf).toBe(true);
    expect(perf.dripFtsDuringWalk).toBe(true);
    expect(perf.yieldEvery).toBe(999); // explicit wins
  });

  it('walkKnobsFromOpts mirrors track', () => {
    const ui = walkKnobsFromOpts(applyIndexTrack({ track: 'ui' }));
    expect(ui.interactive).toBe(true);
    expect(ui.maxPerf).toBe(false);
    const perf = walkKnobsFromOpts(applyIndexTrack({ track: 'perf' }));
    expect(perf.interactive).toBe(false);
    expect(perf.maxPerf).toBe(true);
  });
});
