/** 引用计数 + 隐藏防抖：并发 refresh 不会被先结束的任务误关 */

export interface RefCountGate {
  enter: () => void;
  leave: () => void;
  readonly count: number;
  readonly active: boolean;
  reset: () => void;
}

export function createDebouncedRefCount(opts: {
  onChange: (active: boolean) => void;
  /** 全部结束后延迟再关，避免连点闪烁 */
  hideDelayMs?: number;
}): RefCountGate {
  let count = 0;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let active = false;
  const hideDelayMs = opts.hideDelayMs ?? 140;

  const setActive = (v: boolean) => {
    if (active === v) return;
    active = v;
    opts.onChange(v);
  };

  return {
    enter() {
      count += 1;
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      setActive(true);
    },
    leave() {
      count = Math.max(0, count - 1);
      if (count > 0) return;
      hideTimer = setTimeout(() => {
        hideTimer = null;
        if (count === 0) setActive(false);
      }, hideDelayMs);
    },
    get count() {
      return count;
    },
    get active() {
      return active;
    },
    reset() {
      count = 0;
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      setActive(false);
    },
  };
}

/** 深搜代数：递增后旧 Promise 结果应丢弃 */
export function bumpGen(prev: number): number {
  return (prev + 1) >>> 0;
}

export function isCurrentGen(mine: number, latest: number): boolean {
  return mine === latest;
}

/** 画廊步进：优先只在文件间移动 */
export function galleryStepPool<T extends { id: string; kind: string }>(
  items: T[],
): T[] {
  const files = items.filter((n) => n.kind === 'file');
  return files.length ? files : items;
}

export function stepInPool(ids: string[], currentId: string | undefined, delta: number): string | null {
  if (!ids.length) return null;
  const i = currentId ? ids.indexOf(currentId) : -1;
  const from = i < 0 ? 0 : i;
  const next = Math.min(ids.length - 1, Math.max(0, from + delta));
  return ids[next] ?? null;
}
