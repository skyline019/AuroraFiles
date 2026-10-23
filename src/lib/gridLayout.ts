/** 网格布局纯函数：虚拟化与框选均依赖几何，不依赖 DOM */

export interface GridMetrics {
  cols: number;
  cellW: number;
  cellH: number;
  padding: number;
  gapX: number;
  gapY: number;
  contentWidth: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function computeGridMetrics(
  containerWidth: number,
  iconSize: number,
  opts?: { padding?: number; gapX?: number; gapY?: number; nameBlock?: number },
): GridMetrics {
  const padding = opts?.padding ?? 16;
  const gapX = opts?.gapX ?? 4;
  const gapY = opts?.gapY ?? 8;
  const nameBlock = opts?.nameBlock ?? 36;
  const cellW = iconSize + 34;
  const cellH = iconSize + 12 + nameBlock;
  const inner = Math.max(cellW, containerWidth - padding * 2);
  const cols = Math.max(1, Math.floor((inner + gapX) / (cellW + gapX)));
  const contentWidth = cols * cellW + (cols - 1) * gapX + padding * 2;
  return { cols, cellW, cellH, padding, gapX, gapY, contentWidth };
}

export function cellRect(index: number, m: GridMetrics): Rect {
  const col = index % m.cols;
  const row = Math.floor(index / m.cols);
  return {
    x: m.padding + col * (m.cellW + m.gapX),
    y: m.padding + row * (m.cellH + m.gapY),
    w: m.cellW,
    h: m.cellH,
  };
}

export function totalGridHeight(count: number, m: GridMetrics): number {
  if (count <= 0) return m.padding * 2;
  const rows = Math.ceil(count / m.cols);
  return m.padding * 2 + rows * m.cellH + Math.max(0, rows - 1) * m.gapY;
}

export function visibleIndexRange(
  scrollTop: number,
  viewportH: number,
  count: number,
  m: GridMetrics,
  overscanRows = 2,
): { start: number; end: number } {
  if (count <= 0) return { start: 0, end: 0 };
  const rowH = m.cellH + m.gapY;
  const firstRow = Math.max(0, Math.floor((scrollTop - m.padding) / rowH) - overscanRows);
  const lastRow = Math.ceil((scrollTop + viewportH - m.padding) / rowH) + overscanRows;
  const start = Math.min(count, firstRow * m.cols);
  const end = Math.min(count, (lastRow + 1) * m.cols);
  return { start: Math.max(0, start), end: Math.max(start, end) };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** 框选：用布局几何命中，不依赖是否已挂载 DOM */
export function hitTestMarquee(
  count: number,
  ids: string[],
  marquee: Rect,
  m: GridMetrics,
): string[] {
  const hit: string[] = [];
  const n = Math.min(count, ids.length);
  for (let i = 0; i < n; i++) {
    if (rectsIntersect(cellRect(i, m), marquee)) hit.push(ids[i]);
  }
  return hit;
}
