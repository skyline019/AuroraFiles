/**
 * 搜索 × 分组硬契约（demo）— 边缘与生命周期
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoDesktop, lockDemo } from './helpers/demo';

async function renderedKinds(page: Page) {
  return page.evaluate(() => {
    const st = window.__aurora!.getState();
    const ids = [...document.querySelectorAll('[data-item]')].map((el) => el.getAttribute('data-item')!);
    return ids.map((id) => {
      const n = st.nodes[id];
      if (!n) return null;
      const folder = n.kind === 'folder' || n.kind === 'drive' || n.kind === 'special';
      return folder ? 'folder' : 'file';
    }).filter(Boolean) as Array<'file' | 'folder'>;
  });
}

function assertPartitioned(kinds: Array<'file' | 'folder'>, requireBoth: boolean) {
  const hasF = kinds.includes('folder');
  const hasFile = kinds.includes('file');
  if (requireBoth) {
    expect(hasF, `expected folders in ${JSON.stringify(kinds)}`).toBe(true);
    expect(hasFile, `expected files in ${JSON.stringify(kinds)}`).toBe(true);
  }
  if (!hasF || !hasFile) return;
  const firstFile = kinds.indexOf('file');
  const lastFolder = kinds.lastIndexOf('folder');
  expect(lastFolder).toBeLessThan(firstFile);
}

test.describe('Search×Group contracts', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDesktop(page);
  });

  test('ungrouped deep search: both kinds present and partitioned under 图片', async ({ page }) => {
    await page.evaluate(() => {
      const st = window.__aurora!.getState();
      st.navigate({ t: 'node', id: 'pics' });
      st.patchTab({ view: 'list', groupByCategory: false, categoryFilter: [] });
    });
    await page.evaluate(async () => {
      await window.__aurora!.getState().runDeepSearch('图');
    });
    await expect(page.getByTestId('deep-search-busy')).toHaveCount(0, { timeout: 8_000 });
    await expect.poll(async () => (await renderedKinds(page)).length).toBeGreaterThan(1);

    const kinds = await renderedKinds(page);
    assertPartitioned(kinds, true);
  });

  test('grouped deep search: folder header exclusive; no file under it', async ({ page }) => {
    await page.evaluate(() => {
      const st = window.__aurora!.getState();
      st.navigate({ t: 'node', id: 'pics' });
      st.patchTab({ view: 'list', groupByCategory: true });
    });
    await page.evaluate(async () => {
      await window.__aurora!.getState().runDeepSearch('图');
    });
    await expect(page.getByTestId('deep-search-busy')).toHaveCount(0, { timeout: 8_000 });
    await expect(page.getByTestId('section-header-folder')).toBeVisible({ timeout: 5_000 });

    const check = await page.evaluate(() => {
      const st = window.__aurora!.getState();
      const headers = [...document.querySelectorAll('[data-testid^="section-header-"]')].map((el) =>
        el.getAttribute('data-testid')!.replace('section-header-', ''),
      );
      // walk DOM order: after folder header until next header, all must be folders
      const rows = [...document.querySelectorAll('[data-testid^="section-header-"], [data-item]')];
      let mode: 'none' | 'folder' | 'other' = 'none';
      const violations: string[] = [];
      for (const el of rows) {
        const tid = el.getAttribute('data-testid') || '';
        if (tid.startsWith('section-header-')) {
          mode = tid === 'section-header-folder' ? 'folder' : 'other';
          continue;
        }
        const id = el.getAttribute('data-item')!;
        const n = st.nodes[id];
        if (!n) continue;
        if (mode === 'folder' && n.kind === 'file') violations.push(`file ${id} under folder`);
        if (mode === 'other' && n.kind !== 'file') violations.push(`non-file ${id} under ${mode}`);
      }
      return { headers, violations };
    });
    expect(check.headers[0]).toBe('folder');
    expect(check.violations).toEqual([]);
    assertPartitioned(await renderedKinds(page), true);
  });

  test('exit search via clearDeepSearch keeps group + collapsed', async ({ page }) => {
    await page.evaluate(() => {
      const st = window.__aurora!.getState();
      st.navigate({ t: 'node', id: 'pics' });
      st.patchTab({
        view: 'list',
        groupByCategory: true,
        categoryFilter: ['image'],
        collapsedCategories: ['folder'],
      });
    });
    await page.evaluate(async () => {
      await window.__aurora!.getState().runDeepSearch('图');
    });
    await expect(page.getByTestId('deep-search-busy')).toHaveCount(0, { timeout: 8_000 });

    await page.evaluate(() => {
      const st = window.__aurora!.getState();
      st.clearDeepSearch();
      st.patchTab({ search: '' });
    });

    const tab = await page.evaluate(() => {
      const st = window.__aurora!.getState();
      return st.tabs.find((t) => t.id === st.activeTabId)!;
    });
    expect(tab.groupByCategory).toBe(true);
    expect(tab.categoryFilter).toEqual(['image']);
    expect(tab.collapsedCategories).toEqual(['folder']);
    expect(tab.search).toBe('');
    expect(await page.evaluate(() => window.__aurora!.getState().deepHits)).toBeNull();
  });

  test('exit search via Esc (global) keeps groupBy', async ({ page }) => {
    await page.evaluate(() => {
      const st = window.__aurora!.getState();
      st.navigate({ t: 'node', id: 'pics' });
      st.patchTab({ view: 'list', groupByCategory: true });
    });
    await page.evaluate(async () => {
      await window.__aurora!.getState().runDeepSearch('图');
    });
    await expect(page.getByTestId('deep-search-busy')).toHaveCount(0, { timeout: 8_000 });

    // blur search input so Escape is handled by global keys (not typing early-return)
    await page.locator('input[placeholder*="搜索"]').first().blur();
    await page.keyboard.press('Escape');

    await expect.poll(async () =>
      page.evaluate(() => {
        const st = window.__aurora!.getState();
        const tab = st.tabs.find((t) => t.id === st.activeTabId)!;
        return {
          search: tab.search,
          groupBy: tab.groupByCategory,
          hits: st.deepHits,
        };
      }),
    ).toEqual({ search: '', groupBy: true, hits: null });
  });

  test('back after enabling group in child keeps groupBy', async ({ page }) => {
    await page.evaluate(() => {
      const st = window.__aurora!.getState();
      st.navigate({ t: 'node', id: 'pics' });
      st.navigate({ t: 'node', id: 'docs' });
      st.patchTab({ groupByCategory: true, categoryFilter: ['pdf'] });
      st.back();
    });
    const tab = await page.evaluate(() => {
      const st = window.__aurora!.getState();
      return st.tabs.find((t) => t.id === st.activeTabId)!;
    });
    expect(tab.history[tab.hi]).toEqual({ t: 'node', id: 'pics' });
    expect(tab.groupByCategory).toBe(true);
    expect(tab.categoryFilter).toEqual(['pdf']);
  });

  test('navigate keeps group; chip filter without group excludes folders in DOM', async ({ page }) => {
    await page.evaluate(() => {
      const st = window.__aurora!.getState();
      st.navigate({ t: 'node', id: 'pics' });
      st.patchTab({ view: 'list', groupByCategory: true, categoryFilter: ['image'] });
    });
    await page.evaluate(() => {
      window.__aurora!.getState().navigate({ t: 'node', id: 'docs' });
    });
    let tab = await page.evaluate(() => {
      const st = window.__aurora!.getState();
      return st.tabs.find((t) => t.id === st.activeTabId)!;
    });
    expect(tab.groupByCategory).toBe(true);
    expect(tab.categoryFilter).toEqual([]);

    await page.evaluate(() => {
      const st = window.__aurora!.getState();
      st.navigate({ t: 'node', id: 'pics' });
      st.patchTab({ groupByCategory: false, categoryFilter: [] });
    });
    await lockDemo(page);
    await expect(page.getByTestId('category-bar')).toBeVisible({ timeout: 8_000 });
    await page.getByTestId('cat-chip-image').click();
    await expect.poll(async () =>
      page.evaluate(() => {
        const st = window.__aurora!.getState();
        return st.tabs.find((t) => t.id === st.activeTabId)!.categoryFilter;
      }),
    ).toEqual(['image']);

    const kinds = await renderedKinds(page);
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((k) => k === 'file')).toBe(true);
  });

  test('empty query schedule clears hits without killing group', async ({ page }) => {
    await page.evaluate(() => {
      const st = window.__aurora!.getState();
      st.navigate({ t: 'node', id: 'pics' });
      st.patchTab({ groupByCategory: true, search: '图' });
    });
    await page.evaluate(async () => {
      await window.__aurora!.getState().runDeepSearch('图');
    });
    await expect(page.getByTestId('deep-search-busy')).toHaveCount(0, { timeout: 8_000 });

    await page.evaluate(() => {
      window.__aurora!.getState().scheduleDeepSearch('');
      window.__aurora!.getState().patchTab({ search: '' });
    });
    await expect.poll(async () =>
      page.evaluate(() => {
        const st = window.__aurora!.getState();
        const tab = st.tabs.find((t) => t.id === st.activeTabId)!;
        return tab.groupByCategory && st.deepHits == null && tab.search === '';
      }),
    ).toBe(true);
  });
});
