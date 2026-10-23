import { describe, expect, it } from 'vitest';
import {
  FFMPEG_IMAGE_EXTS,
  NATIVE_IMAGE_EXTS,
  allImageExts,
  isNativeImageExt,
  needsFfmpegImageDecode,
} from './mediaDecode';
import { IMAGE_EXTS, categoryOf } from './fs';

describe('mediaDecode', () => {
  it('flags TIFF / AVIF / HEIF / RAW for ffmpeg', () => {
    for (const ext of ['tif', 'tiff', 'avif', 'heic', 'heif', 'nef', 'cr2', 'cr3', 'dng', 'arw']) {
      expect(needsFfmpegImageDecode(ext)).toBe(true);
    }
  });

  it('keeps jpg/png/webp native', () => {
    for (const ext of NATIVE_IMAGE_EXTS) {
      expect(isNativeImageExt(ext)).toBe(true);
      expect(needsFfmpegImageDecode(ext)).toBe(false);
    }
  });

  it('IMAGE_EXTS unions native + ffmpeg lists', () => {
    const all = allImageExts();
    expect(IMAGE_EXTS).toEqual(all);
    for (const ext of FFMPEG_IMAGE_EXTS) expect(IMAGE_EXTS).toContain(ext);
    for (const ext of NATIVE_IMAGE_EXTS) expect(IMAGE_EXTS).toContain(ext);
  });

  it('categoryOf classifies new formats as image', () => {
    expect(categoryOf('avif')).toBe('image');
    expect(categoryOf('heif')).toBe('image');
    expect(categoryOf('cr3')).toBe('image');
    expect(categoryOf('dng')).toBe('image');
  });
});
