import { useMemo } from 'react';
import { LayoutGrid, Layers } from 'lucide-react';
import { useStore, useActiveTab, useItemsForChips } from '@/lib/store';
import type { Category } from '@/lib/fs';
import { CATEGORY_DOT, categoryLabel } from '@/lib/categoryLabel';
import { presentChipCategories } from '@/lib/groupItems';
import { cn } from '@/utils/cn';

/** 当前范围分类筛选芯片 + 分组开关 */
export function CategoryBar() {
  const tab = useActiveTab();
  const pool = useItemsForChips();
  const patchTab = useStore((s) => s.patchTab);

  const chips = useMemo(() => presentChipCategories(pool), [pool]);
  const filter = tab.categoryFilter ?? [];
  const show = chips.length > 0 || filter.length > 0 || tab.groupByCategory;
  if (!show) return null;

  const allActive = filter.length === 0;

  const toggle = (cat: Category) => {
    const cur = new Set(filter);
    if (cur.has(cat)) cur.delete(cat);
    else cur.add(cat);
    patchTab({ categoryFilter: [...cur] });
  };

  return (
    <div
      data-testid="category-bar"
      className="cat-bar flex shrink-0 items-center gap-1.5 border-b border-black/[.05] px-3 py-1.5 dark:border-white/[.07]"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        <button
          type="button"
          data-testid="cat-chip-all"
          onClick={() => patchTab({ categoryFilter: [] })}
          className={cn(
            'cat-chip shrink-0 rounded-md px-2 py-[3px] text-[11.5px] font-medium transition-all duration-120',
            allActive
              ? 'bg-[#0a84ff]/15 text-[#0a84ff] ring-1 ring-[#0a84ff]/35 scale-[1.02]'
              : 'text-zinc-500 hover:bg-black/[.05] dark:text-zinc-400 dark:hover:bg-white/[.07]',
          )}
        >
          全部
        </button>
        {chips.map((cat) => {
          const on = filter.includes(cat);
          return (
            <button
              key={cat}
              type="button"
              data-testid={`cat-chip-${cat}`}
              onClick={() => toggle(cat)}
              className={cn(
                'cat-chip flex shrink-0 items-center gap-1 rounded-md px-2 py-[3px] text-[11.5px] font-medium transition-all duration-120',
                on
                  ? 'bg-black/[.07] text-zinc-800 ring-1 ring-black/[.08] scale-[1.02] dark:bg-white/[.12] dark:text-zinc-100 dark:ring-white/[.12]'
                  : 'text-zinc-500 hover:bg-black/[.05] dark:text-zinc-400 dark:hover:bg-white/[.07]',
              )}
            >
              <span
                className="h-[7px] w-[7px] rounded-full"
                style={{ background: CATEGORY_DOT[cat] }}
                aria-hidden
              />
              {categoryLabel(cat)}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        data-testid="cat-group-toggle"
        title="按类型分组"
        onClick={() => patchTab({ groupByCategory: !tab.groupByCategory })}
        className={cn(
          'flex shrink-0 items-center gap-1 rounded-md px-2 py-[3px] text-[11.5px] font-medium transition-all duration-120',
          tab.groupByCategory
            ? 'bg-[#0a84ff]/15 text-[#0a84ff]'
            : 'text-zinc-500 hover:bg-black/[.05] dark:text-zinc-400 dark:hover:bg-white/[.07]',
        )}
      >
        {tab.groupByCategory ? <Layers size={12} strokeWidth={2.2} /> : <LayoutGrid size={12} strokeWidth={2.2} />}
        分组
      </button>
    </div>
  );
}
