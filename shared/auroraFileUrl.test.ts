import { describe, expect, it } from 'vitest';
import { fromAuroraFileUrl, mimeFromPath, toAuroraFileUrl } from './auroraFileUrl.mjs';

describe('auroraFileUrl', () => {
  it('encodes spaces and CJK while keeping drive letter', () => {
    const url = toAuroraFileUrl('C:\\Users\\My Photos\\测试\\a.jpg');
    expect(url).toBe('aurora-file:///C:/Users/My%20Photos/%E6%B5%8B%E8%AF%95/a.jpg');
    expect(fromAuroraFileUrl(url).toLowerCase()).toBe('c:\\users\\my photos\\测试\\a.jpg');
  });

  it('maps jpeg/png MIME', () => {
    expect(mimeFromPath('x.jpg')).toBe('image/jpeg');
    expect(mimeFromPath('x.PNG')).toBe('image/png');
    expect(mimeFromPath('x.webp')).toBe('image/webp');
  });

  it('round-trips deep CJK + webp', () => {
    const abs = 'D:\\资料\\相册\\风景\\夕阳.webp';
    const url = toAuroraFileUrl(abs);
    expect(url).toContain('%E8%B5%84%E6%96%99');
    expect(url.endsWith('.webp')).toBe(true);
    expect(fromAuroraFileUrl(url).toLowerCase()).toBe(abs.toLowerCase());
  });
});
