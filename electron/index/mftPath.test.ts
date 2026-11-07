import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWalkEngine, resolveMftWalkBin, walkVolume } from './walkEngine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const MFT_BIN = path.join(REPO, 'native', 'mft-enum', 'build', 'Release', 'aurora-mft-enum.exe');

describe('mft-cxx path rebuild + WalkEngine', () => {
  it('path_rebuild self-test passes when binary present', () => {
    if (!fs.existsSync(MFT_BIN)) {
      expect(resolveMftWalkBin()).toBeNull();
      return;
    }
    const r = spawnSync(MFT_BIN, ['--self-test'], { encoding: 'utf8', windowsHide: true });
    expect(r.status).toBe(0);
    const row = JSON.parse(String(r.stdout).trim().split(/\r?\n/).pop()!);
    expect(row.ok).toBe(true);
  });

  it('js engine still walks small trees; mft resolves when forced with bin', async () => {
    expect(resolveWalkEngine('C:\\tmp\\not-a-vol', { engine: 'js' })).toBe('js');
    if (fs.existsSync(MFT_BIN)) {
      expect(resolveWalkEngine('E:\\', { engine: 'mft' })).toBe('mft');
    }
    const tree = await fsp.mkdtemp(path.join(os.tmpdir(), 'aurora-mft-fb-'));
    try {
      await fsp.writeFile(path.join(tree, 'a.txt'), '1');
      const entries: { path: string }[] = [];
      const stats = await walkVolume(tree, {
        engine: 'js',
        maxDepth: 4,
        maxScan: 100,
        onEntry: (e: { path: string }) => entries.push(e),
      });
      expect(stats.engine).toBe('js');
      expect(entries.length).toBeGreaterThanOrEqual(1);
    } finally {
      await fsp.rm(tree, { recursive: true, force: true });
    }
  });
});
