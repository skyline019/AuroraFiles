import { useEffect, useState, type CSSProperties } from 'react';
import { Film, FileWarning, Loader2, ExternalLink } from 'lucide-react';
import { FSNode, kindLabel } from '@/lib/fs';
import { loadPreview, PreviewPayload, canInlinePreview } from '@/lib/preview';
import { previewFailHint } from '@/lib/previewFail';
import { useStore } from '@/lib/store';
import { FileGlyph } from './icons';
import { cn } from '@/utils/cn';

interface Props {
  node: FSNode;
  absPath?: string | null;
  className?: string;
  /** 紧凑模式（分栏预览） */
  compact?: boolean;
}

export function PreviewFail({
  node,
  message,
  hint,
  compact,
  className,
  canOpen,
}: {
  node: FSNode;
  message: string;
  hint?: string;
  compact?: boolean;
  className?: string;
  canOpen?: boolean;
}) {
  const open = useStore((s) => s.openNode);
  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-3 px-4 text-center', className)}
      data-testid="preview-fail"
      role="alert"
    >
      <div className="relative">
        <FileGlyph node={node} size={compact ? 64 : 120} />
        <span className="absolute -bottom-1 -right-1 rounded-full bg-amber-500/15 p-1 text-amber-600 dark:text-amber-400">
          <FileWarning size={compact ? 12 : 16} />
        </span>
      </div>
      <div className="space-y-1">
        <p className="text-[13px] font-medium text-zinc-600 dark:text-zinc-300">{kindLabel(node)}</p>
        <p className="max-w-[280px] text-[12.5px] leading-snug text-amber-700 dark:text-amber-400" data-testid="preview-fail-message">{message}</p>
        {hint && <p className="max-w-[280px] text-[11.5px] leading-snug text-zinc-400" data-testid="preview-fail-hint">{hint}</p>}
      </div>
      {canOpen && (
        <button
          type="button"
          data-testid="preview-fail-open"
          onClick={() => open(node.id)}
          className="mt-1 flex items-center gap-1.5 rounded-lg bg-[#0a84ff]/[.12] px-3 py-1.5 text-[12.5px] font-medium text-[#0a84ff] transition-colors hover:bg-[#0a84ff]/[.2]"
        >
          <ExternalLink size={13} />用系统应用打开
        </button>
      )}
    </div>
  );
}

export function PreviewPane({ node, absPath, className, compact }: Props) {
  const [data, setData] = useState<PreviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; label?: string } | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const canOpen = !!absPath || node.kind === 'file';

  useEffect(() => {
    let alive = true;
    setSheetIdx(0);
    setProgress(null);
    if (!canInlinePreview(node.name) && !node.imageUrl && node.content === undefined) {
      setData({
        kind: 'fallback',
        error: '此类型暂无内嵌预览',
        meta: 'open-system',
      });
      setLoading(false);
      return;
    }
    setLoading(true);
    setData(null);
    void loadPreview(node, absPath, {
      skipPoster: !!compact,
      onProgress: (pct, label) => {
        if (alive) setProgress({ pct, label });
      },
    })
      .then((p) => {
        if (!alive) return;
        setData(p);
        setLoading(false);
        setProgress(null);
      })
      .catch((err) => {
        if (!alive) return;
        setData({
          kind: 'fallback',
          error: err instanceof Error ? err.message : '预览加载失败',
        });
        setLoading(false);
        setProgress(null);
      });
    return () => { alive = false; };
  }, [node.id, node.modifiedAt, node.imageUrl, node.content, absPath, compact, node.name]);

  const maxH = compact ? 'max-h-[160px]' : 'max-h-[56vh]';

  if (loading) {
    const pct = progress?.pct ?? 0;
    return (
      <div className={cn('flex flex-col items-center justify-center gap-2 text-zinc-400', className)} role="status" aria-live="polite" aria-busy="true">
        <Loader2 className="animate-spin text-[#0a84ff]" size={compact ? 22 : 28} />
        <span className="text-[12px]">{progress?.label || '正在加载预览…'}</span>
        <span className="max-w-[220px] truncate text-[11px] text-zinc-400/80">{node.name}</span>
        {!compact && (
          <div className="mt-1 h-1.5 w-40 overflow-hidden rounded-full bg-black/[.08] dark:bg-white/[.1]" data-testid="preview-progress">
            <div
              className="h-full rounded-full bg-[#0a84ff] transition-[width] duration-200"
              style={{ width: `${Math.max(6, Math.min(100, pct))}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  if (!data || data.error) {
    const msg = data?.error || '无法生成预览';
    return (
      <PreviewFail
        node={node}
        message={msg}
        hint={previewFailHint(msg, data?.meta)}
        compact={compact}
        className={className}
        canOpen={canOpen}
      />
    );
  }

  if (data.kind === 'image' && data.url) {
    return (
      <div className={cn('flex items-center justify-center', className)}>
        <img
          src={data.url}
          alt={node.name}
          className={cn(maxH, 'max-w-full rounded-lg object-contain shadow-xl')}
          onError={() => setData({ kind: 'image', error: '图片无法解码或已损坏' })}
        />
      </div>
    );
  }

  if (data.kind === 'video' && data.url) {
    return (
      <div className={cn('flex w-full flex-col items-center gap-2', className)}>
        <video
          key={data.url}
          src={data.url}
          controls
          playsInline
          poster={data.poster || undefined}
          className={cn(maxH, 'w-full max-w-full rounded-lg bg-black shadow-xl')}
          onError={() => setData({ kind: 'video', error: '视频无法播放（编码不受支持或文件损坏）' })}
        />
        {!data.poster && !compact && (
          <p className="flex items-center gap-1 text-[11px] text-zinc-400">
            <Film size={12} /> 安装本机 ffmpeg 后可自动生成封面
          </p>
        )}
      </div>
    );
  }

  if (data.kind === 'audio' && data.url) {
    return (
      <div className={cn('flex w-full flex-col items-center gap-4 px-6', className)}>
        <FileGlyph node={node} size={compact ? 64 : 110} />
        <audio
          key={data.url}
          src={data.url}
          controls
          className="w-full max-w-md"
          onError={() => setData({ kind: 'audio', error: '音频无法播放' })}
        />
      </div>
    );
  }

  if (data.kind === 'pdf' && data.url) {
    return (
      <iframe
        title={node.name}
        src={data.url}
        className={cn(maxH, 'h-[56vh] w-full rounded-lg border-0 bg-white shadow-inner', className)}
      />
    );
  }

  if (data.kind === 'text') {
    return (
      <div className={cn(maxH, 'h-full w-full overflow-auto rounded-lg bg-white p-4 text-left shadow-inner dark:bg-[#1b1b1d]', className)}>
        {(data.meta || data.truncated) && (
          <div className="mb-2 flex gap-2 text-[11px] text-zinc-400">
            {data.meta && <span>编码 {data.meta}</span>}
            {data.truncated && <span className="text-amber-600">已截断</span>}
          </div>
        )}
        <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-zinc-700 dark:text-zinc-300">
          {data.text?.length ? data.text : '（空文件）'}
        </pre>
      </div>
    );
  }

  if (data.kind === 'docx' && data.html) {
    return (
      <div className={cn('flex h-full w-full flex-col gap-1', className)}>
        {data.meta && !compact && (
          <p className="text-[11px] text-zinc-400">{data.meta}</p>
        )}
        <div
          className={cn(maxH, 'prose-aurora h-full w-full overflow-auto rounded-lg bg-white p-5 text-left text-[13px] leading-relaxed text-zinc-800 shadow-inner dark:bg-[#1b1b1d] dark:text-zinc-200')}
          dangerouslySetInnerHTML={{ __html: data.html }}
        />
      </div>
    );
  }

  if (data.kind === 'xlsx' && data.sheets?.length) {
    const sheet = data.sheets[Math.min(sheetIdx, data.sheets.length - 1)];
    return (
      <div className={cn('flex h-full w-full flex-col gap-2', className)}>
        {data.meta && !compact && (
          <p className="text-[11px] text-zinc-400">{data.meta}</p>
        )}
        {data.sheets.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {data.sheets.map((s, i) => (
              <button
                key={s.name}
                type="button"
                onClick={() => setSheetIdx(i)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-[11px]',
                  i === sheetIdx ? 'bg-[#0a84ff] text-white' : 'bg-black/[.05] text-zinc-600 dark:bg-white/[.08] dark:text-zinc-300',
                )}
              >{s.name}</button>
            ))}
          </div>
        )}
        <div className={cn(maxH, 'flex-1 overflow-auto rounded-lg border border-black/[.06] bg-white dark:border-white/[.08] dark:bg-[#1b1b1d]')}>
          <table className="min-w-full border-collapse text-left text-[11.5px]">
            <tbody>
              {sheet.rows.map((row, ri) => (
                <tr key={ri} className={ri === 0 ? 'bg-black/[.04] font-semibold dark:bg-white/[.06]' : 'odd:bg-black/[.015] dark:odd:bg-white/[.02]'}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="max-w-[180px] truncate border border-black/[.06] px-2 py-1 dark:border-white/[.08]">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (data.kind === 'pptx' && data.slides?.length) {
    return (
      <div className={cn(maxH, 'flex w-full flex-col gap-3 overflow-auto', className)}>
        <p className="text-[11px] text-zinc-400">{data.meta || '幻灯片级近似预览'}</p>
        {data.slides.map((sl, i) => {
          const hasLayout = (sl.elements?.length ?? 0) > 0;
          return (
            <div key={i} className="text-left">
              <div className="mb-1.5 flex items-baseline justify-between gap-2 px-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[#0a84ff]">幻灯片 {i + 1}</span>
                {!hasLayout && <span className="truncate text-[11px] text-zinc-500">{sl.title}</span>}
              </div>
              {hasLayout ? (
                <div
                  data-testid="pptx-slide-canvas"
                  data-slide-index={i}
                  className="relative w-full overflow-hidden rounded-lg border border-black/[.1] shadow-sm dark:border-white/[.12]"
                  style={{
                    aspectRatio: '16 / 9',
                    background: sl.bg || '#fff',
                  }}
                >
                  {sl.elements!.map((el, ei) => {
                    const box: CSSProperties = {
                      position: 'absolute',
                      left: `${el.x}%`,
                      top: `${el.y}%`,
                      width: `${Math.max(el.w, 0.5)}%`,
                      height: `${Math.max(el.h, 0.5)}%`,
                      boxSizing: 'border-box',
                    };
                    if (el.kind === 'image' && el.src) {
                      return (
                        <img
                          key={ei}
                          src={el.src}
                          alt=""
                          draggable={false}
                          className="object-contain"
                          style={{ ...box, objectFit: 'cover' }}
                        />
                      );
                    }
                    if (el.kind === 'rect') {
                      return <div key={ei} style={{ ...box, background: el.fill || '#ddd' }} />;
                    }
                    // text
                    const fs = el.fontSizePt
                      ? `clamp(8px, ${Math.max(0.7, (el.fontSizePt / 18) * (compact ? 1.6 : 2.2))}cqw, ${compact ? 14 : 22}px)`
                      : compact ? '10px' : '13px';
                    return (
                      <div
                        key={ei}
                        style={{
                          ...box,
                          background: el.fill,
                          color: el.color || '#1a1a1a',
                          fontWeight: el.bold ? 650 : 400,
                          fontSize: fs,
                          textAlign: el.align || 'left',
                          overflow: 'hidden',
                          padding: '0.35% 0.8%',
                          lineHeight: 1.25,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          containerType: 'size',
                        }}
                      >
                        {el.text}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-black/[.08] bg-white p-4 shadow-sm dark:border-white/[.1] dark:bg-[#1e1e20]">
                  <div className="text-[14px] font-semibold text-zinc-800 dark:text-zinc-100">{sl.title}</div>
                  {sl.body && sl.body !== sl.title && (
                    <pre className="mt-2 whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-400">{sl.body}</pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <PreviewFail
      node={node}
      message="此类型暂无内嵌预览"
      hint="可用「打开」调用系统默认应用"
      compact={compact}
      className={className}
      canOpen={canOpen}
    />
  );
}
