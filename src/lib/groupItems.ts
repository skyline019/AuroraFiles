import {
  type Category,
  type FSNode,
  categoryOf,
  extOf,
} from './fs';
import {
  CATEGORY_CHIP_ORDER,
  CATEGORY_SECTION_ORDER,
  categoryLabel,
  typeTokenToCategory,
} from './categoryLabel';

export type SectionKey = Category | 'folder';

export type CategorySection = {
  key: SectionKey;
  label: string;
  items: FSNode[];
};

export type BrowseRow =
  | { t: 'header'; key: SectionKey; label: string; count: number; collapsed: boolean }
  | { t: 'item'; node: FSNode };

export function nodeCategoryKey(n: FSNode): SectionKey {
  if (n.kind === 'folder' || n.kind === 'drive' || n.kind === 'special') return 'folder';
  return categoryOf(n.ext ?? extOf(n.name));
}

/** 按类型筛选；keepFolders 默认 true（便于导航） */
export function filterByCategories(
  items: FSNode[],
  filter: Category[] | undefined | null,
  opts: { keepFolders?: boolean } = {},
): FSNode[] {
  if (!filter?.length) return items;
  const keepFolders = opts.keepFolders !== false;
  const want = new Set(filter);
  return items.filter((n) => {
    const key = nodeCategoryKey(n);
    if (key === 'folder') return keepFolders;
    return want.has(key);
  });
}

/** 扩展名 / 别名 → 是否匹配 type: 过滤 */
export function matchesTypeToken(n: FSNode, typeToken: string): boolean {
  const t = String(typeToken || '').trim().toLowerCase().replace(/^\./, '');
  if (!t) return true;
  if (n.kind !== 'file') return false;
  const ext = (n.ext ?? extOf(n.name)).toLowerCase();
  if (ext === t) return true;
  const aliased = typeTokenToCategory(t);
  if (aliased) return nodeCategoryKey(n) === aliased;
  return nodeCategoryKey(n) === categoryOf(t);
}

export function groupByCategory(items: FSNode[]): CategorySection[] {
  const buckets = new Map<SectionKey, FSNode[]>();
  for (const n of items) {
    const key = nodeCategoryKey(n);
    let list = buckets.get(key);
    if (!list) {
      list = [];
      buckets.set(key, list);
    }
    list.push(n);
  }
  const out: CategorySection[] = [];
  for (const key of CATEGORY_SECTION_ORDER) {
    const list = buckets.get(key);
    if (!list?.length) continue;
    out.push({ key, label: categoryLabel(key), items: list });
  }
  // 兜底：未列入 SECTION_ORDER 的键
  for (const [key, list] of buckets) {
    if (out.some((s) => s.key === key)) continue;
    out.push({ key, label: categoryLabel(key), items: list });
  }
  return out;
}

/** 分组 → 扁平虚拟列表行；折叠节只保留 header */
export function flattenGrouped(
  sections: CategorySection[],
  collapsed: ReadonlySet<string> | Iterable<string> = [],
): BrowseRow[] {
  const collapsedSet = collapsed instanceof Set ? collapsed : new Set(collapsed);
  const rows: BrowseRow[] = [];
  for (const s of sections) {
    const isCollapsed = collapsedSet.has(s.key);
    rows.push({
      t: 'header',
      key: s.key,
      label: s.label,
      count: s.items.length,
      collapsed: isCollapsed,
    });
    if (isCollapsed) continue;
    for (const node of s.items) rows.push({ t: 'item', node });
  }
  return rows;
}

/** 当前列表实际出现的芯片类（按 CHIP_ORDER） */
export function presentChipCategories(items: FSNode[]): Category[] {
  const seen = new Set<Category>();
  for (const n of items) {
    const key = nodeCategoryKey(n);
    if (key !== 'folder') seen.add(key);
  }
  return CATEGORY_CHIP_ORDER.filter((c) => seen.has(c));
}

export function browseRowsFromItems(
  items: FSNode[],
  groupBy: boolean,
  collapsed: readonly string[] = [],
): BrowseRow[] {
  if (!groupBy) return items.map((node) => ({ t: 'item' as const, node }));
  return flattenGrouped(groupByCategory(items), collapsed);
}
