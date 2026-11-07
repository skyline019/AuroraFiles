import { describe, expect, it } from 'vitest';
import { enqueueThumbJob, thumbBudgetStats } from './thumbBudget';

describe('thumbBudget', () => {
  it('caps concurrent jobs at 4', async () => {
    let started = 0;
    const release: Array<() => void> = [];
    const jobs = Array.from({ length: 8 }, () =>
      enqueueThumbJob(
        () =>
          new Promise<string | null>((resolve) => {
            started += 1;
            release.push(() => resolve('ok'));
          }),
      ),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toBe(4);
    expect(thumbBudgetStats().inflight).toBe(4);

    // Release first wave → next 4 start
    const first = release.splice(0, release.length);
    first.forEach((fn) => fn());
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toBe(8);

    release.splice(0, release.length).forEach((fn) => fn());
    await Promise.all(jobs.map((j) => j.promise));
    expect(thumbBudgetStats().inflight).toBe(0);
  });

  it('cancel prevents resolve after dequeue', async () => {
    const { promise, cancel } = enqueueThumbJob(
      async () => {
        await new Promise((r) => setTimeout(r, 30));
        return 'late';
      },
    );
    cancel();
    expect(await promise).toBeNull();
  });
});
