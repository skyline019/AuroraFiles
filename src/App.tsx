import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { useStore, useActiveTab, useItems, tabTitle, currentNodeId } from '@/lib/store';
import { TitleBar } from '@/components/TitleBar';
import { Sidebar } from '@/components/Sidebar';
import { Toolbar } from '@/components/Toolbar';
import { GridView, ListView, ThisPCView, LocationHeader, FolderBusyOverlay } from '@/components/Views';
import { ColumnView, GalleryView } from '@/components/ColumnsGallery';
import { galleryStepPool, stepInPool } from '@/lib/asyncGate';
import { ContextMenu, QuickLook, InfoPanel, BatchRename, CommandPalette, ShortcutsHelp, IndexPanel, Toasts } from '@/components/Overlays';
import { FolderIcon } from '@/components/icons';
import { ID, visibleItems, formatSize, folderSize, driveFor, extOf, categoryOf } from '@/lib/fs';
import { cn } from '@/utils/cn';
import { indexStatusLabel } from '@/lib/indexLabel';

// ── 桌面壁纸 ────────────────────────────────────────────────
function Wallpaper() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#e3e9f4] transition-colors duration-500 dark:bg-[#0a0d1c]">
      <div className="blob-a absolute -left-[8%] -top-[12%] h-[62vh] w-[58vw] rounded-full bg-[#8fb3ff] opacity-70 blur-[110px] dark:bg-[#203070] dark:opacity-50" />
      <div className="blob-b absolute -right-[10%] top-[8%] h-[58vh] w-[50vw] rounded-full bg-[#f0b8d9] opacity-60 blur-[120px] dark:bg-[#4a1f5e] dark:opacity-40" />
      <div className="blob-c absolute bottom-[-18%] left-[22%] h-[60vh] w-[56vw] rounded-full bg-[#ffd9a8] opacity-60 blur-[130px] dark:bg-[#1b3a5e] dark:opacity-40" />
      <div className="absolute inset-0 bg-gradient-to-b from-white/[.06] to-black/[.05] dark:from-black/[.1] dark:to-black/[.3]" />
      {/* 桌面水印 */}
      <div className="pointer-events-none absolute right-6 top-5 text-right">
        <p className="text-[13px] font-semibold text-white/80 drop-shadow dark:text-white/50">Aurora OS</p>
        <p className="text-[11px] text-white/50 drop-shadow dark:text-white/30">Windows 11 · 极光主题</p>
      </div>
    </div>
  );
}

// ── 状态栏 ──────────────────────────────────────────────────
function StatusBar() {
  const s = useStore();
  const tab = useActiveTab();
  const items = useItems();
  const nodeId = currentNodeId(tab);
  const sel = tab.selection;
  const selSize = sel.reduce((sum, id) => {
    const n = s.nodes[id];
    return sum + (n ? (n.kind === 'file' ? n.size : folderSize(s.nodes, n.id)) : 0);
  }, 0);
  const drive = nodeId ? driveFor(s.nodes, nodeId) : undefined;
  const hiddenCount = items.filter(i => i.hidden).length;
  const indexLabel = s.fsMode === 'real' ? indexStatusLabel(s.indexInfo) : '';

  return (
    <div className="flex h-[27px] shrink-0 select-none items-center gap-3 border-t border-black/[.06] px-3 text-[11.5px] text-zinc-400 dark:border-white/[.08] dark:text-zinc-500">
      <span className="tabular">{items.length} 个项目{tab.showHidden && hiddenCount > 0 ? `（含 ${hiddenCount} 个隐藏）` : ''}</span>
      {sel.length > 0 && <span className="tabular text-[#0a84ff]">已选 {sel.length} 个 · {formatSize(selSize)}</span>}
      {s.folderRefreshing && (
        <span className="tabular text-amber-600/90 dark:text-amber-400/80">正在加载文件夹…</span>
      )}
      {s.deepSearching && (
        <span className="tabular text-[#0a84ff]">深度搜索中…</span>
      )}
      {indexLabel ? (
        <button
          type="button"
          onClick={() => s.setIndexPanel(true)}
          className={cn(
            'tabular max-w-[220px] truncate rounded px-1 transition-colors hover:bg-black/[.06] dark:hover:bg-white/[.08]',
            s.indexInfo?.building ? 'text-amber-600/90 dark:text-amber-400/80' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300',
          )}
          title={`${indexLabel} · 点击查看详情`}
          data-testid="index-status-chip"
        >
          {indexLabel}
        </button>
      ) : s.fsMode === 'demo' ? (
        <button
          type="button"
          onClick={() => s.setIndexPanel(true)}
          className="rounded px-1 text-zinc-400 transition-colors hover:bg-black/[.06] hover:text-zinc-600 dark:hover:bg-white/[.08]"
          data-testid="index-status-chip"
          title="索引状态"
        >索引</button>
      ) : null}
      {s.fsMode === 'real' && s.indexInfo?.usnReadable === false && (
        <button
          type="button"
          onClick={() => void s.relaunchElevated()}
          className="rounded px-1 text-[11px] text-[#0a84ff] transition-colors hover:bg-[#0a84ff]/10"
          title="以管理员重启以启用完整 USN/FRN 追赶"
        >
          启用 USN
        </button>
      )}
      <span className="flex-1" />
      {tab.view === 'grid' && (
        <span className="flex items-center gap-2">
          <span className="text-[10px]">图标</span>
          <input
            type="range"
            min={52} max={116} step={4}
            value={tab.iconSize}
            onChange={e => s.patchTab({ iconSize: parseInt(e.target.value) })}
            className="zoom-slider"
          />
        </span>
      )}
      {drive?.drive && (
        <span className="tabular">磁盘可用 {formatSize(drive.drive.total - drive.drive.used)}</span>
      )}
      <button onClick={() => s.setShortcuts(true)} className="rounded px-1 transition-colors hover:bg-black/[.06] hover:text-zinc-600 dark:hover:bg-white/[.08]" title="查看快捷键">
        <kbd className="kbd mr-1">?</kbd>快捷键
      </button>
    </div>
  );
}

// ── 主视图路由 ──────────────────────────────────────────────
function ContentView() {
  const tab = useActiveTab();
  const nodeId = currentNodeId(tab);
  if (nodeId === ID.pc && !tab.search.trim()) return <ThisPCView />;
  switch (tab.view) {
    case 'list': return <ListView />;
    case 'columns': return <ColumnView />;
    case 'gallery': return <GalleryView />;
    default: return <GridView />;
  }
}

// ── 全局快捷键 ──────────────────────────────────────────────
function useGlobalKeys() {
  useEffect(() => {
    const activeTab = () => {
      const st = useStore.getState();
      return st.tabs.find(t => t.id === st.activeTabId) ?? st.tabs[0];
    };
    const itemsNow = () => {
      const st = useStore.getState();
      return visibleItems(st.nodes, activeTab());
    };
    const selectAll = () => useStore.getState().setSelection(itemsNow().map(i => i.id));
    const invert = () => {
      const st = useStore.getState();
      const sel = new Set(activeTab().selection);
      st.setSelection(itemsNow().map(i => i.id).filter(id => !sel.has(id)));
    };
    const selFirst = () => {
      const st = useStore.getState();
      const id = activeTab().selection[0];
      return id ? st.nodes[id] : undefined;
    };
    const openSelected = () => {
      const st = useStore.getState();
      const id = activeTab().selection[0];
      if (id) st.openNode(id);
    };
    const quickLookToggle = () => {
      const st = useStore.getState();
      if (st.quickLookId) { st.setQuickLook(null); return; }
      const n = selFirst();
      if (!n) return;
      if (n.kind !== 'file') {
        st.toast('请选择文件以快速查看', 'info');
        return;
      }
      const cat = categoryOf(extOf(n.name));
      if (cat === 'app' || cat === 'sys' || cat === 'db') st.toast(`“${n.name}”不支持快速查看`, 'info');
      else st.setQuickLook(n.id);
    };

    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const tab = activeTab();
      const target = e.target as HTMLElement;
      const typing = !!target.closest('input, textarea, [contenteditable="true"]');
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // 面板类（自身优先处理）
      if (st.paletteOpen) return;
      if (e.key === 'Escape') {
        if (st.quickLookId) { st.setQuickLook(null); return; }
        if (st.batchOpen) { st.setBatch(false); return; }
        if (st.shortcutsOpen) { st.setShortcuts(false); return; }
        if (st.infoId) { st.setInfo(null); return; }
        if (typing) return;
        if (tab.search) { st.patchTab({ search: '' }); return; }
        if (tab.selection.length) st.setSelection([]);
        return;
      }
      if (st.quickLookId || st.batchOpen || st.shortcutsOpen) return;

      if (mod && key === 'k') { e.preventDefault(); st.setPalette(true); return; }
      if (mod && key === 'e') { e.preventDefault(); window.dispatchEvent(new CustomEvent('aurora:focus-search')); return; }
      if (typing) return;

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const list = st.deepHits?.length && tab.search.trim()
          ? st.deepHits.map((id) => st.nodes[id]).filter((n): n is NonNullable<typeof n> => !!n && !n.deleted)
          : visibleItems(st.nodes, tab);
        if (!list.length) return;
        e.preventDefault();
        // 画廊：左右只在文件间步进；分栏/列表：单列键盘
        const pool = tab.view === 'gallery' ? galleryStepPool(list) : list;
        const ids = pool.map((n) => n.id);
        const anchor = tab.selection.find((id) => ids.includes(id)) ?? tab.selection[tab.selection.length - 1];
        const cols = tab.view === 'grid'
          ? Math.max(1, Math.floor((window.innerWidth - 280) / (tab.iconSize + 28)))
          : 1;
        let delta = 0;
        if (e.key === 'ArrowLeft') delta = -1;
        else if (e.key === 'ArrowRight') delta = 1;
        else if (e.key === 'ArrowUp') delta = -cols;
        else if (e.key === 'ArrowDown') delta = cols;
        const next = stepInPool(ids, anchor, delta);
        if (!next) return;
        if (e.shiftKey && anchor && tab.view !== 'gallery') {
          const a = ids.indexOf(tab.selection[0] ?? anchor);
          const from = Math.min(a, ids.indexOf(next));
          const to = Math.max(a, ids.indexOf(next));
          st.setSelection(ids.slice(from, to + 1));
        } else {
          st.setSelection([next]);
        }
        return;
      }

      if (e.key === 'F2') { e.preventDefault(); const id = tab.selection[0]; if (id) st.beginRename(id); return; }
      if (e.key === 'F3') return; // Toolbar 处理
      if (e.key === 'F5') {
        e.preventDefault();
        void st.refreshCurrent();
        return;
      }
      if (e.key === 'F6') { e.preventDefault(); if (tab.selection.length) st.setBatch(true); return; }
      if (e.key === 'Enter') {
        if (e.altKey) { e.preventDefault(); const id = tab.selection[0]; if (id) st.setInfo(id); return; }
        openSelected();
        return;
      }
      if (e.key === ' ') { e.preventDefault(); quickLookToggle(); return; }
      if (e.key === 'Backspace') { e.preventDefault(); st.back(); return; }
      if (e.key === 'Delete') {
        if (!tab.selection.length) return;
        if (e.shiftKey) st.deleteForever(tab.selection);
        else {
          const nodeId = currentNodeId(tab);
          const first = tab.selection.map(id => st.nodes[id]).find(Boolean);
          if (first?.deleted || nodeId === ID.trash) st.deleteForever(tab.selection);
          else st.trash(tab.selection);
        }
        return;
      }
      if (e.key === '?' || (e.shiftKey && e.key === '/')) { st.setShortcuts(true); return; }

      if (e.altKey) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); st.back(); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); st.forward(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); st.up(); return; }
        if (key === 't') { e.preventDefault(); st.addTab(); return; }
        if (key === 'w') { e.preventDefault(); st.closeTab(st.activeTabId); return; }
        if (mod && key === 'c') {
          e.preventDefault();
          const stt = useStore.getState();
          const n = selFirst();
          const nid0 = currentNodeId(activeTab());
          const targetId = n?.id ?? nid0;
          if (targetId) {
            import('@/lib/fs').then(({ pathString }) => {
              navigator.clipboard?.writeText(pathString(stt.nodes, targetId)).catch(() => undefined);
              stt.toast('已复制路径');
            });
          }
          return;
        }
        return;
      }

      if (!mod) return;
      switch (key) {
        case 'a': e.preventDefault(); selectAll(); return;
        case 'u': if (e.shiftKey) { e.preventDefault(); invert(); } return;
        case 'c': e.preventDefault(); if (tab.selection.length) st.setClipboard('copy', tab.selection); return;
        case 'x': e.preventDefault(); if (tab.selection.length) st.setClipboard('cut', tab.selection); return;
        case 'v': e.preventDefault(); st.paste(); return;
        case 'd': e.preventDefault(); if (tab.selection.length) st.duplicate(tab.selection); return;
        case 'z': e.preventDefault(); st.undo(); return;
        case 'y': e.preventDefault(); st.redo(); return;
        case 'n': if (e.shiftKey) { e.preventDefault(); st.createFolder(); } return;
        case '.': case '>': if (e.shiftKey) { e.preventDefault(); st.patchTab({ showHidden: !tab.showHidden }); st.toast(tab.showHidden ? '已隐藏系统文件' : '正在显示隐藏文件'); } return;
        case '1': case '2': case '3': case '4': {
          e.preventDefault();
          const views = ['grid', 'list', 'columns', 'gallery'] as const;
          st.patchTab({ view: views[parseInt(key) - 1] });
          return;
        }
        case '+': case '=': e.preventDefault(); st.patchTab({ iconSize: Math.min(116, tab.iconSize + 8) }); return;
        case '-': e.preventDefault(); st.patchTab({ iconSize: Math.max(52, tab.iconSize - 8) }); return;
      }
    };

    const onSelectAll = () => selectAll();
    const onInvert = () => invert();
    window.addEventListener('keydown', onKey);
    document.addEventListener('aurora:select-all', onSelectAll);
    document.addEventListener('aurora:invert', onInvert);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('aurora:select-all', onSelectAll);
      document.removeEventListener('aurora:invert', onInvert);
    };
  }, []);
}

// ── 窗口 ────────────────────────────────────────────────────
function useViewportSize() {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return vp;
}

function Window() {
  const s = useStore();
  const tab = useActiveTab();
  const items = useItems();
  const dragControls = useDragControls();
  const loc = tab.history[tab.hi];
  const locKey = (loc.t === 'node' ? loc.id : `tag-${loc.tag}`) + tab.view;
  const vp = useViewportSize();
  const electron = typeof window !== 'undefined' && !!(window as unknown as { aurora?: { isElectron?: boolean } }).aurora?.isElectron;
  const W = electron ? vp.w : Math.min(1260, vp.w * 0.95);
  const H = electron ? vp.h : Math.min(848, vp.h * 0.93);

  return (
    <motion.div
      drag={!s.maximized}
      dragListener={false}
      dragControls={dragControls}
      dragMomentum={false}
      animate={s.winState !== 'open' ? 'hidden' : s.maximized ? 'max' : 'normal'}
      variants={{
        normal: { width: W, height: H, borderRadius: 14, opacity: 1, scale: 1, y: 0 },
        max: { width: vp.w, height: vp.h, borderRadius: 0, opacity: 1, scale: 1, x: 0, y: 0 },
        hidden: { opacity: 0, scale: 0.7, y: 110, width: W, height: H, borderRadius: 14 },
      }}
      initial="normal"
      transition={{
        width: { type: 'spring', stiffness: 260, damping: 30 },
        height: { type: 'spring', stiffness: 260, damping: 30 },
        borderRadius: { duration: 0.25 },
        default: { type: 'spring', stiffness: 340, damping: 30 },
      }}
      className="window-shadow pointer-events-auto relative flex flex-col overflow-hidden"
      style={{ willChange: 'transform' }}
      role="application"
      aria-label="Aurora Files"
    >
      <a href="#aurora-main" className="skip-link">跳到文件列表</a>
      <div className="relative z-10 shrink-0 bg-white/[.45] backdrop-blur-2xl dark:bg-[#191a1e]/[.55]">
        <TitleBar onDragPointerDown={(e) => { if (!s.maximized && e.button === 0) dragControls.start(e); }} />
      </div>
      <div className="flex min-h-0 flex-1">
        <AnimatePresence initial={false}>
          {s.sidebarOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 234, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              className="shrink-0 overflow-hidden border-r border-black/[.05] bg-white/[.55] backdrop-blur-2xl dark:border-white/[.07] dark:bg-[#17181c]/[.6]"
            >
              <Sidebar />
            </motion.aside>
          )}
        </AnimatePresence>
        <main className="flex min-w-0 flex-1 flex-col bg-white text-zinc-800 dark:bg-[#1f1f22] dark:text-zinc-100">
          <Toolbar />
          <div className="relative flex min-h-0 flex-1 flex-col">
            <LocationHeader count={items.length} />
            <div id="aurora-main" className="relative min-h-0 flex-1" tabIndex={-1}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={locKey}
                  initial={{ opacity: 0, y: 7 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="h-full"
                >
                  <ContentView />
                </motion.div>
              </AnimatePresence>
              <FolderBusyOverlay />
            </div>
          </div>
          <StatusBar />
        </main>
      </div>

      {/* 浮层 */}
      <ContextMenu />
      <AnimatePresence>{s.quickLookId && <QuickLook key="ql" />}</AnimatePresence>
      <AnimatePresence>{s.infoId && <InfoPanel key="info" />}</AnimatePresence>
      <AnimatePresence>{s.batchOpen && <BatchRename key="batch" />}</AnimatePresence>
      <AnimatePresence>{s.paletteOpen && <CommandPalette key="palette" />}</AnimatePresence>
      <AnimatePresence>{s.shortcutsOpen && <ShortcutsHelp key="shortcuts" />}</AnimatePresence>
      <AnimatePresence>{s.indexPanelOpen && <IndexPanel key="index" />}</AnimatePresence>
      <Toasts />
    </motion.div>
  );
}

// ── 关闭 / 最小化后的桌面卡片 ────────────────────────────────
function DockCard() {
  const s = useStore();
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.85, y: 14 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24, delay: 0.15 }}
      onClick={() => s.setWinState('open')}
      className="dock-bounce pointer-events-auto flex flex-col items-center gap-3 rounded-3xl p-6 transition-transform hover:scale-105"
    >
      <div
        className="flex h-[104px] w-[104px] items-center justify-center rounded-[26px] shadow-2xl"
        style={{ background: 'linear-gradient(160deg, #7cc0ff, #0a6cff)', boxShadow: '0 24px 60px -12px rgba(10,108,255,.55), inset 0 1px 0 rgba(255,255,255,.4)' }}
      >
        <FolderIcon size={64} />
      </div>
      <span className="rounded-lg bg-black/25 px-3 py-1 text-[13px] font-medium text-white backdrop-blur">
        Aurora Files
      </span>
      <span className="text-[11.5px] text-white/60">{s.winState === 'min' ? '窗口已最小化' : '窗口已关闭'} · 点击图标重新打开</span>
    </motion.button>
  );
}

export default function App() {
  const dark = useStore(s => s.dark);
  const winState = useStore(s => s.winState);
  const nodes = useStore(s => s.nodes);
  const fsMode = useStore(s => s.fsMode);
  const booting = useStore(s => s.booting);
  const tab = useActiveTab();
  const electron = typeof window !== 'undefined' && !!(window as unknown as { aurora?: { isElectron?: boolean } }).aurora?.isElectron;
  useGlobalKeys();

  useEffect(() => {
    document.title = `${tabTitle(nodes, tab)} — Aurora Files`;
  }, [nodes, tab]);

  useEffect(() => {
    if (electron) {
      useStore.setState({ maximized: true });
      void useStore.getState().bootstrapReal();
    }
  }, [electron]);

  // Electron：真窗口全屏内容区，去掉仿壁纸桌面
  if (electron) {
    return (
      <div className={cn(dark && 'dark', 'h-full')}>
        <div className="relative flex h-full w-full select-none flex-col overflow-hidden bg-[#e3e9f4] dark:bg-[#0a0d1c]">
          {booting && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 text-sm text-white backdrop-blur-sm">
              正在连接本机磁盘…
            </div>
          )}
          {fsMode === 'demo' && (
            <div className="flex shrink-0 items-center justify-between gap-2 bg-amber-500/90 px-3 py-1.5 text-[12px] text-white">
              <span>当前为「极光演示」虚拟盘 · 文件操作不会写入真实磁盘</span>
              <button
                type="button"
                className="rounded-md bg-white/20 px-2 py-0.5 font-medium hover:bg-white/30"
                onClick={() => void useStore.getState().exitDemoToReal()}
              >
                返回真盘
              </button>
            </div>
          )}
          <div className="pointer-events-auto min-h-0 flex-1">
            <Window />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(dark && 'dark', 'h-full')}>
      <div className="relative h-full w-full select-none overflow-hidden">
        <Wallpaper />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <AnimatePresence mode="wait">
            {winState === 'open' ? <Window key="win" /> : <DockCard key="dock" />}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
