/**
 * UI perf baseline: synthetic large folders via __aurora, open/scroll metrics + screenshots.
 * Writes JSON under perf-out/<runId>/ (or AURORA_PERF_OUT).
 */
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT_ROOT = process.env.AURORA_PERF_OUT || path.join(process.cwd(), 'perf-out');
const FILES_CAP = Number(process.env.AURORA_PERF_FILES_CAP) || 50_000;

type Profile = {
  id: string;
  uiItems: number;
  previewImages: number;
};

const PROFILES: Profile[] = [
  { id: 'S-mem', uiItems: 5_000, previewImages: 24 },
  { id: 'S-files', uiItems: Math.min(20_000, FILES_CAP), previewImages: 8 },
  { id: 'S-search', uiItems: 2_000, previewImages: 4 },
  { id: 'S-preview', uiItems: 800, previewImages: 64 },
].filter((p) => {
  const raw = process.env.AURORA_PERF_PROFILES;
  if (!raw?.trim()) return true;
  return raw.split(',').map((s) => s.trim()).includes(p.id);
});

async function ensureRunDir() {
  const runId = process.env.AURORA_PERF_RUN_ID || new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(OUT_ROOT, runId);
  await fs.mkdir(path.join(runDir, 'screenshots'), { recursive: true });
  return { runId, runDir };
}

/** Inject N synthetic children under Desktop and navigate there. */
async function injectLargeFolder(page: Page, count: number, withImages: number) {
  return page.evaluate(
    ({ count, withImages }) => {
      const api = window.__aurora;
      if (!api) throw new Error('__aurora missing');
      const state = api.getState();
      const desktopId = 'desktop';
      const nodes = { ...state.nodes };
      const parent = { ...nodes[desktopId], childrenIds: [...(nodes[desktopId]?.childrenIds || [])] };
      if (!parent.id) throw new Error('desktop missing');
      const now = Date.now();
      const newIds: string[] = [];
      for (let i = 0; i < count; i++) {
        const id = `perf-${count}-${i}`;
        const isImg = i < withImages;
        // Prefix images with 0_ so default name-sort surfaces them first (S-preview)
        nodes[id] = {
          id,
          name: isImg ? `0_IMG_${String(i).padStart(5, '0')}.JPG` : `file_${i}_report.txt`,
          kind: 'file',
          parentId: desktopId,
          childrenIds: [],
          size: isImg ? 2_500_000 : 4096,
          createdAt: now,
          modifiedAt: now - i * 1000,
          accessedAt: now,
          tags: [],
          ext: isImg ? 'jpg' : 'txt',
          ...(isImg
            ? {
                imageUrl:
                  'data:image/svg+xml,' +
                  encodeURIComponent(
                    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect fill="#8fb3ff" width="100%" height="100%"/><text x="12" y="40" fill="#fff" font-size="18">IMG ${i}</text></svg>`,
                  ),
                thumbUrl:
                  'data:image/svg+xml,' +
                  encodeURIComponent(
                    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect fill="#6366f1" width="100%" height="100%"/></svg>`,
                  ),
              }
            : { content: `perf ${i}` }),
        };
        newIds.push(id);
      }
      parent.childrenIds = [...parent.childrenIds, ...newIds];
      nodes[desktopId] = parent;
      const tabs = state.tabs.map((t) =>
        t.id === state.activeTabId
          ? {
              ...t,
              view: 'grid' as const,
              history: [{ t: 'node' as const, id: desktopId }],
              hi: 0,
              search: '',
              selection: [],
            }
          : t,
      );
      api.setState({ nodes, tabs, deepHits: null, deepSearching: false, folderRefreshing: false });
      return { injected: newIds.length, desktopId };
    },
    { count, withImages },
  );
}

async function measureOpenAndScroll(page: Page) {
  return page.evaluate(async () => {
    const wrap = document.querySelector('[data-testid="grid-scroll"]') as HTMLElement | null;
    if (!wrap) throw new Error('grid-scroll missing');

    const t0 = performance.now();
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const firstItem = document.querySelector('[data-testid="grid-scroll"] [data-item]');
    const folderOpenMs = Math.round(performance.now() - t0);
    const firstVisible = !!firstItem;

    const collectLongtasks = async (ms: number, stepPx: number, everyFrames: number) => {
      const longtasks: number[] = [];
      let obs: PerformanceObserver | null = null;
      try {
        obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.duration > 50) longtasks.push(Math.round(e.duration));
          }
        });
        // buffered:false — avoid leaking prior-phase longtasks into the next sample
        obs.observe({ type: 'longtask', buffered: false } as PerformanceObserverInit);
      } catch {
        /* longtask may be unavailable */
      }
      // let prior work settle so it isn't attributed to this phase
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const start = performance.now();
      let frame = 0;
      while (performance.now() - start < ms) {
        frame += 1;
        if (frame % everyFrames === 0) {
          wrap.scrollTop += stepPx;
          if (wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 4) wrap.scrollTop = 0;
        }
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
      }
      obs?.disconnect();
      return longtasks;
    };

    // Fling: every frame +180px (stress). Paced: ~1 row / 2 frames (closer to wheel/trackpad).
    const fling = await collectLongtasks(1000, 180, 1);
    const paced = await collectLongtasks(2000, 120, 2);

    return {
      folder_open_ms: folderOpenMs,
      first_visible: firstVisible,
      scroll_ms: 3000,
      /** @deprecated prefer paced_*; kept for trend vs older runs */
      longtasks_over_50ms: paced.length,
      longtask_durations_ms: paced.slice(0, 40),
      fling_longtasks_over_50ms: fling.length,
      fling_longtask_durations_ms: fling.slice(0, 40),
      paced_longtasks_over_50ms: paced.length,
      paced_longtask_durations_ms: paced.slice(0, 40),
      item_dom_count: document.querySelectorAll('[data-testid="grid-scroll"] [data-item]').length,
      scrollHeight: wrap.scrollHeight,
    };
  });
}

test.describe.configure({ mode: 'serial' });

test.describe('perf baseline UI', () => {
  let runDir = '';
  let runId = '';

  test.beforeAll(async () => {
    const r = await ensureRunDir();
    runDir = r.runDir;
    runId = r.runId;
  });

  for (const profile of PROFILES) {
    test(`${profile.id} open + scroll + screenshot`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.goto('/');
      await expect(page.getByRole('button', { name: '桌面' }).first()).toBeVisible({ timeout: 20_000 });

      // Force grid
      await page.keyboard.press('Control+1');
      await page.getByRole('button', { name: '桌面' }).first().click();

      const injected = await injectLargeFolder(page, profile.uiItems, profile.previewImages);
      expect(injected.injected).toBe(profile.uiItems);

      await expect(page.getByTestId('grid-scroll')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-testid="grid-scroll"] [data-item]').first()).toBeVisible({
        timeout: 30_000,
      });

      const metrics = await measureOpenAndScroll(page);

      const shotPath = path.join(runDir, 'screenshots', `${profile.id}-grid.png`);
      await page.getByTestId('grid-scroll').screenshot({ path: shotPath });

      // Virtualization DOM caps: list / columns / gallery must not mount N items
      const virtDom: Record<string, number> = {};
      await page.keyboard.press('Control+2');
      await expect(page.getByTestId('list-scroll')).toBeVisible({ timeout: 10_000 });
      virtDom.list = await page.locator('[data-testid="list-scroll"] [data-item]').count();
      await page.keyboard.press('Control+3');
      await expect(page.getByTestId('column-scroll').first()).toBeVisible({ timeout: 10_000 });
      virtDom.columns = await page.locator('[data-testid="column-scroll"] [data-item]').count();
      await page.keyboard.press('Control+4');
      await expect(page.getByTestId('gallery-strip')).toBeVisible({ timeout: 10_000 });
      virtDom.gallery = await page.locator('[data-testid="gallery-strip"] [data-item]').count();
      await page.keyboard.press('Control+1');
      await expect(page.getByTestId('grid-scroll')).toBeVisible({ timeout: 10_000 });
      virtDom.grid = await page.locator('[data-testid="grid-scroll"] [data-item]').count();

      const virtCap = Math.max(120, Math.ceil(profile.uiItems * 0.08));
      const virtWarns: string[] = [];
      for (const [view, n] of Object.entries(virtDom)) {
        if (n > virtCap) virtWarns.push(`${view}_dom_${n}_gt_${virtCap}`);
        if (n >= profile.uiItems) virtWarns.push(`${view}_not_virtualized`);
      }

      let previewMs: number | null = null;
      if (profile.id === 'S-preview') {
        const t0 = Date.now();
        // Virtualized DOM may not contain image cells; open Quick Look via store
        const opened = await page.evaluate(() => {
          const api = window.__aurora;
          if (!api) return null;
          const { nodes } = api.getState();
          const img = Object.values(nodes).find(
            (n) => n.kind === 'file' && n.name?.startsWith('0_IMG_') && n.imageUrl,
          );
          if (!img) return null;
          api.setState({ quickLookId: img.id });
          return img.id;
        });
        expect(opened).toBeTruthy();
        await expect(page.getByRole('button', { name: '打开' }).first()).toBeVisible({ timeout: 8_000 });
        await page.waitForTimeout(400);
        previewMs = Date.now() - t0;
        await page.screenshot({
          path: path.join(runDir, 'screenshots', `${profile.id}-quicklook.png`),
          fullPage: false,
        });
        await page.evaluate(() => window.__aurora?.setState({ quickLookId: null }));
      }

      const payload = {
        kind: 'aurora-perf-ui',
        runId,
        profile: profile.id,
        fixture: { uiItems: profile.uiItems, previewImages: profile.previewImages },
        metrics: {
          ...metrics,
          preview_open_ms: previewMs,
          virt_dom: virtDom,
          virt_cap: virtCap,
        },
        screenshots: [
          `${profile.id}-grid.png`,
          ...(profile.id === 'S-preview' ? [`${profile.id}-quicklook.png`] : []),
        ],
        warn: [] as string[],
      };
      if (metrics.folder_open_ms > 800) payload.warn.push('folder_open_ms_gt_800');
      // Gate on paced (realistic) scroll; fling remains diagnostic only
      if ((metrics.paced_longtasks_over_50ms ?? metrics.longtasks_over_50ms) > 2) {
        payload.warn.push('paced_scroll_longtasks_gt_2');
      }
      if ((metrics.fling_longtasks_over_50ms ?? 0) > 6) {
        payload.warn.push('fling_scroll_longtasks_gt_6');
      }
      payload.warn.push(...virtWarns);

      await fs.writeFile(
        path.join(runDir, `${profile.id}.ui.json`),
        JSON.stringify(payload, null, 2),
        'utf8',
      );

      // Soft gates: attach warnings but do not fail v1 (evidence first)
      test.info().annotations.push({
        type: 'perf',
        description: JSON.stringify(payload.metrics),
      });
    });
  }

  test('write UI summary', async () => {
    const files = await fs.readdir(runDir);
    const uiFiles = files.filter((f) => f.endsWith('.ui.json'));
    const profiles = [];
    for (const f of uiFiles) {
      profiles.push(JSON.parse(await fs.readFile(path.join(runDir, f), 'utf8')));
    }
    const summary = {
      kind: 'aurora-perf-ui-summary',
      runId,
      at: new Date().toISOString(),
      profiles,
      warns: profiles.flatMap((p: { profile: string; warn: string[] }) =>
        p.warn.map((w) => `${p.profile}:${w}`),
      ),
    };
    await fs.writeFile(path.join(runDir, 'summary.ui.json'), JSON.stringify(summary, null, 2), 'utf8');
    await fs.writeFile(
      path.join(OUT_ROOT, 'latest-ui.json'),
      JSON.stringify({ runId, dir: runDir }, null, 2),
      'utf8',
    );
  });
});
