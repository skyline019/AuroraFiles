import { useState, useRef, useEffect } from 'react';
import {
  ChevronLeft, ChevronRight, ArrowUp, FolderPlus, ArrowUpDown, MoreHorizontal,
  LayoutGrid, List, Columns3, GalleryHorizontal, Search, X, Check, ChevronDown, Loader2,
} from 'lucide-react';
import { useStore, useActiveTab, useCurrentLocation, currentNodeId } from '@/lib/store';
import { FileGlyph, TagDot } from './icons';
import { FSNode, ID, ViewMode, SortKey, getChain, pathString, findByPath, trashCount, sortNodes } from '@/lib/fs';
import { cn } from '@/utils/cn';

// ── 弹出小菜单 ──────────────────────────────────────────────
export interface PopItem {
  label: string; icon?: React.ReactNode; shortcut?: string; checked?: boolean;
  danger?: boolean; disabled?: boolean; sep?: boolean; action?: () => void;
}
export function Pop({ x, y, items, onClose, minW = 200 }: { x: number; y: number; items: PopItem[]; onClose: () => void; minW?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [onClose]);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y]);
  return (
    <div
      ref={ref}
      style={{ left: pos.x, top: pos.y, minWidth: minW }}
      className="fixed z-[90] rounded-xl border border-black/[.08] bg-white/90 p-1 shadow-2xl shadow-black/20 backdrop-blur-2xl dark:border-white/[.12] dark:bg-[#2c2c2e]/95"
    >
      {items.map((it, i) => it.sep ? (
        <div key={i} className="mx-2 my-1 h-px bg-black/[.07] dark:bg-white/[.1]" />
      ) : (
        <button
          key={i}
          disabled={it.disabled}
          onClick={() => { it.action?.(); onClose(); }}
          className={cn(
            'flex w-full items-center gap-2 rounded-[7px] px-2 py-[5px] text-left text-[13px] transition-colors',
            it.disabled ? 'opacity-40' : it.danger
              ? 'text-red-500 hover:bg-red-500 hover:text-white'
              : 'text-zinc-700 hover:bg-[#0a84ff] hover:text-white dark:text-zinc-200',
          )}
        >
          <span className="flex w-4 items-center justify-center">{it.checked ? <Check size={13} strokeWidth={2.6} /> : it.icon}</span>
          <span className="flex-1">{it.label}</span>
          {it.shortcut && <span className={cn('text-[11px]', 'opacity-45')}>{it.shortcut}</span>}
        </button>
      ))}
    </div>
  );
}

// ── 地址栏 ──────────────────────────────────────────────────
function PathBar() {
  const s = useStore();
  const tab = useActiveTab();
  const loc = useCurrentLocation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [menuFor, setMenuFor] = useState<{ x: number; y: number; parentId: string } | null>(null);
  const nodeId = currentNodeId(tab);

  const chain = nodeId ? getChain(s.nodes, nodeId) : [];
  const MAX = 5;
  let segs = chain;
  let collapsed = false;
  if (chain.length > MAX) {
    segs = [chain[0], ...chain.slice(-(MAX - 1))];
    collapsed = true;
  }

  const startEdit = () => {
    if (loc.t === 'tag') return;
    setText(nodeId ? pathString(s.nodes, nodeId) : '');
    setEditing(true);
  };

  const siblingItems = (parentId: string): PopItem[] => {
    const parent = s.nodes[parentId];
    if (!parent) return [];
    return sortNodes(s.nodes, parent.childrenIds.map(c => s.nodes[c]).filter((x): x is FSNode => !!x && !x.deleted), 'name', 'asc')
      .slice(0, 24)
      .map(n => ({
        label: n.name,
        icon: <FileGlyph node={n} size={15} />,
        checked: n.id === nodeId,
        action: () => s.openNode(n.id),
      }));
  };

  return (
    <>
      <div className="flex h-8 min-w-0 flex-1 items-center rounded-[9px] bg-black/[.045] pl-2 pr-1 ring-1 ring-black/[.04] transition-shadow focus-within:ring-2 focus-within:ring-[#0a84ff]/60 dark:bg-white/[.07] dark:ring-white/[.05]">
        {editing ? (
          <input
            autoFocus
            value={text}
            onChange={e => setText(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const found = findByPath(s.nodes, text);
                setEditing(false);
                if (found) s.navigate(found);
                else s.toast('找不到该路径，请检查拼写');
              }
              if (e.key === 'Escape') setEditing(false);
            }}
            className="h-full w-full bg-transparent text-[13px] text-zinc-800 outline-none dark:text-zinc-100"
            placeholder="输入路径，如：C:\Users\linwz\桌面"
          />
        ) : (
          <div className="flex h-full min-w-0 flex-1 items-center" onDoubleClick={startEdit}>
            {loc.t === 'tag' ? (
              <span className="flex items-center gap-2 px-1 text-[13px] font-medium text-zinc-700 dark:text-zinc-200">
                <TagDot color={loc.tag} size={11} /> 标签：{loc.tag}
              </span>
            ) : (
              <div className="flex min-w-0 items-center overflow-x-auto py-1">
                {segs.map((n, i) => {
                  const isLast = i === segs.length - 1;
                  const isFirst = i === 0;
                  return (
                    <span key={n.id} className="flex shrink-0 items-center">
                      {i > 0 && <ChevronRight size={12} className="mx-[2px] shrink-0 text-zinc-400" strokeWidth={2.2} />}
                      {collapsed && i === 1 && (
                        <span className="mr-1 shrink-0 text-[13px] text-zinc-400">…<ChevronRight size={12} className="mx-[2px] -mt-px inline text-zinc-400" strokeWidth={2.2} /></span>
                      )}
                      <button
                        onClick={() => !isLast && s.navigate({ t: 'node', id: n.id })}
                        title={n.name}
                        className={cn(
                          'flex items-center gap-1.5 rounded-md px-1.5 py-[3px] text-[13px] transition-colors',
                          isLast ? 'font-semibold text-zinc-800 dark:text-zinc-100' : 'text-zinc-500 hover:bg-black/[.05] hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/[.08] dark:hover:text-zinc-200',
                        )}
                      >
                        {isFirst && <FileGlyph node={n} size={15} />}
                        <span className="max-w-[140px] truncate">{n.name}</span>
                        {!isLast && (
                          <span
                            role="button"
                            title="查看同级项目"
                            onClick={(e) => {
                              e.stopPropagation();
                              const r = (e.target as HTMLElement).getBoundingClientRect();
                              setMenuFor({ x: r.left, y: r.bottom + 4, parentId: n.id });
                            }}
                            className="rounded p-px text-zinc-400 hover:bg-black/[.06] hover:text-zinc-600 dark:hover:bg-white/[.1]"
                          >
                            <ChevronDown size={11} strokeWidth={2.4} />
                          </span>
                        )}
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <button className="ml-auto h-full min-w-6 flex-1 cursor-text" title="点击编辑路径" onClick={startEdit} />
          </div>
        )}
      </div>
      {menuFor && <Pop x={menuFor.x} y={menuFor.y} items={siblingItems(menuFor.parentId)} onClose={() => setMenuFor(null)} minW={220} />}
    </>
  );
}

// ── 工具栏 ──────────────────────────────────────────────────
const VIEW_MODES: { v: ViewMode; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; label: string; key: string }[] = [
  { v: 'grid', icon: LayoutGrid, label: '图标视图', key: 'Ctrl+1' },
  { v: 'list', icon: List, label: '列表视图', key: 'Ctrl+2' },
  { v: 'columns', icon: Columns3, label: '分栏视图', key: 'Ctrl+3' },
  { v: 'gallery', icon: GalleryHorizontal, label: '画廊视图', key: 'Ctrl+4' },
];
const SORTS: { k: SortKey; label: string }[] = [
  { k: 'name', label: '名称' }, { k: 'modified', label: '修改日期' }, { k: 'kind', label: '类型' }, { k: 'size', label: '大小' },
];

export function Toolbar() {
  const s = useStore();
  const tab = useActiveTab();
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const nodeId = currentNodeId(tab);
  const isTrash = nodeId === ID.trash;
  const binCount = trashCount(s.nodes);
  const sel = tab.selection;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F3') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
    };
    const focusSearch = () => { searchRef.current?.focus(); searchRef.current?.select(); };
    window.addEventListener('keydown', h);
    window.addEventListener('aurora:focus-search', focusSearch);
    return () => {
      window.removeEventListener('keydown', h);
      window.removeEventListener('aurora:focus-search', focusSearch);
    };
  }, []);

  const btn = (title: string, onClick: () => void, icon: React.ReactNode, disabled = false, danger = false) => (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-[7px] p-[7px] transition-colors',
        disabled ? 'text-zinc-300 dark:text-zinc-600' : danger
          ? 'text-red-500 hover:bg-red-500/10'
          : 'text-zinc-500 hover:bg-black/[.05] hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/[.08] dark:hover:text-zinc-100',
      )}
    >{icon}</button>
  );
  const div = <span className="mx-1 h-5 w-px shrink-0 bg-black/[.07] dark:bg-white/[.09]" />;

  const sortItems: PopItem[] = [
    ...SORTS.map(x => ({ label: x.label, checked: tab.sortKey === x.k, action: () => s.patchTab({ sortKey: x.k }) })),
    { label: '', sep: true },
    { label: '升序', checked: tab.sortDir === 'asc', action: () => s.patchTab({ sortDir: 'asc' }) },
    { label: '降序', checked: tab.sortDir === 'desc', action: () => s.patchTab({ sortDir: 'desc' }) },
  ];
  const moreItems: PopItem[] = [
    { label: '全选', shortcut: 'Ctrl+A', action: () => document.dispatchEvent(new CustomEvent('aurora:select-all')) },
    { label: '反向选择', shortcut: 'Ctrl+Shift+U', action: () => document.dispatchEvent(new CustomEvent('aurora:invert')) },
    { label: '批量重命名…', disabled: sel.length < 1, shortcut: 'F6', action: () => s.setBatch(true) },
    { label: '压缩为 ZIP', disabled: sel.length < 1, action: () => s.compress(sel) },
    { label: '', sep: true },
    { label: '撤消', shortcut: 'Ctrl+Z', disabled: !s.undoStack.length, action: s.undo },
    { label: '重做', shortcut: 'Ctrl+Y', disabled: !s.redoStack.length, action: s.redo },
    { label: '', sep: true },
    { label: '显示隐藏的项目', checked: tab.showHidden, shortcut: 'Ctrl+Shift+.', action: () => s.patchTab({ showHidden: !tab.showHidden }) },
    {
      label: '复制当前路径', action: () => {
        if (nodeId) { navigator.clipboard?.writeText(pathString(s.nodes, nodeId)).catch(() => undefined); s.toast('已复制路径'); }
      },
    },
    { label: '刷新', shortcut: 'F5', action: () => { void s.refreshCurrent(); } },
    ...(isTrash && binCount > 0 ? [{ label: '', sep: true } as PopItem, { label: '清空回收站', danger: true, action: s.emptyTrash } as PopItem] : []),
  ];

  return (
    <div className="flex h-12 shrink-0 items-center gap-[2px] border-b border-black/[.06] px-2.5 dark:border-white/[.08]">
      {btn('后退 (Alt+←)', s.back, <ChevronLeft size={17} strokeWidth={2} />, tab.hi === 0)}
      {btn('前进 (Alt+→)', s.forward, <ChevronRight size={17} strokeWidth={2} />, tab.hi >= tab.history.length - 1)}
      {btn('向上一层 (Alt+↑)', s.up, <ArrowUp size={15} strokeWidth={2} />, !nodeId || s.nodes[nodeId]?.parentId === 'root' || !!s.nodes[nodeId] && s.nodes[nodeId].kind === 'special')}
      {div}
      <PathBar />
      {div}
      {btn('新建文件夹 (Ctrl+Shift+N)', s.createFolder, <FolderPlus size={16} strokeWidth={1.9} />, isTrash)}
      <div className="mx-1 flex items-center rounded-[8px] bg-black/[.05] p-[3px] dark:bg-white/[.07]">
        {VIEW_MODES.map(m => (
          <button
            key={m.v}
            title={`${m.label} (${m.key})`}
            onClick={() => s.patchTab({ view: m.v })}
            className={cn(
              'rounded-[6px] p-[5px] transition-all',
              tab.view === m.v
                ? 'bg-white text-zinc-800 shadow-sm dark:bg-white/[.18] dark:text-white'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200',
            )}
          >
            <m.icon size={14} strokeWidth={2} />
          </button>
        ))}
      </div>
      <button
        title="排序方式"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setSortMenu({ x: r.left, y: r.bottom + 6 }); }}
        className="rounded-[7px] p-[7px] text-zinc-500 transition-colors hover:bg-black/[.05] hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/[.08] dark:hover:text-zinc-100"
      ><ArrowUpDown size={15} strokeWidth={1.9} /></button>
      <button
        title="更多选项"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMoreMenu({ x: r.right, y: r.bottom + 6 }); }}
        className="rounded-[7px] p-[7px] text-zinc-500 transition-colors hover:bg-black/[.05] hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/[.08] dark:hover:text-zinc-100"
      ><MoreHorizontal size={16} strokeWidth={2} /></button>
      {isTrash && binCount > 0 && (
        <button
          onClick={s.emptyTrash}
          className="ml-1 shrink-0 rounded-[7px] px-2.5 py-1 text-[12px] font-medium text-red-500 transition-colors hover:bg-red-500/10"
        >清空</button>
      )}
      <div className={cn(
        'ml-1 flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] bg-black/[.045] px-2.5 ring-1 ring-black/[.04] transition-all focus-within:w-60 focus-within:ring-2 focus-within:ring-[#0a84ff]/60 dark:bg-white/[.07] dark:ring-white/[.05]',
        tab.search ? 'w-60' : 'w-40',
      )}>
        <Search size={13} className="shrink-0 text-zinc-400" strokeWidth={2.2} />
        <input
          ref={searchRef}
          value={tab.search}
          onChange={e => {
            // 改关键字：取消进行中的深搜并退出深搜结果，切回当前范围即时过滤
            s.clearDeepSearch();
            s.patchTab({ search: e.target.value });
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              if (s.deepSearching) {
                e.preventDefault();
                s.cancelDeepSearch();
                return;
              }
              s.clearDeepSearch();
              s.patchTab({ search: '' });
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              void s.runDeepSearch(tab.search || (e.target as HTMLInputElement).value);
            }
          }}
          placeholder={nodeId ? `搜索“${s.nodes[nodeId]?.name ?? ''}” · Enter 深度` : '搜索 · Enter 深度'}
          title="输入即时过滤当前视图；Enter 递归搜索子文件夹"
          className="w-full min-w-0 bg-transparent text-[13px] text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
        />
        {s.deepSearching && (
          <button
            type="button"
            title="取消深度搜索"
            onClick={() => s.cancelDeepSearch()}
            className="flex shrink-0 items-center gap-0.5 rounded text-[10px] text-[#0a84ff] hover:underline"
          >
            <Loader2 size={12} className="animate-spin" aria-label="深度搜索中" />
            取消
          </button>
        )}
        {s.folderRefreshing && !s.deepSearching && (
          <Loader2 size={12} className="shrink-0 animate-spin text-amber-500" aria-label="加载文件夹" />
        )}
        {(tab.search || s.deepHits) && !s.deepSearching && (
          <button
            onClick={() => { s.clearDeepSearch(); s.patchTab({ search: '' }); }}
            className="shrink-0 rounded-full bg-black/[.08] p-[2px] text-zinc-500 hover:bg-black/[.15] dark:bg-white/[.15] dark:hover:bg-white/25"
          >
            <X size={10} strokeWidth={2.5} />
          </button>
        )}
      </div>
      {sortMenu && <Pop x={sortMenu.x - 150} y={sortMenu.y} items={sortItems} onClose={() => setSortMenu(null)} />}
      {moreMenu && <Pop x={moreMenu.x - 260} y={moreMenu.y} items={moreItems} onClose={() => setMoreMenu(null)} minW={240} />}
    </div>
  );
}
