/** Limit concurrent thumb resolves so gallery/grid scroll does not stampede ffmpeg/IPC. */

const MAX_INFLIGHT = 4;

type Job = {
  run: () => Promise<void>;
};

let inflight = 0;
const queue: Job[] = [];

function pump() {
  while (inflight < MAX_INFLIGHT && queue.length) {
    const job = queue.shift()!;
    inflight += 1;
    void job.run().finally(() => {
      inflight -= 1;
      pump();
    });
  }
}

/** Schedule work with a concurrency cap. Returns a cancel handle. */
export function enqueueThumbJob(fn: () => Promise<string | null>): {
  promise: Promise<string | null>;
  cancel: () => void;
} {
  let cancelled = false;
  let resolve!: (v: string | null) => void;
  const promise = new Promise<string | null>((r) => {
    resolve = r;
  });

  const job: Job = {
    run: async () => {
      if (cancelled) {
        resolve(null);
        return;
      }
      try {
        const v = await fn();
        resolve(cancelled ? null : v);
      } catch {
        resolve(null);
      }
    },
  };
  queue.push(job);
  pump();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      const i = queue.indexOf(job);
      if (i >= 0) {
        queue.splice(i, 1);
        resolve(null);
      }
    },
  };
}

export function thumbBudgetStats() {
  return { inflight, queued: queue.length, max: MAX_INFLIGHT };
}
