import { describe, expect, it } from 'vitest';
import { base64ToUint8, decodeTextBytes } from './textDecode';

describe('decodeTextBytes', () => {
  it('decodes utf-8', () => {
    const bytes = new TextEncoder().encode('你好 Aurora');
    const r = decodeTextBytes(bytes);
    expect(r.text).toContain('你好');
    expect(r.encoding).toMatch(/utf-8/);
  });

  it('strips utf-8 BOM', () => {
    const body = new TextEncoder().encode('hello');
    const bytes = new Uint8Array(3 + body.length);
    bytes.set([0xef, 0xbb, 0xbf], 0);
    bytes.set(body, 3);
    expect(decodeTextBytes(bytes).text).toBe('hello');
  });
});

describe('base64ToUint8', () => {
  it('roundtrips ascii', () => {
    const b64 = btoa('abc');
    expect(String.fromCharCode(...base64ToUint8(b64))).toBe('abc');
  });
});
