import { useEffect, useState, RefObject } from 'react';

/** 简单纵向窗口虚拟化：返回可见切片与占位高度 */
export function useVirtualWindow(
  scrollRef: RefObject<HTMLElement | null>,
  count: number,
  rowHeight: number,
  overscan = 10,
) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(640);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const ro = new ResizeObserver(() => setViewport(el.clientHeight || 640));
    setViewport(el.clientHeight || 640);
    el.addEventListener('scroll', onScroll, { passive: true });
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, [scrollRef]);

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  return {
    start,
    end,
    offsetY: start * rowHeight,
    totalHeight: count * rowHeight,
  };
}
