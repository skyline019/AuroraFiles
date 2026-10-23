/**
 * Chromium 难直解的格式：经本机 ffmpeg 转 JPEG 后再预览 / 缩略。
 * 与 electron/fs-service convertImagePreview 白名单保持一致。
 */

/** 浏览器通常可直解，走 aurora-file:// */
export const NATIVE_IMAGE_EXTS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico',
] as const;

/**
 * 需 ffmpeg 抽帧转 JPEG（HEIC/HEIF/TIFF/AVIF/常见 RAW）。
 * 本机 ffmpeg 未编译对应解码器时会失败，UI 回退到系统打开。
 */
export const FFMPEG_IMAGE_EXTS = [
  'heic', 'heif',
  'tif', 'tiff',
  'avif',
  'nef', 'cr2', 'cr3', 'arw', 'dng', 'raf', 'orf', 'rw2', 'pef', 'sr2', 'srw',
] as const;

const FFMPEG_SET = new Set<string>(FFMPEG_IMAGE_EXTS);
const NATIVE_SET = new Set<string>(NATIVE_IMAGE_EXTS);

export function needsFfmpegImageDecode(ext: string): boolean {
  return FFMPEG_SET.has(ext.toLowerCase());
}

export function isNativeImageExt(ext: string): boolean {
  return NATIVE_SET.has(ext.toLowerCase());
}

/** IMAGE_EXTS = 原生 + ffmpeg 解码清单（去重） */
export function allImageExts(): string[] {
  return [...new Set([...NATIVE_IMAGE_EXTS, ...FFMPEG_IMAGE_EXTS])];
}
