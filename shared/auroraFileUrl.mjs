/**
 * Shared aurora-file:// helpers (main + renderer).
 * Must percent-encode path segments and expose MIME for Chromium <img>/<video>.
 */

/** @param {string} filePath */
export function mimeFromPath(filePath) {
  const ext = String(filePath).split('.').pop()?.toLowerCase() || '';
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    jfif: 'image/jpeg',
    jpe: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    avif: 'image/avif',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    heic: 'image/heic',
    heif: 'image/heif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    aac: 'audio/aac',
    m4a: 'audio/mp4',
    pdf: 'application/pdf',
  };
  return map[ext] || 'application/octet-stream';
}

/**
 * Build aurora-file:///C:/Users/... with encoded segments (spaces, CJK, #, ?).
 * @param {string} absPath win32 absolute path
 */
export function toAuroraFileUrl(absPath) {
  const slash = String(absPath || '').replace(/\\/g, '/');
  if (!slash) return 'aurora-file:///';
  const parts = slash.split('/');
  const encoded = parts
    .map((seg, i) => {
      if (i === 0 && /^[A-Za-z]:$/.test(seg)) return seg; // keep C:
      if (!seg) return '';
      return encodeURIComponent(seg);
    })
    .join('/');
  return `aurora-file:///${encoded}`;
}

/**
 * @param {string} url
 * @returns {string} normalized win32 path
 */
export function fromAuroraFileUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'aurora-file:') throw new Error('协议错误');
  let pathname = decodeURIComponent(u.pathname || '');
  if (pathname.startsWith('/') && /^[A-Za-z]:/.test(pathname.slice(1))) {
    pathname = pathname.slice(1);
  }
  return pathname.replace(/\//g, '\\');
}
