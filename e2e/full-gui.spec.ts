/**
 * Full-chain GUI walkthrough with screenshots + session video.
 * Covers shells, views, overlays, clipboard, tags, search, index, dark mode.
 *
 *   AURORA_PERF_RUN_ID=gui-full-1 npm run test:e2e:full-gui
 */
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT_ROOT = process.env.AURORA_PERF_OUT || path.join(process.cwd(), 'perf-out');

test.use({
  video: { mode: 'on', size: { width: 1280, height: 800 } },
  viewport: { width: 1280, height: 800 },
});

async function ensureRunDir() {
  const runId = process.env.AURORA_PERF_RUN_ID || `gui-full-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const runDir = path.join(OUT_ROOT, runId);
  await fs.mkdir(path.join(runDir, 'screenshots'), { recursive: true });
  await fs.mkdir(path.join(runDir, 'video'), { recursive: true });
  return { runId, runDir };
}

async function shot(page: Page, runDir: string, name: string, steps: string[]) {
  const file = `${String(steps.length + 1).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: path.join(runDir, 'screenshots', file), fullPage: false });
  steps.push(file);
  return file;
}

async function lockDemo(page: Page) {
  await page.evaluate(() => {
    const api = window.__aurora;
    if (!api) throw new Error('__aurora missing');
    const st = api.getState();
    if (st.fsMode !== 'demo') st.enterDemo?.();
    api.setState({
      fsMode: 'demo',
      booting: false,
      folderRefreshing: false,
      deepSearching: false,
      toasts: [],
      refreshFolder: async () => undefined,
    } as never);
  });
}

async function pickDesktopFile(page: Page, nameIncludes?: string) {
  return page.evaluate((needle) => {
    const api = window.__aurora!;
    const st = api.getState();
    const desk = st.nodes.desktop;
    const kids = (desk?.childrenIds || [])
      .map((id) => st.nodes[id])
      .filter((n): n is NonNullable<typeof n> => !!n && n.kind === 'file' && !n.deleted);
    const hit = needle
      ? kids.find((n) => n.name.includes(needle))
      : kids[0];
    if (!hit) throw new Error(`no desktop file${needle ? `: ${needle}` : ''}`);
    const tabs = st.tabs.map((t) =>
      t.id === st.activeTabId
        ? {
            ...t,
            history: [{ t: 'node' as const, id: 'desktop' }],
            hi: 0,
            search: '',
            selection: [hit.id],
            view: 'grid' as const,
          }
        : t,
    );
    api.setState({ tabs, quickLookId: null, infoId: null, batchOpen: false, paletteOpen: false });
    return { id: hit.id, name: hit.name };
  }, nameIncludes || null);
}

test.describe('Full GUI chain · screenshots + video', () => {
  test('walk all major surfaces', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const { runId, runDir } = await ensureRunDir();
    const steps: string[] = [];
    const warn: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    await expect(page.getByRole('button', { name: '桌面' }).first()).toBeVisible({ timeout: 20_000 });
    await lockDemo(page);
    await page.getByRole('button', { name: '桌面' }).first().click();
    await shot(page, runDir, 'desktop-grid', steps);

    // —— Views ——
    for (const [chord, name, testId] of [
      ['Control+1', 'grid', 'grid-scroll'],
      ['Control+2', 'list', 'list-scroll'],
      ['Control+3', 'columns', 'column-scroll'],
      ['Control+4', 'gallery', 'gallery-strip'],
    ] as const) {
      await page.keyboard.press(chord);
      await expect(page.getByTestId(testId).first()).toBeVisible({ timeout: 10_000 });
      await shot(page, runDir, `view-${name}`, steps);
    }
    await page.keyboard.press('Control+1');

    // —— This PC ——
    await page.getByRole('button', { name: '此电脑' }).first().click();
    await expect(page.getByTestId('this-pc-view')).toBeVisible({ timeout: 8_000 });
    await shot(page, runDir, 'this-pc', steps);
    await page.getByRole('button', { name: '桌面' }).first().click();

    // —— Sidebar: tags / trash ——
    const tagBtn = page.getByRole('button', { name: /重要/ }).first();
    if (await tagBtn.count()) {
      await tagBtn.click();
      await page.waitForTimeout(200);
      await shot(page, runDir, 'tag-filter', steps);
    } else {
      warn.push('tag_button_missing');
    }
    await page.evaluate(() => window.__aurora!.getState().navigate({ t: 'node', id: 'sp-trash' }));
    await page.waitForTimeout(250);
    await shot(page, runDir, 'trash', steps);
    await page.evaluate(() => window.__aurora!.getState().navigate({ t: 'node', id: 'desktop' }));
    await page.waitForTimeout(150);

    // —— Tab chrome ——
    await page.keyboard.press('Alt+t');
    await expect(page.getByRole('button', { name: /关闭标签页/ })).toHaveCount(2, { timeout: 5_000 }).catch(() => {
      warn.push('tab_close_count');
    });
    await shot(page, runDir, 'multi-tab', steps);
    await page.keyboard.press('Alt+w');

    // —— Dark mode ——
    await page.getByRole('button', { name: /深色|浅色/ }).first().click();
    await page.waitForTimeout(250);
    await shot(page, runDir, 'dark-mode', steps);
    await page.getByRole('button', { name: /深色|浅色/ }).first().click();

    // —— Command palette ——
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('command-palette')).toBeVisible({ timeout: 8_000 });
    await shot(page, runDir, 'command-palette', steps);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('command-palette')).toHaveCount(0);

    // —— Shortcuts ——
    await page.keyboard.press('Shift+/');
    await expect(page.getByTestId('shortcuts-help')).toBeVisible({ timeout: 8_000 });
    await shot(page, runDir, 'shortcuts', steps);
    await page.keyboard.press('Escape');

    // —— Index panel ——
    await page.getByTestId('index-status-chip').click();
    await expect(page.getByTestId('index-panel')).toBeVisible({ timeout: 8_000 });
    await shot(page, runDir, 'index-panel', steps);
    await page.keyboard.press('Escape');
    // backdrop click fallback
    if (await page.getByTestId('index-panel').count()) {
      await page.getByTestId('index-panel').click({ position: { x: 4, y: 4 } });
    }

    // —— Index soft-refresh copy (injected) ——
    await page.evaluate(() => {
      window.__aurora!.setState({
        fsMode: 'real',
        booting: false,
        indexRoot: 'C:\\',
        indexInfo: {
          ready: true,
          building: false,
          refreshing: true,
          size: 120_000,
          watching: true,
        },
      });
    });
    await expect(page.getByTestId('index-status-chip')).toHaveAttribute('data-index-state', 'refreshing');
    await expect(page.getByTestId('index-status-chip')).not.toContainText('正在建立索引');
    await shot(page, runDir, 'index-refreshing-chip', steps);
    await lockDemo(page);

    // —— Selection + Quick Look + Info ——
    const file = await pickDesktopFile(page);
    await expect(page.locator(`[data-item="${file.id}"]`).first()).toBeVisible({ timeout: 8_000 });
    await page.locator(`[data-item="${file.id}"]`).first().click();
    await page.keyboard.press(' ');
    await expect(page.getByTestId('quicklook')).toBeVisible({ timeout: 8_000 });
    await shot(page, runDir, 'quicklook', steps);
    await page.keyboard.press('Escape');

    await pickDesktopFile(page, file.name.slice(0, 6));
    await page.keyboard.press('Alt+Enter');
    await expect(page.getByTestId('info-panel')).toBeVisible({ timeout: 8_000 });
    await shot(page, runDir, 'info-panel', steps);
    await page.keyboard.press('Escape');

    // —— Batch rename ——
    await page.evaluate(() => {
      const api = window.__aurora!;
      const st = api.getState();
      const desk = st.nodes.desktop;
      const ids = (desk?.childrenIds || [])
        .map((id) => st.nodes[id])
        .filter((n) => n && n.kind === 'file' && !n.deleted)
        .slice(0, 3)
        .map((n) => n!.id);
      const tabs = st.tabs.map((t) => (t.id === st.activeTabId ? { ...t, selection: ids } : t));
      api.setState({ tabs, batchOpen: true });
    });
    await expect(page.getByTestId('batch-rename')).toBeVisible({ timeout: 8_000 });
    await shot(page, runDir, 'batch-rename', steps);
    await page.keyboard.press('Escape');

    // —— Context menu ——
    const ctxFile = await pickDesktopFile(page);
    await page.locator(`[data-item="${ctxFile.id}"]`).first().click({ button: 'right' });
    await expect(page.getByTestId('context-menu')).toBeVisible({ timeout: 5_000 });
    await shot(page, runDir, 'context-menu', steps);
    await page.keyboard.press('Escape');

    // —— Clipboard toast ——
    await pickDesktopFile(page);
    await page.keyboard.press('Control+c');
    await expect(page.getByTestId('toast-stack')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('toast-stack')).toContainText(/已复制/);
    await shot(page, runDir, 'toast-copy', steps);

    // —— Tag toggle ——
    await page.evaluate(() => {
      const api = window.__aurora!;
      const st = api.getState();
      const id = st.tabs.find((t) => t.id === st.activeTabId)?.selection[0];
      if (id) st.toggleTag([id], 'red');
    });
    await page.waitForTimeout(200);
    await shot(page, runDir, 'tag-applied', steps);

    // —— New folder ——
    await page.keyboard.press('Control+Shift+N');
    await page.waitForTimeout(300);
    await shot(page, runDir, 'new-folder', steps);

    // —— Filter search (live) ——
    const search = page.locator('input[placeholder*="Enter 深度"]').first();
    await search.fill('报告');
    await page.waitForTimeout(250);
    await shot(page, runDir, 'filter-search', steps);
    await search.fill('');

    // —— Folder busy ——
    await page.evaluate(() => window.__aurora!.setState({ folderRefreshing: true }));
    await expect(page.getByTestId('folder-busy-overlay')).toBeVisible();
    await shot(page, runDir, 'folder-busy', steps);
    await page.evaluate(() => window.__aurora!.setState({ folderRefreshing: false }));

    // —— Sidebar collapse ——
    const hide = page.getByRole('button', { name: /隐藏边栏|显示边栏/ }).first();
    if (await hide.count()) {
      await hide.click();
      await page.waitForTimeout(350);
      await shot(page, runDir, 'sidebar-collapsed', steps);
      await hide.click();
    }

    // —— Window dock (minimize) ——
    await page.getByRole('button', { name: '最小化' }).click();
    await page.waitForTimeout(400);
    await shot(page, runDir, 'dock-minimized', steps);
    await page.getByText('Aurora Files').first().click();
    await expect(page.getByRole('application', { name: 'Aurora Files' })).toBeVisible({ timeout: 8_000 });
    await shot(page, runDir, 'restored', steps);

    if (consoleErrors.length) warn.push(`console_errors_${consoleErrors.length}`);

    const summary = {
      kind: 'aurora-gui-full',
      runId,
      at: new Date().toISOString(),
      steps,
      stepCount: steps.length,
      consoleErrors: consoleErrors.slice(0, 30),
      warn,
      ok: warn.length === 0,
      video: 'video/session.webm',
    };
    await fs.writeFile(path.join(runDir, 'summary.gui-full.json'), JSON.stringify(summary, null, 2));
    await fs.writeFile(path.join(OUT_ROOT, 'latest-gui-full.json'), JSON.stringify(summary, null, 2));
    testInfo.annotations.push({ type: 'gui-full', description: JSON.stringify(summary) });
    expect(warn, `gui-full warns: ${warn.join(', ')}`).toEqual([]);
    expect(steps.length).toBeGreaterThanOrEqual(20);
  });

  test.afterEach(async ({ page }, testInfo) => {
    const runId = process.env.AURORA_PERF_RUN_ID || 'gui-full-latest';
    const destDir = path.join(OUT_ROOT, runId, 'video');
    await fs.mkdir(destDir, { recursive: true });
    const dest = path.join(destDir, 'session.webm');
    const video = page.video();
    if (!video) return;
    const save = (async () => {
      try {
        await video.saveAs(dest);
      } catch {
        const src = await video.path().catch(() => null);
        if (src) await fs.copyFile(src, dest);
      }
    })();
    await Promise.race([save, new Promise((r) => setTimeout(r, 8_000))]);
    testInfo.annotations.push({
      type: 'video',
      description: await fs.stat(dest).then(() => dest).catch(() => 'missing'),
    });
  });
});

