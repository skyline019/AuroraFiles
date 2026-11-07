import { expect, Page } from '@playwright/test';

/** Ensure demo disk is active and overlays are quiet. */
export async function lockDemo(page: Page) {
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
      context: null,
      quickLookId: null,
      infoId: null,
      batchOpen: false,
      paletteOpen: false,
      shortcutsOpen: false,
      indexPanelOpen: false,
      refreshFolder: async () => undefined,
    } as never);
  });
}

export async function gotoDesktop(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '桌面' }).first()).toBeVisible({ timeout: 20_000 });
  await lockDemo(page);
  await page.evaluate(() => {
    const api = window.__aurora!;
    api.getState().navigate({ t: 'node', id: 'desktop' });
    const tabs = api.getState().tabs.map((t) =>
      t.id === api.getState().activeTabId
        ? { ...t, view: 'grid' as const, search: '', selection: [], renaming: null }
        : t,
    );
    api.setState({ tabs });
  });
  await page.keyboard.press('Control+1');
  await expect(page.getByTestId('grid-scroll')).toBeVisible({ timeout: 10_000 });
}

export async function pickDesktopFile(page: Page, nameIncludes?: string) {
  return page.evaluate((needle) => {
    const api = window.__aurora!;
    const st = api.getState();
    const desk = st.nodes.desktop;
    const kids = (desk?.childrenIds || [])
      .map((id) => st.nodes[id])
      .filter((n): n is NonNullable<typeof n> => !!n && n.kind === 'file' && !n.deleted);
    const hit = needle ? kids.find((n) => n.name.includes(needle)) : kids[0];
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
            renaming: null,
          }
        : t,
    );
    api.setState({
      tabs,
      quickLookId: null,
      infoId: null,
      batchOpen: false,
      paletteOpen: false,
      context: null,
    });
    return { id: hit.id, name: hit.name };
  }, nameIncludes || null);
}

export async function selectIds(page: Page, ids: string[]) {
  await page.evaluate((sel) => {
    const api = window.__aurora!;
    const st = api.getState();
    const tabs = st.tabs.map((t) => (t.id === st.activeTabId ? { ...t, selection: sel } : t));
    api.setState({ tabs });
  }, ids);
}

export async function locId(page: Page) {
  return page.evaluate(() => {
    const st = window.__aurora!.getState();
    const tab = st.tabs.find((t) => t.id === st.activeTabId) ?? st.tabs[0];
    const loc = tab.history[tab.hi];
    return loc.t === 'node' ? loc.id : null;
  });
}
