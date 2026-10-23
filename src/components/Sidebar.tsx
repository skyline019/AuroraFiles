import { useState, useMemo } from 'react';
import {
  Monitor, Download, FileText, Image as ImageIcon, Music, Film, Clock,
  Cloud, ChevronRight, Tag,
} from 'lucide-react';
import { useStore, useActiveTab, currentNodeId } from '@/lib/store';
import { FileGlyph, TagDot } from './icons';
import { TAGS, ID, QUICK_LIST, TagColor, FSNode, trashCount, Location } from '@/lib/fs';
import { cn } from '@/utils/cn';
import type React from 'react';

const ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>> = {
  monitor: Monitor, download: Download, doc: FileText, image: ImageIcon, music: Music, film: Film, clock: Clock,
};

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="px-1">
      <button onClick={() => setOpen(!open)} className="group mb-1 flex w-full items-center gap-1 px-1.5">
        <ChevronRight size={10} strokeWidth={2.5} className={cn('text-zinc-400 transition-transform', open && 'rotate-90')} />
        <span className="text-[11px] font-semibold tracking-wide text-zinc-400 dark:text-zinc-500">{title}</span>
      </button>
      {open && <div className="flex flex-col gap-[1px]">{children}</div>}
    </div>
  );
}

export function Sidebar() {
  const s = useStore();
  const tab = useActiveTab();
  const loc = tab.history[tab.hi];
  const curId = currentNodeId(tab);
  const [dropKey, setDropKey] = useState<string | null>(null);

  const favorites = useMemo(
    () => Object.values(s.nodes).filter(n => n.favorite && !n.deleted),
    [s.nodes],
  );
  const tagCounts = useMemo(() => {
    const m = new Map<TagColor, number>();
    Object.values(s.nodes).forEach((n: FSNode) => {
      if (n.deleted || n.kind === 'special') return;
      n.tags.forEach(t => m.set(t, (m.get(t) ?? 0) + 1));
    });
    return m;
  }, [s.nodes]);
  const binCount = trashCount(s.nodes);

  const go = (l: Location) => s.navigate(l);
  const isLoc = (l: Location) => (l.t === 'node' ? loc.t === 'node' && loc.id === l.id : loc.t === 'tag' && loc.tag === l.tag);

  const rowCls = (active: boolean, key: string) => cn(
    'group flex h-7 w-full items-center gap-2 rounded-[7px] px-2 text-[13px] transition-colors',
    active
      ? 'bg-black/[.08] font-medium text-zinc-800 dark:bg-white/[.14] dark:text-zinc-100'
      : 'text-zinc-600 hover:bg-black/[.045] dark:text-zinc-300 dark:hover:bg-white/[.06]',
    dropKey === key && 'ring-2 ring-inset ring-[#0a84ff]',
  );

  const dropHandlers = (key: string, apply: (ids: string[]) => void, enabled = true) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!enabled || !e.dataTransfer.types.includes('application/x-aurora')) return;
      e.preventDefault();
      setDropKey(key);
    },
    onDragLeave: () => setDropKey(k => (k === key ? null : k)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropKey(null);
      if (!enabled) return;
      try {
        const ids = JSON.parse(e.dataTransfer.getData('application/x-aurora')) as string[];
        if (Array.isArray(ids) && ids.length) apply(ids);
      } catch { /* ignore */ }
    },
  });

  const openNodeCtx = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    s.setContext({ x: e.clientX, y: e.clientY, ids: [id] });
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-2 pb-4 pt-2">
      <Section title="个人收藏">
        {QUICK_LIST.map(q => {
          const Icon = ICONS[q.icon];
          const node = s.nodes[q.id];
          return (
            <button
              key={q.id}
              className={rowCls(isLoc({ t: 'node', id: q.id }), q.id)}
              onClick={() => go({ t: 'node', id: q.id })}
              onContextMenu={(e) => openNodeCtx(e, q.id)}
              {...dropHandlers(q.id, ids => s.moveTo(ids, q.id), ![ID.recent].includes(q.id))}
            >
              <Icon size={15} strokeWidth={1.9} style={{ color: q.tint }} />
              <span className="truncate">{node?.name ?? ''}</span>
            </button>
          );
        })}
        {favorites.length > 0 && <div className="mx-3 my-1 h-px bg-black/[.06] dark:bg-white/[.07]" />}
        {favorites.map(n => (
          <button
            key={n.id}
            className={rowCls(curId === n.id, `fav-${n.id}`)}
            onClick={() => go({ t: 'node', id: n.id })}
            onContextMenu={(e) => openNodeCtx(e, n.id)}
            {...dropHandlers(`fav-${n.id}`, ids => s.moveTo(ids, n.id), n.kind !== 'file')}
          >
            <span className="shrink-0"><FileGlyph node={n} size={15} /></span>
            <span className="truncate">{n.name}</span>
          </button>
        ))}
      </Section>

      <Section title="位置">
        {(() => {
          const pc = s.nodes[ID.pc];
          const locIds = [ID.pc, ...(pc?.childrenIds ?? [ID.c, ID.d, ID.e])];
          const seen = new Set<string>();
          return locIds.map(id => {
            if (seen.has(id)) return null;
            seen.add(id);
            const node = s.nodes[id];
            if (!node) return null;
            const pct = node.drive && node.drive.total > 0 ? Math.round((node.drive.used / node.drive.total) * 100) : 0;
            return (
              <button
                key={id}
                className={cn(rowCls(isLoc({ t: 'node', id }), id), 'h-auto py-[5px]')}
                onClick={() => go({ t: 'node', id })}
                onContextMenu={(e) => openNodeCtx(e, id)}
                {...dropHandlers(id, ids => s.moveTo(ids, id), node.kind === 'drive' || (node.kind === 'folder' && !node.system))}
              >
                <span className="shrink-0"><FileGlyph node={node} size={16} /></span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate leading-tight">{node.name}</span>
                  {node.drive && node.drive.total > 0 && (
                    <span className="mt-[3px] block h-[3px] w-full overflow-hidden rounded-full bg-black/[.08] dark:bg-white/[.12]">
                      <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: pct > 90 ? '#ff453a' : '#0a84ff' }} />
                    </span>
                  )}
                </span>
              </button>
            );
          });
        })()}
        {s.fsMode === 'demo' && s.nodes[ID.od] && (
          <button
            className={rowCls(isLoc({ t: 'node', id: ID.od }), ID.od)}
            onClick={() => go({ t: 'node', id: ID.od })}
            onContextMenu={(e) => openNodeCtx(e, ID.od)}
            {...dropHandlers(ID.od, ids => s.moveTo(ids, ID.od))}
          >
            <Cloud size={15} strokeWidth={1.9} style={{ color: '#1c9dfa' }} />
            <span className="truncate">OneDrive</span>
          </button>
        )}
        <button
          className={rowCls(isLoc({ t: 'node', id: ID.trash }), ID.trash)}
          onClick={() => {
            if (s.fsMode === 'real') {
              s.toast('真盘删除已进入系统回收站；请在资源管理器中打开回收站');
              return;
            }
            go({ t: 'node', id: ID.trash });
          }}
          onContextMenu={(e) => openNodeCtx(e, ID.trash)}
          {...dropHandlers(ID.trash, ids => s.trash(ids))}
        >
          <span className="shrink-0 opacity-80"><FileGlyph node={s.nodes[ID.trash]} size={16} /></span>
          <span className="flex-1 text-left">{s.fsMode === 'real' ? '回收站（系统）' : '回收站'}</span>
          {s.fsMode === 'demo' && binCount > 0 && (
            <span className="rounded-full bg-black/[.08] px-1.5 py-px text-[10px] font-medium text-zinc-500 dark:bg-white/[.14] dark:text-zinc-300">{binCount}</span>
          )}
        </button>
        {s.fsMode === 'demo' && !!(window as unknown as { aurora?: unknown }).aurora && (
          <button type="button" className={rowCls(false, 'back-real')} onClick={() => void s.exitDemoToReal()}>
            <span className="truncate text-[#0a84ff]">← 返回本机真盘</span>
          </button>
        )}
      </Section>

      <Section title="标签">
        {TAGS.map(t => {
          const count = tagCounts.get(t.color) ?? 0;
          return (
            <button
              key={t.color}
              className={rowCls(isLoc({ t: 'tag', tag: t.color }), `tag-${t.color}`)}
              onClick={() => go({ t: 'tag', tag: t.color })}
              {...dropHandlers(`tag-${t.color}`, ids => { s.toggleTag(ids, t.color); s.toast(`已添加「${t.label}」标签`); })}
            >
              <TagDot color={t.color} size={11} />
              <span className="flex-1 text-left">{t.label}</span>
              {count > 0 && <span className="text-[10px] text-zinc-400">{count}</span>}
            </button>
          );
        })}
        <div className="pointer-events-none mt-2 flex items-center gap-1.5 px-2 text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">
          <Tag size={10} />
          拖拽文件到标签上即可快速标记
        </div>
      </Section>
    </div>
  );
}
