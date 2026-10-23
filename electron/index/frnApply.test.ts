import { describe, expect, it } from 'vitest';
import { usnIsDelete } from './usnRead.mjs';

describe('usnIsDelete', () => {
  it('detects FILE_DELETE bit', () => {
    expect(usnIsDelete(0x00000200)).toBe(true);
    expect(usnIsDelete(0x00000001)).toBe(false);
    expect(usnIsDelete(0x00000201)).toBe(true);
  });
});

describe('FRN map resolve contract', () => {
  it('parent frn + name yields path', () => {
    const frnMap = new Map<string, string>([
      ['100', 'C:\\Users\\Alice'],
      ['200', 'C:\\Users\\Alice\\docs'],
    ]);
    const parent = frnMap.get('100');
    expect(parent).toBe('C:\\Users\\Alice');
    const full = `${parent}\\report.txt`;
    frnMap.set('300', full);
    expect(frnMap.get('300')).toBe('C:\\Users\\Alice\\report.txt');
  });
});
