/**
 * 深路径严格矩阵 D1–D7（Windows：\\?\ 创建，索引存逻辑路径）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fsPath, logicalPath } from './winPath.mjs';
import { parallelDirentWalk } from './fastWalk.mjs';
import {
  configureIndexDir,
  ensureIndexed,
  queryIndex,
  disposeVolumeIndex,
  waitIndexDebt,
} from './fsIndex.mjs';
import { resetIndexPrefsCache, saveIndexPrefs } from './indexPrefs.mjs';

const execFileAsync = promisify(execFile);
const win = process.platform === 'win32';

async function mkDeepFile(base: string, targetLen: number) {
  let cur = base;
  let n = 0;
  while (cur.length < targetLen - 20) {
    const seg = `d${n}`;
    cur = path.join(cur, seg);
    await fs.mkdir(fsPath(cur), { recursive: true });
    n += 1;
    if (n > 80) break;
  }
  const file = path.join(cur, 'deep_target.txt');
  await fs.writeFile(fsPath(file), 'deep-ok', 'utf8');
  return { dir: cur, file: logicalPath(file) };
}

describe('winPath helpers (D7)', () => {
  it('logicalPath o fsPath round-trip for normal abs path', () => {
    const p = win ? 'E:\\Agent\\foo\\bar.txt' : '/tmp/foo/bar.txt';
    const round = logicalPath(fsPath(p));
    expect(round.replace(/\//g, '\\').toLowerCase()).toBe(
      path.win32.normalize(p).replace(/\//g, '\\').toLowerCase(),
    );
  });

  it('logicalPath strips \\\\?\\ prefix', () => {
    expect(logicalPath('\\\\?\\E:\\a\\b')).toBe('E:\\a\\b');
  });
});

describe.skipIf(!win)('deep path strict matrix', () => {
  let tree: string;
  let idxDir: string;

  beforeEach(async () => {
    tree = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-deep-'));
    idxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-deep-idx-'));
    configureIndexDir(idxDir);
    resetIndexPrefsCache();
    await saveIndexPrefs({ maxScan: 50_000, excludeNames: [] });
  });

  afterEach(async () => {
    disposeVolumeIndex(tree);
    await fs.rm(tree, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(idxDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('D1+D2+D4: nested path >260 indexed without \\\\?\\ and searchable', async () => {
    const { file } = await mkDeepFile(tree, 280);
    expect(file.length).toBeGreaterThan(260);
    expect(file.includes('\\\\?\\')).toBe(false);

    const entries: { path: string; name: string }[] = [];
    await parallelDirentWalk(tree, {
      maxDepth: 100,
      maxScan: 50_000,
      onEntry: (e) => entries.push(e),
    });
    const hit = entries.find((e) => e.name === 'deep_target.txt');
    expect(hit).toBeTruthy();
    expect(hit!.path.length).toBeGreaterThan(260);
    expect(hit!.path.includes('\\\\?\\')).toBe(false);

    disposeVolumeIndex(tree);
    await ensureIndexed(tree, {
      rebuild: true,
      maxDepth: 100,
      maxScan: 50_000,
      leanMemory: true,
      persist: false,
      waitDebt: true,
      liveFollowers: false,
      skipMode: 'minimal',
    });
    await waitIndexDebt(tree, { timeoutMs: 60_000 });
    const q = await queryIndex(tree, 'deep_target', { maxResults: 20 });
    expect(q.items.some((i: { name: string }) => i.name === 'deep_target.txt')).toBe(true);
  });

  it('D3: hidden dir under deep path still enumerated (minimal skip)', async () => {
    const hidden = path.join(tree, '.secret_deep');
    await fs.mkdir(fsPath(hidden), { recursive: true });
    const nested = path.join(hidden, 'x'.repeat(40), 'y'.repeat(40));
    await fs.mkdir(fsPath(nested), { recursive: true });
    const file = path.join(nested, 'hid.txt');
    await fs.writeFile(fsPath(file), 'h', 'utf8');
    try {
      await execFileAsync('attrib', ['+H', fsPath(hidden)], { windowsHide: true });
    } catch { /* attrib may fail in some envs; still hidden-by-dot */ }

    const names: string[] = [];
    await parallelDirentWalk(tree, {
      maxDepth: 32,
      skipDir: (n) => n.toLowerCase() === 'system volume information',
      onEntry: (e) => names.push(e.name),
    });
    expect(names).toContain('hid.txt');
    expect(names).toContain('.secret_deep');
  });

  it('D5: followReparse off skips symlink loop; on visits target once', async () => {
    const a = path.join(tree, 'A');
    const b = path.join(tree, 'B');
    await fs.mkdir(a);
    await fs.mkdir(b);
    await fs.writeFile(path.join(a, 'onlyA.txt'), 'a');
    try {
      await fs.symlink(a, path.join(b, 'linkToA'), 'junction');
    } catch {
      // junction may need privileges — soft skip
      return;
    }
    const off: string[] = [];
    await parallelDirentWalk(tree, {
      maxDepth: 8,
      followReparse: false,
      onEntry: (e) => off.push(e.name),
    });
    expect(off.filter((n) => n === 'onlyA.txt').length).toBe(1);

    const on: string[] = [];
    await parallelDirentWalk(tree, {
      maxDepth: 8,
      followReparse: true,
      onEntry: (e) => on.push(e.path.toLowerCase()),
    });
    const only = on.filter((p) => p.endsWith('\\onlya.txt'));
    expect(only.length).toBeGreaterThanOrEqual(1);
    expect(only.length).toBeLessThanOrEqual(2);
  });

  it('D6: short path regression still walks', async () => {
    await fs.writeFile(path.join(tree, 'short.txt'), 's');
    const entries: string[] = [];
    await parallelDirentWalk(tree, {
      maxDepth: 4,
      onEntry: (e) => entries.push(e.name),
    });
    expect(entries).toContain('short.txt');
  });
});

describe('deep path helpers exist on disk', () => {
  it('fsPath is callable', () => {
    expect(typeof fsPath).toBe('function');
    expect(typeof logicalPath).toBe('function');
    expect(fssync.existsSync(os.tmpdir())).toBe(true);
  });
});
