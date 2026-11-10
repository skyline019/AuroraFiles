/**
 * Electron shell without framer-motion — shorter cold parse / no motion modulepreload.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { useStore, useActiveTab, useItems, currentNodeId } from '@/lib/store';
import { TitleBar } from '@/components/TitleBar';
import { Sidebar } from '@/components/Sidebar';
import { Toolbar } from '@/components/Toolbar';
import { StatusBar } from '@/components/StatusBar';
import { GridView, ListView, ThisPCView, LocationHeader, FolderBusyOverlay } from '@/components/Views';
import { CategoryBar } from '@/components/CategoryBar';
import { ID } from '@/lib/fs';

const ColumnView = lazy(() => import('@/components/ColumnsGallery').then((m) => ({ default: m.ColumnView })));
const GalleryView = lazy(() => import('@/components/ColumnsGallery').then((m) => ({ default: m.GalleryView })));
const OverlayHost = lazy(() => import('@/components/OverlayHost'));

function ContentView() {
  const tab = useActiveTab();
  const nodeId = currentNodeId(tab);
  if (nodeId === ID.pc && !tab.search.trim()) return <ThisPCView />;
  switch (tab.view) {
    case 'list':
      return <ListView />;
    case 'columns':
      return (
        <Suspense fallback={<div className="p-4 text-[12px] text-zinc-400">加载分栏…</div>}>
          <ColumnView />
        </Suspense>
      );
    case 'gallery':
      return (
        <Suspense fallback={<div className="p-4 text-[12px] text-zinc-400">加载画廊…</div>}>
          <GalleryView />
        </Suspense>
      );
    default:
      return <GridView />;
  }
}

export default function ElectronShell() {
  const s = useStore();
  const tab = useActiveTab();
  const items = useItems();
  const [overlaysReady, setOverlaysReady] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setOverlaysReady(true), 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden bg-white text-zinc-800 dark:bg-[#1f1f22] dark:text-zinc-100"
      role="application"
      aria-label="Aurora Files"
    >
      <a href="#aurora-main" className="skip-link">
        跳到文件列表
      </a>
      <div className="relative z-10 shrink-0 bg-white/[.45] backdrop-blur-2xl dark:bg-[#191a1e]/[.55]">
        <TitleBar />
      </div>
      <div className="flex min-h-0 flex-1">
        {s.sidebarOpen && (
          <aside className="w-[234px] shrink-0 overflow-hidden border-r border-black/[.05] bg-white/[.55] backdrop-blur-2xl dark:border-white/[.07] dark:bg-[#17181c]/[.6]">
            <Sidebar />
          </aside>
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          <Toolbar />
          <div className="relative flex min-h-0 flex-1 flex-col">
            <LocationHeader count={items.length} />
            <CategoryBar />
            <div id="aurora-main" className="relative min-h-0 flex-1" tabIndex={-1}>
              <div className="view-fade h-full" key={`${currentNodeId(tab)}-${tab.view}-${tab.categoryFilter?.join(',') ?? ''}-${tab.groupByCategory ? 'g' : 'f'}`}>
                <ContentView />
              </div>
              <FolderBusyOverlay />
            </div>
          </div>
          <StatusBar />
        </main>
      </div>
      {overlaysReady && (
        <Suspense fallback={null}>
          <OverlayHost />
        </Suspense>
      )}
    </div>
  );
}
