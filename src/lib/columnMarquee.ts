/** 分栏末列框选：固定行高几何命中 */

export const COLUMN_ROW_H = 30;
export const COLUMN_ROW_PAD_Y = 4; // py-1 ≈ 4px top

export function hitTestColumnMarquee(
  ids: string[],
  marquee: { x: number; y: number; w: number; h: number },
  rowH = COLUMN_ROW_H,
  padY = COLUMN_ROW_PAD_Y,
): string[] {
  if (!ids.length || marquee.w < 2 && marquee.h < 2) {
    // 仍允许极小拖动命中单行
    if (marquee.w < 1 && marquee.h < 1) return [];
  }
  const y0 = Math.min(marquee.y, marquee.y + marquee.h);
  const y1 = Math.max(marquee.y, marquee.y + marquee.h);
  const top = y0 - padY;
  const bottom = y1 - padY;
  const start = Math.max(0, Math.floor(top / rowH));
  const end = Math.min(ids.length - 1, Math.floor(Math.max(0, bottom - 0.01) / rowH));
  if (end < start) return [];
  return ids.slice(start, end + 1);
}
