/**
 * Index status chip must never look like a cold rebuild while soft-refreshing.
 *
 *   npm run test:e2e:index
 */
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = process.env.AURORA_PERF_OUT || path.join(process.cwd(), 'perf-out');

async function shot(page: Page, name: string) {
  const dir = path.join(OUT, 'index-status');
  await fs.mkdir(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: false });
}

async function setIndexInfo(
  page: Page,
  info: {
    ready?: boolean;
    building?: boolean;
    refreshing?: boolean;
    size?: number;
    watching?: boolean;
    usnReadable?: boolean | null;
    disk?: { exists?: boolean; deltaLines?: number };
  } | null,
) {
  await page.evaluate((indexInfo) => {
    const api = window.__aurora;
    if (!api) throw new Error('__aurora missing');
    api.setState({
      fsMode: 'real',
      indexRoot: 'C:\\',
      indexInfo,
      booting: false,
      folderRefreshing: false,
      deepSearching: false,
    });
  }, info);
}

test.describe('Index status chip display', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: '桌面' }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('index-status-chip')).toBeVisible();
  });

  test('demo chip shows 演示盘', async ({ page }) => {
    const chip = page.getByTestId('index-status-chip');
    await expect(chip).toHaveAttribute('data-index-state', 'demo');
    await expect(chip).toHaveText('演示盘');
    await shot(page, '01-demo');
  });

  test('cold build shows 正在建立索引 and amber tone', async ({ page }) => {
    await setIndexInfo(page, { ready: false, building: true, size: 0 });
    const chip = page.getByTestId('index-status-chip');
    await expect(chip).toHaveAttribute('data-index-state', 'building');
    await expect(chip).toHaveText('正在建立索引…');
    await expect(chip).toHaveClass(/text-amber/);
    await shot(page, '02-building');
  });

  test('building with progress does not say 正在建立索引… alone', async ({ page }) => {
    await setIndexInfo(page, { ready: false, building: true, size: 12_345 });
    const chip = page.getByTestId('index-status-chip');
    await expect(chip).toHaveAttribute('data-index-state', 'building');
    await expect(chip).toContainText('索引中');
    await expect(chip).toContainText('12,345');
    await expect(chip).not.toHaveText('正在建立索引…');
    await shot(page, '03-building-progress');
  });

  test('ready + soft-refresh never looks like cold build', async ({ page }) => {
    await setIndexInfo(page, {
      ready: true,
      building: false,
      refreshing: true,
      size: 88_000,
      watching: true,
    });
    const chip = page.getByTestId('index-status-chip');
    await expect(chip).toHaveAttribute('data-index-state', 'refreshing');
    await expect(chip).toContainText('索引就绪');
    await expect(chip).toContainText('同步中');
    await expect(chip).not.toContainText('正在建立索引');
    await expect(chip).toHaveClass(/text-sky/);
    await expect(chip).not.toHaveClass(/text-amber/);
    await shot(page, '04-ready-refreshing');
  });

  test('legacy ready+building misflag still shows 同步中 not cold build', async ({ page }) => {
    await setIndexInfo(page, {
      ready: true,
      building: true,
      refreshing: false,
      size: 9_001,
    });
    const chip = page.getByTestId('index-status-chip');
    await expect(chip).toHaveAttribute('data-index-state', 'refreshing');
    await expect(chip).toContainText('索引就绪');
    await expect(chip).toContainText('同步中');
    await expect(chip).not.toContainText('正在建立索引');
    await shot(page, '05-legacy-ready-building');
  });

  test('ready steady state is quiet zinc tone', async ({ page }) => {
    await setIndexInfo(page, {
      ready: true,
      building: false,
      refreshing: false,
      size: 50_000,
      disk: { exists: true },
      usnReadable: true,
    });
    const chip = page.getByTestId('index-status-chip');
    await expect(chip).toHaveAttribute('data-index-state', 'ready');
    await expect(chip).toContainText('索引就绪');
    await expect(chip).toContainText('USN');
    await expect(chip).not.toHaveClass(/text-amber/);
    await expect(chip).not.toHaveClass(/text-sky/);
    await shot(page, '06-ready');
  });

  test('index panel mirrors chip copy for soft-refresh', async ({ page }) => {
    await setIndexInfo(page, {
      ready: true,
      building: false,
      refreshing: true,
      size: 42_000,
    });
    await page.getByTestId('index-status-chip').click();
    const panel = page.getByTestId('index-panel');
    await expect(panel).toBeVisible();
    const summary = page.getByTestId('index-panel-summary');
    await expect(summary).toContainText('索引就绪');
    await expect(summary).toContainText('同步中');
    await expect(summary).not.toContainText('正在建立索引');
    await shot(page, '07-panel-refreshing');
  });
});
