import { describe, expect, it } from 'vitest';

describe('volumeRootOf contract', () => {
  it('extracts drive root', () => {
    const volumeRootOf = (abs: string) => {
      const m = String(abs).match(/^([A-Za-z]:)/);
      return m ? `${m[1]}\\` : null;
    };
    expect(volumeRootOf('D:\\Users\\x')).toBe('D:\\');
    expect(volumeRootOf('c:/temp')).toBe('c:\\');
    expect(volumeRootOf('not-a-path')).toBeNull();
  });
});
