/**
 * PPTX 幻灯片级近似预览：解析 PresentationML 位置/图片（EMU），非完整引擎。
 * 参考：https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document
 */
import type { JSZipObject } from 'jszip';

export interface PptxSlideEl {
  kind: 'text' | 'image' | 'rect';
  /** 相对幻灯片百分比 0–100 */
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  fontSizePt?: number;
  color?: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  src?: string;
  fill?: string;
}

export interface PptxSlideView {
  title: string;
  body: string;
  bg?: string;
  elements: PptxSlideEl[];
}

const DEFAULT_CX = 12192000; // 16:9
const DEFAULT_CY = 6858000;
const MAX_SLIDES = 40;
const MAX_IMAGES_PER_SLIDE = 24;

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.max(0, Math.min(100, (n / total) * 100));
}

function attrNum(tag: string, name: string): number | null {
  const m = tag.match(new RegExp(`\\b${name}="(-?\\d+)"`, 'i'));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseXfrm(chunk: string): { x: number; y: number; cx: number; cy: number } | null {
  const offTag = chunk.match(/<(?:a:)?off\b[^>/]*\/?>/i)?.[0];
  const extTag = chunk.match(/<(?:a:)?ext\b[^>/]*\/?>/i)?.[0];
  if (!offTag || !extTag) return null;
  const x = attrNum(offTag, 'x');
  const y = attrNum(offTag, 'y');
  const cx = attrNum(extTag, 'cx');
  const cy = attrNum(extTag, 'cy');
  if (x == null || y == null || cx == null || cy == null) return null;
  return { x, y, cx, cy };
}

function srgbFrom(chunk: string): string | undefined {
  const m = chunk.match(/<(?:a:)?srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/i);
  return m ? `#${m[1]}` : undefined;
}

function schemeFallback(chunk: string): string | undefined {
  const m = chunk.match(/<(?:a:)?schemeClr\b[^>]*\bval="([^"]+)"/i);
  if (!m) return undefined;
  const map: Record<string, string> = {
    bg1: '#ffffff', bg2: '#f3f3f3', tx1: '#1a1a1a', tx2: '#44546a',
    accent1: '#4472c4', accent2: '#ed7d31', accent3: '#a5a5a5',
    accent4: '#ffc000', accent5: '#5b9bd5', accent6: '#70ad47',
  };
  return map[m[1]] || '#888888';
}

function fillOf(chunk: string): string | undefined {
  return srgbFrom(chunk) || schemeFallback(chunk);
}

function mimeOfMedia(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const m: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    bmp: 'image/bmp', webp: 'image/webp', emf: 'image/emf', wmf: 'image/wmf',
    tif: 'image/tiff', tiff: 'image/tiff',
  };
  return m[ext] || 'application/octet-stream';
}

async function toDataUrl(file: JSZipObject, mediaPath: string): Promise<string | null> {
  try {
    const b64 = await file.async('base64');
    if (!b64 || b64.length > 8_000_000) return null; // ~6MB raw cap
    return `data:${mimeOfMedia(mediaPath)};base64,${b64}`;
  } catch {
    return null;
  }
}

function parseRels(relsXml: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/gi)) {
    const tag = m[0];
    const id = tag.match(/\bId="([^"]+)"/i)?.[1];
    const target = tag.match(/\bTarget="([^"]+)"/i)?.[1];
    const type = tag.match(/\bType="([^"]+)"/i)?.[1] || '';
    if (!id || !target) continue;
    if (!/image/i.test(type) && !/\.(png|jpe?g|gif|bmp|webp|tif{1,2})$/i.test(target)) continue;
    let t = target.replace(/\\/g, '/');
    if (t.startsWith('/')) t = t.slice(1);
    if (t.startsWith('../')) t = `ppt/${t.replace(/^\.\.\//, '')}`;
    else if (!t.startsWith('ppt/')) t = `ppt/slides/${t}`.replace('/slides/../', '/');
    map.set(id, t);
  }
  return map;
}

function textsIn(chunk: string): string[] {
  return [...chunk.matchAll(/<(?:a:)?t\b[^>]*>([^<]*)<\/(?:a:)?t>/gi)]
    .map((m) => decodeXmlEntities(m[1]).trim())
    .filter(Boolean);
}

function fontSizePt(chunk: string): number | undefined {
  const m = chunk.match(/<(?:a:)?rPr\b[^>]*\bsz="(\d+)"/i);
  if (!m) return undefined;
  return Number(m[1]) / 100;
}

function alignOf(chunk: string): PptxSlideEl['align'] {
  const m = chunk.match(/<(?:a:)?pPr\b[^>]*\balgn="(l|ctr|r|just|dist)"/i);
  if (!m) return 'left';
  if (m[1] === 'ctr') return 'center';
  if (m[1] === 'r') return 'right';
  return 'left';
}

function isBold(chunk: string): boolean {
  return /<(?:a:)?rPr\b[^>]*\bb="1"/i.test(chunk) || /<(?:a:)?rPr\b[^>]*\bbold="1"/i.test(chunk);
}

function textColor(chunk: string): string | undefined {
  const run = chunk.match(/<(?:a:)?rPr\b[\s\S]*?<\/(?:a:)?rPr>/i)?.[0]
    || chunk.match(/<(?:a:)?defRPr\b[\s\S]*?\/>/i)?.[0]
    || chunk;
  return srgbFrom(run) || schemeFallback(run);
}

export async function parsePptxVisual(
  buf: ArrayBuffer,
  onProgress?: (pct: number, label?: string) => void,
): Promise<{ slides: PptxSlideView[]; cx: number; cy: number }> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);

  let cx = DEFAULT_CX;
  let cy = DEFAULT_CY;
  const pres = zip.files['ppt/presentation.xml'];
  if (pres) {
    const px = await pres.async('string');
    const sz = px.match(/<(?:p:)?sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/i)
      || px.match(/<(?:p:)?sldSz\b[^>]*\bcy="(\d+)"[^>]*\bcx="(\d+)"/i);
    if (sz) {
      cx = Number(sz[1]) || cx;
      cy = Number(sz[2]) || cy;
    }
  }

  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .slice(0, MAX_SLIDES);

  const slides: PptxSlideView[] = [];
  let imgCache = new Map<string, string | null>();

  for (let si = 0; si < names.length; si++) {
    const name = names[si];
    onProgress?.(80 + Math.floor((si / Math.max(1, names.length)) * 18), `渲染幻灯片 ${si + 1}/${names.length}…`);
    const xml = await zip.files[name].async('string');
    const num = name.match(/slide(\d+)\.xml$/i)?.[1] || String(si + 1);
    const relPath = `ppt/slides/_rels/slide${num}.xml.rels`;
    const rels = zip.files[relPath] ? parseRels(await zip.files[relPath].async('string')) : new Map<string, string>();

    const elements: PptxSlideEl[] = [];
    let bg: string | undefined;

    const bgChunk = xml.match(/<(?:p:)?bg\b[\s\S]*?<\/(?:p:)?bg>/i)?.[0]
      || xml.match(/<(?:p:)?bgPr\b[\s\S]*?<\/(?:p:)?bgPr>/i)?.[0];
    if (bgChunk) bg = fillOf(bgChunk);

    // pictures
    let imgCount = 0;
    for (const m of xml.matchAll(/<(?:p:)?pic\b[\s\S]*?<\/(?:p:)?pic>/gi)) {
      if (imgCount >= MAX_IMAGES_PER_SLIDE) break;
      const chunk = m[0];
      const xfrm = parseXfrm(chunk);
      if (!xfrm) continue;
      const rid = chunk.match(/<(?:a:)?blip\b[^>]*\b(?:r:)?embed="([^"]+)"/i)?.[1];
      if (!rid) continue;
      const mediaPath = rels.get(rid);
      if (!mediaPath || !zip.files[mediaPath]) continue;
      if (!imgCache.has(mediaPath)) {
        imgCache.set(mediaPath, await toDataUrl(zip.files[mediaPath], mediaPath));
      }
      const src = imgCache.get(mediaPath);
      if (!src) continue;
      imgCount += 1;
      elements.push({
        kind: 'image',
        x: pct(xfrm.x, cx),
        y: pct(xfrm.y, cy),
        w: pct(xfrm.cx, cx),
        h: pct(xfrm.cy, cy),
        src,
      });
    }

    // shapes (text + filled rects)
    for (const m of xml.matchAll(/<(?:p:)?sp\b[\s\S]*?<\/(?:p:)?sp>/gi)) {
      const chunk = m[0];
      const xfrm = parseXfrm(chunk);
      if (!xfrm) continue;
      const texts = textsIn(chunk);
      const fill = fillOf(chunk.match(/<(?:p:)?spPr\b[\s\S]*?(?:<(?:p:)?txBody|<(?:p:)?style|$)/i)?.[0] || chunk);
      const box = {
        x: pct(xfrm.x, cx),
        y: pct(xfrm.y, cy),
        w: pct(xfrm.cx, cx),
        h: pct(xfrm.cy, cy),
      };
      // near full-slide solid as bg if no explicit bg
      if (!bg && fill && box.w > 90 && box.h > 90 && texts.length === 0) {
        bg = fill;
        continue;
      }
      if (fill && texts.length === 0 && box.w * box.h > 0.5) {
        elements.push({ kind: 'rect', ...box, fill });
      }
      if (texts.length) {
        elements.push({
          kind: 'text',
          ...box,
          text: texts.join('\n'),
          fontSizePt: fontSizePt(chunk),
          color: textColor(chunk) || '#1a1a1a',
          bold: isBold(chunk),
          align: alignOf(chunk),
          fill: fill && box.w * box.h > 1 ? fill : undefined,
        });
      }
    }

    const allText = textsIn(xml);
    const title = allText[0] || `幻灯片 ${si + 1}`;
    const body = allText.slice(1).join('\n') || (allText.length ? allText[0] : '（无文本）');

    // z-order: rects under images under text
    elements.sort((a, b) => {
      const rank = (k: PptxSlideEl['kind']) => (k === 'rect' ? 0 : k === 'image' ? 1 : 2);
      return rank(a.kind) - rank(b.kind);
    });

    slides.push({ title, body, bg: bg || '#ffffff', elements });
  }

  return { slides, cx, cy };
}
