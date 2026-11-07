import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  computeGridMetrics,
  visibleIndexRange,
  type GridMetrics,
} from '@/lib/gridLayout';

export type ViewportBox = { w: number; h: number; scrollTop: number };

/**
 * Coalesce scroll/resize into at most one React state update per animation frame.
 * Skips setState when w/h/scrollTop are unchanged.
 */
export function useRafViewport(
  scrollRef: RefObject<HTMLElement | null>,
  initial: ViewportBox = { w: 800, h: 600, scrollTop: 0 },
): ViewportBox {
  const [viewport, setViewport] = useState<ViewportBox>(initial);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let raf = 0;
    const read = (): ViewportBox => ({
      w: el.clientWidth || initial.w,
      h: el.clientHeight || initial.h,
      scrollTop: el.scrollTop,
    });

    const flush = () => {
      raf = 0;
      const next = read();
      setViewport((prev) =>
        prev.w === next.w && prev.h === next.h && prev.scrollTop === next.scrollTop ? prev : next,
      );
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef]);

  return viewport;
}

export type GridWindow = {
  metrics: GridMetrics;
  range: { start: number; end: number };
  scrollTop: number;
  w: number;
  h: number;
};

/**
 * Only commits React state when the visible index window (or metrics/cols) changes.
 * Small scroll deltas inside the same rows do not re-render the grid.
 */
export function useGridWindow(
  scrollRef: RefObject<HTMLElement | null>,
  itemCount: number,
  iconSize: number,
  overscanRows = 1,
): GridWindow {
  const [win, setWin] = useState<GridWindow>(() => {
    const metrics = computeGridMetrics(800, iconSize);
    return {
      metrics,
      range: visibleIndexRange(0, 600, itemCount, metrics, overscanRows),
      scrollTop: 0,
      w: 800,
      h: 600,
    };
  });
  const latest = useRef(win);
  latest.current = win;
  const iconRef = useRef(iconSize);
  iconRef.current = iconSize;
  const countRef = useRef(itemCount);
  countRef.current = itemCount;
  const overscanRef = useRef(overscanRows);
  overscanRef.current = overscanRows;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let raf = 0;
    const flush = () => {
      raf = 0;
      const w = el.clientWidth || 800;
      const h = el.clientHeight || 600;
      const scrollTop = el.scrollTop;
      const metrics = computeGridMetrics(w, iconRef.current);
      const range = visibleIndexRange(
        scrollTop,
        h,
        countRef.current,
        metrics,
        overscanRef.current,
      );
      const prev = latest.current;
      if (
        prev.range.start === range.start &&
        prev.range.end === range.end &&
        prev.metrics.cols === metrics.cols &&
        prev.metrics.cellW === metrics.cellW &&
        prev.metrics.cellH === metrics.cellH &&
        prev.w === w &&
        prev.h === h
      ) {
        return;
      }
      const next: GridWindow = { metrics, range, scrollTop, w, h };
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
  }, [scrollRef, itemCount, iconSize, overscanRows]);

  return win;
}
