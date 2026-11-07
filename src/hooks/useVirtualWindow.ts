import { useEffect, useRef, useState, type RefObject } from 'react';

export type VirtualWindow = {
  start: number;
  end: number;
  offsetY: number;
  totalHeight: number;
};

/** Pure: list/column window from scroll metrics (unit-testable). */
export function listWindowFromScroll(
  scrollTop: number,
  viewportH: number,
  count: number,
  rowHeight: number,
  overscan: number,
): VirtualWindow {
  const rh = Math.max(1, rowHeight);
  const start = Math.max(0, Math.floor(scrollTop / rh) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + viewportH) / rh) + overscan);
  return {
    start,
    end,
    offsetY: start * rh,
    totalHeight: count * rh,
  };
}

export type HorizontalWindow = {
  start: number;
  end: number;
  offsetX: number;
  totalWidth: number;
};

/** Pure: gallery strip window from horizontal scroll. */
export function horizontalWindowFromScroll(
  scrollLeft: number,
  viewportW: number,
  count: number,
  itemWidth: number,
  overscan: number,
): HorizontalWindow {
  const iw = Math.max(1, itemWidth);
  const start = Math.max(0, Math.floor(scrollLeft / iw) - overscan);
  const end = Math.min(count, Math.ceil((scrollLeft + viewportW) / iw) + overscan);
  return {
    start,
    end,
    offsetX: start * iw,
    totalWidth: count * iw,
  };
}

/**
 * Vertical window virtualization: at most one React commit per frame,
 * and only when start/end/totalHeight change (same-row pixel scrolls skip setState).
 */
export function useVirtualWindow(
  scrollRef: RefObject<HTMLElement | null>,
  count: number,
  rowHeight: number,
  overscan = 10,
): VirtualWindow {
  const [win, setWin] = useState<VirtualWindow>(() =>
    listWindowFromScroll(0, 640, count, rowHeight, overscan),
  );
  const latest = useRef(win);
  latest.current = win;
  const countRef = useRef(count);
  countRef.current = count;
  const rowRef = useRef(rowHeight);
  rowRef.current = rowHeight;
  const overscanRef = useRef(overscan);
  overscanRef.current = overscan;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let raf = 0;
    const flush = () => {
      raf = 0;
      const next = listWindowFromScroll(
        el.scrollTop,
        el.clientHeight || 640,
        countRef.current,
        rowRef.current,
        overscanRef.current,
      );
      const prev = latest.current;
      if (
        prev.start === next.start &&
        prev.end === next.end &&
        prev.totalHeight === next.totalHeight
      ) {
        return;
      }
      latest.current = next;
      setWin(next);
    };

    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(flush);
    };

    flush();
    el.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', schedule);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollRef, count, rowHeight, overscan]);

  return win;
}

/**
 * Horizontal window for gallery strip — same skip-same-window semantics.
 */
export function useHorizontalWindow(
  scrollRef: RefObject<HTMLElement | null>,
  count: number,
  itemWidth: number,
  overscan = 4,
): HorizontalWindow {
  const [win, setWin] = useState<HorizontalWindow>(() =>
    horizontalWindowFromScroll(0, 800, count, itemWidth, overscan),
  );
  const latest = useRef(win);
  latest.current = win;
  const countRef = useRef(count);
  countRef.current = count;
  const itemRef = useRef(itemWidth);
  itemRef.current = itemWidth;
  const overscanRef = useRef(overscan);
  overscanRef.current = overscan;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let raf = 0;
    const flush = () => {
      raf = 0;
      const next = horizontalWindowFromScroll(
        el.scrollLeft,
        el.clientWidth || 800,
        countRef.current,
        itemRef.current,
        overscanRef.current,
      );
      const prev = latest.current;
      if (
        prev.start === next.start &&
        prev.end === next.end &&
        prev.totalWidth === next.totalWidth
      ) {
        return;
      }
      latest.current = next;
      setWin(next);
    };

    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(flush);
    };

    flush();
    el.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', schedule);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollRef, count, itemWidth, overscan]);

  return win;
}
