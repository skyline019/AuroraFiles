/**
 * Visual + video acceptance for virtualized views.
 * Scrolls grid/list/columns/gallery, screenshots each state, records video.
 *
 *   AURORA_PERF_RUN_ID=ui-visual-1 npm run test:perf-ui-visual
 */
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT_ROOT = process.env.AURORA_PERF_OUT || path.join(process.cwd(), 'perf-out');
const ITEM_COUNT = Number(process.env.AURORA_VISUAL_ITEMS) || 2_500;
const PREVIEW_IMAGES = Number(process.env.AURORA_VISUAL_IMAGES) || 48;

test.use({
  video: { mode: 'on', size: { width: 1280, height: 800 } },
  viewport: { width: 1280, height: 800 },
});

async function ensureRunDir() {
  const runId = process.env.AURORA_PERF_RUN_ID || `ui-visual-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const runDir = path.join(OUT_ROOT, runId);
  await fs.mkdir(path.join(runDir, 'screenshots'), { recursive: true });
  await fs.mkdir(path.join(runDir, 'video'), { recursive: true });
  return { runId, runDir };
}

async function injectFolder(page: Page, count: number, withImages: number) {
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
      const prefix = `vis-${count}-`;
      // Drop prior fixture ids so re-inject is idempotent after softRefresh
      parent.childrenIds = parent.childrenIds.filter((id) => !String(id).startsWith(prefix));
      for (const id of Object.keys(nodes)) {
        if (id.startsWith(prefix)) delete nodes[id];
      }
      for (let i = 0; i < count; i++) {
        const id = `${prefix}${i}`;
        const isImg = i < withImages;
        nodes[id] = {
          id,
          name: isImg ? `0_IMG_${String(i).padStart(4, '0')}.JPG` : `file_${i}_doc.txt`,
          kind: 'file',
          parentId: desktopId,
          childrenIds: [],
          size: isImg ? 1_200_000 : 2048,
          createdAt: now,
          modifiedAt: now - i * 500,
          accessedAt: now,
          tags: i % 17 === 0 ? ['blue'] : [],
          ext: isImg ? 'jpg' : 'txt',
          ...(isImg
            ? {
                imageUrl:
                  'data:image/svg+xml,' +
                  encodeURIComponent(
                    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect fill="#6ea8fe" width="100%" height="100%"/><text x="16" y="40" fill="#fff" font-size="22">IMG ${i}</text></svg>`,
                  ),
                thumbUrl:
                  'data:image/svg+xml,' +
                  encodeURIComponent(
                    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect fill="#4c6ef5" width="100%" height="100%"/></svg>`,
                  ),
              }
            : { content: `vis ${i}` }),
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
      return { injected: newIds.length, deskKids: parent.childrenIds.length };
    },
    { count, withImages },
  );
}

async function scrollMain(page: Page, testId: string, steps: number, delta: number) {
  const el = page.getByTestId(testId).first();
  const horizontal = testId === 'gallery-strip';
  const metrics = await el.evaluate(
    (node, { steps, delta, horizontal }) => {
      const target = node as HTMLElement;
      const before = { top: target.scrollTop, left: target.scrollLeft, sh: target.scrollHeight, ch: target.clientHeight };
      for (let i = 0; i < steps; i++) {
        if (horizontal) target.scrollLeft += delta;
        else target.scrollTop += delta;
      }
      // Nudge listeners (passive scroll may need a tick)
      target.dispatchEvent(new Event('scroll'));
      return {
        before,
        after: { top: target.scrollTop, left: target.scrollLeft, sh: target.scrollHeight, ch: target.clientHeight },
      };
    },
    { steps, delta, horizontal },
  );
  await page.waitForTimeout(120);
  return metrics;
}

async function shot(page: Page, runDir: string, name: string) {
  const p = path.join(runDir, 'screenshots', `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  return p;
}

async function countItems(page: Page, testId: string) {
  return page.locator(`[data-testid="${testId}"] [data-item]`).count();
}

test.describe('UI visual + video check', () => {
  test('four views scroll · screenshot · assert virt caps', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const { runId, runDir } = await ensureRunDir();
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    await expect(page.getByRole('button', { name: '桌面' }).first()).toBeVisible({ timeout: 20_000 });
    // Stay on demo graph — real-fs hydrateFolder races wipe synthetic childrenIds
    await page.evaluate(() => {
      const api = window.__aurora;
      if (!api) throw new Error('__aurora missing');
      api.getState().enterDemo?.();
      const st = api.getState();
      // Neuter refresh for the rest of this page session
      api.setState({
        fsMode: 'demo',
        refreshFolder: async () => undefined,
      } as never);
      void st;
    });
    await page.keyboard.press('Control+1');
    await page.getByRole('button', { name: '桌面' }).first().click();

    const inj = await injectFolder(page, ITEM_COUNT, PREVIEW_IMAGES);
    expect(inj.injected).toBe(ITEM_COUNT);

    // Re-assert fixture still on Desktop (real-fs softRefresh can clobber children)
    async function ensureFixture(view: 'grid' | 'list' | 'columns' | 'gallery') {
      const kids = await page.evaluate(() => window.__aurora?.getState().nodes.desktop?.childrenIds?.length ?? 0);
      if (kids < ITEM_COUNT) {
        await injectFolder(page, ITEM_COUNT, PREVIEW_IMAGES);
      }
      await page.evaluate((view) => {
        const api = window.__aurora;
        if (!api) throw new Error('__aurora missing');
        const st = api.getState();
        const img = Object.values(st.nodes).find(
          (n) => n.kind === 'file' && n.name?.startsWith('0_IMG_') && (n.imageUrl || n.thumbUrl),
        );
        const tabs = st.tabs.map((t) =>
          t.id === st.activeTabId
            ? {
                ...t,
                view,
                galleryFilesOnly: true,
                history: [{ t: 'node' as const, id: 'desktop' }],
                hi: 0,
                search: '',
                selection: img ? [img.id] : [],
              }
            : t,
        );
        api.setState({ tabs, folderRefreshing: false });
      }, view);
    }

    const views: { key: string; view: 'grid' | 'list' | 'columns' | 'gallery'; testId: string; scrollDelta: number }[] = [
      { key: 'grid', view: 'grid', testId: 'grid-scroll', scrollDelta: 480 },
      { key: 'list', view: 'list', testId: 'list-scroll', scrollDelta: 640 },
      { key: 'columns', view: 'columns', testId: 'column-scroll', scrollDelta: 600 },
      { key: 'gallery', view: 'gallery', testId: 'gallery-strip', scrollDelta: 400 },
    ];

    const report: {
      view: string;
      domBefore: number;
      domAfter: number;
      shots: string[];
      firstBefore?: string | null;
      firstAfter?: string | null;
    }[] = [];
    const warn: string[] = [];
    const virtCap = Math.max(80, Math.ceil(ITEM_COUNT * 0.1));

    for (const v of views) {
      await ensureFixture(v.view);
      await expect(page.getByTestId(v.testId).first()).toBeVisible({ timeout: 12_000 });
      if (v.key === 'columns') {
        const colMeta = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="column-scroll"]') as HTMLElement | null;
          return {
            colCount: document.querySelectorAll('[data-testid="column-scroll"]').length,
            sh: el?.scrollHeight ?? 0,
            kids: Number(el?.getAttribute('data-kids') ?? 0),
          };
        });
        if (colMeta.colCount !== 1) warn.push(`columns_testid_count_${colMeta.colCount}`);
        if (colMeta.kids < ITEM_COUNT || colMeta.sh < ITEM_COUNT) {
          warn.push(`columns_short_kids_${colMeta.kids}_sh_${colMeta.sh}`);
        }
      }
      await expect(page.locator(`[data-testid="${v.testId}"] [data-item]`).first()).toBeVisible({
        timeout: 12_000,
      });
      if (v.key === 'gallery') {
        await expect(page.getByTestId('gallery-hero-img')).toBeVisible({ timeout: 8_000 });
      }
      if (v.key === 'grid') {
        const painted = await page.locator('[data-testid="grid-scroll"] img[src^="data:image"]').count();
        if (painted < 8) warn.push(`grid_thumbs_painted_${painted}`);
      }
      await page.waitForTimeout(200);

      const firstNameBefore = await page
        .locator(`[data-testid="${v.testId}"] [data-item]`)
        .first()
        .getAttribute('data-item');
      const before = await countItems(page, v.testId);
      const shotTop = await shot(page, runDir, `${v.key}-top`);
      const scrollMeta = await scrollMain(page, v.testId, 8, v.scrollDelta);
      await page.waitForTimeout(250);
      const after = await countItems(page, v.testId);
      const firstNameAfter = await page
        .locator(`[data-testid="${v.testId}"] [data-item]`)
        .first()
        .getAttribute('data-item');

      if (v.key === 'gallery') {
        // Lock id before click — strip recycle can rewrite the nth(4) node afterward
        const mid = page.locator('[data-testid="gallery-strip"] [data-item]').nth(4);
        const midId = await mid.getAttribute('data-item');
        const midName = await page.evaluate(
          (id) => window.__aurora?.getState().nodes[id!]?.name ?? null,
          midId,
        );
        await mid.click();
        await expect(page.getByTestId('gallery-hero-img')).toHaveAttribute('alt', midName || '', {
          timeout: 3_000,
        });
      }

      const shotMid = await shot(page, runDir, `${v.key}-scrolled`);

      if (before > virtCap) warn.push(`${v.key}_dom_before_${before}_gt_${virtCap}`);
      if (after > virtCap) warn.push(`${v.key}_dom_after_${after}_gt_${virtCap}`);
      if (before >= ITEM_COUNT) warn.push(`${v.key}_not_virtualized`);
      if (before < 1) warn.push(`${v.key}_empty_dom`);
      // After heavy scroll, first visible slot should usually change (except tiny lists)
      const scrollRange = (scrollMeta?.after?.sh ?? 0) - (scrollMeta?.after?.ch ?? 0);
      if (
        firstNameBefore &&
        firstNameAfter &&
        firstNameBefore === firstNameAfter &&
        scrollRange > 800 &&
        (v.key === 'list' || v.key === 'columns' || v.key === 'grid')
      ) {
        const moved = (scrollMeta?.after?.top ?? 0) > (scrollMeta?.before?.top ?? 0) + 40;
        warn.push(
          moved
            ? `${v.key}_virt_window_stuck`
            : `${v.key}_scroll_window_stuck:${JSON.stringify(scrollMeta)}`,
        );
      }
      if (v.key === 'columns' && (scrollMeta?.after?.sh ?? 0) < ITEM_COUNT) {
        warn.push(`columns_content_too_short_sh_${scrollMeta?.after?.sh}`);
      }

      report.push({
        view: v.key,
        domBefore: before,
        domAfter: after,
        shots: [path.basename(shotTop), path.basename(shotMid)],
        firstBefore: firstNameBefore,
        firstAfter: firstNameAfter,
        scrollMeta,
      });
    }

    // Quick Look frame
    await page.evaluate(() => {
      const api = window.__aurora;
      if (!api) return;
      const st = api.getState();
      const tabs = st.tabs.map((t) => (t.id === st.activeTabId ? { ...t, view: 'grid' as const } : t));
      api.setState({ tabs });
      const img = Object.values(st.nodes).find(
        (n) => n.kind === 'file' && n.name?.startsWith('0_IMG_') && (n.imageUrl || n.thumbUrl),
      );
      if (img) api.setState({ quickLookId: img.id });
    });
    await page.waitForTimeout(400);
    await shot(page, runDir, 'quicklook');
    await page.evaluate(() => window.__aurora?.setState({ quickLookId: null }));

    if (consoleErrors.length) {
      warn.push(`console_errors_${consoleErrors.length}`);
    }

    const summary = {
      kind: 'aurora-ui-visual',
      runId,
      at: new Date().toISOString(),
      fixture: { items: ITEM_COUNT, images: PREVIEW_IMAGES },
      virtCap,
      views: report,
      consoleErrors: consoleErrors.slice(0, 20),
      warn,
      ok: warn.length === 0,
      video: 'video/session.webm',
    };
    await fs.writeFile(path.join(runDir, 'summary.visual.json'), JSON.stringify(summary, null, 2));
    await fs.writeFile(path.join(OUT_ROOT, 'latest-ui-visual.json'), JSON.stringify(summary, null, 2));

    testInfo.annotations.push({ type: 'visual', description: JSON.stringify(summary) });
    expect(warn, `visual warns: ${warn.join(', ')}`).toEqual([]);
  });

  test.afterEach(async ({ page }, testInfo) => {
    const runId = process.env.AURORA_PERF_RUN_ID;
    if (!runId) return;
    const destDir = path.join(OUT_ROOT, runId, 'video');
    await fs.mkdir(destDir, { recursive: true });
    const dest = path.join(destDir, 'session.webm');
    const video = page.video();
    if (!video) return;
    // Don't block teardown forever if encoder is stuck
    const save = (async () => {
      try {
        await video.saveAs(dest);
      } catch {
        const src = await video.path().catch(() => null);
        if (src) await fs.copyFile(src, dest);
      }
    })();
    await Promise.race([
      save,
      new Promise((r) => setTimeout(r, 5_000)),
    ]);
    testInfo.annotations.push({
      type: 'video',
      description: (await fs.stat(dest).then(() => dest).catch(() => 'missing')),
    });
  });
});
