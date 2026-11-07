import { useStore, useActiveTab, useItems, currentNodeId } from '@/lib/store';
import { formatSize, folderSize, driveFor } from '@/lib/fs';
import { cn } from '@/utils/cn';
import { indexChipState, indexStatusLabel } from '@/lib/indexLabel';

/** Shared bottom chrome — keeps Electron / web index-chip copy & tone in sync. */
export function StatusBar() {
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
  const hiddenCount = items.filter((i) => i.hidden).length;
  const indexLabel = s.fsMode === 'real' ? indexStatusLabel(s.indexInfo) : '';
  const chipState = indexChipState(s.fsMode, s.indexInfo);
  const chipBusy = chipState === 'building';

  return (
    <div
      className="flex h-[27px] shrink-0 select-none items-center gap-3 border-t border-black/[.06] px-3 text-[11.5px] text-zinc-400 dark:border-white/[.08] dark:text-zinc-500"
      data-testid="status-bar"
    >
      <span className="tabular">
        {items.length} 个项目{tab.showHidden && hiddenCount > 0 ? `（含 ${hiddenCount} 个隐藏）` : ''}
      </span>
      {sel.length > 0 && (
        <span className="tabular text-[#0a84ff]">
          已选 {sel.length} 个 · {formatSize(selSize)}
        </span>
      )}
      {s.folderRefreshing && (
        <span className="tabular text-amber-600/90 dark:text-amber-400/80" data-testid="folder-refresh-hint">
          正在加载文件夹…
        </span>
      )}
      {s.deepSearching && (
        <span className="tabular text-[#0a84ff]" data-testid="deep-search-hint">
          深度搜索中…
        </span>
      )}
      {indexLabel ? (
        <button
          type="button"
          onClick={() => s.setIndexPanel(true)}
          className={cn(
            'tabular max-w-[min(42vw,300px)] truncate rounded px-1 transition-colors hover:bg-black/[.06] dark:hover:bg-white/[.08]',
            chipBusy
              ? 'text-amber-600/90 dark:text-amber-400/80'
              : chipState === 'refreshing'
                ? 'text-sky-600/90 dark:text-sky-400/80'
                : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300',
          )}
          title={`${indexLabel} · 点击查看详情`}
          data-testid="index-status-chip"
          data-index-state={chipState}
        >
          {indexLabel}
        </button>
      ) : s.fsMode === 'demo' ? (
        <button
          type="button"
          onClick={() => s.setIndexPanel(true)}
          className="rounded px-1.5 text-[11px] font-medium text-[#5e5ce6] transition-colors hover:bg-[#5e5ce6]/10 dark:text-[#a5a3ff]"
          data-testid="index-status-chip"
          data-index-state="demo"
          title="当前为演示盘 · 点击查看索引说明"
        >
          演示盘
        </button>
      ) : null}
      {s.fsMode === 'real' && s.indexInfo?.usnReadable === false && (
        <button
          type="button"
          onClick={() => void s.relaunchElevated()}
          className="rounded px-1 text-[11px] text-[#0a84ff] transition-colors hover:bg-[#0a84ff]/10"
          title="以管理员重启以启用完整 USN/FRN 追赶"
          data-testid="enable-usn-btn"
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
            min={52}
            max={116}
            step={4}
            value={tab.iconSize}
            onChange={(e) => s.patchTab({ iconSize: parseInt(e.target.value) })}
            className="zoom-slider"
            aria-label="图标大小"
          />
        </span>
      )}
      {drive?.drive && (
        <span className="tabular">磁盘可用 {formatSize(drive.drive.total - drive.drive.used)}</span>
      )}
      <button
        type="button"
        onClick={() => s.setShortcuts(true)}
        className="rounded px-1 transition-colors hover:bg-black/[.06] hover:text-zinc-600 dark:hover:bg-white/[.08]"
        title="查看快捷键"
      >
        <kbd className="kbd mr-1">?</kbd>快捷键
      </button>
    </div>
  );
}
