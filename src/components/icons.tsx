import { useEffect, useState } from 'react';
import {
  Music, Film, Archive, Code2, FileText, Image as ImageIcon, Table2, Presentation,
  FileType, Type, Database, FileCog, Link2, File, AppWindow, Star, Clock, Monitor,
} from 'lucide-react';
import { FSNode, ID, extOf, categoryOf, tagHex } from '@/lib/fs';
import { resolveImageThumbUrl, resolveVideoThumbUrl } from '@/lib/mediaThumb';

// ── macOS 风文件夹 ──────────────────────────────────────────
export function FolderIcon({ size, tint = '#58a6f5' }: { size: number; tint?: string }) {
  return (
    <svg width={size} height={size * 0.82} viewBox="0 0 64 52" fill="none" style={{ filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,.18))' }}>
      <defs>
        <linearGradient id="fol-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={tint} /><stop offset="1" stopColor="#3f8fd9" />
        </linearGradient>
        <linearGradient id="fol-f" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8ec7f9" /><stop offset="1" stopColor={tint} />
        </linearGradient>
      </defs>
      <path d="M2 12a6 6 0 0 1 6-6h13.5c2 0 3.8 1 4.9 2.7L28.6 12H56a6 6 0 0 1 6 6v26a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6V12Z" fill="url(#fol-b)" />
      <path d="M2 20a6 6 0 0 1 6-6h48a6 6 0 0 1 6 6v24a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6V20Z" fill="url(#fol-f)" />
      <path d="M8 14h48a6 6 0 0 1 6 6v1.5A6 6 0 0 0 56 16H8a6 6 0 0 0-6 5.5V20a6 6 0 0 1 6-6Z" fill="#fff" opacity=".35" />
    </svg>
  );
}

// ── 磁盘图标 ────────────────────────────────────────────────
export function DriveIcon({ size, removable }: { size: number; removable?: boolean }) {
  return (
    <svg width={size} height={size * 0.82} viewBox="0 0 64 52" fill="none" style={{ filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,.2))' }}>
      <defs>
        <linearGradient id="drv" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e8e9ec" /><stop offset="1" stopColor="#b9bcc4" />
        </linearGradient>
      </defs>
      <rect x="2" y="8" width="60" height="36" rx="7" fill="url(#drv)" />
      <rect x="2" y="8" width="60" height="36" rx="7" stroke="#000" strokeOpacity=".12" />
      <rect x="8" y="12" width="48" height="5" rx="2.5" fill="#fff" opacity=".55" />
      <rect x="44" y="34" width="12" height="4" rx="2" fill={removable ? '#30d158' : '#5e5ce6'} />
      <circle cx="10" cy="36" r="2" fill="#8e8e93" />
    </svg>
  );
}

// ── 回收站 ──────────────────────────────────────────────────
export function TrashGlyph({ size, full }: { size: number; full?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,.18))' }}>
      <defs>
        <linearGradient id="trash" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4f4f6" /><stop offset="1" stopColor="#c9c9cf" />
        </linearGradient>
      </defs>
      {full && <circle cx="40" cy="12" r="6" fill="#fff" stroke="#c9c9cf" />}
      {full && <circle cx="26" cy="10" r="5" fill="#fdfdfd" stroke="#d2d2d7" />}
      <path d="M12 18h40l-3.5 36a6 6 0 0 1-6 5.5h-21a6 6 0 0 1-6-5.5L12 18Z" fill="url(#trash)" stroke="#000" strokeOpacity=".1" />
      <path d="M22 24l2 30M32 24v30M42 24l-2 30" stroke="#a7a7ad" strokeWidth="2" strokeLinecap="round" opacity=".8" />
      <rect x="8" y="13" width="48" height="5" rx="2.5" fill="#dcdce1" stroke="#000" strokeOpacity=".08" />
    </svg>
  );
}

// ── 彩色 squircle 包裹 ──────────────────────────────────────
function Squircle({ size, from, to, children }: { size: number; from: string; to: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center text-white"
      style={{
        width: size, height: size, borderRadius: size * 0.26,
        background: `linear-gradient(160deg, ${from}, ${to})`,
        boxShadow: `0 ${size * 0.05}px ${size * 0.12}px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,.35)`,
      }}>
      {children}
    </div>
  );
}

function Thumb({ url, size, rounded = 6 }: { url: string; size: number; rounded?: number }) {
  const [err, setErr] = useState(false);
  if (err) {
    return <Squircle size={size} from="#c084fc" to="#8b5cf6"><ImageIcon size={size * 0.5} strokeWidth={1.8} /></Squircle>;
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setErr(true)}
      className="object-cover bg-zinc-200 dark:bg-zinc-700"
      style={{ width: size, height: size, borderRadius: rounded, boxShadow: '0 0 0 1px rgba(0,0,0,.12), 0 2px 6px rgba(0,0,0,.18)' }}
    />
  );
}
function GlyphFallback({ size, from, to, Icon }: {
  size: number; from: string; to: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}) {
  return <Squircle size={size} from={from} to={to}><Icon size={size * 0.5} strokeWidth={1.8} /></Squircle>;
}

/** 图片缩略：原生直链；TIFF/AVIF/HEIF/RAW 经 ffmpeg */
export function ImageThumb({ node, size, rounded = 6 }: { node: FSNode; size: number; rounded?: number }) {
  const embedded = node.thumbUrl ?? node.imageUrl ?? null;
  const [url, setUrl] = useState<string | null>(embedded);

  useEffect(() => {
    let cancelled = false;
    if (embedded) {
      setUrl(embedded);
      return;
    }
    setUrl(null);
    void resolveImageThumbUrl(node.id, node.name, null).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => { cancelled = true; };
  }, [node.id, node.name, embedded]);

  if (!url) return <GlyphFallback size={size} from="#c084fc" to="#8b5cf6" Icon={ImageIcon} />;
  return <Thumb url={url} size={size} rounded={rounded} />;
}

/** 视频封面缩略：演示 thumbUrl → ffmpeg 抽帧；失败回退 Film 图标 */
export function VideoThumb({ node, size, rounded = 6 }: { node: FSNode; size: number; rounded?: number }) {
  const embedded = node.thumbUrl ?? node.imageUrl ?? null;
  const [url, setUrl] = useState<string | null>(embedded);

  useEffect(() => {
    let cancelled = false;
    if (embedded) {
      setUrl(embedded);
      return;
    }
    setUrl(null);
    void resolveVideoThumbUrl(node.id).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => { cancelled = true; };
  }, [node.id, embedded]);

  if (!url) {
    return (
      <span data-testid="video-thumb-fallback" data-name={node.name}>
        <GlyphFallback size={size} from="#a88bff" to="#6d4bd8" Icon={Film} />
      </span>
    );
  }
  return (
    <span data-testid="video-thumb" data-name={node.name}>
      <Thumb url={url} size={size} rounded={rounded} />
    </span>
  );
}

// ── 文档型图标 ──────────────────────────────────────────────
const CAT_COLOR: Record<string, string> = {
  doc: '#2b579a', sheet: '#217346', slide: '#d24726', pdf: '#e2574c', text: '#64748b',
  archive: '#c07f2e', code: '#334155', font: '#7048e8', db: '#0e7490', sys: '#75808f', link: '#0a84ff', other: '#8e8e93',
};
function DocIcon({ size, ext, color, Glyph }: { size: number; ext: string; color: string; Glyph: React.ComponentType<{ size?: number; strokeWidth?: number }> }) {
  return (
    <div className="relative" style={{ width: size * 0.82, height: size }}>
      <svg viewBox="0 0 40 48" className="absolute inset-0 h-full w-full" style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.16))' }}>
        <path d="M4 1h22l10 10v34a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3Z" fill="#fdfdfe" stroke="#00000022" />
        <path d="M26 1l10 10h-9a1 1 0 0 1-1-1V1Z" fill="#00000014" />
      </svg>
      <div className="absolute inset-x-0 flex items-center justify-center" style={{ top: '18%', height: '38%', color }}>
        <Glyph size={size * 0.34} strokeWidth={1.9} />
      </div>
      {ext && (
        <div className="absolute inset-x-[12%] flex justify-center" style={{ bottom: '9%' }}>
          <span className="font-bold uppercase text-white" style={{
            background: color, fontSize: Math.max(6, size * 0.13), lineHeight: 1.35, padding: '0 .45em',
            borderRadius: size * 0.05, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            boxShadow: '0 .5px 1px rgba(0,0,0,.2)',
          }}>{ext.slice(0, 5)}</span>
        </div>
      )}
    </div>
  );
}

const GLYPHS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  audio: Music, video: Film, archive: Archive, code: Code2, doc: FileText, sheet: Table2,
  slide: Presentation, pdf: FileType, text: FileText, font: Type, db: Database, sys: FileCog,
  link: Link2, image: ImageIcon, other: File,
};

// ── 主分发组件 ──────────────────────────────────────────────
export function FileGlyph({ node, size }: { node: FSNode; size: number }) {
  if (node.kind === 'folder') return <FolderIcon size={size} />;
  if (node.kind === 'drive') return <DriveIcon size={size} removable={node.drive?.removable} />;
  if (node.kind === 'special') {
    if (node.id === ID.trash) return <TrashGlyph size={size} full={node.childrenIds.length > 0 || true} />;
    if (node.id === ID.quick) return <Squircle size={size} from="#4da2ff" to="#0a6cff"><Star size={size * 0.52} strokeWidth={2} fill="#fff" /></Squircle>;
    if (node.id === ID.recent) return <Squircle size={size} from="#8e8e93" to="#636366"><Clock size={size * 0.52} strokeWidth={2} /></Squircle>;
    return <FolderIcon size={size} />;
  }
  if (node.id === ID.od) return <Squircle size={size} from="#60c3fd" to="#1c7ef2"><CloudGlyph size={size * 0.6} /></Squircle>;
  if (node.id === ID.pc) return <Squircle size={size} from="#5e5ce6" to="#3634a3"><Monitor size={size * 0.5} strokeWidth={2} /></Squircle>;

  const ext = node.ext ?? extOf(node.name);
  const cat = categoryOf(ext);
  if (cat === 'image') return <ImageThumb node={node} size={size} />;
  if (cat === 'app') {
    const c = node.appColor ?? '#3b82f6';
    return <Squircle size={size} from={c} to={shade(c)}><AppWindow size={size * 0.48} strokeWidth={1.9} /></Squircle>;
  }
  if (cat === 'audio') return <Squircle size={size} from="#ff6482" to="#e7335e"><Music size={size * 0.5} strokeWidth={2} /></Squircle>;
  if (cat === 'video') return <VideoThumb node={node} size={size} />;
  const Glyph = GLYPHS[cat] ?? File;
  return <DocIcon size={size} ext={ext} color={CAT_COLOR[cat]} Glyph={Glyph} />;
}

function CloudGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M17.5 19a4.5 4.5 0 0 0 .42-8.98 6 6 0 0 0-11.7 1.62A4 4 0 0 0 7 19h10.5Z" fill="#fff" />
    </svg>
  );
}

function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (x: number) => Math.max(0, Math.round(x * 0.68));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// ── 标签圆点 ────────────────────────────────────────────────
export function TagDot({ color, size = 10, ring = true }: { color: string; size?: number; ring?: boolean }) {
  return (
    <span className="inline-block shrink-0 rounded-full" style={{
      width: size, height: size, background: tagHex(color as never),
      boxShadow: ring ? '0 0 0 1.5px rgba(0,0,0,.08), inset 0 0 0 1.5px rgba(255,255,255,.25)' : undefined,
    }} />
  );
}
