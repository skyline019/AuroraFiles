/** 文本预览解码：UTF-8 / UTF-16 / GBK（Chromium） */

function hasBomUtf8(u8: Uint8Array): boolean {
  return u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf;
}

function hasBomUtf16Le(u8: Uint8Array): boolean {
  return u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe;
}

function hasBomUtf16Be(u8: Uint8Array): boolean {
  return u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff;
}

function tryDecode(u8: Uint8Array, label: string): string | null {
  try {
    const dec = new TextDecoder(label, { fatal: true });
    return dec.decode(u8);
  } catch {
    try {
      const dec = new TextDecoder(label, { fatal: false });
      const s = dec.decode(u8);
      // 过多替换字符则视为失败
      const bad = (s.match(/\uFFFD/g) || []).length;
      if (bad > Math.max(3, s.length * 0.02)) return null;
      return s;
    } catch {
      return null;
    }
  }
}

export function decodeTextBytes(bytes: Uint8Array): { text: string; encoding: string } {
  if (hasBomUtf8(bytes)) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8-bom' };
  }
  if (hasBomUtf16Le(bytes)) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  }
  if (hasBomUtf16Be(bytes)) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  }

  const utf8 = tryDecode(bytes, 'utf-8');
  if (utf8 !== null) return { text: utf8, encoding: 'utf-8' };

  for (const enc of ['gbk', 'gb18030', 'big5', 'shift_jis']) {
    const s = tryDecode(bytes, enc);
    if (s !== null) return { text: s, encoding: enc };
  }

  return { text: new TextDecoder('utf-8', { fatal: false }).decode(bytes), encoding: 'utf-8-lossy' };
}

export function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
