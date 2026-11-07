import { lazy, Suspense, useEffect, useState } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { useStore, useActiveTab, useItems, tabTitle, currentNodeId } from '@/lib/store';
import { TitleBar } from '@/components/TitleBar';
import { Sidebar } from '@/components/Sidebar';
import { Toolbar } from '@/components/Toolbar';
import { StatusBar } from '@/components/StatusBar';
import { GridView, ListView, ThisPCView, LocationHeader, FolderBusyOverlay } from '@/components/Views';
import { ColumnView, GalleryView } from '@/components/ColumnsGallery';
import { FolderIcon } from '@/components/icons';
import { ID } from '@/lib/fs';
import { cn } from '@/utils/cn';
import { useGlobalKeys } from '@/hooks/useGlobalKeys';

const OverlayHost = lazy(() => import('@/components/OverlayHost'));

function Wallpaper() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#e3e9f4] transition-colors duration-500 dark:bg-[#0a0d1c]">
      <div className="blob-a absolute -left-[8%] -top-[12%] h-[62vh] w-[58vw] rounded-full bg-[#8fb3ff] opacity-70 blur-[110px] dark:bg-[#203070] dark:opacity-50" />
      <div className="blob-b absolute -right-[10%] top-[8%] h-[58vh] w-[50vw] rounded-full bg-[#f0b8d9] opacity-60 blur-[120px] dark:bg-[#4a1f5e] dark:opacity-40" />
      <div className="blob-c absolute bottom-[-18%] left-[22%] h-[60vh] w-[56vw] rounded-full bg-[#ffd9a8] opacity-60 blur-[130px] dark:bg-[#1b3a5e] dark:opacity-40" />
      <div className="absolute inset-0 bg-gradient-to-b from-white/[.06] to-black/[.05] dark:from-black/[.1] dark:to-black/[.3]" />
      <div className="pointer-events-none absolute right-6 top-5 text-right">
        <p className="text-[13px] font-semibold text-white/80 drop-shadow dark:text-white/50">Aurora OS</p>
        <p className="text-[11px] text-white/50 drop-shadow dark:text-white/30">Windows 11 · 极光主题</p>
      </div>
    </div>
  );
}

function ContentView() {
  const tab = useActiveTab();
  const nodeId = currentNodeId(tab);
  if (nodeId === ID.pc && !tab.search.trim()) return <ThisPCView />;
  switch (tab.view) {
    case 'list':
      return <ListView />;
    case 'columns':
      return <ColumnView />;
    case 'gallery':
      return <GalleryView />;
    default:
      return <GridView />;
  }
}

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
  const W = Math.min(1260, vp.w * 0.95);
  const H = Math.min(848, vp.h * 0.93);

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
      <a href="#aurora-main" className="skip-link">
        跳到文件列表
      </a>
      <div className="relative z-10 shrink-0 bg-white/[.45] backdrop-blur-2xl dark:bg-[#191a1e]/[.55]">
        <TitleBar
          onDragPointerDown={(e) => {
            if (!s.maximized && e.button === 0) dragControls.start(e);
          }}
        />
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
      <Suspense fallback={null}>
        <OverlayHost />
      </Suspense>
    </motion.div>
  );
}

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
        style={{
          background: 'linear-gradient(160deg, #7cc0ff, #0a6cff)',
          boxShadow: '0 24px 60px -12px rgba(10,108,255,.55), inset 0 1px 0 rgba(255,255,255,.4)',
        }}
      >
        <FolderIcon size={64} />
      </div>
      <span className="rounded-lg bg-black/25 px-3 py-1 text-[13px] font-medium text-white backdrop-blur">
        Aurora Files
      </span>
      <span className="text-[11.5px] text-white/60">
        {s.winState === 'min' ? '窗口已最小化' : '窗口已关闭'} · 点击图标重新打开
      </span>
    </motion.button>
  );
}

export default function App() {
  const dark = useStore((s) => s.dark);
  const winState = useStore((s) => s.winState);
  const nodes = useStore((s) => s.nodes);
  const tab = useActiveTab();
  useGlobalKeys();

  useEffect(() => {
    document.title = `${tabTitle(nodes, tab)} — Aurora Files`;
  }, [nodes, tab]);

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
