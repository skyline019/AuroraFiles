/**
 * Category filter chips + group-by toggle (demo disk).
 */
import { test, expect } from '@playwright/test';
import { gotoDesktop } from './helpers/demo';

test.describe('Category browse', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDesktop(page);
  });

  test('image chip filters grid to images (+ folders)', async ({ page }) => {
    // 桌面无图片文件；进「图片」库
    await page.evaluate(() => {
      window.__aurora!.getState().navigate({ t: 'node', id: 'pics' });
    });
    await expect(page.getByTestId('category-bar')).toBeVisible({ timeout: 8_000 });
    await page.getByTestId('cat-chip-image').click();

    await expect.poll(async () =>
      page.evaluate(() => {
        const st = window.__aurora!.getState();
        const tab = st.tabs.find((t) => t.id === st.activeTabId)!;
        return tab.categoryFilter;
      }),
    ).toEqual(['image']);

    const kinds = await page.evaluate(() => {
      const st = window.__aurora!.getState();
      const tab = st.tabs.find((t) => t.id === st.activeTabId)!;
      // visibleItems path via selection pool: inspect rendered data-item names' nodes
      const ids = [...document.querySelectorAll('[data-item]')].map((el) => el.getAttribute('data-item')!);
      return ids.map((id) => {
        const n = st.nodes[id];
        if (!n) return null;
        if (n.kind === 'folder') return 'folder';
        return n.ext || n.name.split('.').pop() || '';
      }).filter(Boolean);
    });
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((k) => k === 'folder' || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg', 'psd'].includes(String(k).toLowerCase()))).toBe(true);

    await page.getByTestId('cat-chip-all').click();
    await expect.poll(async () =>
      page.evaluate(() => {
        const st = window.__aurora!.getState();
        return st.tabs.find((t) => t.id === st.activeTabId)!.categoryFilter;
      }),
    ).toEqual([]);
  });

  test('group toggle shows section headers in list', async ({ page }) => {
    await page.evaluate(() => {
      window.__aurora!.getState().navigate({ t: 'node', id: 'pics' });
      window.__aurora!.getState().patchTab({ view: 'list', groupByCategory: true });
    });
    await expect(page.getByTestId('cat-group-toggle')).toBeVisible();
    await expect(page.locator('[data-testid^="section-header-"]').first()).toBeVisible({ timeout: 5_000 });

    const first = page.locator('[data-testid^="section-header-"]').first();
    await first.click();
    await expect.poll(async () =>
      page.evaluate(() => {
        const st = window.__aurora!.getState();
        return (st.tabs.find((t) => t.id === st.activeTabId)!.collapsedCategories || []).length;
      }),
    ).toBeGreaterThan(0);
  });
});
