import { test, expect } from '@playwright/test';

test.describe('Context menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: '桌面' }).first()).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Control+1');
    await expect(page.getByTestId('grid-scroll')).toBeVisible({ timeout: 10_000 });
  });

  test('right-click file opens item menu', async ({ page }) => {
    const item = page.locator('[data-item]').first();
    await expect(item).toBeVisible({ timeout: 15_000 });
    await item.click({ button: 'right' });
    const menu = page.getByTestId('context-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button', { name: '打开 Enter' })).toBeVisible();
    await expect(menu.getByRole('button', { name: '复制 Ctrl+C' })).toBeVisible();
    await expect(menu.getByRole('button', { name: '移到回收站 Delete' })).toBeVisible();
  });

  test('menu action copy actually runs (not closed by pointerdown)', async ({ page }) => {
    const item = page.locator('[data-item]').first();
    await expect(item).toBeVisible({ timeout: 15_000 });
    await item.click({ button: 'right' });
    const menu = page.getByTestId('context-menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('button', { name: '复制 Ctrl+C' }).click();
    await expect(menu).toHaveCount(0);
    const clip = await page.evaluate(() => window.__aurora?.getState().clipboard);
    expect(clip?.mode).toBe('copy');
    expect(clip?.ids?.length).toBeGreaterThan(0);
  });

  test('background menu can create folder', async ({ page }) => {
    const scroll = page.getByTestId('grid-scroll');
    await expect(scroll).toBeVisible();
    const box = await scroll.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.click(box!.x + box!.width - 24, box!.y + box!.height - 24, { button: 'right' });
    const menu = page.getByTestId('context-menu');
    await expect(menu).toBeVisible();
    const createBtn = menu.getByRole('button', { name: '新建文件夹 Ctrl+Shift+N' });
    await expect(createBtn).toBeVisible();
    await expect(createBtn).toBeEnabled();
    const before = await page.evaluate(() => Object.keys(window.__aurora?.getState().nodes ?? {}).length);
    await createBtn.click();
    await expect(menu).toHaveCount(0);
    await expect.poll(async () =>
      page.evaluate(() => Object.keys(window.__aurora?.getState().nodes ?? {}).length),
    ).toBeGreaterThan(before);
  });

  test('Escape closes context menu', async ({ page }) => {
    const item = page.locator('[data-item]').first();
    await expect(item).toBeVisible({ timeout: 15_000 });
    await item.click({ button: 'right' });
    await expect(page.getByTestId('context-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('context-menu')).toHaveCount(0);
  });
});
