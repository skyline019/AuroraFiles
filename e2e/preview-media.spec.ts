import { test, expect, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '桌面' }).first()).toBeVisible({ timeout: 20_000 });
}

async function openQuickLookByName(page: Page, namePart: string) {
  await page.evaluate((name) => {
    const st = window.__aurora!.getState();
    const node = Object.values(st.nodes).find((n) => n.kind === 'file' && n.name.includes(name));
    if (!node) throw new Error(`node not found: ${name}`);
    if (node.parentId) st.navigate({ t: 'node', id: node.parentId });
    st.setSelection([node.id]);
    st.setQuickLook(node.id);
  }, namePart);
}

test.describe('Aurora preview / media e2e', () => {
  test('preview fail state for demo HEIC without decode', async ({ page }) => {
    await ready(page);
    await openQuickLookByName(page, 'macOS-Sequoia-dark.heic');
    const fail = page.getByTestId('preview-fail');
    await expect(fail).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('preview-fail-message')).toContainText(/无法读取|转码|解码|环境/);
    await expect(page.getByTestId('preview-fail-open')).toBeVisible();
  });

  test('gallery shows video cover thumb', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => {
      const st = window.__aurora!.getState();
      const vids = Object.values(st.nodes).find((n) => n.name === '视频' && n.kind === 'folder');
      if (!vids) throw new Error('视频 folder missing');
      st.navigate({ t: 'node', id: vids.id });
      st.patchTab({ view: 'gallery', galleryFilesOnly: true });
    });
    await expect(page.getByTestId('gallery-files-only-toggle')).toBeVisible({ timeout: 8_000 });
    const thumb = page.locator('[data-testid="video-thumb"][data-name="年会剪辑-final.mp4"]');
    await expect(thumb).toBeVisible({ timeout: 8_000 });
    await expect(thumb.locator('img')).toBeVisible();
  });

  test('PPTX slide canvas from e2e mock', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('aurora-e2e-pptx-visual', '1');
    });
    await ready(page);
    await openQuickLookByName(page, '季度汇报.pptx');
    const canvas = page.getByTestId('pptx-slide-canvas').first();
    await expect(canvas).toBeVisible({ timeout: 8_000 });
    await expect(canvas).toContainText('E2E Canvas');
    await expect(canvas.locator('img')).toHaveCount(1);
  });
});
