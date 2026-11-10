/**
 * Category filter chips + group-by toggle (demo disk).
 */
import { test, expect } from '@playwright/test';
import { gotoDesktop } from './helpers/demo';

test.describe('Category browse', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDesktop(page);
  });

  test('image chip filters grid to images only (no folders)', async ({ page }) => {
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
      const ids = [...document.querySelectorAll('[data-item]')].map((el) => el.getAttribute('data-item')!);
      return ids.map((id) => {
        const n = st.nodes[id];
        if (!n) return null;
        if (n.kind === 'folder') return 'folder';
        return n.ext || n.name.split('.').pop() || '';
      }).filter(Boolean);
    });
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((k) => k !== 'folder')).toBe(true);
    expect(kinds.every((k) => ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg', 'psd'].includes(String(k).toLowerCase()))).toBe(true);

    await page.getByTestId('cat-chip-all').click();
    await expect.poll(async () =>
      page.evaluate(() => {
        const st = window.__aurora!.getState();
        return st.tabs.find((t) => t.id === st.activeTabId)!.categoryFilter;
      }),
    ).toEqual([]);
  });

  test('group toggle shows folder as its own section; clears on navigate', async ({ page }) => {
    await page.evaluate(() => {
      window.__aurora!.getState().navigate({ t: 'node', id: 'pics' });
      window.__aurora!.getState().patchTab({ view: 'list', groupByCategory: true });
    });
    await expect(page.getByTestId('cat-group-toggle')).toBeVisible();
    await expect(page.getByTestId('section-header-folder')).toBeVisible({ timeout: 5_000 });

    const first = page.locator('[data-testid^="section-header-"]').first();
    await first.click();
    await expect.poll(async () =>
      page.evaluate(() => {
        const st = window.__aurora!.getState();
        return (st.tabs.find((t) => t.id === st.activeTabId)!.collapsedCategories || []).length;
      }),
    ).toBeGreaterThan(0);

    // 换目录后分组不常驻
    await page.evaluate(() => {
      window.__aurora!.getState().navigate({ t: 'node', id: 'docs' });
    });
    await expect.poll(async () =>
      page.evaluate(() => {
        const st = window.__aurora!.getState();
        const tab = st.tabs.find((t) => t.id === st.activeTabId)!;
        return tab.groupByCategory === false && (tab.categoryFilter || []).length === 0;
      }),
    ).toBe(true);
  });

  test('exit search keeps groupBy; deep hits keep folders before files', async ({ page }) => {
    await page.evaluate(() => {
      const st = window.__aurora!.getState();
      st.navigate({ t: 'node', id: 'pics' });
      st.patchTab({ view: 'list', groupByCategory: true });
    });
    await expect(page.getByTestId('section-header-folder')).toBeVisible({ timeout: 5_000 });

    await page.evaluate(async () => {
      await window.__aurora!.getState().runDeepSearch('图');
    });
    await expect(page.getByTestId('deep-search-busy')).toHaveCount(0, { timeout: 8_000 });

    const order = await page.evaluate(() => {
      const st = window.__aurora!.getState();
      const tab = st.tabs.find((t) => t.id === st.activeTabId)!;
      const hits = st.deepHits || [];
      const list = hits.map((id) => st.nodes[id]).filter((n): n is NonNullable<typeof n> => !!n && !n.deleted);
      // mirror presentDeepHits contract via rendered items when grouped: folder header first
      return {
        groupBy: tab.groupByCategory,
        kinds: list.map((n) => (n.kind === 'file' ? 'file' : 'folder')),
        hasFolderHeader: !!document.querySelector('[data-testid="section-header-folder"]'),
      };
    });
    expect(order.groupBy).toBe(true);
    // interleaved raw hits may exist; UI must still show folder section when grouped
    expect(order.hasFolderHeader).toBe(true);
    // if both kinds present in hits, raw list may interleave — assert via store helper
    const partitioned = await page.evaluate(() => {
      const st = window.__aurora!.getState();
      const tab = st.tabs.find((t) => t.id === st.activeTabId)!;
      // useItems path: read DOM order of data-item under list
      const ids = [...document.querySelectorAll('[data-item]')].map((el) => el.getAttribute('data-item')!);
      const kinds = ids.map((id) => {
        const n = st.nodes[id];
        return !n ? null : n.kind === 'file' ? 'file' : 'folder';
      }).filter(Boolean) as string[];
      const firstFile = kinds.indexOf('file');
      const lastFolder = kinds.lastIndexOf('folder');
      return { kinds, ok: firstFile === -1 || lastFolder === -1 || lastFolder < firstFile, search: tab.search };
    });
    expect(partitioned.ok).toBe(true);

    // Esc / clear：退出搜索后分组仍在
    await page.evaluate(() => {
      const st = window.__aurora!.getState();
      st.clearDeepSearch();
      st.patchTab({ search: '' });
    });
    await expect.poll(async () =>
      page.evaluate(() => {
        const st = window.__aurora!.getState();
        const tab = st.tabs.find((t) => t.id === st.activeTabId)!;
        return tab.groupByCategory === true && !tab.search;
      }),
    ).toBe(true);
    await expect(page.getByTestId('section-header-folder')).toBeVisible();
  });
});
