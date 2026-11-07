import { useEffect } from 'react';
import { useStore, useActiveTab, tabTitle } from '@/lib/store';
import ElectronShell from '@/components/ElectronShell';
import { useGlobalKeys } from '@/hooks/useGlobalKeys';
import { cn } from '@/utils/cn';

/** Electron production entry — no framer-motion on the cold path. */
export default function AppElectron() {
  const dark = useStore((s) => s.dark);
  const nodes = useStore((s) => s.nodes);
  const fsMode = useStore((s) => s.fsMode);
  const booting = useStore((s) => s.booting);
  const tab = useActiveTab();
  useGlobalKeys();

  useEffect(() => {
    document.title = `${tabTitle(nodes, tab)} — Aurora Files`;
  }, [nodes, tab]);

  useEffect(() => {
    useStore.setState({ maximized: true });
    void useStore.getState().bootstrapReal();
  }, []);

  useEffect(() => {
    const api = window.aurora;
    void api?.startupMark?.('renderer_mount');
  }, []);

  useEffect(() => {
    // booting starts true (bootApp); mark interactive only after first real-disk skeleton
    if (booting || fsMode !== 'real') return;
    void window.aurora?.startupMark?.('interactive');
  }, [booting, fsMode]);

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
          <ElectronShell />
        </div>
      </div>
    </div>
  );
}
