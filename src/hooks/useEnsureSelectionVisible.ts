import { useEffect, useRef, type RefObject } from 'react';

/**
 * When the anchor selection changes, keep it in the scrollport.
 * Uses DOM scrollIntoView when the row/cell is mounted; otherwise index geometry.
 */
export function useEnsureSelectionVisible(
  scrollRef: RefObject<HTMLElement | null>,
  orderedIds: string[],
  selection: string[],
  scrollToIndex: (el: HTMLElement, index: number) => void,
) {
  const prevAnchor = useRef<string | null>(null);
  const idsRef = useRef(orderedIds);
  idsRef.current = orderedIds;
  const scrollToRef = useRef(scrollToIndex);
  scrollToRef.current = scrollToIndex;

  useEffect(() => {
    const anchor = selection[selection.length - 1] ?? null;
    if (!anchor || anchor === prevAnchor.current) return;
    prevAnchor.current = anchor;
    const el = scrollRef.current;
    if (!el) return;
    const idx = idsRef.current.indexOf(anchor);
    if (idx < 0) return;

    const mounted = el.querySelector(`[data-item="${CSS.escape(anchor)}"]`) as HTMLElement | null;
    if (mounted) {
      mounted.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }
    scrollToRef.current(el, idx);
  }, [selection, scrollRef]);
}

export function listScrollToIndex(rowHeight: number) {
  return (el: HTMLElement, index: number) => {
    const rh = Math.max(1, rowHeight);
    const top = index * rh - el.clientHeight / 2 + rh / 2;
    el.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  };
}
