import { useRef, useState, useMemo, useCallback, useEffect, memo } from 'react';
import {
  ChevronUp, ChevronDown, FolderOpen, SearchX, Trash2, RotateCcw, Folder as FolderLucide, Loader2, X,
} from 'lucide-react';
import { deepSearchBusyLabel } from '@/lib/previewFail';
import { useStore, useActiveTab, useItems, useCurrentLocation, currentNodeId } from '@/lib/store';
import { FileGlyph, FolderIcon, ImageThumb, TagDot, DriveIcon } from './icons';
import { FSNode, ID, SortKey, formatSize, formatDate, kindLabel } from '@/lib/fs';
import { useVirtualWindow } from '@/hooks/useVirtualWindow';
import { useGridWindow } from '@/hooks/useRafViewport';
import { useEnsureSelectionVisible, listScrollToIndex } from '@/hooks/useEnsureSelectionVisible';
import { cellRect, hitTestMarquee, totalGridHeight } from '@/lib/gridLayout';
import { cn } from '@/utils/cn';
import { searchSourceLabel } from '@/lib/indexLabel';

const LIST_ROW_H = 32;

// ── 名称标签 / 重命名（避免无 selector 的 useStore，防止每格订阅整棵 store）──
export function NameLabel({
  node,
  center,
  small,
  renaming: renamingProp,
}: {
  node: FSNode;
  center?: boolean;
  small?: boolean;
  /** 若由父级传入则不再订阅 store */
  renaming?: boolean;
}) {
  const renamingFromStore = useStore((s) => {
    if (renamingProp !== undefined) return false;
    const t = s.tabs.find((x) => x.id === s.activeTabId);
    return t?.renaming === node.id;
  });
  const renaming = renamingProp !== undefined ? renamingProp : renamingFromStore;
  if (renaming) {
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
          const st = useStore.getState();
          if (e.key === 'Enter') st.commitRename(node.id, (e.target as HTMLInputElement).value);
          if (e.key === 'Escape') st.patchTab({ renaming: null });
        }}
        onBlur={(e) => useStore.getState().commitRename(node.id, e.target.value)}
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

const EMPTY_SEL: string[] = [];

// ── 共享交互（窄订阅：不因 toast/深搜等无关字段重渲染）────────────────
export function useFileHandlers(orderedIds: string[]) {
  const selection = useStore((s) => {
    const t = s.tabs.find((x) => x.id === s.activeTabId);
    return t?.selection ?? EMPTY_SEL;
  });
  const cutIds = useStore((s) =>
    s.clipboard?.mode === 'cut' ? s.clipboard.ids : null,
  );
  const orderedRef = useRef(orderedIds);
  orderedRef.current = orderedIds;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const anchor = useRef<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);

  const click = useCallback((e: React.MouseEvent, node: FSNode, orderOverride?: string[]) => {
    e.stopPropagation();
    const st = useStore.getState();
    const order = orderOverride ?? orderedRef.current;
    const sel = selectionRef.current;
    if (e.shiftKey && anchor.current && order.includes(anchor.current)) {
      const a = order.indexOf(anchor.current);
      const b = order.indexOf(node.id);
      if (a >= 0 && b >= 0) {
        st.setSelection(order.slice(Math.min(a, b), Math.max(a, b) + 1));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      st.setSelection(sel.includes(node.id) ? sel.filter((x) => x !== node.id) : [...sel, node.id]);
    } else {
      st.setSelection([node.id]);
    }
    anchor.current = node.id;
  }, []);

  const ctx = useCallback((e: React.MouseEvent, node: FSNode) => {
    e.preventDefault();
    e.stopPropagation();
    const st = useStore.getState();
    const sel = selectionRef.current.includes(node.id) ? selectionRef.current : [node.id];
    if (!selectionRef.current.includes(node.id)) st.setSelection([node.id]);
    anchor.current = node.id;
    st.setContext({ x: e.clientX, y: e.clientY, ids: sel });
  }, []);

  const dragStart = useCallback((e: React.DragEvent, node: FSNode) => {
    const st = useStore.getState();
    const sel = selectionRef.current;
    const ids = sel.includes(node.id) ? sel : [node.id];
    if (!sel.includes(node.id)) st.setSelection([node.id]);
    e.dataTransfer.setData('application/x-aurora', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'copyMove';
  }, []);

  const folderTarget = useCallback((node: FSNode) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/x-aurora')) return;
      if (selectionRef.current.includes(node.id)) return;
      e.preventDefault();
      e.stopPropagation();
      setDropId(node.id);
    },
    onDragLeave: () => setDropId((d) => (d === node.id ? null : d)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropId(null);
      const st = useStore.getState();
      try {
        const ids = JSON.parse(e.dataTransfer.getData('application/x-aurora')) as string[];
        if (ids?.length) {
          if (node.id === ID.trash) st.trash(ids);
          else if (node.deleted || node.kind === 'file') st.toast('无法移动到该位置');
          else st.moveTo(ids, node.id);
        }
      } catch { /* ignore */ }
    },
  }), []);

  const bgCtx = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    useStore.getState().setContext({ x: e.clientX, y: e.clientY, ids: [] });
  }, []);

  const cutSet = useMemo(() => (cutIds ? new Set(cutIds) : null), [cutIds]);
  const isCut = useCallback((id: string) => !!cutSet?.has(id), [cutSet]);

  return { click, ctx, dragStart, folderTarget, bgCtx, dropId, isCut, cutSet };
}

// ── 特殊位置标题条 ──────────────────────────────────────────
export function LocationHeader({ count }: { count: number }) {
  const cancelDeepSearch = useStore((s) => s.cancelDeepSearch);
  const restore = useStore((s) => s.restore);
  const emptyTrash = useStore((s) => s.emptyTrash);
  const deepHitsLen = useStore((s) => s.deepHits?.length ?? 0);
  const deepMeta = useStore((s) => s.deepMeta);
  const deepBusy = useStore((s) => s.deepSearching);
  const folderBusy = useStore((s) => s.folderRefreshing);
  const locName = useStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId) ?? s.tabs[0];
    const loc = tab.history[tab.hi];
    return loc.t === 'node' ? s.nodes[loc.id]?.name : undefined;
  });
  const tab = useActiveTab();
  const loc = useCurrentLocation();
  const nodeId = currentNodeId(tab);
  const isTrash = nodeId === ID.trash;
  const searching = !!tab.search.trim();
  const deep = deepHitsLen > 0;
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
            onClick={() => cancelDeepSearch()}
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
          {deep ? '深度搜索' : '当前范围'}「{loc.t === 'node' ? locName : '标签'}」
          找到 <b className="text-zinc-700 dark:text-zinc-200">{count}</b> 个匹配
          “<b className="text-[#0a84ff]">{tab.search}</b>”
          {deepMeta
            ? ` · ${searchSourceLabel(deepMeta.source, deepMeta.cached)} ${deepMeta.scanned}${deepMeta.truncated ? '（已截断）' : ''}`
            : ''}
          {!deep && ' · 正在扩展到子文件夹…'}
        </span>
      ) : isTrash ? (
        <>
          <span>{count} 个项目</span>
          <span className="text-zinc-300 dark:text-zinc-600">项目会在 30 天后自动清除</span>
          <span className="flex-1" />
          <button
            disabled={!tab.selection.length}
            onClick={() => restore(tab.selection)}
            className="flex items-center gap-1 rounded-md px-2 py-1 font-medium text-[#0a84ff] transition-colors hover:bg-[#0a84ff]/10 disabled:opacity-35"
          ><RotateCcw size={13} strokeWidth={2} />还原所选</button>
          <button
            disabled={!count}
            onClick={emptyTrash}
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
  const cancelDeepSearch = useStore((s) => s.cancelDeepSearch);
  const deepBusy = useStore((s) => s.deepSearching);
  const tab = useActiveTab();
  const nodeId = currentNodeId(tab);
  const searching = !!tab.search.trim();
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
          onClick={() => cancelDeepSearch()}
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
  const tab = useActiveTab();
  const items = useItems();
  const orderedIds = useMemo(() => items.map((i) => i.id), [items]);
  const itemsById = useMemo(() => {
    const m = new Map<string, FSNode>();
    for (const n of items) m.set(n.id, n);
    return m;
  }, [items]);
  const h = useFileHandlers(orderedIds);
  const wrapRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const marqueeBase = useRef<string[]>([]);
  const size = tab.iconSize;
  const selectedSet = useMemo(() => new Set(tab.selection), [tab.selection]);
  const { metrics, range, w: viewportW } = useGridWindow(wrapRef, items.length, size, 1);
  const totalH = useMemo(() => totalGridHeight(items.length, metrics), [items.length, metrics]);
  const slice = items.slice(range.start, range.end);
  const orderedRef = useRef(orderedIds);
  orderedRef.current = orderedIds;
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;
  const itemsLenRef = useRef(items.length);
  itemsLenRef.current = items.length;
  const hRef = useRef(h);
  hRef.current = h;
  const itemsByIdRef = useRef(itemsById);
  itemsByIdRef.current = itemsById;
  const scrollIdle = useRef(0);

  // DOM-only scroll flag — no React commit (preserves useGridWindow skip-same-window)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onScroll = () => {
      el.dataset.scrolling = '1';
      window.clearTimeout(scrollIdle.current);
      scrollIdle.current = window.setTimeout(() => {
        delete el.dataset.scrolling;
      }, 120);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.clearTimeout(scrollIdle.current);
    };
  }, []);

  const scrollSelToIndex = useCallback((el: HTMLElement, index: number) => {
    const box = cellRect(index, metricsRef.current);
    const top = box.y - el.clientHeight / 2 + box.h / 2;
    el.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  }, []);
  useEnsureSelectionVisible(wrapRef, orderedIds, tab.selection, scrollSelToIndex);

  const nodeFromEvent = useCallback((e: React.SyntheticEvent) => {
    const el = (e.target as HTMLElement).closest('[data-item]');
    if (!el) return null;
    const id = el.getAttribute('data-item');
    return id ? itemsByIdRef.current.get(id) ?? null : null;
  }, []);

  const onDelegatedClick = useCallback(
    (e: React.MouseEvent) => {
      const node = nodeFromEvent(e);
      if (!node) return;
      hRef.current.click(e, node);
    },
    [nodeFromEvent],
  );

  const onDelegatedDblClick = useCallback(
    (e: React.MouseEvent) => {
      const node = nodeFromEvent(e);
      if (!node) return;
      useStore.getState().openNode(node.id);
    },
    [nodeFromEvent],
  );

  const onDelegatedCtx = useCallback(
    (e: React.MouseEvent) => {
      const node = nodeFromEvent(e);
      if (!node) {
        hRef.current.bgCtx(e);
        return;
      }
      hRef.current.ctx(e, node);
    },
    [nodeFromEvent],
  );

  const onDelegatedDragStart = useCallback(
    (e: React.DragEvent) => {
      const node = nodeFromEvent(e);
      if (!node) return;
      hRef.current.dragStart(e, node);
    },
    [nodeFromEvent],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-item]') || (e.target as HTMLElement).closest('input')) return;
    const st = useStore.getState();
    st.setSelection([]);
    const rect = contentRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left + (wrapRef.current?.scrollLeft || 0);
    const sy = e.clientY - rect.top + (wrapRef.current?.scrollTop || 0);
    const active = st.tabs.find((t) => t.id === st.activeTabId);
    marqueeBase.current = e.ctrlKey || e.metaKey ? [...(active?.selection ?? [])] : [];
    let cur = { x1: sx, y1: sy, x2: sx, y2: sy };
    const maxY = Math.max(0, totalH - 1);
    const maxX = Math.max(0, (wrapRef.current?.scrollWidth || viewportW) - 1);
    const edge = 28;
    const move = (ev: PointerEvent) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const wrapBox = wrap.getBoundingClientRect();
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
      const hit = hitTestMarquee(itemsLenRef.current, orderedRef.current, { x, y, w, h: hh }, metricsRef.current);
      useStore.getState().setSelection([...new Set([...marqueeBase.current, ...hit])]);
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

  const renamingId = tab.renaming;
  const cutSet = h.cutSet;

  return (
    <div
      ref={wrapRef}
      data-testid="grid-scroll"
      className="no-select h-full overflow-auto"
      onContextMenu={onDelegatedCtx}
      onClick={onDelegatedClick}
      onDoubleClick={onDelegatedDblClick}
      onDragStart={onDelegatedDragStart}
      onPointerDown={onPointerDown}
    >
      <div ref={contentRef} className="relative" style={{ height: totalH, minHeight: '100%' }}>
        {slice.map((node, i) => {
          const index = range.start + i;
          const box = cellRect(index, metrics);
          const needsFolderTarget = node.kind !== 'file' || node.id === ID.trash;
          return (
            <GridCell
              key={`slot-${i}`}
              node={node}
              box={box}
              size={size}
              selected={selectedSet.has(node.id)}
              cut={!!cutSet?.has(node.id)}
              renaming={renamingId === node.id}
              folderTargetProps={needsFolderTarget ? h.folderTarget(node) : undefined}
            />
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

type GridCellProps = {
  node: FSNode;
  box: { x: number; y: number; w: number; h: number };
  size: number;
  selected: boolean;
  cut: boolean;
  renaming: boolean;
  folderTargetProps?: Record<string, unknown>;
};

const GridCell = memo(function GridCell({
  node,
  box,
  size,
  selected,
  cut,
  renaming,
  folderTargetProps,
}: GridCellProps) {
  return (
    <div
      data-item={node.id}
      draggable
      {...(folderTargetProps || {})}
      className={cn(
        'group absolute flex cursor-default flex-col items-center gap-[5px] rounded-xl p-2 transition-colors [[data-scrolling]_&]:transition-none',
        cut && 'opacity-45',
      )}
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        contentVisibility: 'auto',
        containIntrinsicSize: `${box.w}px ${box.h}px`,
      }}
    >
      <div
        className={cn(
          'rounded-[10px] p-[6px] transition-colors group-hover:bg-black/[.04] dark:group-hover:bg-white/[.05]',
          selected &&
            'bg-[#0a84ff]/[.13] ring-1 ring-[#0a84ff]/50 group-hover:bg-[#0a84ff]/[.13] dark:bg-[#0a84ff]/[.22]',
        )}
      >
        <FileGlyph node={node} size={size} />
      </div>
      <div
        className={cn(
          'w-full rounded-md px-1 py-px',
          selected && 'bg-[#0a84ff]/[.13] dark:bg-[#0a84ff]/[.22]',
        )}
      >
        <NameLabel node={node} center renaming={renaming} />
      </div>
      <TagDots node={node} />
    </div>
  );
});

// ── 列表（详细信息）视图 ────────────────────────────────────
const COLS: { k: SortKey | null; label: string; w: string; right?: boolean }[] = [
  { k: 'name', label: '名称', w: 'flex-1 min-w-[180px]' },
  { k: 'modified', label: '修改日期', w: 'w-[132px]' },
  { k: 'kind', label: '类型', w: 'w-[132px]' },
  { k: 'size', label: '大小', w: 'w-[92px]', right: true },
];

export function ListView() {
  const tab = useActiveTab();
  const items = useItems();
  const orderedIds = useMemo(() => items.map((i) => i.id), [items]);
  const itemsById = useMemo(() => {
    const m = new Map<string, FSNode>();
    for (const n of items) m.set(n.id, n);
    return m;
  }, [items]);
  const h = useFileHandlers(orderedIds);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualWindow(scrollRef, items.length, LIST_ROW_H, 8);
  const slice = items.slice(virt.start, virt.end);
  const selectedSet = useMemo(() => new Set(tab.selection), [tab.selection]);
  const hRef = useRef(h);
  hRef.current = h;
  const itemsByIdRef = useRef(itemsById);
  itemsByIdRef.current = itemsById;
  useEnsureSelectionVisible(scrollRef, orderedIds, tab.selection, listScrollToIndex(LIST_ROW_H));

  const nodeFromEvent = useCallback((e: React.SyntheticEvent) => {
    const el = (e.target as HTMLElement).closest('[data-item]');
    if (!el) return null;
    const id = el.getAttribute('data-item');
    return id ? itemsByIdRef.current.get(id) ?? null : null;
  }, []);

  if (!items.length) return <EmptyState />;

  const headerClick = (k: SortKey | null) => {
    if (!k) return;
    const st = useStore.getState();
    const t = st.tabs.find((x) => x.id === st.activeTabId);
    if (!t) return;
    if (t.sortKey === k) st.patchTab({ sortDir: t.sortDir === 'asc' ? 'desc' : 'asc' });
    else st.patchTab({ sortKey: k, sortDir: 'asc' });
  };

  return (
    <div
      ref={scrollRef}
      data-testid="list-scroll"
      className="no-select h-full overflow-auto px-2 pb-3"
      onContextMenu={(e) => {
        const node = nodeFromEvent(e);
        if (!node) hRef.current.bgCtx(e);
        else hRef.current.ctx(e, node);
      }}
      onClick={(e) => {
        const node = nodeFromEvent(e);
        if (!node) {
          useStore.getState().setSelection([]);
          return;
        }
        hRef.current.click(e, node);
      }}
      onDoubleClick={(e) => {
        const node = nodeFromEvent(e);
        if (node) useStore.getState().openNode(node.id);
      }}
      onDragStart={(e) => {
        const node = nodeFromEvent(e);
        if (node) hRef.current.dragStart(e, node);
      }}
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
          {slice.map((node, i) => {
            const selected = selectedSet.has(node.id);
            const needsFolderTarget = node.kind !== 'file' || node.id === ID.trash;
            return (
              <ListRow
                key={`list-slot-${i}`}
                node={node}
                selected={selected}
                cut={!!h.cutSet?.has(node.id)}
                dropActive={h.dropId === node.id}
                renaming={tab.renaming === node.id}
                folderTargetProps={needsFolderTarget ? h.folderTarget(node) : undefined}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

const ListRow = memo(function ListRow({
  node,
  selected,
  cut,
  dropActive,
  renaming,
  folderTargetProps,
}: {
  node: FSNode;
  selected: boolean;
  cut: boolean;
  dropActive: boolean;
  renaming: boolean;
  folderTargetProps?: Record<string, unknown>;
}) {
  return (
              <div
                data-item={node.id}
                draggable
                {...(folderTargetProps || {})}
                style={{ height: LIST_ROW_H }}
                className={cn(
                  'flex cursor-default items-center gap-2 rounded-[7px] py-[5px] pl-3 pr-4 transition-colors',
                  selected ? 'bg-[#0a84ff]/[.13] dark:bg-[#0a84ff]/[.22]' : 'hover:bg-black/[.03] dark:hover:bg-white/[.05]',
                  cut && 'opacity-45',
                  dropActive && 'ring-2 ring-inset ring-[#0a84ff]',
                )}
              >
                <span className={cn('flex min-w-0 flex-1 items-center gap-2', dropActive && 'pointer-events-none')}>
                  <FileGlyph node={node} size={19} />
                  <NameLabel node={node} small renaming={renaming} />
                  <span className="flex items-center gap-[3px]">{node.tags.map(t => <TagDot key={t} color={t} size={7} ring={false} />)}</span>
                </span>
                <span className="w-[132px] text-[12px] text-zinc-400 tabular">{formatDate(node.modifiedAt)}</span>
                <span className="w-[132px] truncate text-[12px] text-zinc-400">{kindLabel(node)}</span>
                <span className="w-[92px] text-right text-[12px] text-zinc-500 tabular dark:text-zinc-400">
                  {node.kind === 'file' ? formatSize(node.size) : '—'}
                </span>
              </div>
  );
});

// ── 此电脑 ──────────────────────────────────────────────────
export function ThisPCView() {
  const s = useStore();
  const h = useFileHandlers([]);
  const { nodes } = s;
  const folders = [ID.desktop, ID.dl, ID.docs, ID.pics, ID.music, ID.vids].map(id => nodes[id]).filter(Boolean);
  const drives = [ID.c, ID.d, ID.e].map(id => nodes[id]).filter(Boolean);
  const od = nodes[ID.od];

  return (
    <div className="h-full overflow-auto p-6" onContextMenu={h.bgCtx} data-testid="this-pc-view">
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
