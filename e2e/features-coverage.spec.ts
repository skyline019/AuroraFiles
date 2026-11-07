/**
 * Functional coverage of major demo-disk product surfaces.
 * Complements visual/full-gui walks with state assertions.
 */
import { test, expect } from '@playwright/test';
import { gotoDesktop, lockDemo, locId, pickDesktopFile, selectIds } from './helpers/demo';

test.describe('Features coverage · navigation', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDesktop(page);
  });

  test('sidebar: 此电脑 / 桌面 / 回收站', async ({ page }) => {
    await page.getByRole('button', { name: '此电脑' }).first().click();
    await expect(page.getByTestId('this-pc-view')).toBeVisible();
    expect(await locId(page)).toBe('pc');

    await page.getByRole('button', { name: '桌面' }).first().click();
    await expect(page.getByTestId('grid-scroll')).toBeVisible();
    expect(await locId(page)).toBe('desktop');

    await page.getByRole('button', { name: '回收站' }).first().click();
    expect(await locId(page)).toBe('sp-trash');
  });

  test('history: open folder then Backspace / up()', async ({ page }) => {
    const folder = await page.evaluate(() => {
      const st = window.__aurora!.getState();
      const id = (st.nodes.desktop?.childrenIds || [])
        .map((cid) => st.nodes[cid])
        .find((n) => n && n.kind === 'folder' && !n.deleted && n.parentId === 'desktop');
      if (!id) throw new Error('no desktop folder');
      return { id: id.id, name: id.name };
    });
    await page.locator(`[data-item="${folder.id}"]`).first().dblclick();
    await expect.poll(async () => locId(page)).toBe(folder.id);
    await page.keyboard.press('Backspace');
    await expect.poll(async () => locId(page)).toBe('desktop');

    await page.evaluate((id) => window.__aurora!.getState().openNode(id), folder.id);
    await expect.poll(async () => locId(page)).toBe(folder.id);
    await page.evaluate(() => window.__aurora!.getState().up());
    await expect.poll(async () => locId(page)).toBe('desktop');
  });

  test('tabs: Alt+T open, Alt+W close', async ({ page }) => {
    const before = await page.evaluate(() => window.__aurora!.getState().tabs.length);
    await page.keyboard.press('Alt+t');
    await expect.poll(async () => page.evaluate(() => window.__aurora!.getState().tabs.length)).toBe(before + 1);
    await page.keyboard.press('Alt+w');
    await expect.poll(async () => page.evaluate(() => window.__aurora!.getState().tabs.length)).toBe(before);
  });
});

test.describe('Features coverage · views & chrome', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDesktop(page);
  });

  test('four views via Ctrl+1..4', async ({ page }) => {
    const map = [
      ['Control+1', 'grid', 'grid-scroll'],
      ['Control+2', 'list', 'list-scroll'],
      ['Control+3', 'columns', 'column-scroll'],
      ['Control+4', 'gallery', 'gallery-strip'],
    ] as const;
    for (const [chord, view, testId] of map) {
      await page.keyboard.press(chord);
      await expect(page.getByTestId(testId).first()).toBeVisible({ timeout: 8_000 });
      const v = await page.evaluate(() => {
        const st = window.__aurora!.getState();
        return st.tabs.find((t) => t.id === st.activeTabId)?.view;
      });
      expect(v).toBe(view);
    }
  });

  test('dark mode toggle', async ({ page }) => {
    const before = await page.evaluate(() => window.__aurora!.getState().dark);
    await page.getByRole('button', { name: /深色|浅色/ }).first().click();
    await expect.poll(async () => page.evaluate(() => window.__aurora!.getState().dark)).not.toBe(before);
    await page.getByRole('button', { name: /深色|浅色/ }).first().click();
    await expect.poll(async () => page.evaluate(() => window.__aurora!.getState().dark)).toBe(before);
  });

  test('icon size Ctrl+= / Ctrl+-', async ({ page }) => {
    const before = await page.evaluate(() => {
      const st = window.__aurora!.getState();
      return st.tabs.find((t) => t.id === st.activeTabId)!.iconSize;
    });
    await page.keyboard.press('Control+=');
    await expect.poll(async () =>
      page.evaluate(() => {
        const st = window.__aurora!.getState();
        return st.tabs.find((t) => t.id === st.activeTabId)!.iconSize;
      }),
    ).toBeGreaterThan(before);
    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+-');
    await expect.poll(async () =>
      page.evaluate(() => {
        const st = window.__aurora!.getState();
        return st.tabs.find((t) => t.id === st.activeTabId)!.iconSize;
      }),
    ).toBeLessThanOrEqual(before);
  });

  test('show hidden Ctrl+Shift+.', async ({ page }) => {
    const before = await page.evaluate(() => {
      const st = window.__aurora!.getState();
      return st.tabs.find((t) => t.id === st.activeTabId)!.showHidden;
    });
    await page.keyboard.press('Control+Shift+.');
    await expect.poll(async () =>
      page.evaluate(() => {
        const st = window.__aurora!.getState();
        return st.tabs.find((t) => t.id === st.activeTabId)!.showHidden;
      }),
    ).toBe(!before);
  });
});

test.describe('Features coverage · selection & clipboard', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDesktop(page);
  });

  test('Ctrl+A selects all visible, Ctrl+Shift+U inverts', async ({ page }) => {
    await page.keyboard.press('Control+a');
    const n = await page.evaluate(() => {
      const st = window.__aurora!.getState();
      return st.tabs.find((t) => t.id === st.activeTabId)!.selection.length;
    });
    expect(n).toBeGreaterThan(1);
    await page.keyboard.press('Control+Shift+u');
    const after = await page.evaluate(() => {
      const st = window.__aurora!.getState();
      return st.tabs.find((t) => t.id === st.activeTabId)!.selection.length;
    });
    // invert of full selection → empty
    expect(after).toBe(0);
  });

  test('copy / cut / paste / duplicate', async ({ page }) => {
    const file = await pickDesktopFile(page, '便签');
    await page.locator(`[data-item="${file.id}"]`).first().click();
    await page.keyboard.press('Control+c');
    let clip = await page.evaluate(() => window.__aurora!.getState().clipboard);
    expect(clip?.mode).toBe('copy');
    expect(clip?.ids).toContain(file.id);

    await page.keyboard.press('Control+x');
    clip = await page.evaluate(() => window.__aurora!.getState().clipboard);
    expect(clip?.mode).toBe('cut');

    const before = await page.evaluate(() => window.__aurora!.getState().nodes.desktop!.childrenIds.length);
    // cancel cut by copying again then duplicate
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+d');
    await expect.poll(async () =>
      page.evaluate(() => window.__aurora!.getState().nodes.desktop!.childrenIds.length),
    ).toBeGreaterThan(before);

    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect.poll(async () =>
      page.evaluate(() => window.__aurora!.getState().nodes.desktop!.childrenIds.length),
    ).toBeGreaterThan(before + 1);
  });

  test('trash → restore', async ({ page }) => {
    const file = await pickDesktopFile(page, '灵感笔记');
    await page.locator(`[data-item="${file.id}"]`).first().click();
    await page.keyboard.press('Delete');
    await expect.poll(async () =>
      page.evaluate((id) => !!window.__aurora!.getState().nodes[id]?.deleted, file.id),
    ).toBe(true);

    await page.getByRole('button', { name: '回收站' }).first().click();
    await selectIds(page, [file.id]);
    await page.evaluate((id) => window.__aurora!.getState().restore([id]), file.id);
    await expect.poll(async () =>
      page.evaluate((id) => !window.__aurora!.getState().nodes[id]?.deleted, file.id),
    ).toBe(true);
  });
});

test.describe('Features coverage · overlays & edit', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDesktop(page);
  });

  test('Quick Look Space and Info Alt+Enter', async ({ page }) => {
    const file = await pickDesktopFile(page, '便签');
    await page.locator(`[data-item="${file.id}"]`).first().click();
    await page.keyboard.press(' ');
    await expect(page.getByTestId('quicklook')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('quicklook')).toHaveCount(0);

    const again = await pickDesktopFile(page, '便签');
    await page.locator(`[data-item="${again.id}"]`).first().click();
    await page.keyboard.press('Alt+Enter');
    await expect(page.getByTestId('info-panel')).toBeVisible();
    await expect(page.getByTestId('info-panel')).toContainText(/文本文档|\.txt|txt/i);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('info-panel')).toHaveCount(0);
  });

  test('F2 rename commits on Enter', async ({ page }) => {
    const file = await pickDesktopFile(page, '便签');
    await page.locator(`[data-item="${file.id}"]`).first().click();
    await page.keyboard.press('F2');
    const input = page.locator('input.rename-input');
    await expect(input).toBeVisible();
    await input.fill('便签-renamed.txt');
    await input.press('Enter');
    await expect.poll(async () =>
      page.evaluate((id) => window.__aurora!.getState().nodes[id]?.name, file.id),
    ).toBe('便签-renamed.txt');
  });

  test('batch rename dialog F6', async ({ page }) => {
    const ids = await page.evaluate(() => {
      const st = window.__aurora!.getState();
      return (st.nodes.desktop?.childrenIds || [])
        .map((id) => st.nodes[id])
        .filter((n) => n && n.kind === 'file' && !n.deleted)
        .slice(0, 2)
        .map((n) => n!.id);
    });
    await selectIds(page, ids);
    await page.keyboard.press('F6');
    await expect(page.getByTestId('batch-rename')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('batch-rename')).toHaveCount(0);
  });

  test('command palette opens and navigates to 回收站', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const palette = page.getByTestId('command-palette');
    await expect(palette).toBeVisible();
    await palette.locator('input').fill('前往：回收站');
    await palette.getByRole('button', { name: /前往：回收站/ }).click();
    await expect.poll(async () => locId(page)).toBe('sp-trash');
  });

  test('shortcuts help Shift+/', async ({ page }) => {
    await page.keyboard.press('Shift+/');
    await expect(page.getByTestId('shortcuts-help')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('shortcuts-help')).toHaveCount(0);
  });
});

test.describe('Features coverage · search sort tags favorites', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDesktop(page);
  });

  test('live filter search narrows selection pool', async ({ page }) => {
    const search = page.locator('input[placeholder*="Enter 深度"]').first();
    const before = await page.locator('[data-testid="grid-scroll"] [data-item]').count();
    await search.fill('灵感');
    await expect.poll(async () =>
      page.evaluate(() => {
        const st = window.__aurora!.getState();
        return st.tabs.find((t) => t.id === st.activeTabId)?.search;
      }),
    ).toBe('灵感');
    await expect.poll(async () => page.locator('[data-testid="grid-scroll"] [data-item]').count()).toBeGreaterThan(0);
    await expect.poll(async () => page.locator('[data-testid="grid-scroll"] [data-item]').count()).toBeLessThan(before);
    await search.fill('');
  });

  test('sort via store patch reflects in tab', async ({ page }) => {
    await page.evaluate(() => {
      window.__aurora!.getState().patchTab({ sortKey: 'size', sortDir: 'desc' });
    });
    const sort = await page.evaluate(() => {
      const st = window.__aurora!.getState();
      const t = st.tabs.find((x) => x.id === st.activeTabId)!;
      return { key: t.sortKey, dir: t.sortDir };
    });
    expect(sort).toEqual({ key: 'size', dir: 'desc' });
  });

  test('favorite toggle and tag via API surface', async ({ page }) => {
    const folder = await page.evaluate(() => {
      const st = window.__aurora!.getState();
      const n = (st.nodes.desktop?.childrenIds || [])
        .map((id) => st.nodes[id])
        .find((x) => x && x.kind === 'folder' && !x.deleted);
      if (!n) throw new Error('no folder');
      return { id: n.id, fav: !!n.favorite };
    });
    await page.evaluate((id) => window.__aurora!.getState().toggleFavorite(id), folder.id);
    await expect.poll(async () =>
      page.evaluate((id) => !!window.__aurora!.getState().nodes[id]?.favorite, folder.id),
    ).toBe(!folder.fav);

    const file = await pickDesktopFile(page, '旅行');
    await page.evaluate((id) => window.__aurora!.getState().toggleTag([id], 'red'), file.id);
    await expect.poll(async () =>
      page.evaluate((id) => window.__aurora!.getState().nodes[id]?.tags.includes('red'), file.id),
    ).toBe(true);
  });

  test('context menu: 移到回收站 then undo', async ({ page }) => {
    await lockDemo(page);
    const file = await pickDesktopFile(page, '旅行');
    await page.locator(`[data-item="${file.id}"]`).first().click({ button: 'right' });
    const menu = page.getByTestId('context-menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('button', { name: '移到回收站 Delete' }).click();
    await expect.poll(async () =>
      page.evaluate((id) => !!window.__aurora!.getState().nodes[id]?.deleted, file.id),
    ).toBe(true);
    await page.keyboard.press('Control+z');
    await expect.poll(async () =>
      page.evaluate((id) => !window.__aurora!.getState().nodes[id]?.deleted, file.id),
    ).toBe(true);
  });

  test('Ctrl+Shift+N creates folder', async ({ page }) => {
    const before = await page.evaluate(() => window.__aurora!.getState().nodes.desktop!.childrenIds.length);
    await page.keyboard.press('Control+Shift+N');
    await expect.poll(async () =>
      page.evaluate(() => window.__aurora!.getState().nodes.desktop!.childrenIds.length),
    ).toBeGreaterThan(before);
  });
});

test.describe('Features coverage · status & index', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDesktop(page);
  });

  test('status bar + index chip + prefs track radios', async ({ page }) => {
    await expect(page.getByTestId('status-bar')).toBeVisible();
    const chip = page.getByTestId('index-status-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText(/演示盘|索引/);
    await chip.click();
    const panel = page.getByTestId('index-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('index-prefs-form')).toBeVisible();
    await expect(page.getByTestId('index-track-ui')).toBeVisible();
    await expect(page.getByTestId('index-track-perf')).toBeVisible();
    await page.getByTestId('index-track-perf').click();
    await page.getByTestId('index-track-ui').click();
    await page.keyboard.press('Escape');
    if (await panel.count()) {
      await panel.click({ position: { x: 4, y: 4 } });
    }
  });

  test('gallery files-only toggle persists label swap', async ({ page }) => {
    await page.keyboard.press('Control+4');
    const toggle = page.getByTestId('gallery-files-only-toggle');
    await expect(toggle).toBeVisible();
    const before = await toggle.textContent();
    await toggle.click();
    await expect(toggle).not.toHaveText(before || '');
  });
});
