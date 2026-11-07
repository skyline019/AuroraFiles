import { describe, expect, it } from 'vitest';
import { hasNonAscii, diskPath } from './mediaPath.mjs';
import { fsPath, logicalPath } from './index/winPath.mjs';

describe('mediaPath', () => {
  it('detects CJK / non-ascii', () => {
    expect(hasNonAscii('C:\\Users\\a\\x.webp')).toBe(false);
    expect(hasNonAscii('C:\\Users\\测试\\图.webp')).toBe(true);
    expect(hasNonAscii('E:\\My Photos\\a.jpg')).toBe(false);
  });

  it('diskPath uses namespaced form on win32', () => {
    if (process.platform !== 'win32') return;
    const p = 'E:\\Agent\\中文\\a.webp';
    const d = diskPath(p);
    expect(d.startsWith('\\\\?\\')).toBe(true);
    expect(logicalPath(d).replace(/\//g, '\\').toLowerCase()).toBe(
      'e:\\agent\\中文\\a.webp',
    );
    expect(fsPath(p)).toBe(d);
  });
});
