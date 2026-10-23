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
    expect(clampMaxScan(9e9)).toBe(2_000_000);
    expect(clampMaxScan(80_000)).toBe(80_000);
  });

  it('persists maxScan and exclude names', async () => {
    const saved = await saveIndexPrefs({
      maxScan: 60_000,
      excludeNames: ['Vendor', 'vendor', 'bad/path', 'node_modules', '  .cache  '],
    });
    expect(saved.maxScan).toBe(60_000);
    expect(saved.excludeNames).toEqual(['vendor', 'node_modules', '.cache']);
    const loaded = await loadIndexPrefs();
    expect(loaded.maxScan).toBe(60_000);
    expect(loaded.excludeNames).toContain('.cache');
  });

  it('merges builtin skip with user excludes', async () => {
    await saveIndexPrefs({ excludeNames: ['MyCache'] });
    const set = effectiveSkipSet(await loadIndexPrefs());
    expect(set.has('node_modules')).toBe(true);
    expect(set.has('mycache')).toBe(true);
    expect(BUILTIN_SKIP.length).toBeGreaterThan(3);
  });

  it('normalizeExcludeNames drops path segments', () => {
    expect(normalizeExcludeNames(['ok', 'a\\b', '../x', ''])).toEqual(['ok']);
  });
});
