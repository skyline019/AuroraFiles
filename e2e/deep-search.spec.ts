/**
 * Dev deep-search: from current location, recurse all descendants (demo disk).
 * Real-disk path is covered by electron/index/searchFiles.test.ts.
 */
import { test, expect } from '@playwright/test';
import { gotoDesktop, lockDemo } from './helpers/demo';

test.describe('Deep search from current location', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDesktop(page);
  });

  test('Enter deep-search finds nested file under 设计稿', async ({ page }) => {
    const search = page.locator('input[placeholder*="Enter 深度"]').first();
    await search.click();
    await search.fill('主视觉-v3');
    await search.press('Enter');

    await expect(page.getByTestId('deep-search-busy')).toHaveCount(0, { timeout: 8_000 });
    await expect.poll(async () =>
      page.evaluate(() => (window.__aurora!.getState().deepHits || []).length),
    ).toBeGreaterThan(0);

    const hitNames = await page.evaluate(() => {
      const st = window.__aurora!.getState();
      return (st.deepHits || []).map((id) => st.nodes[id]?.name).filter(Boolean);
    });
    expect(hitNames.some((n) => n!.includes('主视觉'))).toBe(true);

    const meta = await page.evaluate(() => window.__aurora!.getState().deepMeta);
    expect(meta?.source).toBe('demo-deep');
    expect((meta?.scanned ?? 0)).toBeGreaterThan(1);
  });

  test('deep-search from 文档 finds nested 工作 file', async ({ page }) => {
    await page.getByRole('button', { name: '文档' }).first().click();
    await lockDemo(page);
    await page.evaluate(() => {
      window.__aurora!.getState().navigate({ t: 'node', id: 'docs' });
    });

    const search = page.locator('input[placeholder*="Enter 深度"]').first();
    await search.fill('产品白皮书');
    await search.press('Enter');
    await expect(page.getByTestId('deep-search-busy')).toHaveCount(0, { timeout: 8_000 });

    const hits = await page.evaluate(() => {
      const st = window.__aurora!.getState();
      return (st.deepHits || []).map((id) => st.nodes[id]?.name);
    });
    expect(hits.some((n) => n?.includes('白皮书'))).toBe(true);

    // Scoped: should not pull desktop-only names when searching under 文档
    const locId = await page.evaluate(() => {
      const st = window.__aurora!.getState();
      const t = st.tabs.find((x) => x.id === st.activeTabId)!;
      return t.history[t.hi];
    });
    expect(locId).toEqual({ t: 'node', id: 'docs' });
  });

  test('live filter still works without Enter', async ({ page }) => {
    const search = page.locator('input[placeholder*="Enter 深度"]').first();
    await search.fill('灵感');
    await expect.poll(async () =>
      page.evaluate(() => {
        const st = window.__aurora!.getState();
        return st.tabs.find((t) => t.id === st.activeTabId)?.search;
      }),
    ).toBe('灵感');
    await search.fill('');
  });
});
