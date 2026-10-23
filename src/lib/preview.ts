/**
 * 文件预览加载：真盘走 Electron IPC / aurora-file 协议；演示模式用节点内嵌字段。
 * Office 解析库按需动态 import，避免拖垮首屏包体。
 */
import { api, isElectron, isRealId } from './aurora';
import { categoryOf, extOf, FSNode, IMAGE_EXTS } from './fs';
import { needsFfmpegImageDecode } from './mediaDecode';
import { base64ToUint8, decodeTextBytes } from './textDecode';

export const TEXT_PREVIEW_EXTS = [
  'txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'json', 'jsonc', 'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'css', 'scss', 'less', 'html', 'htm', 'vue', 'svelte',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'sql',
  'ps1', 'psm1', 'psd1', 'bat', 'cmd', 'sh', 'bash', 'zsh', 'fish', 'env', 'gitignore', 'dockerfile',
];

export type PreviewKind =
  | 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'docx' | 'xlsx' | 'pptx' | 'fallback';

export interface PreviewPayload {
  kind: PreviewKind;
  url?: string;
  text?: string;
  html?: string;
  truncated?: boolean;
  sheets?: { name: string; rows: string[][] }[];
  slides?: import('./previewPptx').PptxSlideView[];
  error?: string;
  meta?: string;
  poster?: string;
}

export interface LoadPreviewOpts {
  /** 分栏紧凑预览时跳过 ffmpeg 封面，加快首屏 */
  skipPoster?: boolean;
  /** 0–100 进度回调（大 Office / 视频封面） */
  onProgress?: (pct: number, label?: string) => void;
}

const MAX_CACHE = 48;
const cache = new Map<string, PreviewPayload>();
const inflight = new Map<string, Promise<PreviewPayload>>();
const MAX_TEXT = 200_000;

function cacheSet(key: string, value: PreviewPayload) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

function mimeOf(ext: string): string {
  const m: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    bmp: 'image/bmp', svg: 'image/svg+xml', heic: 'image/heic', heif: 'image/heif',
    avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff',
    nef: 'image/x-nikon-nef', cr2: 'image/x-canon-cr2', dng: 'image/x-adobe-dng', arw: 'image/x-sony-arw',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
    mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac', ogg: 'audio/ogg', m4a: 'audio/mp4', wma: 'audio/x-ms-wma',
    pdf: 'application/pdf',
  };
  return m[ext] || 'application/octet-stream';
}

export function previewKindOf(name: string): PreviewKind {
  const ext = extOf(name);
  const cat = categoryOf(ext);
  if (cat === 'image' || IMAGE_EXTS.includes(ext)) return 'image';
  if (cat === 'video') return 'video';
  if (cat === 'audio') return 'audio';
  if (cat === 'pdf' || ext === 'pdf') return 'pdf';
  if (ext === 'docx' || ext === 'doc') return 'docx';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return ext === 'csv' ? 'text' : 'xlsx';
  if (ext === 'pptx' || ext === 'ppt') return 'pptx';
  if (TEXT_PREVIEW_EXTS.includes(ext) || cat === 'text' || cat === 'code') return 'text';
  return 'fallback';
}

export function canInlinePreview(name: string): boolean {
  return previewKindOf(name) !== 'fallback';
}

/** 与主进程 toAuroraFileUrl 规则一致，渲染进程可同步构造 */
export function fileSrcUrl(absPath: string): string {
  if (!absPath) return '';
  const slash = absPath.replace(/\\/g, '/');
  return `aurora-file:///${slash}`;
}


/** Playwright：localStorage aurora-e2e-pptx-visual=1 时注入幻灯片画布 mock */
function e2ePptxVisualMock(): PreviewPayload | null {
  try {
    if (typeof localStorage === 'undefined' || localStorage.getItem('aurora-e2e-pptx-visual') !== '1') {
      return null;
    }
  } catch {
    return null;
  }
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  return {
    kind: 'pptx',
    meta: 'e2e mock · 幻灯片画布',
    slides: [
      {
        title: 'E2E Slide',
        body: 'canvas',
        bg: '#102030',
        elements: [
          { kind: 'rect', x: 5, y: 8, w: 90, h: 18, fill: '#0a84ff' },
          {
            kind: 'text',
            x: 8,
            y: 10,
            w: 84,
            h: 14,
            text: 'E2E Canvas',
            color: '#ffffff',
            bold: true,
            align: 'center',
            fontSizePt: 28,
          },
          { kind: 'image', x: 30, y: 40, w: 40, h: 45, src: png },
        ],
      },
    ],
  };
}

async function loadPreviewUncached(
  node: FSNode,
  absPath: string | null | undefined,
  opts?: LoadPreviewOpts,
): Promise<PreviewPayload> {
  const kind = previewKindOf(node.name);

  if (kind === 'pptx') {
    const mock = e2ePptxVisualMock();
    if (mock) return mock;
  }

  if (!absPath || !isRealId(node.id)) {
    if (kind === 'image' && (node.imageUrl || node.thumbUrl)) {
      return { kind, url: node.imageUrl || node.thumbUrl };
    }
    if (kind === 'text' && node.content !== undefined) {
      return { kind, text: node.content };
    }
  }

  try {
    if (!absPath || !isElectron()) {
      const p: PreviewPayload = {
        kind: kind === 'fallback' ? 'fallback' : kind,
        text: node.content,
        url: node.imageUrl || node.thumbUrl,
        error: kind !== 'fallback' && !node.content && !node.imageUrl ? '当前环境无法读取本地文件' : undefined,
        meta: mimeOf(extOf(node.name)),
      };
      if (kind === 'image' && p.url) return p;
      if (kind === 'text' && p.text !== undefined) return p;
      return p;
    }

    if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf') {
      const ext = extOf(node.name);
      // TIFF / AVIF / HEIF / 常见 RAW：ffmpeg → JPEG
      if (kind === 'image' && needsFfmpegImageDecode(ext)) {
        opts?.onProgress?.(30, '转码预览…');
        try {
          const conv = await api().imagePreview(absPath, { maxEdge: 2048 });
          if (conv?.url) {
            return { kind: 'image', url: conv.url, meta: conv.meta || `${ext}→jpeg` };
          }
        } catch { /* fallthrough */ }
        return {
          kind: 'image',
          error: `${ext.toUpperCase()} 内置转码失败，请点「打开」用系统应用查看`,
        };
      }
      const url = fileSrcUrl(absPath);
      const p: PreviewPayload = { kind, url, meta: mimeOf(ext) };
      if (kind === 'video') {
        opts?.onProgress?.(20, '准备播放…');
        if (!opts?.skipPoster) {
          opts?.onProgress?.(40, '生成封面…');
          const poster = await tryVideoPoster(absPath);
          if (poster) p.poster = poster;
          opts?.onProgress?.(90, '就绪');
        } else {
          opts?.onProgress?.(100, '就绪');
        }
      }
      return p;
    }

    if (kind === 'text') {
      const raw = await api().readText(absPath, MAX_TEXT);
      if (typeof raw === 'string') {
        return { kind: 'text', text: raw, truncated: raw.length >= MAX_TEXT - 16 };
      }
      const { text, encoding } = decodeTextBytes(base64ToUint8(raw.base64));
      return {
        kind: 'text',
        text,
        truncated: !!raw.truncated,
        meta: encoding,
      };
    }

    if (kind === 'docx' || kind === 'xlsx' || kind === 'pptx') {
      opts?.onProgress?.(5, '加载 Office 解析器…');
      const office = await import('./previewOffice');
      if (kind === 'docx') return office.previewDocx(absPath, node.name, opts?.onProgress);
      if (kind === 'xlsx') return office.previewXlsx(absPath, node.name, opts?.onProgress);
      return office.previewPptx(absPath, node.name, opts?.onProgress);
    }

    return { kind: 'fallback' };
  } catch (err) {
    return { kind, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function loadPreview(
  node: FSNode,
  absPath?: string | null,
  opts?: LoadPreviewOpts,
): Promise<PreviewPayload> {
  const kind = previewKindOf(node.name);
  const cacheKey = `${node.id}:${node.modifiedAt}:${kind}:${opts?.skipPoster ? 'np' : 'p'}`;
  const hit = cache.get(cacheKey);
  if (hit) {
    // LRU touch
    cacheSet(cacheKey, hit);
    return hit;
  }
  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const job = loadPreviewUncached(node, absPath, opts).then((p) => {
    cacheSet(cacheKey, p);
    inflight.delete(cacheKey);
    return p;
  }).catch((err) => {
    inflight.delete(cacheKey);
    throw err;
  });
  inflight.set(cacheKey, job);
  return job;
}

export function clearPreviewCache(id?: string) {
  if (!id) { cache.clear(); inflight.clear(); return; }
  for (const k of [...cache.keys()]) if (k.startsWith(`${id}:`)) cache.delete(k);
  for (const k of [...inflight.keys()]) if (k.startsWith(`${id}:`)) inflight.delete(k);
}

/** 尝试用本机 ffmpeg 生成视频封面（失败则静默）；预览用较大边长 */
export async function tryVideoPoster(absPath: string, maxEdge = 1280): Promise<string | null> {
  if (!isElectron()) return null;
  const key = `poster:${maxEdge}:${absPath}`;
  const hit = cache.get(key);
  if (hit?.poster) return hit.poster;
  try {
    const r = await api().videoPoster(absPath, { maxEdge });
    const url = r?.url || null;
    if (url) cacheSet(key, { kind: 'video', poster: url });
    return url;
  } catch {
    return null;
  }
}
