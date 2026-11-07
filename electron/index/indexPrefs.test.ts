import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configureIndexDir } from './persist.mjs';
import {
  clampMaxScan,
  effectiveSkipSet,
  loadIndexPrefs,
  normalizeExcludeNames,
  saveIndexPrefs,
  resetIndexPrefsCache,
  BUILTIN_SKIP,
} from './indexPrefs.mjs';

describe('indexPrefs', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-prefs-'));
    resetIndexPrefsCache();
    configureIndexDir(dir);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('clamps maxScan', () => {
    expect(clampMaxScan(100)).toBe(5_000);
    expect(clampMaxScan(9e9)).toBe(50_000_000);
    expect(clampMaxScan(0)).toBe(50_000_000);
    expect(clampMaxScan(-1)).toBe(50_000_000);
    expect(clampMaxScan(80_000)).toBe(80_000);
    expect(clampMaxScan(2_000_000)).toBe(2_000_000);
  });

  it('migrates legacy default 120000 → 2M', async () => {
    await saveIndexPrefs({ maxScan: 120_000, excludeNames: [] });
    // Bypass cache as if cold load
    resetIndexPrefsCache();
    // save wrote 120k clamped; re-save raw file to simulate old prefs
    const fs = await import('node:fs/promises');
    const { getIndexDir } = await import('./persist.mjs');
    const p = path.join(getIndexDir(), 'index-prefs.json');
    await fs.writeFile(p, JSON.stringify({ maxScan: 120000, excludeNames: [] }), 'utf8');
    resetIndexPrefsCache();
    const loaded = await loadIndexPrefs();
    expect(loaded.maxScan).toBe(2_000_000);
  });

  it('persists maxScan and exclude names', async () => {
    const saved = await saveIndexPrefs({
      maxScan: 60_000,
      excludeNames: ['Vendor', 'vendor', 'bad/path', 'node_modules', '  .cache  '],
      indexTrack: 'perf',
    });
    expect(saved.maxScan).toBe(60_000);
    expect(saved.excludeNames).toEqual(['vendor', 'node_modules', '.cache']);
    expect(saved.indexTrack).toBe('perf');
    const loaded = await loadIndexPrefs();
    expect(loaded.maxScan).toBe(60_000);
    expect(loaded.excludeNames).toContain('.cache');
    expect(loaded.indexTrack).toBe('perf');
  });

  it('merges builtin skip with user excludes', async () => {
    await saveIndexPrefs({ excludeNames: ['MyCache'] });
    const set = effectiveSkipSet(await loadIndexPrefs());
    expect(set.has('node_modules')).toBe(true);
    expect(set.has('mycache')).toBe(true);
    expect(set.has('appdata')).toBe(true);
    expect(BUILTIN_SKIP.length).toBeGreaterThan(8);
  });

  it('normalizeExcludeNames drops path segments', () => {
    expect(normalizeExcludeNames(['ok', 'a\\b', '../x', ''])).toEqual(['ok']);
  });
});
