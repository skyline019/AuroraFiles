import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ChevronLeft, Eye } from 'lucide-react';
import { useStore, useActiveTab, useItems, useCurrentLocation, currentNodeId } from '@/lib/store';
import { FileGlyph, ImageThumb, VideoThumb, TagDot } from './icons';
import { useFileHandlers, NameLabel, EmptyState } from './Views';
import { FSNode, sortNodes, getChain, formatSize, formatDate, kindLabel, extOf, IMAGE_EXTS, categoryOf } from '@/lib/fs';
import { resolvePathId } from '@/lib/realFs';
import { PreviewPane } from './PreviewPane';
import { galleryStepPool, stepInPool } from '@/lib/asyncGate';
import { COLUMN_ROW_H, hitTestColumnMarquee } from '@/lib/columnMarquee';
import { cn } from '@/utils/cn';

// ── 分栏视图 ────────────────────────────────────────────────
function ColumnRow({ node, active, onClick, h }: {
  node: FSNode; active: boolean; onClick: (e: React.MouseEvent) => void; h: ReturnType<typeof useFileHandlers>;
}) {
  const s = useStore();
  const isFolder = node.kind !== 'file';
  return (
    <div
      data-item={node.id}
      draggable
      onDragStart={(e) => h.dragStart(e, node)}
      {...(isFolder ? h.folderTarget(node) : {})}
      onClick={onClick}
      onDoubleClick={() => { if (!isFolder) s.openNode(node.id); }}
      onContextMenu={(e) => h.ctx(e, node)}
      className={cn(
        'mx-1 flex h-[30px] cursor-default items-center gap-2 rounded-[6px] px-2 transition-colors',
        active ? 'bg-[#0a84ff]/[.14] dark:bg-[#0a84ff]/[.24]' : 'hover:bg-black/[.04] dark:hover:bg-white/[.05]',
        h.isCut(node.id) && 'opacity-45',
        h.dropId === node.id && 'ring-2 ring-inset ring-[#0a84ff]',
      )}
    >
      <FileGlyph node={node} size={17} />
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-zinc-700 dark:text-zinc-200">{node.name}</span>
      {node.tags.slice(0, 3).map(t => <TagDot key={t} color={t} size={6} ring={false} />)}
      {isFolder && <ChevronRight size={13} strokeWidth={2.2} className={cn('shrink-0', active ? 'text-zinc-500 dark:text-zinc-300' : 'text-zinc-300 dark:text-zinc-600')} />}
    </div>
  );
}

/** 任意分栏列：支持框选（与 Finder 全列一致） */
function ColumnPane({
  kids,
  colIds,
  h,
  activeId,
  onOpen,
}: {
  kids: FSNode[];
  colIds: string[];
  h: ReturnType<typeof useFileHandlers>;
  activeId: (id: string) => boolean;
  onOpen: (e: React.MouseEvent, child: FSNode) => void;
}) {
  const s = useStore();
  const tab = useActiveTab();
  const colRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const marqueeBase = useRef<string[]>([]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-item]') || (e.target as HTMLElement).closest('input')) return;
    s.setSelection([]);
    const wrap = colRef.current;
    const content = contentRef.current;
    if (!wrap || !content) return;
    const rect = content.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top + wrap.scrollTop;
    marqueeBase.current = (e.ctrlKey || e.metaKey) ? [...tab.selection] : [];
    let cur = { x1: sx, y1: sy, x2: sx, y2: sy };
    const maxY = Math.max(kids.length * COLUMN_ROW_H + 8, wrap.scrollHeight);
    const move = (ev: PointerEvent) => {
      const scrollTop = wrap.scrollTop;
      const origin = content.getBoundingClientRect();
      // 边缘滚动
      const box = wrap.getBoundingClientRect();
      if (ev.clientY > box.bottom - 24) wrap.scrollTop = Math.min(wrap.scrollHeight, wrap.scrollTop + 16);
      else if (ev.clientY < box.top + 24) wrap.scrollTop = Math.max(0, wrap.scrollTop - 16);
      cur = {
        ...cur,
        x2: Math.max(0, Math.min(220, ev.clientX - origin.left)),
        y2: Math.max(0, Math.min(maxY, ev.clientY - origin.top + scrollTop)),
      };
      const x = Math.min(cur.x1, cur.x2);
      const y = Math.min(cur.y1, cur.y2);
      const w = Math.abs(cur.x2 - cur.x1);
      const hh = Math.abs(cur.y2 - cur.y1);
      setMarquee({ x, y, w, h: hh });
      const hit = hitTestColumnMarquee(colIds, { x, y, w, h: hh });
      s.setSelection([...new Set([...marqueeBase.current, ...hit])]);
    };
    const upEvt = () => {
      setMarquee(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', upEvt);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', upEvt);
  };

  return (
    <div
      ref={colRef}
      className="flex h-full w-[228px] shrink-0 flex-col overflow-y-auto border-r border-black/[.05] py-1 dark:border-white/[.07]"
      onPointerDown={onPointerDown}
    >
      <div ref={contentRef} className="relative min-h-full" style={{ height: Math.max(kids.length * COLUMN_ROW_H + 8, 40) }}>
        {kids.length === 0 && <p className="px-4 py-3 text-[12px] text-zinc-400">空文件夹</p>}
        {kids.map(child => (
          <ColumnRow
            key={child.id}
            node={child}
            h={h}
            active={activeId(child.id)}
            onClick={(e) => onOpen(e, child)}
          />
        ))}
        {marquee && (
          <div
            className="pointer-events-none absolute z-20 rounded-[3px] border border-[#0a84ff]/50 bg-[#0a84ff]/[.12]"
            style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
          />
        )}
      </div>
    </div>
  );
}

export function ColumnView() {
  const s = useStore();
  const tab = useActiveTab();
  const loc = useCurrentLocation();
  const items = useItems();
  const h = useFileHandlers([]);
  const nodeId = currentNodeId(tab);
  const scrollRef = useRef<HTMLDivElement>(null);

  const plain = !!nodeId && !!s.nodes[nodeId] && s.nodes[nodeId].kind !== 'special' && !tab.search.trim();
  const chain = plain ? getChain(s.nodes, nodeId!) : [];

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [nodeId, tab.search]);

  const columnOf = (parent: FSNode) =>
    sortNodes(
      s.nodes,
      parent.childrenIds.map(c => s.nodes[c]).filter((x): x is FSNode => !!x && !x.deleted && (tab.showHidden || !x.hidden)),
      tab.sortKey, tab.sortDir,
    );

  const openInColumn = (e: React.MouseEvent, child: FSNode, colIds: string[], navigateFolder: boolean) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      h.click(e, child, colIds);
      return;
    }
    if (navigateFolder && child.kind !== 'file') {
      s.navigate({ t: 'node', id: child.id });
      s.setSelection([child.id]);
      return;
    }
    h.click(e, child, colIds);
  };

  const selectedFile = tab.selection.length === 1 ? s.nodes[tab.selection[0]] : undefined;
  const showPreview = selectedFile && selectedFile.kind === 'file';
  const showFolderHint = selectedFile && selectedFile.kind !== 'file';

  return (
    <div ref={scrollRef} className="no-select flex h-full overflow-x-auto" onContextMenu={h.bgCtx} onClick={(e) => { if (!(e.target as HTMLElement).closest('[data-item]')) s.setSelection([]); }}>
      {plain ? chain.map((folder, i) => {
        const kids = columnOf(folder);
        const colIds = kids.map(c => c.id);
        const isLast = i === chain.length - 1;
        return (
          <ColumnPane
            key={folder.id}
            kids={kids}
            colIds={colIds}
            h={h}
            activeId={(id) =>
              isLast
                ? tab.selection.includes(id)
                : chain[i + 1]?.id === id || tab.selection.includes(id)
            }
            onOpen={(e, child) => openInColumn(e, child, colIds, true)}
          />
        );
      }) : (
        <ColumnPane
          kids={items}
          colIds={items.map(c => c.id)}
          h={h}
          activeId={(id) => tab.selection.includes(id)}
          onOpen={(e, child) => openInColumn(e, child, items.map(c => c.id), loc.t !== 'node')}
        />
      )}

      {/* 预览列 */}
      <div className="flex h-full w-[290px] shrink-0 flex-col items-center gap-3 overflow-y-auto p-6">
        {showPreview ? (
          <>
            <div className="flex h-[170px] w-full items-center justify-center overflow-hidden">
              <PreviewPane
                node={selectedFile!}
                absPath={s.fsMode === 'real' ? resolvePathId(selectedFile!.id, s.quickMap) : null}
                compact
                className="h-full w-full"
              />
            </div>
            <p className="max-w-full truncate text-[14px] font-semibold text-zinc-800 dark:text-zinc-100">{selectedFile!.name}</p>
            <p className="text-[12px] text-zinc-400">{kindLabel(selectedFile!)} · {formatSize(selectedFile!.size)}</p>
            <div className="w-full space-y-1.5 border-t border-black/[.06] pt-3 text-[12px] dark:border-white/[.08]">
              <div className="flex justify-between"><span className="text-zinc-400">修改日期</span><span className="text-zinc-600 tabular dark:text-zinc-300">{formatDate(selectedFile!.modifiedAt)}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">创建日期</span><span className="text-zinc-600 tabular dark:text-zinc-300">{formatDate(selectedFile!.createdAt)}</span></div>
              {selectedFile!.tags.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">标签</span>
                  <span className="flex gap-1">{selectedFile!.tags.map(t => <TagDot key={t} color={t} size={9} />)}</span>
                </div>
              )}
            </div>
            <button
              onClick={() => s.setQuickLook(selectedFile!.id)}
              className="mt-2 flex items-center gap-1.5 rounded-lg bg-[#0a84ff] px-3.5 py-1.5 text-[12.5px] font-medium text-white shadow-sm transition-all hover:brightness-110 active:scale-95"
            ><Eye size={13} />快速查看<span className="kbd ml-1 !bg-white/20 !text-white !shadow-none">空格</span></button>
          </>
        ) : showFolderHint ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <FileGlyph node={selectedFile!} size={72} />
            <p className="max-w-full truncate text-[14px] font-semibold text-zinc-800 dark:text-zinc-100">{selectedFile!.name}</p>
            <p className="text-[12px] text-zinc-400">文件夹 · 单击深入 / Shift·Ctrl 多选</p>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <FolderIcon size={64} />
            <p className="text-[12px] text-zinc-400">选中文件即可预览<br />单击文件夹深入浏览</p>
          </div>
        )}
      </div>
    </div>
  );
}

function FolderIcon({ size }: { size: number }) {
  return (
    <div className="opacity-50 grayscale-[.3]">
      <FileGlyph node={{ kind: 'folder' } as FSNode} size={size} />
    </div>
  );
}

// ── 画廊视图 ────────────────────────────────────────────────
export function GalleryView() {
  const s = useStore();
  const tab = useActiveTab();
  const items = useItems();
  const filesOnly = tab.galleryFilesOnly !== false;
  const stripItems = useMemo(
    () => (filesOnly ? items.filter((n) => n.kind === 'file') : items),
    [items, filesOnly],
  );
  const orderedIds = useMemo(() => items.map(i => i.id), [items]);
  const stripIds = useMemo(() => stripItems.map((n) => n.id), [stripItems]);
  const filePool = useMemo(() => galleryStepPool(items), [items]);
  const stepIds = useMemo(() => filePool.map(n => n.id), [filePool]);
  const h = useFileHandlers(filesOnly ? stripIds : orderedIds);
  const stripRef = useRef<HTMLDivElement>(null);

  // 无选中或不在当前底栏列表时，自动落到第一个文件
  useEffect(() => {
    const pool = filesOnly ? stripIds : orderedIds;
    if (!pool.length) return;
    const inList = tab.selection.find(id => pool.includes(id));
    if (inList) return;
    s.setSelection([stepIds[0] ?? pool[0]]);
  }, [orderedIds.join('|'), stripIds.join('|'), stepIds.join('|'), tab.selection.join('|'), filesOnly]);

  const selId = (filesOnly ? stripIds : orderedIds).find((id) => tab.selection.includes(id))
    ?? stepIds[0]
    ?? stripIds[0]
    ?? orderedIds[0];
  const cur = selId ? s.nodes[selId] : undefined;
  const stepIdx = stepIds.indexOf(selId ?? '');

  const step = (d: number) => {
    const next = stepInPool(stepIds.length ? stepIds : (filesOnly ? stripIds : orderedIds), selId, d);
    if (next) s.setSelection([next]);
  };

  useEffect(() => {
    const el = stripRef.current;
    const target = el?.querySelector('[data-cur="1"]') as HTMLElement | null;
    if (el && target) el.scrollTo({ left: target.offsetLeft - el.clientWidth / 2 + target.clientWidth / 2, behavior: 'smooth' });
  }, [selId]);

  if (!items.length) return <EmptyState />;
  if (filesOnly && !stripItems.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-400">
        <p className="text-[13px]">当前文件夹没有可预览的文件</p>
        <button
          type="button"
          data-testid="gallery-show-folders"
          onClick={() => s.patchTab({ galleryFilesOnly: false })}
          className="rounded-lg bg-[#0a84ff]/[.12] px-3 py-1.5 text-[12.5px] font-medium text-[#0a84ff]"
        >显示文件夹</button>
      </div>
    );
  }

  const abs = cur && cur.kind === 'file' && s.fsMode === 'real' ? resolvePathId(cur.id, s.quickMap) : null;
  const isFolder = cur && cur.kind !== 'file';
  const canStep = (stepIds.length ? stepIds : stripIds).length > 1;

  return (
    <div className="flex h-full flex-col" onContextMenu={h.bgCtx}>
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-hidden px-16">
        {cur && (
          <>
            <div
              data-item={cur.id}
              onDoubleClick={() => s.openNode(cur.id)}
              onContextMenu={(e) => h.ctx(e, cur)}
              className="flex min-h-0 w-full flex-1 cursor-default items-center justify-center py-4"
            >
              {isFolder ? (
                <div className="flex flex-col items-center gap-3">
                  <FileGlyph node={cur} size={140} />
                  <p className="text-[12.5px] text-zinc-400">文件夹 · 双击打开 · 方向键跳过文件夹</p>
                </div>
              ) : (
                <PreviewPane node={cur} absPath={abs} className="h-full max-h-[min(520px,55vh)] w-full max-w-4xl" />
              )}
            </div>
            <p className="shrink-0 text-[15px] font-semibold text-zinc-800 dark:text-zinc-100">{cur.name}</p>
            <p className="-mt-1 shrink-0 text-[12px] text-zinc-400 tabular">
              {kindLabel(cur)} · {cur.kind === 'file' ? formatSize(cur.size) : '—'} · {formatDate(cur.modifiedAt)}
            </p>
          </>
        )}
        {canStep && (
          <>
            <button onClick={() => step(-1)} disabled={stepIdx <= 0 && stepIds.length > 0} className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/[.04] p-2 text-zinc-500 backdrop-blur transition-all hover:bg-black/[.08] disabled:opacity-25 dark:bg-white/[.07] dark:hover:bg-white/[.14]">
              <ChevronLeft size={18} />
            </button>
            <button onClick={() => step(1)} disabled={stepIds.length > 0 && stepIdx >= stepIds.length - 1} className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/[.04] p-2 text-zinc-500 backdrop-blur transition-all hover:bg-black/[.08] disabled:opacity-25 dark:bg-white/[.07] dark:hover:bg-white/[.14]">
              <ChevronRight size={18} />
            </button>
          </>
        )}
      </div>
      <div className="shrink-0 border-t border-black/[.06] bg-black/[.02] dark:border-white/[.08] dark:bg-white/[.02]">
        <div className="flex items-center justify-between gap-2 px-4 pt-2">
          <span className="text-[11px] text-zinc-400">
            {filesOnly ? `仅文件 · ${stripItems.length}` : `全部 · ${stripItems.length}`}
          </span>
          <button
            type="button"
            data-testid="gallery-files-only-toggle"
            onClick={() => s.patchTab({ galleryFilesOnly: !filesOnly })}
            className={cn(
              'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
              filesOnly
                ? 'bg-[#0a84ff]/[.14] text-[#0a84ff]'
                : 'text-zinc-500 hover:bg-black/[.05] dark:hover:bg-white/[.08]',
            )}
          >{filesOnly ? '仅文件' : '含文件夹'}</button>
        </div>
        <div ref={stripRef} className="flex gap-2 overflow-x-auto px-4 py-3">
          {stripItems.map(n => {
            const active = n.id === selId;
            const folder = n.kind !== 'file';
            return (
              <button
                key={n.id}
                type="button"
                data-cur={active ? '1' : undefined}
                data-item={n.id}
                onClick={(e) => h.click(e, n)}
                onDoubleClick={() => s.openNode(n.id)}
                onContextMenu={(e) => h.ctx(e, n)}
                className={cn(
                  'flex w-[88px] shrink-0 flex-col items-center gap-1 rounded-lg p-1.5 transition-all',
                  active ? 'bg-[#0a84ff]/[.14] ring-2 ring-[#0a84ff]' : 'hover:bg-black/[.04] dark:hover:bg-white/[.06]',
                  h.isCut(n.id) && 'opacity-45',
                  folder && 'opacity-80',
                )}
              >
                <span className="flex h-[54px] items-center justify-center">
                  {folder
                    ? <FileGlyph node={n} size={42} />
                    : IMAGE_EXTS.includes(extOf(n.name))
                      ? <ImageThumb node={n} size={52} />
                      : categoryOf(extOf(n.name)) === 'video'
                        ? <VideoThumb node={n} size={52} />
                        : <FileGlyph node={n} size={42} />}
                </span>
                <span className="w-full truncate text-center text-[10px] text-zinc-500 dark:text-zinc-400">{n.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { NameLabel };
