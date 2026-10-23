import { test, expect } from '@playwright/test';

test.describe('Aurora demo UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: '桌面' }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('folder busy overlay blocks clicks', async ({ page }) => {
    await page.evaluate(() => {
      window.__aurora?.setState({ folderRefreshing: true });
    });
    const overlay = page.getByTestId('folder-busy-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('正在加载文件夹');
    await overlay.click({ position: { x: 20, y: 20 }, force: true });
    await expect(overlay).toBeVisible();
    await page.evaluate(() => {
      window.__aurora?.setState({ folderRefreshing: false });
    });
    await expect(overlay).toHaveCount(0);
  });

  test('deep search cancel keeps UI responsive', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('aurora-e2e-slow-search', '1');
    });
    await page.reload();
    await expect(page.getByRole('button', { name: '桌面' }).first()).toBeVisible({ timeout: 20_000 });
    const search = page.locator('input[placeholder*="Enter 深度"]').first();
    await search.click();
    await search.fill('报告');
    await search.press('Enter');
    await expect(page.getByTestId('deep-search-busy')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: '取消' }).first().click();
    await expect(page.getByTestId('deep-search-busy')).toHaveCount(0, { timeout: 5_000 });
  });

  test('index panel opens from status chip', async ({ page }) => {
    await page.getByTestId('index-status-chip').click();
    await expect(page.getByTestId('index-panel')).toBeVisible();
    await expect(page.getByTestId('index-panel')).toContainText('索引状态');
    await page.getByTestId('index-panel').click({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId('index-panel')).toHaveCount(0);
  });

  test('gallery files-only toggle', async ({ page }) => {
    await page.keyboard.press('Control+4');
    const toggle = page.getByTestId('gallery-files-only-toggle');
    await expect(toggle).toBeVisible({ timeout: 8_000 });
    await expect(toggle).toContainText('仅文件');
    await toggle.click();
    await expect(toggle).toContainText('含文件夹');
  });

  test('index prefs form is editable in demo', async ({ page }) => {
    await page.getByTestId('index-status-chip').click();
    const form = page.getByTestId('index-prefs-form');
    await expect(form).toBeVisible();
    const maxInput = form.locator('input[type="number"]');
    await maxInput.fill('90000');
    await form.locator('textarea').fill('vendor\n.cache');
    await form.getByRole('button', { name: '保存策略' }).click();
    await expect(page.getByText(/已保存策略|索引策略已保存/).first()).toBeVisible({ timeout: 5_000 });
  });
});
