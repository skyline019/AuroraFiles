import { useState } from 'react';
import { X, Minus, Plus, Moon, Sun, Keyboard, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useStore, useActiveTab, tabTitle } from '@/lib/store';
import { FileGlyph } from './icons';
import { cn } from '@/utils/cn';

function Light({ bg, glyph, onClick, title }: { bg: string; glyph: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      data-nodrag
      title={title}
      onClick={onClick}
      className="flex h-[13px] w-[13px] items-center justify-center rounded-full text-[#4d0000]/70 transition-transform active:scale-90"
      style={{ background: bg, boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,.15)' }}
    >
      <span className="opacity-0 transition-opacity group-hover:opacity-100">{glyph}</span>
    </button>
  );
}

export function TitleBar({ onDragPointerDown }: { onDragPointerDown: (e: React.PointerEvent) => void }) {
  const { tabs, activeTabId, selectTab, closeTab, addTab, moveTab, dark, toggleDark, setShortcuts, setWinState, toggleMax, sidebarOpen, toggleSidebar, nodes } = useStore();
  useActiveTab();
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  return (
    <div
      className="relative flex h-11 shrink-0 items-center gap-3 pl-[14px] pr-3 select-none"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('[data-nodrag]')) return;
        onDragPointerDown(e);
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-nodrag]')) return;
        toggleMax();
      }}
    >
      {/* 红绿灯 */}
      <div className="group flex items-center gap-2" data-nodrag>
        <Light bg="#ff5f57" title="关闭" onClick={() => setWinState('closed')} glyph={<X size={9} strokeWidth={2.6} />} />
        <Light bg="#febc2e" title="最小化" onClick={() => setWinState('min')} glyph={<Minus size={9} strokeWidth={2.6} color="#5c4600" />} />
        <Light bg="#28c840" title="最大化 / 还原" onClick={toggleMax} glyph={<Plus size={9} strokeWidth={2.6} color="#0a4d00" />} />
      </div>

      <button
        data-nodrag
        title={sidebarOpen ? '隐藏边栏' : '显示边栏'}
        onClick={toggleSidebar}
        className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200"
      >
        {sidebarOpen ? <PanelLeftClose size={16} strokeWidth={1.8} /> : <PanelLeftOpen size={16} strokeWidth={1.8} />}
      </button>

      {/* 标签页 */}
      <div className="flex min-w-0 flex-1 items-center gap-[2px] self-end overflow-x-auto pb-0" data-nodrag>
        <div className="flex min-w-0 items-end">
          {tabs.map((t, i) => {
            const active = t.id === activeTabId;
            const loc = t.history[t.hi];
            const node = loc.t === 'node' ? nodes[loc.id] : undefined;
            return (
              <div
                key={t.id}
                draggable
                onDragStart={() => setDragIdx(i)}
                onDragEnd={() => setDragIdx(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragIdx !== null && dragIdx !== i) moveTab(dragIdx, i); setDragIdx(null); }}
                onClick={() => selectTab(t.id)}
                onAuxClick={(e) => { if (e.button === 1) closeTab(t.id); }}
                className={cn(
                  'group/tab relative flex h-8 w-[150px] min-w-[104px] max-w-[160px] shrink cursor-default items-center gap-1.5 rounded-t-[9px] px-2.5 text-[12px] transition-colors',
                  dragIdx === i && 'opacity-40',
                  active
                    ? 'bg-white text-zinc-800 shadow-[0_-1px_3px_rgba(0,0,0,.06)] dark:bg-[#1f1f22] dark:text-zinc-100'
                    : 'text-zinc-500 hover:bg-white/40 dark:text-zinc-400 dark:hover:bg-white/5',
                )}
              >
                <span className="pointer-events-none shrink-0">
                  {node ? <FileGlyph node={node} size={14} /> : <span className="block h-3.5 w-3.5 rounded-full" style={{ background: '#0a84ff' }} />}
                </span>
                <span className="min-w-0 flex-1 truncate">{tabTitle(nodes, t)}</span>
                <button
                  data-nodrag
                  title="关闭标签页"
                  onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
                  className={cn(
                    'shrink-0 rounded p-[2px] text-zinc-400 transition-all hover:bg-black/10 hover:text-zinc-600 dark:hover:bg-white/15 dark:hover:text-zinc-200',
                    active ? 'opacity-60 group-hover/tab:opacity-100' : 'opacity-0 group-hover/tab:opacity-100',
                  )}
                >
                  <X size={11} strokeWidth={2.2} />
                </button>
                {active && <span className="absolute inset-x-2 -bottom-px h-px bg-white dark:bg-[#1f1f22]" />}
              </div>
            );
          })}
        </div>
        <button
          data-nodrag
          title="新建标签页"
          onClick={() => addTab()}
          className="ml-1 shrink-0 rounded-md p-[5px] text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/10"
        >
          <Plus size={14} strokeWidth={2} />
        </button>
      </div>

      {/* 右侧控制 */}
      <div className="flex shrink-0 items-center gap-1" data-nodrag>
        <button
          title="键盘快捷键 (Shift+/)"
          onClick={() => setShortcuts(true)}
          className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200"
        >
          <Keyboard size={16} strokeWidth={1.8} />
        </button>
        <button
          title={dark ? '切换到浅色模式' : '切换到深色模式'}
          onClick={toggleDark}
          className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200"
        >
          {dark ? <Sun size={16} strokeWidth={1.8} /> : <Moon size={16} strokeWidth={1.8} />}
        </button>
      </div>
    </div>
  );
}
