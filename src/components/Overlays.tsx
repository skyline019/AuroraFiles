import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, ChevronLeft, ChevronRight, ChevronRight as ChevSub, ExternalLink, CheckCircle2, AlertCircle,
  FolderPlus, FilePlus2, Clipboard, Copy, Scissors, Pencil, Trash2, RotateCcw, Archive,
  Link2, Info, Eye, Star, StarOff, Tag, Search, LayoutGrid, List, Columns3,
  GalleryHorizontal, FolderInput, FileText, Command, CornerDownLeft, ArrowUp, ArrowDown, Check,
  Database, RefreshCw, Shield, HardDrive,
} from 'lucide-react';
import { useStore, useActiveTab, useItems, currentNodeId } from '@/lib/store';
import { indexStatusLabel, searchSourceLabel } from '@/lib/indexLabel';
import { api, isElectron } from '@/lib/aurora';
import { FileGlyph, TagDot, ImageThumb } from './icons';
import { PreviewPane } from './PreviewPane';
import {
  TAGS, ID, FSNode, extOf, categoryOf, kindLabel, formatSize, formatDateFull, formatDate,
  pathString, getChain, IMAGE_EXTS, folderSize, folderCount,
} from '@/lib/fs';
import { resolvePathId } from '@/lib/realFs';
import { applyBatchName } from '@/lib/batchRename';
import { cn } from '@/utils/cn';

// ═══════════════════ 右键菜单 ═══════════════════
interface MItem {
  label?: string; icon?: React.ReactNode; shortcut?: string; danger?: boolean;
  disabled?: boolean; sep?: boolean; checked?: boolean; action?: () => void; children?: MItem[];
}

function MenuPanel({ items, x, y, onClose }: { items: MItem[]; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [sub, setSub] = useState<number | null>(null);
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - r.width - 6)),
      y: Math.max(4, Math.min(y, window.innerHeight - r.height - 6)),
    });
  }, [x, y]);
  return (
    <div
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-[95] min-w-[218px] rounded-xl border border-black/[.09] bg-white/[.92] p-1 shadow-2xl shadow-black/25 backdrop-blur-2xl dark:border-white/[.12] dark:bg-[#2c2c2e]/[.94]"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => it.sep ? (
        <div key={i} className="mx-2.5 my-1 h-px bg-black/[.07] dark:bg-white/[.1]" />
      ) : (
        <div key={i} className="relative" onMouseEnter={() => setSub(it.children ? i : null)}>
          <button
            disabled={it.disabled}
            onClick={() => { if (it.children) return; it.action?.(); onClose(); }}
            className={cn(
              'flex w-full items-center gap-2 rounded-[7px] px-2.5 py-[5px] text-left text-[13px]',
              it.disabled ? 'opacity-40' : it.danger
                ? 'text-red-500 hover:bg-red-500 hover:text-white'
                : 'text-zinc-700 hover:bg-[#0a84ff] hover:text-white dark:text-zinc-200',
              sub === i && (it.danger ? 'bg-red-500 text-white' : 'bg-[#0a84ff] text-white'),
            )}
          >
            <span className="flex w-[18px] items-center justify-center">{it.checked ? <Check size={13} strokeWidth={2.8} /> : it.icon}</span>
            <span className="flex-1 truncate">{it.label}</span>
            {it.shortcut && <span className="text-[11px] opacity-40">{it.shortcut}</span>}
            {it.children && <ChevSub size={13} className="opacity-60" />}
          </button>
          <AnimatePresence>
            {sub === i && it.children && (
              <motion.div
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="absolute left-full top-[-5px] z-10 ml-1 min-w-[190px] rounded-xl border border-black/[.09] bg-white/[.94] p-1 shadow-2xl shadow-black/25 backdrop-blur-2xl dark:border-white/[.12] dark:bg-[#2c2c2e]/[.96]"
              >
                {it.children.map((c, j) => c.sep ? (
                  <div key={j} className="mx-2.5 my-1 h-px bg-black/[.07] dark:bg-white/[.1]" />
                ) : (
                  <button
                    key={j}
                    disabled={c.disabled}
                    onClick={() => { c.action?.(); onClose(); }}
                    className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-[5px] text-left text-[13px] text-zinc-700 hover:bg-[#0a84ff] hover:text-white disabled:opacity-40 dark:text-zinc-200"
                  >
                    <span className="flex w-[18px] items-center justify-center">{c.checked ? <Check size={13} strokeWidth={2.8} /> : c.icon}</span>
                    <span className="flex-1">{c.label}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

export function ContextMenu() {
  const s = useStore();
  const tab = useActiveTab();
  const m = s.context;
  useEffect(() => {
    if (!m) return;
    const close = () => s.setContext(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [m, s]);

  const items = useMemo((): MItem[] => {
    if (!m) return [];
    const sel = m.ids.map(id => s.nodes[id]).filter((x): x is FSNode => !!x);
    const first = sel[0];
    const single = sel.length === 1 ? first : undefined;
    const nodeId = currentNodeId(tab);
    const inTrash = !!first?.deleted || nodeId === ID.trash;
    const clip = s.clipboard;

    if (sel.length > 0 && first) {
      if (inTrash) {
        return [
          { label: '还原', icon: <RotateCcw size={14} />, action: () => s.restore(m.ids) },
          { label: '彻底删除…', icon: <Trash2 size={14} />, danger: true, action: () => s.deleteForever(m.ids) },
          { sep: true },
          { label: '属性', icon: <Info size={14} />, action: () => s.setInfo(first.id) },
        ];
      }
      const runOpenWith = (app: 'default' | 'reveal' | 'notepad' | 'code' | 'picker') => {
        if (!single) return;
        const abs = resolvePathId(single.id, s.quickMap);
        if (s.fsMode === 'real' && /^[A-Za-z]:[\\/]/.test(abs)) {
          void api().openWith(abs, app).catch((err: Error) => s.toast(err.message || '无法打开'));
          return;
        }
        if (app === 'default') s.openNode(single.id);
        else s.toast('演示模式请切换到真盘以调用系统应用');
      };
      const openWith: MItem[] = single ? [{
        label: '打开方式', icon: <ExternalLink size={14} />, children: [
          { label: '默认应用', action: () => runOpenWith('default') },
          ...(single.kind === 'file' ? [
            { label: '选择其他应用…', action: () => runOpenWith('picker') },
            { sep: true } as MItem,
            { label: '记事本', action: () => runOpenWith('notepad') },
            { label: 'Visual Studio Code', action: () => runOpenWith('code') },
          ] : []),
          { sep: true },
          { label: '在资源管理器中显示', action: () => runOpenWith('reveal') },
        ],
      }] : [];
      return [
        { label: '打开', icon: <ExternalLink size={14} />, shortcut: 'Enter', action: () => s.openNode(first.id) },
        ...(single && single.kind !== 'file' ? [{ label: '在新标签页中打开', icon: <Copy size={14} />, action: () => s.addTab({ t: 'node', id: single.id }) } as MItem] : []),
        ...openWith,
        ...(first.kind === 'file' ? [{ label: '快速查看', icon: <Eye size={14} />, shortcut: '空格', action: () => s.setQuickLook(first.id) } as MItem] : []),
        { sep: true },
        ...(single && single.kind !== 'file' && !single.system && single.kind !== 'special' && single.kind !== 'drive'
          ? [{ label: single.favorite ? '从快速访问移除' : '固定到快速访问', icon: single.favorite ? <StarOff size={14} /> : <Star size={14} />, action: () => s.toggleFavorite(single.id) } as MItem]
          : []),
        {
          label: '标签', icon: <Tag size={14} />, children: [
            ...TAGS.map(t => ({
              label: t.label,
              icon: <TagDot color={t.color} size={10} />,
              checked: sel.every(n => n.tags.includes(t.color)),
              action: () => s.toggleTag(m.ids, t.color),
            })),
            { sep: true },
            {
              label: '移除所有标签', action: () => {
                TAGS.forEach(t => { if (sel.every(n => n.tags.includes(t.color))) s.toggleTag(m.ids, t.color); });
              },
            },
          ],
        },
        { sep: true },
        { label: '剪切', icon: <Scissors size={14} />, shortcut: 'Ctrl+X', action: () => s.setClipboard('cut', m.ids) },
        { label: '复制', icon: <Copy size={14} />, shortcut: 'Ctrl+C', action: () => s.setClipboard('copy', m.ids) },
        ...(single && single.kind !== 'file' && clip ? [{ label: `粘贴到此处（${clip.ids.length} 项）`, icon: <Clipboard size={14} />, action: () => s.paste(single.id) } as MItem] : []),
        { label: '创建副本', icon: <FilePlus2 size={14} />, shortcut: 'Ctrl+D', action: () => s.duplicate(m.ids) },
        { sep: true },
        ...(single ? [{ label: '重命名', icon: <Pencil size={14} />, shortcut: 'F2', action: () => s.beginRename(single.id) } as MItem] : []),
        ...(sel.length > 1 ? [{ label: `批量重命名 ${sel.length} 个项目…`, icon: <Pencil size={14} />, shortcut: 'F6', action: () => s.setBatch(true) } as MItem] : []),
        { label: '压缩为 ZIP', icon: <Archive size={14} />, action: () => s.compress(m.ids) },
        ...(single ? [{
          label: '复制文件路径', icon: <Link2 size={14} />, shortcut: 'Ctrl+Alt+C', action: () => {
            const abs = s.fsMode === 'real' ? resolvePathId(single.id, s.quickMap) : pathString(s.nodes, single.id);
            navigator.clipboard?.writeText(abs).catch(() => undefined);
            s.toast('已复制文件路径');
          },
        } as MItem] : []),
        { sep: true },
        { label: '属性', icon: <Info size={14} />, shortcut: 'Alt+Enter', action: () => s.setInfo(first.id) },
        { sep: true },
        { label: '移到回收站', icon: <Trash2 size={14} />, shortcut: 'Delete', danger: true, action: () => s.trash(m.ids) },
      ];
    }

    // 背景菜单
    const canCreate = !!nodeId && ![ID.trash, ID.quick, ID.recent].includes(nodeId);
    const curFolder = nodeId ? s.nodes[nodeId] : undefined;
    return [
      { label: '新建文件夹', icon: <FolderPlus size={14} />, shortcut: 'Ctrl+Shift+N', disabled: !canCreate, action: s.createFolder },
      {
        label: '新建文件', icon: <FilePlus2 size={14} />, disabled: !canCreate, children: [
          { label: '文本文档 (.txt)', icon: <FileText size={14} />, action: () => s.createFile('txt') },
          { label: 'Markdown 文档 (.md)', icon: <FileText size={14} />, action: () => s.createFile('md') },
        ],
      },
      { label: clip ? `粘贴（${clip.ids.length} 项）` : '粘贴', icon: <Clipboard size={14} />, shortcut: 'Ctrl+V', disabled: !clip || !canCreate, action: () => s.paste() },
      { sep: true },
      {
        label: '排序方式', icon: <ArrowUpDownIcon />, children: [
          { label: '名称', checked: tab.sortKey === 'name', action: () => s.patchTab({ sortKey: 'name' }) },
          { label: '修改日期', checked: tab.sortKey === 'modified', action: () => s.patchTab({ sortKey: 'modified' }) },
          { label: '类型', checked: tab.sortKey === 'kind', action: () => s.patchTab({ sortKey: 'kind' }) },
          { label: '大小', checked: tab.sortKey === 'size', action: () => s.patchTab({ sortKey: 'size' }) },
          { sep: true },
          { label: '升序', checked: tab.sortDir === 'asc', action: () => s.patchTab({ sortDir: 'asc' }) },
          { label: '降序', checked: tab.sortDir === 'desc', action: () => s.patchTab({ sortDir: 'desc' }) },
        ],
      },
      {
        label: '查看', icon: <LayoutGrid size={14} />, children: [
          { label: '图标', icon: <LayoutGrid size={14} />, checked: tab.view === 'grid', action: () => s.patchTab({ view: 'grid' }) },
          { label: '列表', icon: <List size={14} />, checked: tab.view === 'list', action: () => s.patchTab({ view: 'list' }) },
          { label: '分栏', icon: <Columns3 size={14} />, checked: tab.view === 'columns', action: () => s.patchTab({ view: 'columns' }) },
          { label: '画廊', icon: <GalleryHorizontal size={14} />, checked: tab.view === 'gallery', action: () => s.patchTab({ view: 'gallery' }) },
        ],
      },
      { sep: true },
      { label: '全选', shortcut: 'Ctrl+A', action: () => document.dispatchEvent(new CustomEvent('aurora:select-all')) },
      { label: '反向选择', shortcut: 'Ctrl+Shift+U', action: () => document.dispatchEvent(new CustomEvent('aurora:invert')) },
      { sep: true },
      { label: tab.showHidden ? '隐藏系统隐藏文件' : '显示隐藏的项目', checked: tab.showHidden, shortcut: 'Ctrl+Shift+.', action: () => s.patchTab({ showHidden: !tab.showHidden }) },
      {
        label: '复制当前路径', icon: <Link2 size={14} />, disabled: !nodeId, action: () => {
          if (nodeId) { navigator.clipboard?.writeText(pathString(s.nodes, nodeId)).catch(() => undefined); s.toast('已复制路径'); }
        },
      },
      ...(nodeId === ID.trash ? [{ sep: true } as MItem, { label: '清空回收站', icon: <Trash2 size={14} />, danger: true, action: s.emptyTrash } as MItem] : []),
      { sep: true },
      { label: '属性', icon: <Info size={14} />, disabled: !curFolder, action: () => nodeId && s.setInfo(nodeId) },
    ];
  }, [m, s, tab]);

  if (!m) return null;
  return <MenuPanel items={items} x={m.x} y={m.y} onClose={() => s.setContext(null)} />;
}

function ArrowUpDownIcon() {
  return <ArrowUp size={12} className="translate-y-[-2px]" />;
}

// ═══════════════════ 快速查看 Quick Look ═══════════════════
export function QuickLook() {
  const s = useStore();
  const items = useItems().filter((n) => n.kind === 'file');
  const id = s.quickLookId;
  const node = id ? s.nodes[id] : undefined;
  const idx = items.findIndex(i => i.id === id);

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); s.setQuickLook(null); }
      if (e.key === 'ArrowLeft' && idx > 0) s.setQuickLook(items[idx - 1].id);
      if (e.key === 'ArrowRight' && idx >= 0 && idx < items.length - 1) s.setQuickLook(items[idx + 1].id);
      if (e.key === 'Enter' && node) {
        e.preventDefault();
        openExternally();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, idx, items, s, node]);

  const openExternally = () => {
    if (!node) return;
    const abs = resolvePathId(node.id, s.quickMap);
    if (s.fsMode === 'real' && /^[A-Za-z]:[\\/]/.test(abs)) {
      void api().openPath(abs).catch((err: Error) => s.toast(err.message || '无法打开'));
      return;
    }
    s.toast(`已使用默认应用打开“${node.name}”（演示）`);
  };

  if (!node) return null;
  const abs = s.fsMode === 'real' ? resolvePathId(node.id, s.quickMap) : null;
  const wide = ['pdf', 'docx', 'xlsx', 'pptx', 'video'].includes(categoryOf(extOf(node.name)))
    || ['pdf', 'docx', 'xlsx', 'pptx', 'mp4', 'mkv', 'webm'].includes(extOf(node.name));

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-8 backdrop-blur-[6px]"
      onClick={() => s.setQuickLook(null)}
    >
      <motion.div
        initial={{ scale: 0.82, opacity: 0, y: 24 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 12 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className={cn(
          'flex max-h-full flex-col overflow-hidden rounded-2xl border border-white/[.4] bg-white/[.94] shadow-2xl dark:border-white/[.12] dark:bg-[#242426]/[.96]',
          wide ? 'w-[min(980px,94vw)]' : 'w-[min(760px,92vw)]',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-black/[.06] px-4 dark:border-white/[.08]">
          <FileGlyph node={node} size={20} />
          <span className="truncate text-[13.5px] font-semibold text-zinc-800 dark:text-zinc-100">{node.name}</span>
          {idx >= 0 && <span className="text-[11px] text-zinc-400 tabular">{idx + 1} / {items.length}</span>}
          <span className="flex-1" />
          <button disabled={idx <= 0} onClick={() => s.setQuickLook(items[idx - 1].id)} className="rounded-md p-1.5 text-zinc-500 hover:bg-black/[.05] disabled:opacity-25 dark:hover:bg-white/[.08]"><ChevronLeft size={15} /></button>
          <button disabled={idx < 0 || idx >= items.length - 1} onClick={() => s.setQuickLook(items[idx + 1].id)} className="rounded-md p-1.5 text-zinc-500 hover:bg-black/[.05] disabled:opacity-25 dark:hover:bg-white/[.08]"><ChevronRight size={15} /></button>
          <button onClick={openExternally} className="flex items-center gap-1 rounded-lg bg-[#0a84ff] px-2.5 py-1 text-[12px] font-medium text-white transition-all hover:brightness-110 active:scale-95"><ExternalLink size={12} />打开</button>
          <button onClick={() => s.setQuickLook(null)} className="rounded-md p-1.5 text-zinc-500 hover:bg-black/[.05] dark:hover:bg-white/[.08]"><X size={15} /></button>
        </div>
        <div className="flex min-h-[280px] flex-1 items-center justify-center overflow-auto bg-black/[.025] p-6 dark:bg-black/[.2]">
          <PreviewPane node={node} absPath={abs && /^[A-Za-z]:[\\/]/.test(abs) ? abs : null} className="w-full" />
        </div>
        <div className="flex shrink-0 items-center gap-5 border-t border-black/[.06] px-5 py-2.5 text-[12px] text-zinc-500 dark:border-white/[.08] dark:text-zinc-400">
          <span>{kindLabel(node)}</span>
          <span className="tabular">{formatSize(node.size)}</span>
          <span className="tabular">{formatDateFull(node.modifiedAt)}</span>
          {node.tags.length > 0 && <span className="flex items-center gap-1.5">{node.tags.map(t => <TagDot key={t} color={t} size={9} />)}</span>}
          <span className="flex-1" />
          <span className="text-zinc-400">空格 关闭 · Enter 打开 · ←/→ 切换</span>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════ 显示简介（属性） ═══════════════════
export function InfoPanel() {
  const s = useStore();
  const node = s.infoId ? s.nodes[s.infoId] : undefined;
  const [name, setName] = useState('');
  useEffect(() => { if (node) setName(node.name); }, [node?.id, node]);
  if (!node) return null;

  const isFolder = node.kind !== 'file';
  const isText = false;
  void isText;

  return (
    <motion.div
      initial={{ opacity: 0, x: 24, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      className="absolute right-3 top-[104px] z-[60] flex max-h-[calc(100%-130px)] w-[300px] flex-col overflow-hidden rounded-2xl border border-black/[.08] bg-white/[.94] shadow-2xl shadow-black/20 backdrop-blur-2xl dark:border-white/[.12] dark:bg-[#2a2a2c]/[.95]"
    >
      <div className="flex items-center justify-between border-b border-black/[.06] px-4 py-2 dark:border-white/[.08]">
        <span className="text-[12px] font-semibold text-zinc-500 dark:text-zinc-400">显示简介</span>
        <button onClick={() => s.setInfo(null)} className="rounded-md p-1 text-zinc-400 hover:bg-black/[.06] hover:text-zinc-600 dark:hover:bg-white/[.1]"><X size={13} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex flex-col items-center gap-2">
          {IMAGE_EXTS.includes(extOf(node.name)) && node.imageUrl ? <ImageThumb node={node} size={72} rounded={10} /> : <FileGlyph node={node} size={64} />}
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { s.commitRename(node.id, name); (e.target as HTMLInputElement).blur(); } }}
            onBlur={() => s.commitRename(node.id, name)}
            className="w-full rounded-md bg-transparent px-2 py-0.5 text-center text-[13px] font-semibold text-zinc-800 outline-none transition-shadow focus:bg-black/[.04] focus:ring-2 focus:ring-[#0a84ff]/50 dark:text-zinc-100 dark:focus:bg-white/[.06]"
          />
          <span className="rounded-full bg-black/[.05] px-2 py-0.5 text-[10.5px] text-zinc-500 dark:bg-white/[.08] dark:text-zinc-400">{kindLabel(node)}</span>
        </div>

        <div className="space-y-[9px] text-[12px]">
          <Row k="大小" v={isFolder ? `${formatSize(folderSize(s.nodes, node.id))}（${folderCount(s.nodes, node.id)} 个项目）` : formatSize(node.size)} mono />
          {node.drive && <Row k="可用空间" v={`${formatSize(node.drive.total - node.drive.used)} / ${formatSize(node.drive.total)}`} mono />}
          <Row k="位置" v={node.parentId ? pathString(s.nodes, node.parentId) : '—'} />
          <Row k="创建时间" v={formatDateFull(node.createdAt)} mono />
          <Row k="修改时间" v={formatDateFull(node.modifiedAt)} mono />
          <Row k="打开时间" v={formatDate(node.accessedAt)} mono />
          {node.drive && <Row k="格式" v={node.drive.format} />}
        </div>

        <div className="mt-4 border-t border-black/[.06] pt-3 dark:border-white/[.08]">
          <p className="mb-2 text-[11px] font-semibold text-zinc-400">标签</p>
          <div className="flex items-center gap-2.5">
            {TAGS.map(t => (
              <button
                key={t.color}
                title={t.label}
                onClick={() => s.toggleTag([node.id], t.color)}
                className={cn(
                  'flex h-[22px] w-[22px] items-center justify-center rounded-full transition-all',
                  node.tags.includes(t.color) ? 'scale-110 ring-2 ring-[#0a84ff] ring-offset-1 dark:ring-offset-[#2a2a2c]' : 'opacity-60 hover:opacity-100',
                )}
              >
                <TagDot color={t.color} size={15} />
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 border-t border-black/[.06] pt-3 dark:border-white/[.08]">
          <p className="mb-2 text-[11px] font-semibold text-zinc-400">通用</p>
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-zinc-600 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={!!node.locked}
              onChange={e => s.setLocked(node.id, e.target.checked)}
              className="h-3.5 w-3.5 accent-[#0a84ff]"
            />
            已锁定
            <span className="text-[10.5px] text-zinc-400">（锁定后不可重命名或删除）</span>
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            onClick={() => { s.setInfo(null); s.openNode(node.id); }}
            className="rounded-lg bg-[#0a84ff] py-1.5 text-[12.5px] font-medium text-white transition-all hover:brightness-110 active:scale-95"
          >打开</button>
          <button
            onClick={() => { s.setInfo(null); s.trash([node.id]); }}
            className="rounded-lg bg-black/[.05] py-1.5 text-[12.5px] font-medium text-red-500 transition-all hover:bg-red-500/10 active:scale-95 dark:bg-white/[.08]"
          >移到回收站</button>
        </div>
      </div>
    </motion.div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-zinc-400">{k}</span>
      <span className={cn('break-all text-right text-zinc-600 dark:text-zinc-300', mono && 'tabular')}>{v}</span>
    </div>
  );
}

// ═══════════════════ 批量重命名 ═══════════════════
export function BatchRename() {
  const s = useStore();
  const tab = useActiveTab();
  const [mode, setMode] = useState<'replace' | 'add' | 'number' | 'date' | 'seq'>('replace');
  const [find, setFind] = useState('');
  const [rep, setRep] = useState('');
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [base, setBase] = useState('未命名');
  const [start, setStart] = useState(1);

  const targets = tab.selection.map(id => s.nodes[id]).filter((x): x is FSNode => !!x);
  const apply = (n: FSNode, i: number): string => {
    if (mode === 'date') return applyBatchName(n.name, i, { preset: 'datePrefix' });
    if (mode === 'seq') return applyBatchName(n.name, i, { preset: 'sequence', start });
    if (mode === 'replace') return applyBatchName(n.name, i, { preset: 'replace', find, replaceWith: rep });
    const dot = n.name.lastIndexOf('.');
    const stem = n.kind === 'file' && dot > 0 ? n.name.slice(0, dot) : n.name;
    const ext = n.kind === 'file' && dot > 0 ? n.name.slice(dot) : '';
    if (mode === 'add') return `${prefix}${stem}${suffix}${ext}`;
    return `${base} ${start + i}${ext}`;
  };
  if (!s.batchOpen) return null;

  const inputCls = 'w-full rounded-lg bg-black/[.05] px-2.5 py-1.5 text-[13px] text-zinc-800 outline-none ring-1 ring-black/[.04] transition-shadow focus:ring-2 focus:ring-[#0a84ff]/60 dark:bg-white/[.07] dark:text-zinc-100';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[65] flex items-center justify-center bg-black/25 backdrop-blur-[3px]" onClick={() => s.setBatch(false)}>
      <motion.div
        initial={{ scale: 0.92, y: 16, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.94, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="w-[460px] rounded-2xl border border-black/[.08] bg-white p-5 shadow-2xl dark:border-white/[.12] dark:bg-[#2a2a2c]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-100">批量重命名 · {targets.length} 个项目</h3>
          <button onClick={() => s.setBatch(false)} className="rounded-md p-1 text-zinc-400 hover:bg-black/[.06] dark:hover:bg-white/[.08]"><X size={15} /></button>
        </div>
        <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-black/[.05] p-[3px] dark:bg-white/[.07]">
          {([['replace', '替换'], ['add', '前后缀'], ['number', '编号'], ['seq', '序号'], ['date', '日期']] as const).map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)} className={cn('flex-1 rounded-[6px] px-1 py-1 text-[12px] transition-all', mode === m ? 'bg-white font-medium text-zinc-800 shadow-sm dark:bg-white/[.2] dark:text-white' : 'text-zinc-500')}>{label}</button>
          ))}
        </div>
        {mode === 'replace' && (
          <div className="mb-4 flex items-center gap-2">
            <input className={inputCls} placeholder="查找…" value={find} onChange={e => setFind(e.target.value)} />
            <ChevronRight size={14} className="shrink-0 text-zinc-400" />
            <input className={inputCls} placeholder="替换为…" value={rep} onChange={e => setRep(e.target.value)} />
          </div>
        )}
        {mode === 'add' && (
          <div className="mb-4 flex items-center gap-2">
            <input className={inputCls} placeholder="前缀" value={prefix} onChange={e => setPrefix(e.target.value)} />
            <input className={inputCls} placeholder="后缀" value={suffix} onChange={e => setSuffix(e.target.value)} />
          </div>
        )}
        {(mode === 'number' || mode === 'seq') && (
          <div className="mb-4 flex items-center gap-2">
            {mode === 'number' && <input className={inputCls} placeholder="名称" value={base} onChange={e => setBase(e.target.value)} />}
            <span className="shrink-0 text-[12px] text-zinc-400">起始</span>
            <input className={cn(inputCls, 'w-20')} type="number" value={start} onChange={e => setStart(parseInt(e.target.value) || 1)} />
          </div>
        )}
        {mode === 'date' && <p className="mb-3 text-[12px] text-zinc-400">将添加今日日期前缀，如 20261023_文件名.ext</p>}
        <div className="mb-4 max-h-[168px] overflow-auto rounded-lg bg-black/[.03] p-2 dark:bg-white/[.04]">
          {targets.slice(0, 8).map((n, i) => (
            <div key={n.id} className="flex items-center gap-2 py-[3px] text-[12px]">
              <span className="min-w-0 flex-1 truncate text-zinc-400">{n.name}</span>
              <ChevronRight size={11} className="shrink-0 text-zinc-300 dark:text-zinc-600" />
              <span className="min-w-0 flex-1 truncate font-medium text-[#0a84ff]">{apply(n, i)}</span>
            </div>
          ))}
          {targets.length > 8 && <p className="pt-1 text-center text-[11px] text-zinc-400">…以及另外 {targets.length - 8} 个项目</p>}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={() => s.setBatch(false)} className="rounded-lg px-3.5 py-1.5 text-[13px] text-zinc-500 hover:bg-black/[.05] dark:hover:bg-white/[.08]">取消</button>
          <button
            onClick={() => { s.renameMany(targets.map((n, i) => ({ id: n.id, name: apply(n, i) }))); s.setBatch(false); }}
            className="rounded-lg bg-[#0a84ff] px-4 py-1.5 text-[13px] font-medium text-white transition-all hover:brightness-110 active:scale-95"
          >重命名</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════ 命令面板 ═══════════════════
interface Cmd { id: string; label: string; hint?: string; icon: React.ReactNode; run: () => void }

export function CommandPalette() {
  const s = useStore();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const open = s.paletteOpen;

  useEffect(() => { if (open) { setQ(''); setActive(0); } }, [open]);

  const commands: Cmd[] = useMemo(() => {
    if (!open) return [];
    const go = (id: string) => () => s.navigate({ t: 'node', id });
    const list: Cmd[] = [
      { id: 'nf', label: '新建文件夹', hint: 'Ctrl+Shift+N', icon: <FolderPlus size={15} />, run: s.createFolder },
      { id: 'ntf', label: '新建文本文档', icon: <FilePlus2 size={15} />, run: () => s.createFile('txt') },
      { id: 'nt', label: '新建标签页', hint: 'Alt+T', icon: <Copy size={15} />, run: () => s.addTab() },
      { id: 'ct', label: '关闭当前标签页', hint: 'Alt+W', icon: <X size={15} />, run: () => s.closeTab(s.activeTabId) },
      { id: 'dark', label: '切换深色 / 浅色模式', icon: <Command size={15} />, run: s.toggleDark },
      { id: 'v1', label: '切换为图标视图', icon: <LayoutGrid size={15} />, run: () => s.patchTab({ view: 'grid' }) },
      { id: 'v2', label: '切换为列表视图', icon: <List size={15} />, run: () => s.patchTab({ view: 'list' }) },
      { id: 'v3', label: '切换为分栏视图', icon: <Columns3 size={15} />, run: () => s.patchTab({ view: 'columns' }) },
      { id: 'v4', label: '切换为画廊视图', icon: <GalleryHorizontal size={15} />, run: () => s.patchTab({ view: 'gallery' }) },
      { id: 'undo', label: '撤销上一步操作', hint: 'Ctrl+Z', icon: <RotateCcw size={15} />, run: s.undo },
      { id: 'sa', label: '全选', hint: 'Ctrl+A', icon: <Check size={15} />, run: () => document.dispatchEvent(new CustomEvent('aurora:select-all')) },
      { id: 'et', label: '清空回收站', icon: <Trash2 size={15} />, run: s.emptyTrash },
      { id: 'kb', label: '查看键盘快捷键', hint: '?', icon: <Command size={15} />, run: () => s.setShortcuts(true) },
      { id: 'idx', label: '索引状态与设置', icon: <Database size={15} />, run: () => s.setIndexPanel(true) },
      {
        id: 'upd',
        label: '检查应用更新',
        icon: <RefreshCw size={15} />,
        run: () => {
          if (!isElectron()) { s.toast('请在桌面版中检查更新', 'info'); return; }
          void api().checkUpdate().then((r) => s.toast(r.message || r.state, r.state === 'error' ? 'error' : 'info'));
        },
      },
      { id: 'ref', label: '刷新当前文件夹', hint: 'F5', icon: <RefreshCw size={15} />, run: () => { void s.refreshCurrent(); } },
      { id: 'g1', label: '前往：桌面', icon: <FolderInput size={15} />, run: go(ID.desktop) },
      { id: 'g2', label: '前往：下载', icon: <FolderInput size={15} />, run: go(ID.dl) },
      { id: 'g3', label: '前往：文档', icon: <FolderInput size={15} />, run: go(ID.docs) },
      { id: 'g4', label: '前往：图片', icon: <FolderInput size={15} />, run: go(ID.pics) },
      { id: 'g5', label: '前往：此电脑', icon: <FolderInput size={15} />, run: go(ID.pc) },
      { id: 'g6', label: '前往：回收站', icon: <Trash2 size={15} />, run: go(ID.trash) },
      { id: 'g7', label: '前往：数据盘 D:', icon: <FolderInput size={15} />, run: go(ID.d) },
    ];
    return list;
  }, [open, s]);

  const fileResults: Cmd[] = useMemo(() => {
    if (!open || !q.trim()) return [];
    const ql = q.trim().toLowerCase();
    return Object.values(s.nodes)
      .filter(n => !n.deleted && !n.hidden && n.kind !== 'special' && n.name.toLowerCase().includes(ql))
      .slice(0, 7)
      .map(n => ({
        id: `f-${n.id}`,
        label: n.name,
        hint: n.parentId ? (getChain(s.nodes, n.parentId).map(x => x.name).slice(-2).join(' / ') || '') : '',
        icon: <FileGlyph node={n} size={16} />,
        run: () => {
          if (n.kind !== 'file') { s.navigate({ t: 'node', id: n.id }); return; }
          if (n.parentId && s.nodes[n.parentId] && !s.nodes[n.parentId].deleted) s.navigate({ t: 'node', id: n.parentId });
          s.setSelection([n.id]);
        },
      }));
  }, [open, q, s]);

  const cmdResults = q.trim()
    ? commands.filter(c => c.label.toLowerCase().includes(q.trim().toLowerCase()))
    : commands;
  const flat = [...fileResults, ...cmdResults];

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;
  const runCmd = (c?: Cmd) => { if (!c) return; s.setPalette(false); setTimeout(c.run, 30); };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[75] flex items-start justify-center bg-black/25 pt-[9%] backdrop-blur-[3px]" onClick={() => s.setPalette(false)}>
      <motion.div
        initial={{ scale: 0.95, y: -14, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        className="w-[540px] overflow-hidden rounded-2xl border border-black/[.09] bg-white/[.96] shadow-2xl dark:border-white/[.12] dark:bg-[#2a2a2c]/[.97]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-black/[.06] px-4 dark:border-white/[.08]">
          <Search size={16} className="text-zinc-400" />
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(flat.length - 1, a + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
              if (e.key === 'Enter') runCmd(flat[active]);
              if (e.key === 'Escape') s.setPalette(false);
            }}
            placeholder="搜索文件，或输入命令…"
            className="h-12 w-full bg-transparent text-[15px] text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
          />
          <span className="kbd">Esc</span>
        </div>
        <div ref={listRef} className="max-h-[320px] overflow-y-auto p-1.5">
          {fileResults.length > 0 && <p className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold text-zinc-400">文件与文件夹</p>}
          {fileResults.map((c, i) => <CmdRow key={c.id} c={c} active={active === i} onHover={() => setActive(i)} onRun={runCmd} />)}
          {cmdResults.length > 0 && <p className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold text-zinc-400">操作</p>}
          {cmdResults.map((c, i) => <CmdRow key={c.id} c={c} active={active === fileResults.length + i} onHover={() => setActive(fileResults.length + i)} onRun={runCmd} />)}
          {flat.length === 0 && <p className="py-8 text-center text-[13px] text-zinc-400">没有找到匹配的命令或文件</p>}
        </div>
        <div className="flex items-center gap-4 border-t border-black/[.06] px-4 py-2 text-[11px] text-zinc-400 dark:border-white/[.08]">
          <span className="flex items-center gap-1"><CornerDownLeft size={11} /> 执行</span>
          <span className="flex items-center gap-1"><ArrowUp size={11} /><ArrowDown size={11} /> 选择</span>
          <span className="ml-auto flex items-center gap-1"><Command size={11} /> 极光命令面板</span>
        </div>
      </motion.div>
    </motion.div>
  );
}

function CmdRow({ c, active, onHover, onRun }: { c: Cmd; active: boolean; onHover: () => void; onRun: (c: Cmd) => void }) {
  return (
    <button
      data-active={active ? '1' : undefined}
      onMouseEnter={onHover}
      onClick={() => onRun(c)}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px]',
        active ? 'bg-[#0a84ff] text-white' : 'text-zinc-700 dark:text-zinc-200',
      )}
    >
      <span className={cn('flex w-[18px] justify-center', active ? 'text-white' : 'text-zinc-400')}>{c.icon}</span>
      <span className="flex-1 truncate">{c.label}</span>
      {c.hint && <span className={cn('max-w-[180px] truncate text-[11px]', active ? 'text-white/70' : 'text-zinc-400')}>{c.hint}</span>}
    </button>
  );
}

// ═══════════════════ 快捷键帮助 ═══════════════════
const SHORTCUTS: [string, string][][] = [
  [
    ['后退 / 前进', 'Alt ← / →'], ['向上一层', 'Alt ↑'], ['打开', 'Enter'], ['快速查看', '空格'],
    ['移动选择', '↑ ↓ ← →'], ['重命名', 'F2'], ['属性', 'Alt Enter'], ['搜索', 'F3 / Ctrl E'],
  ],
  [
    ['复制 / 剪切 / 粘贴', 'Ctrl C / X / V'], ['创建副本', 'Ctrl D'], ['撤销 / 重做', 'Ctrl Z / Y'],
    ['移到回收站', 'Delete'], ['彻底删除', 'Shift Delete'], ['全选', 'Ctrl A'], ['反向选择', 'Ctrl Shift U'],
  ],
  [
    ['新建文件夹', 'Ctrl Shift N'], ['新建 / 关闭标签页', 'Alt T / W'], ['批量重命名', 'F6'],
    ['命令面板', 'Ctrl K'], ['切换视图', 'Ctrl 1-4'], ['刷新', 'F5'], ['隐藏文件', 'Ctrl Shift .'],
  ],
];

export function ShortcutsHelp() {
  const s = useStore();
  if (!s.shortcutsOpen) return null;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[75] flex items-center justify-center bg-black/25 backdrop-blur-[3px]" onClick={() => s.setShortcuts(false)}>
      <motion.div
        initial={{ scale: 0.93, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="w-[680px] max-w-[92%] rounded-2xl border border-black/[.08] bg-white p-6 shadow-2xl dark:border-white/[.12] dark:bg-[#2a2a2c]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-zinc-800 dark:text-zinc-100">键盘快捷键</h3>
          <button onClick={() => s.setShortcuts(false)} className="rounded-md p-1 text-zinc-400 hover:bg-black/[.06] dark:hover:bg-white/[.08]"><X size={16} /></button>
        </div>
        <div className="grid grid-cols-3 gap-6">
          {SHORTCUTS.map((col, i) => (
            <div key={i} className="space-y-2.5">
              {col.map(([label, keys]) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] text-zinc-500 dark:text-zinc-400">{label}</span>
                  <span className="flex shrink-0 gap-1">
                    {keys.split(' ').map((k, j) => <kbd key={j} className="kbd">{k}</kbd>)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="mt-6 border-t border-black/[.06] pt-3 text-center text-[11.5px] text-zinc-400 dark:border-white/[.08]">
          极光文件 · 为效率而生 — 在任意界面按下 <kbd className="kbd mx-1">?</kbd> 即可再次打开本面板
        </p>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════ 索引状态面板 ═══════════════════
const DEMO_PREFS_KEY = 'aurora-index-prefs';

function readDemoPrefs(): { maxScan: number; excludeNames: string[] } {
  try {
    const j = JSON.parse(localStorage.getItem(DEMO_PREFS_KEY) || '{}');
    return {
      maxScan: Math.min(2_000_000, Math.max(5_000, Number(j.maxScan) || 120_000)),
      excludeNames: Array.isArray(j.excludeNames) ? j.excludeNames.map(String) : [],
    };
  } catch {
    return { maxScan: 120_000, excludeNames: [] };
  }
}

export function IndexPanel() {
  const s = useStore();
  const [detail, setDetail] = useState<{
    ready?: boolean;
    building?: boolean;
    size?: number;
    scanned?: number;
    source?: string;
    watching?: boolean;
    usnReadable?: boolean | null;
    maxScan?: number;
    excludeNames?: string[];
    builtinSkip?: string[];
    dirtyDirs?: number;
    pendingDelta?: number;
    frnSize?: number;
    fts?: { ok?: boolean; size?: number; available?: boolean };
    disk?: { exists?: boolean; size?: number; deltaLines?: number };
    usn?: { journalId?: string; nextUsn?: number } | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [maxScanDraft, setMaxScanDraft] = useState('120000');
  const [excludeDraft, setExcludeDraft] = useState('');
  const [prefsDirty, setPrefsDirty] = useState(false);

  useEffect(() => {
    if (!s.indexPanelOpen) return;
    void s.refreshIndexStatus();
    const load = async () => {
      if (isElectron() && s.fsMode === 'real') {
        try {
          const prefs = await api().indexPrefs();
          setMaxScanDraft(String(prefs.maxScan));
          setExcludeDraft((prefs.excludeNames || []).join('\n'));
          setPrefsDirty(false);
          if (s.indexRoot) {
            const st = await api().indexStatus(s.indexRoot);
            setDetail(st);
          } else setDetail(null);
          return;
        } catch { /* fallthrough */ }
      }
      const demo = readDemoPrefs();
      setMaxScanDraft(String(demo.maxScan));
      setExcludeDraft(demo.excludeNames.join('\n'));
      setPrefsDirty(false);
      setDetail(null);
    };
    void load();
  }, [s.indexPanelOpen, s.indexRoot, s.fsMode]);

  if (!s.indexPanelOpen) return null;

  const info = detail || s.indexInfo;
  const drives = Object.values(s.nodes).filter((n) => n.kind === 'drive' && !n.deleted);
  const real = isElectron() && s.fsMode === 'real';

  const savePrefs = async () => {
    const maxScan = Math.min(2_000_000, Math.max(5_000, parseInt(maxScanDraft, 10) || 120_000));
    const excludeNames = excludeDraft.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
    setBusy(true);
    try {
      if (real) {
        const saved = await api().setIndexPrefs({ maxScan, excludeNames });
        setMaxScanDraft(String(saved.maxScan));
        setExcludeDraft(saved.excludeNames.join('\n'));
        s.toast('索引策略已保存 · 重建后生效');
      } else {
        localStorage.setItem(DEMO_PREFS_KEY, JSON.stringify({ maxScan, excludeNames }));
        s.toast('演示模式已保存策略（真盘生效）', 'info');
      }
      setPrefsDirty(false);
    } catch (err) {
      s.toast((err as Error).message || '保存失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const rebuild = async () => {
    if (!real || !s.indexRoot) {
      s.toast('请在桌面版真盘模式下重建索引', 'info');
      return;
    }
    if (prefsDirty) await savePrefs();
    setBusy(true);
    try {
      const maxScan = Math.min(2_000_000, Math.max(5_000, parseInt(maxScanDraft, 10) || 120_000));
      await api().ensureIndex(s.indexRoot, { maxDepth: 10, maxScan, rebuild: true });
      await s.refreshIndexStatus();
      const st = await api().indexStatus(s.indexRoot);
      setDetail(st);
      s.toast('已触发索引重建');
    } catch (err) {
      s.toast((err as Error).message || '重建失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-4 border-b border-black/[.05] py-2.5 text-[12.5px] last:border-0 dark:border-white/[.07]">
      <span className="shrink-0 text-zinc-400">{label}</span>
      <span className="text-right text-zinc-700 dark:text-zinc-200">{value}</span>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[75] flex items-center justify-center bg-black/25 backdrop-blur-[3px]"
      onClick={() => s.setIndexPanel(false)}
      data-testid="index-panel"
      role="dialog"
      aria-modal="true"
      aria-label="索引状态"
    >
      <motion.div
        initial={{ scale: 0.94, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="max-h-[88vh] w-[460px] max-w-[92%] overflow-y-auto rounded-2xl border border-black/[.08] bg-white p-5 shadow-2xl dark:border-white/[.12] dark:bg-[#2a2a2c]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database size={18} className="text-[#0a84ff]" aria-hidden />
            <h3 className="text-[16px] font-semibold text-zinc-800 dark:text-zinc-100">索引状态与策略</h3>
          </div>
          <button type="button" aria-label="关闭" onClick={() => s.setIndexPanel(false)} className="rounded-md p-1 text-zinc-400 hover:bg-black/[.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0a84ff] dark:hover:bg-white/[.08]"><X size={16} /></button>
        </div>

        {!real && (
          <p className="mb-3 rounded-xl bg-amber-500/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-amber-800 dark:text-amber-300">
            当前为演示盘。下方策略可编辑预览；连接真盘后写入本机并用于建索。
          </p>
        )}

        {real && (
          <p className="mb-3 text-[12.5px] text-zinc-500">
            {indexStatusLabel(s.indexInfo) || '尚未建立索引'}
            {s.indexRoot ? ` · 当前卷 ${s.indexRoot}` : ''}
          </p>
        )}

        {real && (
          <div className="mb-4 rounded-xl bg-black/[.03] px-3 dark:bg-white/[.04]">
            <Row label="条目数" value={(info?.size ?? 0).toLocaleString()} />
            <Row label="来源" value={info?.source ? searchSourceLabel(info.source) : '—'} />
            <Row
              label="USN / FRN"
              value={
                info?.usnReadable === true
                  ? '已启用'
                  : info?.usnReadable === false
                    ? (
                      <button type="button" onClick={() => void s.relaunchElevated()} className="inline-flex items-center gap-1 text-[#0a84ff] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0a84ff]">
                        <Shield size={12} />需管理员 · 启用
                      </button>
                    )
                    : (info?.watching ? '目录监视（无 USN）' : '未知')
              }
            />
            <Row
              label="SQLite FTS"
              value={
                info?.fts?.ok
                  ? `就绪 · ${(info.fts.size ?? 0).toLocaleString()}`
                  : ((detail?.fts as { available?: boolean } | undefined)?.available === false ? '不可用' : '未就绪')
              }
            />
            <Row label="落盘缓存" value={info?.disk?.exists ? `是${info.disk.deltaLines ? ` · Δ${info.disk.deltaLines}` : ''}` : '仅内存'} />
            <Row label="脏目录 / 待追赶" value={`${detail?.dirtyDirs ?? 0} / ${detail?.pendingDelta ?? 0}`} />
          </div>
        )}

        <div className="space-y-3 rounded-xl border border-black/[.06] p-3 dark:border-white/[.08]" data-testid="index-prefs-form">
          <label className="block text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
            单卷扫描上限（maxScan）
            <input
              type="number"
              min={5000}
              max={2000000}
              step={5000}
              value={maxScanDraft}
              onChange={(e) => { setMaxScanDraft(e.target.value); setPrefsDirty(true); }}
              className="mt-1 w-full rounded-lg border border-black/[.08] bg-white px-2.5 py-1.5 text-[13px] tabular text-zinc-800 outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff] dark:border-white/[.12] dark:bg-[#1f1f22] dark:text-zinc-100"
            />
            <span className="mt-0.5 block text-[11px] font-normal text-zinc-400">建议 5 万–50 万；过大将拖慢首建索</span>
          </label>
          <label className="block text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
            额外排除目录名（每行一个）
            <textarea
              rows={3}
              value={excludeDraft}
              onChange={(e) => { setExcludeDraft(e.target.value); setPrefsDirty(true); }}
              placeholder={'例如：\nnode_modules\n.cache\nvendor'}
              className="mt-1 w-full resize-y rounded-lg border border-black/[.08] bg-white px-2.5 py-1.5 font-mono text-[12px] text-zinc-800 outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff] dark:border-white/[.12] dark:bg-[#1f1f22] dark:text-zinc-100"
            />
            <span className="mt-0.5 block text-[11px] font-normal text-zinc-400">
              内置已排除：{(detail?.builtinSkip || ['$Recycle.Bin', 'node_modules', '.git', 'Windows']).slice(0, 4).join('、')}…
            </span>
          </label>
          <button
            type="button"
            disabled={busy || !prefsDirty}
            onClick={() => void savePrefs()}
            className="w-full rounded-lg bg-black/[.06] py-1.5 text-[12.5px] font-medium text-zinc-700 disabled:opacity-40 dark:bg-white/[.08] dark:text-zinc-200"
          >保存策略</button>
        </div>

        {real && drives.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
              <HardDrive size={12} />已挂载卷
            </p>
            <div className="flex flex-wrap gap-1.5">
              {drives.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => s.navigate({ t: 'node', id: d.id })}
                  className={cn(
                    'rounded-lg px-2.5 py-1 text-[12px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0a84ff]',
                    s.indexRoot && resolvePathId(d.id, s.quickMap).startsWith(s.indexRoot.replace(/\\+$/, ''))
                      ? 'bg-[#0a84ff]/[.14] text-[#0a84ff]'
                      : 'bg-black/[.04] text-zinc-600 dark:bg-white/[.08] dark:text-zinc-300',
                  )}
                >{d.name}</button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy || !real || !s.indexRoot}
            onClick={() => void rebuild()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#0a84ff] py-2 text-[13px] font-medium text-white disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0a84ff]"
          >
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} aria-hidden />
            {busy ? '处理中…' : '重建当前卷索引'}
          </button>
        </div>

        {isElectron() && (
          <div className="mt-4 rounded-xl border border-black/[.06] p-3 dark:border-white/[.08]" data-testid="update-panel">
            <p className="mb-2 text-[12px] font-medium text-zinc-600 dark:text-zinc-300">应用更新</p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void api().checkUpdate().then((r) => {
                    s.toast(r.message || String(r.state), r.state === 'error' ? 'error' : 'info');
                    if (r.state === 'ready') {
                      /* 已下载 */
                    }
                  }).catch((err: Error) => s.toast(err.message || '检查失败', 'error'));
                }}
                className="flex-1 rounded-lg bg-black/[.06] py-1.5 text-[12.5px] font-medium text-zinc-700 dark:bg-white/[.08] dark:text-zinc-200"
              >检查更新</button>
              <button
                type="button"
                onClick={() => {
                  void api().quitAndInstall().catch((err: Error) => s.toast(err.message || '无法安装更新', 'error'));
                }}
                className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-[#0a84ff] hover:bg-[#0a84ff]/10"
              >重启安装</button>
            </div>
            <p className="mt-1.5 text-[11px] text-zinc-400">需配置 AURORA_UPDATE_URL 或发布 feed；开发模式不会检查。</p>
          </div>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">
          大盘可能因截断上限未覆盖全部文件；深度搜索优先走内存/FTS。修改策略后请重建索引。
        </p>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════ Toast ═══════════════════
export function Toasts() {
  const toasts = useStore(st => st.toasts);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-12 z-[90] flex flex-col items-center gap-2">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 16, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 480, damping: 30 }}
            className="flex items-center gap-2 rounded-full bg-zinc-800/[.92] py-2 pl-3 pr-4 text-[12.5px] font-medium text-white shadow-xl backdrop-blur dark:bg-white/[.92] dark:text-zinc-800"
          >
            {t.kind === 'error' ? (
              <AlertCircle size={14} className="text-red-400 dark:text-red-600" />
            ) : t.kind === 'info' ? (
              <Info size={14} className="text-sky-400 dark:text-sky-600" />
            ) : (
              <CheckCircle2 size={14} className="text-emerald-400 dark:text-emerald-600" />
            )}
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
