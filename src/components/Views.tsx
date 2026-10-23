import { useRef, useState, useMemo, useCallback, useEffect } from 'react';
import {
  ChevronUp, ChevronDown, FolderOpen, SearchX, Trash2, RotateCcw, Folder as FolderLucide, Loader2, X,
} from 'lucide-react';
import { deepSearchBusyLabel } from '@/lib/previewFail';
import { useStore, useActiveTab, useItems, useCurrentLocation, currentNodeId } from '@/lib/store';
import { FileGlyph, FolderIcon, ImageThumb, TagDot, DriveIcon } from './icons';
import { FSNode, ID, SortKey, formatSize, formatDate, kindLabel } from '@/lib/fs';
import { useVirtualWindow } from '@/hooks/useVirtualWindow';
import { cellRect, computeGridMetrics, hitTestMarquee, totalGridHeight, visibleIndexRange } from '@/lib/gridLayout';
import { cn } from '@/utils/cn';
import { searchSourceLabel } from '@/lib/indexLabel';

const LIST_ROW_H = 32;

// ── 名称标签 / 重命名 ───────────────────────────────────────
export function NameLabel({ node, center, small }: { node: FSNode; center?: boolean; small?: boolean }) {
  const s = useStore();
  const tab = useActiveTab();
  if (tab.renaming === node.id) {
    return (
      <input
        autoFocus
        defaultValue={node.name}
        className={cn('rename-input w-full', small && 'text-[12px]')}
        onFocus={(e) => {
          const dot = node.name.lastIndexOf('.');
          if (node.kind === 'file' && dot > 0) e.target.setSelectionRange(0, dot);
          else e.target.select();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') s.commitRename(node.id, (e.target as HTMLInputElement).value);
          if (e.key === 'Escape') s.patchTab({ renaming: null });
        }}
        onBlur={(e) => s.commitRename(node.id, e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      />
    );
  }
  return (
    <span
      title={node.name}
      className={cn(
        'w-full text-[12px] leading-[1.25] text-zinc-700 dark:text-zinc-200',
        center ? 'text-center' : 'truncate',
        center && 'line-clamp-2 break-all',
      )}
      style={center ? { display: '-webkit-box', WebkitBoxOrient: 'vertical' } : undefined}
    >{node.name}</span>
  );
}

export function TagDots({ node, size = 7 }: { node: FSNode; size?: number }) {
  if (!node.tags.length) return null;
  return (
    <span className="flex items-center justify-center gap-[3px]">
      {node.tags.map(t => <TagDot key={t} color={t} size={size} ring={false} />)}
    </span>
  );
}

// ── 共享交互 ────────────────────────────────────────────────
export function useFileHandlers(orderedIds: string[]) {
  const s = useStore();
  const tab = useActiveTab();
  const anchor = useRef<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);

  const click = useCallback((e: React.MouseEvent, node: FSNode, orderOverride?: string[]) => {
    e.stopPropagation();
    const order = orderOverride ?? orderedIds;
    const sel = tab.selection;
    if (e.shiftKey && anchor.current && order.includes(anchor.current)) {
      const a = order.indexOf(anchor.current);
      const b = order.indexOf(node.id);
      if (a >= 0 && b >= 0) {
        s.setSelection(order.slice(Math.min(a, b), Math.max(a, b) + 1));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      s.setSelection(sel.includes(node.id) ? sel.filter(x => x !== node.id) : [...sel, node.id]);
    } else {
      s.setSelection([node.id]);
    }
    anchor.current = node.id;
  }, [tab.selection, orderedIds, s]);

  const ctx = useCallback((e: React.MouseEvent, node: FSNode) => {
    e.preventDefault();
    e.stopPropagation();
    const sel = tab.selection.includes(node.id) ? tab.selection : [node.id];
    if (!tab.selection.includes(node.id)) s.setSelection([node.id]);
    anchor.current = node.id;
    s.setContext({ x: e.clientX, y: e.clientY, ids: sel });
  }, [tab.selection, s]);

  const dragStart = useCallback((e: React.DragEvent, node: FSNode) => {
    const ids = tab.selection.includes(node.id) ? tab.selection : [node.id];
    if (!tab.selection.includes(node.id)) s.setSelection([node.id]);
    e.dataTransfer.setData('application/x-aurora', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'copyMove';
  }, [tab.selection, s]);

  const folderTarget = useCallback((node: FSNode) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/x-aurora')) return;
      if (tab.selection.includes(node.id)) return;
      e.preventDefault();
      e.stopPropagation();
      setDropId(node.id);
    },
    onDragLeave: () => setDropId(d => (d === node.id ? null : d)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropId(null);
      try {
        const ids = JSON.parse(e.dataTransfer.getData('application/x-aurora')) as string[];
        if (ids?.length) {
          if (node.id === ID.trash) s.trash(ids);
          else if (node.deleted || node.kind === 'file') s.toast('无法移动到该位置');
          else s.moveTo(ids, node.id);
        }
      } catch { /* ignore */ }
    },
  }), [tab.selection, s]);

  const bgCtx = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    s.setContext({ x: e.clientX, y: e.clientY, ids: [] });
  }, [s]);

  const isCut = useCallback((id: string) => s.clipboard?.mode === 'cut' && s.clipboard.ids.includes(id), [s.clipboard]);

  return { click, ctx, dragStart, folderTarget, bgCtx, dropId, isCut };
}

// ── 特殊位置标题条 ──────────────────────────────────────────
export function LocationHeader({ count }: { count: number }) {
  const s = useStore();
  const tab = useActiveTab();
  const loc = useCurrentLocation();
  const nodeId = currentNodeId(tab);
  const isTrash = nodeId === ID.trash;
  const searching = !!tab.search.trim();
  const deep = !!s.deepHits?.length;
  const deepBusy = s.deepSearching;
  const folderBusy = s.folderRefreshing;
  if (!searching && !deepBusy && !folderBusy && !isTrash && nodeId !== ID.recent && nodeId !== ID.quick && loc.t !== 'tag') return null;
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-black/[.05] px-4 py-2 text-[12.5px] text-zinc-500 dark:border-white/[.07] dark:text-zinc-400">
      {deepBusy ? (
        <>
          <span className="flex items-center gap-2 text-[#0a84ff]" data-testid="deep-search-busy">
            <Loader2 size={14} className="animate-spin" />
            {deepSearchBusyLabel(tab.search)}
          </span>
          <button
            type="button"
            onClick={() => s.cancelDeepSearch()}
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium text-zinc-500 transition-colors hover:bg-black/[.06] hover:text-zinc-700 dark:hover:bg-white/[.08]"
          >
            <X size={12} strokeWidth={2.5} />取消
          </button>
        </>
      ) : folderBusy && !searching ? (
        <span className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
          <Loader2 size={14} className="animate-spin" />
          正在加载文件夹…
        </span>
      ) : searching ? (
        <span>
          {deep ? '深度搜索' : '当前范围'}「{loc.t === 'node' ? s.nodes[loc.id]?.name : '标签'}」
          找到 <b className="text-zinc-700 dark:text-zinc-200">{count}</b> 个匹配
          “<b className="text-[#0a84ff]">{tab.search}</b>”
          {s.deepMeta
            ? ` · ${searchSourceLabel(s.deepMeta.source, s.deepMeta.cached)} ${s.deepMeta.scanned}${s.deepMeta.truncated ? '（已截断）' : ''}`
            : ''}
          {!deep && ' · Enter 含子文件夹'}
        </span>
      ) : isTrash ? (
        <>
          <span>{count} 个项目</span>
          <span className="text-zinc-300 dark:text-zinc-600">项目会在 30 天后自动清除</span>
          <span className="flex-1" />
          <button
            disabled={!tab.selection.length}
            onClick={() => s.restore(tab.selection)}
            className="flex items-center gap-1 rounded-md px-2 py-1 font-medium text-[#0a84ff] transition-colors hover:bg-[#0a84ff]/10 disabled:opacity-35"
          ><RotateCcw size={13} strokeWidth={2} />还原所选</button>
          <button
            disabled={!count}
            onClick={s.emptyTrash}
            className="flex items-center gap-1 rounded-md px-2 py-1 font-medium text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-35"
          ><Trash2 size={13} strokeWidth={2} />清空回收站</button>
        </>
      ) : nodeId === ID.recent ? (
        <span>按最近打开时间排序 · 共 {count} 个项目</span>
      ) : loc.t === 'tag' ? (
        <span>带有此标签的 {count} 个项目</span>
      ) : (
        <span>固定的文件夹与最近使用的文件</span>
      )}
      {searching && <span className="ml-auto text-zinc-400">Esc 退出搜索</span>}
    </div>
  );
}

// ── 空状态 ──────────────────────────────────────────────────
export function EmptyState() {
  const s = useStore();
  const tab = useActiveTab();
  const nodeId = currentNodeId(tab);
  const searching = !!tab.search.trim();
  const deepBusy = s.deepSearching;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-300 dark:text-zinc-600">
      {deepBusy ? (
        <Loader2 size={40} className="animate-spin text-[#0a84ff]" strokeWidth={1.5} />
      ) : searching ? (
        <SearchX size={54} strokeWidth={1} />
      ) : nodeId === ID.trash ? (
        <Trash2 size={54} strokeWidth={1} />
      ) : (
        <FolderOpen size={54} strokeWidth={1} />
      )}
      <p className="text-[13px] text-zinc-400 dark:text-zinc-500">
        {deepBusy
          ? deepSearchBusyLabel(tab.search)
          : searching
            ? '没有找到匹配的项目'
            : nodeId === ID.trash
              ? '回收站是空的'
              : '此文件夹为空'}
      </p>
      {deepBusy ? (
        <button
          type="button"
          onClick={() => s.cancelDeepSearch()}
          className="rounded-md px-3 py-1 text-[12.5px] font-medium text-[#0a84ff] hover:bg-[#0a84ff]/10"
        >取消搜索</button>
      ) : searching ? (
        <p className="text-[12px] text-zinc-400">试试更换关键词，或按 Esc 返回浏览</p>
      ) : null}
    </div>
  );
}

/** 进夹内容区遮罩：拦截点击，防止连点进夹叠请求 */
export function FolderBusyOverlay() {
  const busy = useStore((s) => s.folderRefreshing);
  if (!busy) return null;
  const block = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div
      data-testid="folder-busy-overlay"
      className="absolute inset-0 z-20 flex cursor-wait items-start justify-center pt-10"
      aria-live="polite"
      aria-busy="true"
      onPointerDown={block}
      onClick={block}
      onContextMenu={block}
      onWheel={block}
    >
      <div className="absolute inset-0 bg-white/45 backdrop-blur-[1.5px] dark:bg-black/35" />
      <div className="relative flex items-center gap-2 rounded-xl border border-black/[.06] bg-white/95 px-4 py-2.5 text-[13px] font-medium text-amber-700 shadow-lg dark:border-white/[.1] dark:bg-[#252528]/95 dark:text-amber-400">
        <Loader2 size={16} className="animate-spin" />
        正在加载文件夹…
        <span className="ml-1 flex gap-1">
          <span className="h-1.5 w-8 animate-pulse rounded-full bg-amber-400/50" />
          <span className="h-1.5 w-5 animate-pulse rounded-full bg-amber-400/35 [animation-delay:120ms]" />
          <span className="h-1.5 w-3 animate-pulse rounded-full bg-amber-400/25 [animation-delay:240ms]" />
        </span>
      </div>
    </div>
  );
}

// ── 图标（网格）视图：几何虚拟化 + 框选不依赖全量 DOM ────────
export function GridView() {
  const s = useStore();
  const tab = useActiveTab();
  const items = useItems();
  const orderedIds = useMemo(() => items.map(i => i.id), [items]);
  const h = useFileHandlers(orderedIds);
  const wrapRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const marqueeBase = useRef<string[]>([]);
  const size = tab.iconSize;
  const [viewport, setViewport] = useState({ w: 800, h: 600, scrollTop: 0 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const sync = () => setViewport({ w: el.clientWidth, h: el.clientHeight, scrollTop: el.scrollTop });
    sync();
    const onScroll = () => setViewport((v) => ({ ...v, scrollTop: el.scrollTop }));
    const ro = new ResizeObserver(sync);
    el.addEventListener('scroll', onScroll, { passive: true });
    ro.observe(el);
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect(); };
  }, []);

  const metrics = useMemo(() => computeGridMetrics(viewport.w, size), [viewport.w, size]);
  const range = useMemo(
    () => visibleIndexRange(viewport.scrollTop, viewport.h, items.length, metrics, 2),
    [viewport.scrollTop, viewport.h, items.length, metrics],
  );
  const totalH = useMemo(() => totalGridHeight(items.length, metrics), [items.length, metrics]);
  const slice = items.slice(range.start, range.end);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-item]') || (e.target as HTMLElement).closest('input')) return;
    s.setSelection([]);
    const rect = contentRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left + (wrapRef.current?.scrollLeft || 0);
    const sy = e.clientY - rect.top + (wrapRef.current?.scrollTop || 0);
    marqueeBase.current = (e.ctrlKey || e.metaKey) ? [...tab.selection] : [];
    let cur = { x1: sx, y1: sy, x2: sx, y2: sy };
    const maxY = Math.max(0, totalH - 1);
    const maxX = Math.max(0, (wrapRef.current?.scrollWidth || viewport.w) - 1);
    const edge = 28;
    const move = (ev: PointerEvent) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const wrapBox = wrap.getBoundingClientRect();
      // 边缘自动滚动
      let dy = 0;
      let dx = 0;
      if (ev.clientY > wrapBox.bottom - edge) dy = Math.min(48, 8 + (ev.clientY - (wrapBox.bottom - edge)));
      else if (ev.clientY < wrapBox.top + edge) dy = -Math.min(48, 8 + ((wrapBox.top + edge) - ev.clientY));
      if (ev.clientX > wrapBox.right - edge) dx = Math.min(32, 6 + (ev.clientX - (wrapBox.right - edge)));
      else if (ev.clientX < wrapBox.left + edge) dx = -Math.min(32, 6 + ((wrapBox.left + edge) - ev.clientX));
      if (dy || dx) {
        wrap.scrollTop = Math.max(0, Math.min(wrap.scrollHeight - wrap.clientHeight, wrap.scrollTop + dy));
        wrap.scrollLeft = Math.max(0, Math.min(wrap.scrollWidth - wrap.clientWidth, wrap.scrollLeft + dx));
      }
      const scrollTop = wrap.scrollTop;
      const scrollLeft = wrap.scrollLeft;
      const contentOrigin = contentRef.current!.getBoundingClientRect();
      cur = {
        ...cur,
        x2: Math.max(0, Math.min(maxX, ev.clientX - contentOrigin.left + scrollLeft)),
        y2: Math.max(0, Math.min(maxY, ev.clientY - contentOrigin.top + scrollTop)),
      };
      const x = Math.min(cur.x1, cur.x2);
      const y = Math.min(cur.y1, cur.y2);
      const w = Math.abs(cur.x2 - cur.x1);
      const hh = Math.abs(cur.y2 - cur.y1);
      setMarquee({ x, y, w, h: hh });
      const hit = hitTestMarquee(items.length, orderedIds, { x, y, w, h: hh }, metrics);
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

  if (!items.length) return <EmptyState />;

  return (
    <div ref={wrapRef} className="no-select h-full overflow-auto" onContextMenu={h.bgCtx} onPointerDown={onPointerDown}>
      <div ref={contentRef} className="relative" style={{ height: totalH, minHeight: '100%' }}>
        {slice.map((node, i) => {
          const index = range.start + i;
          const box = cellRect(index, metrics);
          const selected = tab.selection.includes(node.id);
          return (
            <div
              key={node.id}
              data-item={node.id}
              draggable
              onDragStart={(e) => h.dragStart(e, node)}
              {...(node.kind !== 'file' || node.id === ID.trash ? h.folderTarget(node) : {})}
              onClick={(e) => h.click(e, node)}
              onDoubleClick={() => s.openNode(node.id)}
              onContextMenu={(e) => h.ctx(e, node)}
              className={cn(
                'group absolute flex cursor-default flex-col items-center gap-[5px] rounded-xl p-2 transition-colors',
                h.isCut(node.id) && 'opacity-45',
              )}
              style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            >
              <div className={cn(
                'rounded-[10px] p-[6px] transition-all group-hover:bg-black/[.04] dark:group-hover:bg-white/[.05]',
                selected && 'bg-[#0a84ff]/[.13] ring-1 ring-[#0a84ff]/50 group-hover:bg-[#0a84ff]/[.13] dark:bg-[#0a84ff]/[.22]',
              )}>
                <FileGlyph node={node} size={size} />
              </div>
              <div className={cn('w-full rounded-md px-1 py-px', selected && 'bg-[#0a84ff]/[.13] dark:bg-[#0a84ff]/[.22]')}>
                <NameLabel node={node} center />
              </div>
              <TagDots node={node} />
            </div>
          );
        })}
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

// ── 列表（详细信息）视图 ────────────────────────────────────
const COLS: { k: SortKey | null; label: string; w: string; right?: boolean }[] = [
  { k: 'name', label: '名称', w: 'flex-1 min-w-[180px]' },
  { k: 'modified', label: '修改日期', w: 'w-[132px]' },
  { k: 'kind', label: '类型', w: 'w-[132px]' },
  { k: 'size', label: '大小', w: 'w-[92px]', right: true },
];

export function ListView() {
  const s = useStore();
  const tab = useActiveTab();
  const items = useItems();
  const orderedIds = useMemo(() => items.map(i => i.id), [items]);
  const h = useFileHandlers(orderedIds);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualWindow(scrollRef, items.length, LIST_ROW_H, 16);
  const slice = items.slice(virt.start, virt.end);

  if (!items.length) return <EmptyState />;

  const headerClick = (k: SortKey | null) => {
    if (!k) return;
    if (tab.sortKey === k) s.patchTab({ sortDir: tab.sortDir === 'asc' ? 'desc' : 'asc' });
    else s.patchTab({ sortKey: k, sortDir: 'asc' });
  };

  return (
    <div
      ref={scrollRef}
      className="no-select h-full overflow-auto px-2 pb-3"
      onContextMenu={h.bgCtx}
      onClick={() => s.setSelection([])}
    >
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-black/[.07] bg-white/95 py-[7px] pl-3 pr-4 backdrop-blur dark:border-white/[.08] dark:bg-[#1f1f22]/95">
        {COLS.map(c => (
          <button
            key={c.label}
            onClick={(e) => { e.stopPropagation(); headerClick(c.k); }}
            className={cn(
              'flex items-center gap-1 text-left text-[12px] font-medium text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-200',
              c.w, c.right && 'justify-end',
              tab.sortKey === c.k && 'text-zinc-700 dark:text-zinc-200',
            )}
          >
            {c.label}
            {tab.sortKey === c.k && (tab.sortDir === 'asc' ? <ChevronUp size={11} strokeWidth={2.5} /> : <ChevronDown size={11} strokeWidth={2.5} />)}
          </button>
        ))}
      </div>
      <div style={{ height: virt.totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${virt.offsetY}px)` }}>
          {slice.map(node => {
            const selected = tab.selection.includes(node.id);
            return (
              <div
                key={node.id}
                data-item={node.id}
                draggable
                onDragStart={(e) => h.dragStart(e, node)}
                {...(node.kind !== 'file' || node.id === ID.trash ? h.folderTarget(node) : {})}
                onClick={(e) => h.click(e, node)}
                onDoubleClick={() => s.openNode(node.id)}
                onContextMenu={(e) => h.ctx(e, node)}
                style={{ height: LIST_ROW_H }}
                className={cn(
                  'flex cursor-default items-center gap-2 rounded-[7px] py-[5px] pl-3 pr-4 transition-colors',
                  selected ? 'bg-[#0a84ff]/[.13] dark:bg-[#0a84ff]/[.22]' : 'hover:bg-black/[.03] dark:hover:bg-white/[.05]',
                  h.isCut(node.id) && 'opacity-45',
                  h.dropId === node.id && 'ring-2 ring-inset ring-[#0a84ff]',
                )}
              >
                <span className={cn('flex min-w-0 flex-1 items-center gap-2', h.dropId === node.id && 'pointer-events-none')}>
                  <FileGlyph node={node} size={19} />
                  <NameLabel node={node} small />
                  <span className="flex items-center gap-[3px]">{node.tags.map(t => <TagDot key={t} color={t} size={7} ring={false} />)}</span>
                </span>
                <span className="w-[132px] text-[12px] text-zinc-400 tabular">{formatDate(node.modifiedAt)}</span>
                <span className="w-[132px] truncate text-[12px] text-zinc-400">{kindLabel(node)}</span>
                <span className="w-[92px] text-right text-[12px] text-zinc-500 tabular dark:text-zinc-400">
                  {node.kind === 'file' ? formatSize(node.size) : '—'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── 此电脑 ──────────────────────────────────────────────────
export function ThisPCView() {
  const s = useStore();
  const h = useFileHandlers([]);
  const { nodes } = s;
  const folders = [ID.desktop, ID.dl, ID.docs, ID.pics, ID.music, ID.vids].map(id => nodes[id]).filter(Boolean);
  const drives = [ID.c, ID.d, ID.e].map(id => nodes[id]).filter(Boolean);
  const od = nodes[ID.od];

  return (
    <div className="h-full overflow-auto p-6" onContextMenu={h.bgCtx}>
      <p className="mb-3 px-1 text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">文件夹</p>
      <div className="mb-8 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {folders.map(n => (
          <button
            key={n.id}
            onDoubleClick={() => s.openNode(n.id)}
            onContextMenu={(e) => h.ctx(e, n)}
            {...h.folderTarget(n)}
            className={cn(
              'flex flex-col items-start gap-2 rounded-xl p-3 text-left transition-colors hover:bg-black/[.04] dark:hover:bg-white/[.05]',
              h.dropId === n.id && 'ring-2 ring-inset ring-[#0a84ff]',
            )}
          >
            <FolderIcon size={44} />
            <span>
              <span className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-200">{n.name}</span>
              <span className="block text-[11px] text-zinc-400">{n.childrenIds.filter(c => !nodes[c]?.deleted).length} 个项目</span>
            </span>
          </button>
        ))}
      </div>
      <p className="mb-3 px-1 text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">设备和驱动器</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
        {drives.map(n => {
          const pct = n.drive ? n.drive.used / n.drive.total : 0;
          return (
            <button
              key={n.id}
              onDoubleClick={() => s.openNode(n.id)}
              onContextMenu={(e) => h.ctx(e, n)}
              {...h.folderTarget(n)}
              className={cn(
                'flex items-center gap-3 rounded-xl border border-black/[.05] bg-black/[.02] p-3.5 text-left transition-all hover:border-black/[.1] hover:bg-black/[.04] dark:border-white/[.07] dark:bg-white/[.03] dark:hover:bg-white/[.06]',
                h.dropId === n.id && 'ring-2 ring-inset ring-[#0a84ff]',
              )}
            >
              <DriveIcon size={46} removable={n.drive?.removable} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-zinc-700 dark:text-zinc-200">{n.name}</span>
                <span className="mt-1.5 block h-[5px] overflow-hidden rounded-full bg-black/[.08] dark:bg-white/[.12]">
                  <span className="block h-full rounded-full transition-all" style={{ width: `${pct * 100}%`, background: pct > 0.9 ? '#ff453a' : '#0a84ff' }} />
                </span>
                <span className="mt-1.5 block text-[11px] text-zinc-400 tabular">
                  可用 {formatSize((n.drive?.total ?? 0) - (n.drive?.used ?? 0))} · 共 {formatSize(n.drive?.total ?? 0)}
                </span>
              </span>
            </button>
          );
        })}
        {od && (
          <button
            onDoubleClick={() => s.openNode(od.id)}
            onContextMenu={(e) => h.ctx(e, od)}
            {...h.folderTarget(od)}
            className="flex items-center gap-3 rounded-xl border border-black/[.05] bg-black/[.02] p-3.5 text-left transition-all hover:bg-black/[.04] dark:border-white/[.07] dark:bg-white/[.03] dark:hover:bg-white/[.06]"
          >
            <FileGlyph node={od} size={40} />
            <span>
              <span className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-200">OneDrive</span>
              <span className="mt-1 block text-[11px] text-zinc-400">云存储 · 已同步</span>
            </span>
          </button>
        )}
      </div>
      <div className="mt-10 flex items-center gap-2 rounded-xl bg-[#0a84ff]/[.06] px-4 py-3 text-[12px] text-zinc-500 dark:bg-[#0a84ff]/[.1] dark:text-zinc-400">
        <FolderLucide size={14} className="text-[#0a84ff]" />
        提示：按 <span className="kbd mx-1">空格</span> 快速查看文件，按 <span className="kbd mx-1">Ctrl K</span> 打开命令面板，按 <span className="kbd mx-1">?</span> 查看全部快捷键
      </div>
    </div>
  );
}

export { ImageThumb };
