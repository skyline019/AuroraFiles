/**
 * 分组常驻 × 深搜置顶 — 自动截图 + 录屏 + 自证契约
 *
 *   AURORA_PERF_RUN_ID=group-persist-1 npx playwright test e2e/group-persist.visual.spec.ts
 *
 * 产物：perf-out/<runId>/screenshots/*.png、video/、report.json
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { gotoDesktop, lockDemo } from './helpers/demo';

const OUT_ROOT = process.env.AURORA_PERF_OUT || path.join(process.cwd(), 'perf-out');

test.use({
  video: { mode: 'on', size: { width: 1280, height: 800 } },
  viewport: { width: 1280, height: 800 },
});

async function ensureRunDir() {
  const runId = process.env.AURORA_PERF_RUN_ID || `group-persist-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const runDir = path.join(OUT_ROOT, runId);
  await fs.mkdir(path.join(runDir, 'screenshots'), { recursive: true });
  await fs.mkdir(path.join(runDir, 'video'), { recursive: true });
  return { runId, runDir };
}

/** 等 view-fade / AnimatePresence 落地后再截，并要求主区有实质像素 */
async function settleView(page: Page, minItems = 1) {
  // 关掉动效，避免截到 opacity:0 的中间帧
  await page.addStyleTag({
    content: `
      *, *::before, *::after { animation: none !important; transition: none !important; }
      [data-item], [data-testid^="section-header-"] { content-visibility: visible !important; }
      #aurora-main > div { opacity: 1 !important; transform: none !important; }
    `,
  });
  await expect(page.locator('[data-item]').first()).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => page.locator('[data-item]').count(), { timeout: 8_000 }).toBeGreaterThanOrEqual(minItems);
  // 确认格子有非零盒模型（虚拟化空窗会挂零高节点）
  await expect.poll(async () =>
    page.evaluate(() => {
      const els = [...document.querySelectorAll('[data-item]')] as HTMLElement[];
      return els.reduce((acc, el) => {
        const r = el.getBoundingClientRect();
        return acc + (r.width > 8 && r.height > 8 && r.bottom > 80 && r.top < 760 ? 1 : 0);
      }, 0);
    }),
  ).toBeGreaterThanOrEqual(minItems);
  await page.waitForTimeout(80);
}

async function assertShotHasContent(pngPath: string, name: string, minColoredPct = 2.5) {
  const { readFileSync } = await import('node:fs');
  const png = PNG.sync.read(readFileSync(pngPath));
  const { width: w, height: h, data } = png;
  let colored = 0;
  let total = 0;
  for (let y = 120; y < Math.min(750, h); y += 2) {
    for (let x = 260; x < Math.min(1260, w); x += 2) {
      const i = (w * y + x) << 2;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      total += 1;
      if (sat > 12 && (r + g + b) / 3 < 250) colored += 1;
    }
  }
  const pct = (colored / Math.max(1, total)) * 100;
  expect(pct, `screenshot ${name} content too empty (${pct.toFixed(2)}% colored)`).toBeGreaterThanOrEqual(minColoredPct);
  return pct;
}

async function shot(page: Page, runDir: string, name: string, minColoredPct = 2.5) {
  await settleView(page);
  const p = path.join(runDir, 'screenshots', `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  const st = await fs.stat(p);
  expect(st.size, `screenshot ${name} empty`).toBeGreaterThan(8_000);
  const pct = await assertShotHasContent(p, name, minColoredPct);
  return { path: p, coloredPct: pct };
}

async function seedERoot(page: Page) {
  return page.evaluate(() => {
    const api = window.__aurora!;
    const st = api.getState();
    const nodes = { ...st.nodes };
    // 复用演示盘 E:，贴近真实「卷根几乎全是文件夹」
    const root = 'e';
    const child = 'e-mixed';
    const now = Date.now();
    const folders = ['Agent', 'AndroidProjects', 'JavaProjects', 'Program Files', 'Tools'];
    const folderIds = folders.map((name) => `e-${name}`);
    for (const id of folderIds) {
      const name = id.slice(2);
      nodes[id] = {
        id,
        name,
        kind: 'folder',
        parentId: root,
        childrenIds: [],
        size: 0,
        createdAt: now,
        modifiedAt: now,
        accessedAt: now,
        tags: [],
      };
    }
    const mixKids = [
      { id: `${child}-a.wav`, name: 'a.wav', kind: 'file' as const, ext: 'wav' },
      { id: `${child}-_fwd`, name: '_fwd', kind: 'folder' as const },
      { id: `${child}-_cwt.py`, name: '_cwt.py', kind: 'file' as const, ext: 'py' },
      { id: `${child}-_new`, name: '_new', kind: 'folder' as const },
      { id: `${child}-1.wav`, name: '1.wav', kind: 'file' as const, ext: 'wav' },
      { id: `${child}-2019white`, name: '2019white', kind: 'folder' as const },
    ];
    nodes[child] = {
      id: child,
      name: 'mixed',
      kind: 'folder',
      parentId: root,
      childrenIds: mixKids.map((k) => k.id),
      size: 0,
      createdAt: now,
      modifiedAt: now,
      accessedAt: now,
      tags: [],
    };
    for (const k of mixKids) {
      nodes[k.id] = {
        id: k.id,
        name: k.name,
        kind: k.kind,
        parentId: child,
        childrenIds: [],
        size: k.kind === 'file' ? 1024 : 0,
        createdAt: now,
        modifiedAt: now,
        accessedAt: now,
        tags: [],
        ext: 'ext' in k ? k.ext : undefined,
      };
    }
    const e = nodes[root];
    if (!e) throw new Error('demo E: missing');
    nodes[root] = {
      ...e,
      name: '本地磁盘 (E:)',
      childrenIds: [...folderIds, child],
    };
    // 从 pc 孩子里保证 e 仍在
    const pc = nodes.pc;
    if (pc && !pc.childrenIds.includes(root)) {
      nodes.pc = { ...pc, childrenIds: [...pc.childrenIds, root] };
    }
    api.setState({
      nodes,
      fsMode: 'demo',
      deepHits: null,
      deepMeta: null,
      deepSearching: false,
      refreshFolder: async () => undefined,
    } as never);
    return { root, child, mixIds: mixKids.map((k) => k.id) };
  });
}

async function renderedKinds(page: Page) {
  return page.evaluate(() => {
    const st = window.__aurora!.getState();
    const ids = [...document.querySelectorAll('[data-item]')].map((el) => el.getAttribute('data-item')!);
    return ids.map((id) => {
      const n = st.nodes[id];
      if (!n) return null;
      // 与 isFolderLike 一致：缺 kind = file（索引契约）
      const folder = n.kind === 'folder' || n.kind === 'drive' || n.kind === 'special';
      return folder ? 'folder' : 'file';
    }).filter(Boolean) as Array<'file' | 'folder'>;
  });
}

function assertPartitioned(kinds: Array<'file' | 'folder'>) {
  const hasF = kinds.includes('folder');
  const hasFile = kinds.includes('file');
  expect(hasF && hasFile, `need both kinds: ${JSON.stringify(kinds)}`).toBe(true);
  expect(kinds.lastIndexOf('folder')).toBeLessThan(kinds.indexOf('file'));
}

test.describe('Group persist visual contract', () => {
  test('E-root toggle · navigate stick · search partition · exit keep · screenshots+video', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const { runId, runDir } = await ensureRunDir();
    const checks: { step: string; ok: boolean; detail?: string }[] = [];
    const shots: { path: string; coloredPct: number }[] = [];

    const mark = (step: string, ok: boolean, detail?: string) => {
      checks.push({ step, ok, detail });
      expect(ok, `${step}: ${detail || ''}`).toBe(true);
    };

    await gotoDesktop(page);
    await lockDemo(page);
    const seeded = await seedERoot(page);

    // 1) 仅文件夹卷根：分组开关必须可见
    await page.evaluate((root) => {
      const st = window.__aurora!.getState();
      st.navigate({ t: 'node', id: root });
      st.patchTab({ view: 'grid', groupByCategory: false, categoryFilter: [], search: '' });
    }, seeded.root);
    await expect(page.getByTestId('category-bar')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('cat-group-toggle')).toBeVisible();
    shots.push(await shot(page, runDir, '01-e-root-toggle-visible'));
    mark('e_root_toggle_visible', true, `colored=${shots.at(-1)!.coloredPct.toFixed(2)}%`);

    // 2) 开启分组 → 文件夹节头
    await page.getByTestId('cat-group-toggle').click();
    await expect.poll(async () =>
      page.evaluate(() => window.__aurora!.getState().tabs.find((t) => t.id === window.__aurora!.getState().activeTabId)!.groupByCategory),
    ).toBe(true);
    await expect(page.getByTestId('section-header-folder')).toBeVisible({ timeout: 5_000 });
    shots.push(await shot(page, runDir, '02-e-root-grouped'));
    mark('e_root_folder_section', true, `colored=${shots.at(-1)!.coloredPct.toFixed(2)}%`);

    // 3) 进子目录：分组常驻
    await page.evaluate((child) => {
      window.__aurora!.getState().navigate({ t: 'node', id: child });
    }, seeded.child);
    await expect.poll(async () =>
      page.evaluate(() => window.__aurora!.getState().tabs.find((t) => t.id === window.__aurora!.getState().activeTabId)!.groupByCategory),
    ).toBe(true);
    await expect(page.getByTestId('section-header-folder')).toBeVisible({ timeout: 5_000 });
    shots.push(await shot(page, runDir, '03-child-group-sticky'));
    mark('navigate_keeps_group', true, `colored=${shots.at(-1)!.coloredPct.toFixed(2)}%`);

    // 4) 模拟深搜相关度交错命中（省略 kind 的文件）→ 置顶分区
    await page.evaluate((mixIds) => {
      const api = window.__aurora!;
      const st = api.getState();
      const nodes = { ...st.nodes };
      // 索引契约：文件缺 kind
      for (const id of mixIds) {
        const n = nodes[id];
        if (n && n.kind === 'file') {
          const copy = { ...n };
          delete (copy as { kind?: string }).kind;
          nodes[id] = copy as typeof n;
        }
      }
      api.setState({
        nodes,
        deepHits: mixIds,
        deepMeta: { truncated: false, scanned: mixIds.length },
        deepSearching: false,
      });
      const tabs = st.tabs.map((t) =>
        t.id === st.activeTabId
          ? { ...t, search: 'w', groupByCategory: true, view: 'grid' as const }
          : t,
      );
      api.setState({ tabs });
    }, seeded.mixIds);

    await expect.poll(async () => (await renderedKinds(page)).length).toBeGreaterThan(3);
    const kindsSearch = await renderedKinds(page);
    assertPartitioned(kindsSearch);
    await expect(page.getByTestId('section-header-folder')).toBeVisible();
    shots.push(await shot(page, runDir, '04-deep-search-partitioned'));
    mark('deep_search_partitioned', true, `${kindsSearch.join(',')} colored=${shots.at(-1)!.coloredPct.toFixed(2)}%`);

    // 5) 退出搜索：分组仍在
    await page.evaluate(() => {
      const st = window.__aurora!.getState();
      st.clearDeepSearch();
      st.patchTab({ search: '' });
    });
    await expect.poll(async () =>
      page.evaluate(() => {
        const st = window.__aurora!.getState();
        const tab = st.tabs.find((t) => t.id === st.activeTabId)!;
        return tab.groupByCategory === true && st.deepHits == null && tab.search === '';
      }),
    ).toBe(true);
    await expect(page.getByTestId('section-header-folder')).toBeVisible({ timeout: 5_000 });
    shots.push(await shot(page, runDir, '05-exit-search-group-kept'));
    mark('exit_search_keeps_group', true, `colored=${shots.at(-1)!.coloredPct.toFixed(2)}%`);

    // 6) 回到 E: 根：分组仍常驻
    await page.evaluate((root) => {
      window.__aurora!.getState().navigate({ t: 'node', id: root });
    }, seeded.root);
    await expect.poll(async () =>
      page.evaluate(() => window.__aurora!.getState().tabs.find((t) => t.id === window.__aurora!.getState().activeTabId)!.groupByCategory),
    ).toBe(true);
    await expect(page.getByTestId('cat-group-toggle')).toBeVisible();
    await expect(page.getByTestId('section-header-folder')).toBeVisible({ timeout: 5_000 });
    shots.push(await shot(page, runDir, '06-back-e-root-still-grouped'));
    mark('back_e_root_still_grouped', true, `colored=${shots.at(-1)!.coloredPct.toFixed(2)}%`);

    const video = testInfo.attachments.find((a) => a.name === 'video');
    const report = {
      runId,
      ok: checks.every((c) => c.ok),
      checks,
      shots: shots.map((s) => ({
        file: path.relative(process.cwd(), s.path),
        coloredPct: Number(s.coloredPct.toFixed(2)),
      })),
      videoAttached: !!video,
    };
    await fs.writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
    expect(report.ok).toBe(true);

    for (const s of shots) {
      await testInfo.attach(path.basename(s.path), { path: s.path, contentType: 'image/png' });
    }
    await testInfo.attach('report.json', {
      path: path.join(runDir, 'report.json'),
      contentType: 'application/json',
    });
  });
});
