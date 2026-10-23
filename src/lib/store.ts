import { create } from 'zustand';
import { useMemo } from 'react';
import {
  FSNode, TabState, Location, ID, nid, seedFS, visibleItems, poolFor,
  extOf, categoryOf, nodeTitle, tagLabel,
} from './fs';
import { api, isElectron, REAL_DEMO } from './aurora';
import { buildRealSkeleton, demoNodes, hydrateFolder, resolvePathId } from './realFs';
import { setPersistedTags } from './tagStore';
import { rankSearchResults } from './searchRank';
import { searchSourceLabel } from './indexLabel';
import { bumpGen, createDebouncedRefCount, isCurrentGen } from './asyncGate';

/** 进夹/刷新引用计数：并发 hydrate 不会被先完成的任务误关 */
let folderRefreshGate: ReturnType<typeof createDebouncedRefCount> | null = null;
let deepSearchGen = 0;

function getFolderRefreshGate(set: (p: Partial<Store> | ((s: Store) => Partial<Store>)) => void) {
  if (!folderRefreshGate) {
    folderRefreshGate = createDebouncedRefCount({
      hideDelayMs: 140,
      onChange: (active) => set({ folderRefreshing: active }),
    });
  }
  return folderRefreshGate;
}

export type WinState = 'open' | 'min' | 'closed';
export type FsMode = 'demo' | 'real';
export interface CtxMenu { x: number; y: number; ids: string[] }
interface Snap { label: string; nodes: Record<string, FSNode> }
export type ToastKind = 'success' | 'error' | 'info';
interface Toast { id: number; text: string; kind: ToastKind }

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const mkTab = (loc: Location = { t: 'node', id: ID.desktop }): TabState => ({
  id: nid(),
  history: [loc],
  hi: 0,
  view: loc.t === 'node' && loc.id === ID.dl ? 'list' : 'grid',
  sortKey: 'name',
  sortDir: 'asc',
  iconSize: 76,
  selection: [],
  renaming: null,
  search: '',
  showHidden: false,
  galleryFilesOnly: true,
});

const sanitize = (tabs: TabState[], nodes: Record<string, FSNode>): TabState[] =>
  tabs.map(t => ({ ...t, selection: t.selection.filter(id => !!nodes[id]) }));

const isAbsPath = (id: string) => /^[A-Za-z]:[\\/]/.test(id);
const volumeRootOf = (abs: string) => {
  const m = String(abs).match(/^([A-Za-z]:)/);
  return m ? `${m[1]}\\` : null;
};

interface Store {
  nodes: Record<string, FSNode>;
  tabs: TabState[];
  activeTabId: string;
  clipboard: { mode: 'copy' | 'cut'; ids: string[] } | null;
  undoStack: Snap[];
  redoStack: Snap[];
  toasts: Toast[];
  context: CtxMenu | null;
  quickLookId: string | null;
  infoId: string | null;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  batchOpen: boolean;
  indexPanelOpen: boolean;
  dark: boolean;
  maximized: boolean;
  winState: WinState;
  sidebarOpen: boolean;
  dropTarget: string | null;
  fsMode: FsMode;
  quickMap: Record<string, string> | null;
  booting: boolean;
  folderRefreshing: boolean;
  /** 真盘子树搜索命中 id 列表；非空时优先展示 */
  deepHits: string[] | null;
  deepMeta: { truncated: boolean; scanned: number; source?: string; cached?: boolean } | null;
  deepSearching: boolean;
  indexRoot: string | null;
  indexInfo: {
    ready: boolean;
    building: boolean;
    size: number;
    source?: string;
    watching?: boolean;
    usnReadable?: boolean | null;
    fts?: { ok?: boolean; size?: number };
    disk?: { exists: boolean; size?: number; deltaLines?: number };
  } | null;

  toast: (text: string, kind?: ToastKind) => void;
  refreshIndexStatus: () => Promise<void>;
  relaunchElevated: () => Promise<void>;
  refreshCurrent: () => Promise<void>;
  selectTab: (id: string) => void;
  addTab: (loc?: Location) => void;
  closeTab: (id: string) => void;
  moveTab: (from: number, to: number) => void;
  patchTab: (patch: Partial<TabState>) => void;
  navigate: (loc: Location) => void;
  back: () => void;
  forward: () => void;
  up: () => void;
  setSelection: (ids: string[]) => void;
  openNode: (id: string) => void;
  createFolder: () => void;
  createFile: (ext: string) => void;
  beginRename: (id: string) => void;
  commitRename: (id: string, name: string) => void;
  setClipboard: (mode: 'copy' | 'cut', ids: string[]) => void;
  paste: (destId?: string) => void;
  duplicate: (ids: string[]) => void;
  moveTo: (ids: string[], destId: string) => void;
  trash: (ids: string[]) => void;
  restore: (ids: string[]) => void;
  deleteForever: (ids: string[]) => void;
  emptyTrash: () => void;
  toggleTag: (ids: string[], color: FSNode['tags'][number]) => void;
  toggleFavorite: (id: string) => void;
  setLocked: (id: string, v: boolean) => void;
  renameMany: (entries: { id: string; name: string }[]) => void;
  compress: (ids: string[]) => void;
  undo: () => void;
  redo: () => void;
  setQuickLook: (id: string | null) => void;
  setInfo: (id: string | null) => void;
  setPalette: (v: boolean) => void;
  setShortcuts: (v: boolean) => void;
  setBatch: (v: boolean) => void;
  setIndexPanel: (v: boolean) => void;
  setContext: (m: CtxMenu | null) => void;
  toggleDark: () => void;
  setWinState: (v: WinState) => void;
  toggleMax: () => void;
  toggleSidebar: () => void;
  setDropTarget: (id: string | null) => void;
  touchAccess: (id: string) => void;
  bootstrapReal: () => Promise<void>;
  enterDemo: () => void;
  exitDemoToReal: () => Promise<void>;
  refreshFolder: (folderId: string) => Promise<void>;
  clearDeepSearch: () => void;
  /** 取消进行中的深搜，保留已有 deepHits（防闪空） */
  cancelDeepSearch: () => void;
  runDeepSearch: (query: string) => Promise<void>;
}

const loc = (t: TabState): Location => t.history[t.hi];
const locNodeId = (t: TabState): string | null => (loc(t).t === 'node' ? (loc(t) as { t: 'node'; id: string }).id : null);

function uniqueName(nodes: Record<string, FSNode>, parentId: string, name: string): string {
  const parent = nodes[parentId];
  if (!parent) return name;
  const taken = new Set(parent.childrenIds.map(c => nodes[c]?.name.toLowerCase()).filter(Boolean));
  if (!taken.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const isFile = dot > 0;
  const base = isFile ? name.slice(0, dot) : name;
  const ext = isFile ? name.slice(dot) : '';
  for (let i = 1; i < 99; i++) {
    const cand = i === 1 ? `${base} 副本${ext}` : `${base} 副本 ${i}${ext}`;
    if (!taken.has(cand.toLowerCase())) return cand;
  }
  return `${base} 副本 ${Date.now() % 100}${ext}`;
}

function cloneSubtree(srcId: string, destParent: string, nodes: Record<string, FSNode>): string | null {
  const src = nodes[srcId];
  if (!src) return null;
  const id = nid();
  const name = uniqueName(nodes, destParent, src.name);
  const copy: FSNode = {
    ...clone(src), id, name, parentId: destParent, childrenIds: [],
    deleted: false, trashedFrom: null, createdAt: Date.now(), modifiedAt: Date.now(), accessedAt: Date.now(),
  };
  nodes[id] = copy;
  nodes[destParent].childrenIds.push(id);
  for (const cid of src.childrenIds) cloneSubtree(cid, id, nodes);
  return id;
}

function isAncestor(nodes: Record<string, FSNode>, maybeAnc: string, id: string): boolean {
  let cur = nodes[id];
  let g = 0;
  while (cur && g++ < 99) {
    if (cur.id === maybeAnc) return true;
    cur = cur.parentId ? nodes[cur.parentId] : (undefined as never);
  }
  return false;
}

export const useStore = create<Store>()((set, get) => {
  const commit = (label: string, updater: (nodes: Record<string, FSNode>) => void) => {
    const s = get();
    const next = clone(s.nodes);
    updater(next);
    set({
      nodes: next,
      tabs: sanitize(s.tabs, next),
      undoStack: [...s.undoStack.slice(-24), { label, nodes: s.nodes }],
      redoStack: [],
    });
  };
  const tab = (): TabState => {
    const s = get();
    return s.tabs.find(t => t.id === s.activeTabId) ?? s.tabs[0];
  };
  const patchActive = (patch: Partial<TabState>) =>
    set(s => ({ tabs: s.tabs.map(t => (t.id === s.activeTabId ? { ...t, ...patch } : t)) }));

  const firstTab = mkTab();

  return {
    nodes: seedFS(),
    tabs: [firstTab],
    activeTabId: firstTab.id,
    clipboard: null,
    undoStack: [],
    redoStack: [],
    toasts: [],
    context: null,
    quickLookId: null,
    infoId: null,
    paletteOpen: false,
    shortcutsOpen: false,
    batchOpen: false,
    indexPanelOpen: false,
    dark: typeof localStorage !== 'undefined' && localStorage.getItem('aurora-dark') === '1',
    maximized: false,
    winState: 'open',
    sidebarOpen: true,
    dropTarget: null,
    fsMode: 'demo' as FsMode,
    quickMap: null,
    booting: false,
    folderRefreshing: false,
    deepHits: null,
    deepMeta: null,
    deepSearching: false,
    indexRoot: null,
    indexInfo: null,

    toast: (text, kind = 'success') => {
      const id = Date.now() + Math.random();
      set(s => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
      setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), kind === 'error' ? 3600 : 2600);
    },

    refreshIndexStatus: async () => {
      const s = get();
      if (s.fsMode !== 'real' || !isElectron()) return;
      const t = s.tabs.find((x) => x.id === s.activeTabId) ?? s.tabs[0];
      const nodeId = t ? locNodeId(t) : null;
      const abs = nodeId ? resolvePathId(nodeId, s.quickMap) : '';
      const root = (isAbsPath(abs) ? volumeRootOf(abs) : null) || s.indexRoot;
      if (!root) return;
      if (root !== s.indexRoot) set({ indexRoot: root });
      try {
        const st = await api().indexStatus(root);
        const wasBuilding = s.indexInfo?.building;
        set({
          indexInfo: {
            ready: st.ready,
            building: st.building,
            size: st.size,
            source: st.source,
            watching: st.watching,
            usnReadable: st.usnReadable,
            fts: st.fts,
            disk: st.disk,
          },
        });
        if (wasBuilding && st.ready && !st.building) {
          const bits = [`${st.size.toLocaleString()} 项`];
          if (st.disk?.exists) bits.push(st.disk.deltaLines ? '增量落盘' : '已落盘');
          if (st.fts?.ok) bits.push('FTS');
          if (st.usnReadable) bits.push('USN/FRN');
          else if (st.watching) bits.push('目录监视');
          get().toast(`高速索引就绪 · ${bits.join(' · ')}`);
          // 非提升：仅提示一次完整 USN 需管理员
          if (
            st.usnReadable === false
            && isElectron()
            && typeof sessionStorage !== 'undefined'
            && !sessionStorage.getItem('aurora-usn-hint')
          ) {
            sessionStorage.setItem('aurora-usn-hint', '1');
            setTimeout(() => {
              get().toast('提示：以管理员运行可启用完整 USN/FRN 追赶');
            }, 2800);
          }
        }
      } catch {
        /* ignore */
      }
    },

    relaunchElevated: async () => {
      if (!isElectron()) {
        get().toast('请在桌面版中提升权限');
        return;
      }
      try {
        get().toast('正在请求管理员权限…');
        await api().relaunchElevated();
      } catch (err) {
        get().toast((err as Error).message || '提升权限已取消', 'error');
      }
    },

    selectTab: (id) => set({ activeTabId: id }),
    addTab: (l) => {
      const t = mkTab(l ?? loc(tab()));
      set(s => ({ tabs: [...s.tabs, t], activeTabId: t.id }));
    },
    closeTab: (id) => set(s => {
      if (s.tabs.length === 1) return { winState: 'closed' as WinState };
      const idx = s.tabs.findIndex(t => t.id === id);
      const tabs = s.tabs.filter(t => t.id !== id);
      const activeTabId = s.activeTabId === id ? tabs[Math.max(0, idx - 1)].id : s.activeTabId;
      return { tabs, activeTabId };
    }),
    moveTab: (from, to) => set(s => {
      const tabs = [...s.tabs];
      const [t] = tabs.splice(from, 1);
      tabs.splice(to, 0, t);
      return { tabs };
    }),
    patchTab: patchActive,

    navigate: (l) => {
      const s = get();
      if (s.fsMode === 'real' && l.t === 'node' && l.id === REAL_DEMO) {
        s.enterDemo();
        return;
      }
      const t = tab();
      const history = [...t.history.slice(0, t.hi + 1), l];
      deepSearchGen = bumpGen(deepSearchGen);
      patchActive({ history, hi: history.length - 1, selection: [], renaming: null, search: '' });
      set({ deepHits: null, deepMeta: null, deepSearching: false });
      if (s.fsMode === 'real' && l.t === 'node') void get().refreshFolder(l.id);
    },
    back: () => {
      const t = tab();
      if (t.hi > 0) {
        deepSearchGen = bumpGen(deepSearchGen);
        patchActive({ hi: t.hi - 1, selection: [], renaming: null, search: '' });
        set({ deepSearching: false });
        const l = loc({ ...t, hi: t.hi - 1 });
        if (get().fsMode === 'real' && l.t === 'node') void get().refreshFolder(l.id);
      }
    },
    forward: () => {
      const t = tab();
      if (t.hi < t.history.length - 1) {
        deepSearchGen = bumpGen(deepSearchGen);
        patchActive({ hi: t.hi + 1, selection: [], renaming: null, search: '' });
        set({ deepSearching: false });
        const l = loc({ ...t, hi: t.hi + 1 });
        if (get().fsMode === 'real' && l.t === 'node') void get().refreshFolder(l.id);
      }
    },
    up: () => {
      const s = get();
      const t = tab();
      const l = loc(t);
      if (l.t !== 'node') return;
      const n = s.nodes[l.id];
      if (!n?.parentId || n.parentId === 'root' || (n.kind === 'special' && n.id !== ID.pc)) return;
      s.navigate({ t: 'node', id: n.parentId });
    },

    setSelection: (ids) => patchActive({ selection: ids, renaming: null }),

    openNode: (id) => {
      const s = get();
      if (id === REAL_DEMO) { s.enterDemo(); return; }
      const n = s.nodes[id];
      if (!n) return;
      s.touchAccess(id);
      if (n.kind !== 'file') { s.navigate({ t: 'node', id }); return; }
      const cat = categoryOf(extOf(n.name));
      if (cat === 'app') {
        if (s.fsMode === 'real' && isAbsPath(resolvePathId(id, s.quickMap))) {
          void api().openPath(resolvePathId(id, s.quickMap)).catch((err: Error) => s.toast(err.message || '无法打开'));
        } else s.toast(`已启动“${n.name}”（模拟运行）`);
        return;
      }
      if (cat === 'sys' || cat === 'db') {
        if (s.fsMode === 'real' && isAbsPath(resolvePathId(id, s.quickMap))) {
          void api().openPath(resolvePathId(id, s.quickMap)).catch((err: Error) => s.toast(err.message || '无法打开'));
        } else s.toast(`系统文件“${n.name}”无法直接打开`);
        return;
      }
      // 可预览类型 → 快速查看；其余真盘用系统打开
      const previewable = ['image', 'video', 'audio', 'pdf', 'doc', 'sheet', 'slide', 'text', 'code'].includes(cat)
        || ['docx', 'xlsx', 'pptx', 'ps1', 'psm1'].includes(extOf(n.name));
      if (previewable) { s.setQuickLook(id); return; }
      if (s.fsMode === 'real' && isAbsPath(resolvePathId(id, s.quickMap))) {
        void api().openPath(resolvePathId(id, s.quickMap)).catch((err: Error) => s.toast(err.message || '无法打开'));
        return;
      }
      s.setQuickLook(id);
    },

    createFolder: () => {
      const s = get();
      const t = tab();
      const parent = locNodeId(t);
      if (!parent || [ID.trash, ID.quick, ID.recent, REAL_DEMO].includes(parent) || s.nodes[parent]?.kind === 'file') {
        s.toast('当前位置无法新建文件夹'); return;
      }
      if (s.fsMode === 'real') {
        const abs = resolvePathId(parent, s.quickMap);
        if (!isAbsPath(abs)) { s.toast('当前位置无法新建文件夹'); return; }
        void (async () => {
          try {
            const created = await api().mkdir(abs, uniqueName(s.nodes, parent, '新建文件夹'));
            await s.refreshFolder(parent);
            patchActive({ selection: [created], renaming: created });
            s.toast('已新建文件夹');
          } catch (err) {
            s.toast((err as Error).message || '新建失败', 'error');
          }
        })();
        return;
      }
      const id = nid();
      commit('新建文件夹', nodes => {
        const name = uniqueName(nodes, parent, '新建文件夹');
        nodes[id] = {
          id, name, kind: 'folder', parentId: parent, childrenIds: [], size: 0,
          createdAt: Date.now(), modifiedAt: Date.now(), accessedAt: Date.now(), tags: [],
        };
        nodes[parent].childrenIds.push(id);
        nodes[parent].modifiedAt = Date.now();
      });
      patchActive({ selection: [id], renaming: id });
    },
    createFile: (ext) => {
      const s = get();
      const t = tab();
      const parent = locNodeId(t);
      if (!parent || [ID.trash, ID.quick, ID.recent].includes(parent)) { s.toast('当前位置无法新建文件'); return; }
      if (s.fsMode === 'real') {
        s.toast('真盘模式请用系统应用新建文件；可用「新建文件夹」');
        return;
      }
      const id = nid();
      commit('新建文件', nodes => {
        const name = uniqueName(nodes, parent, ext === 'md' ? '未命名.md' : '新建文本文档.txt');
        nodes[id] = {
          id, name, kind: 'file', parentId: parent, childrenIds: [], size: 0,
          createdAt: Date.now(), modifiedAt: Date.now(), accessedAt: Date.now(), tags: [],
          content: '',
        };
        nodes[parent].childrenIds.push(id);
      });
      patchActive({ selection: [id], renaming: id });
    },

    beginRename: (id) => patchActive({ renaming: id, selection: [id] }),
    commitRename: (id, name) => {
      const s = get();
      const n = s.nodes[id];
      patchActive({ renaming: null });
      if (!n || !name.trim() || name.trim() === n.name) return;
      if (n.locked) { s.toast(`“${n.name}”已锁定，无法重命名`); return; }
      if (/[\\/:*?"<>|]/.test(name)) { s.toast('文件名不能包含 \\ / : * ? " < > |'); return; }
      if (s.fsMode === 'real') {
        const abs = resolvePathId(id, s.quickMap);
        if (!isAbsPath(abs)) return;
        void (async () => {
          try {
            const next = await api().rename(abs, name.trim());
            const parent = n.parentId;
            if (parent) await s.refreshFolder(parent);
            patchActive({ selection: [next] });
            s.toast('已重命名');
          } catch (err) {
            s.toast((err as Error).message || '重命名失败', 'error');
          }
        })();
        return;
      }
      commit('重命名', nodes => {
        const cur = nodes[id];
        if (!cur) return;
        cur.name = uniqueName(nodes, cur.parentId ?? ID.desktop, name.trim());
        cur.modifiedAt = Date.now();
      });
    },

    setClipboard: (mode, ids) => {
      const s = get();
      const valid = ids.filter(id => {
        const n = s.nodes[id];
        return n && !n.system && n.kind !== 'drive' && n.kind !== 'special';
      });
      if (!valid.length) { s.toast('所选项目无法复制'); return; }
      set({ clipboard: { mode, ids: valid } });
      s.toast(mode === 'copy' ? `已复制 ${valid.length} 个项目` : `已剪切 ${valid.length} 个项目`);
    },

    paste: (destId) => {
      const s = get();
      const cb = s.clipboard;
      if (!cb) return;
      const dest = destId ?? locNodeId(tab());
      const destNode = dest ? s.nodes[dest] : undefined;
      if (!dest || !destNode || dest === ID.pc || destNode.kind === 'file' || destNode.kind === 'special' || destNode.deleted) {
        s.toast('无法粘贴到此位置'); return;
      }
      if (cb.mode === 'cut') {
        get().moveTo(cb.ids, dest);
        set({ clipboard: null });
        return;
      }
      if (s.fsMode === 'real') {
        const destAbs = resolvePathId(dest, s.quickMap);
        const sources = cb.ids.map(id => resolvePathId(id, s.quickMap)).filter(isAbsPath);
        if (!isAbsPath(destAbs) || !sources.length) { s.toast('无法粘贴到此位置'); return; }
        void (async () => {
          try {
            const out = await api().copy(sources, destAbs);
            await s.refreshFolder(dest);
            patchActive({ selection: out });
            s.toast(`已粘贴 ${out.length} 个项目`);
          } catch (err) {
            s.toast((err as Error).message || '粘贴失败', 'error');
          }
        })();
        return;
      }
      const ids = cb.ids.filter(id => s.nodes[id] && !s.nodes[id].deleted);
      if (!ids.length) { s.toast('剪贴板项目已失效'); set({ clipboard: null }); return; }
      const pasted: string[] = [];
      commit(`粘贴 ${ids.length} 个项目`, nodes => {
        for (const id of ids) { const c = cloneSubtree(id, dest, nodes); if (c) pasted.push(c); }
        nodes[dest].modifiedAt = Date.now();
      });
      patchActive({ selection: pasted });
      get().toast(`已粘贴 ${pasted.length} 个项目`);
    },

    duplicate: (ids) => {
      const s = get();
      if (s.fsMode === 'real') {
        const first = ids.map(id => s.nodes[id]).find(Boolean);
        if (!first?.parentId) return;
        s.setClipboard('copy', ids);
        s.paste(first.parentId);
        return;
      }
      const pasted: string[] = [];
      const valid = ids.filter(id => { const n = s.nodes[id]; return n && !n.deleted && !n.system && n.kind !== 'drive' && n.kind !== 'special'; });
      if (!valid.length) return;
      commit(`创建 ${valid.length} 个副本`, nodes => {
        for (const id of valid) {
          const n = nodes[id];
          if (n?.parentId) { const c = cloneSubtree(id, n.parentId, nodes); if (c) pasted.push(c); }
        }
      });
      patchActive({ selection: pasted });
      get().toast(`已创建 ${pasted.length} 个副本`);
    },

    moveTo: (ids, destId) => {
      const s = get();
      const dest = s.nodes[destId];
      if (!dest || destId === ID.pc || dest.kind === 'file' || dest.kind === 'special' || dest.deleted) { s.toast('无法移动到该位置'); return; }
      if (s.fsMode === 'real') {
        const destAbs = resolvePathId(destId, s.quickMap);
        const sources = ids.map(id => resolvePathId(id, s.quickMap)).filter(isAbsPath);
        if (!isAbsPath(destAbs) || !sources.length) { s.toast('无法移动到该位置'); return; }
        const parents = [...new Set(ids.map(id => s.nodes[id]?.parentId).filter(Boolean) as string[])];
        void (async () => {
          try {
            const out = await api().move(sources, destAbs);
            for (const p of parents) await s.refreshFolder(p);
            await s.refreshFolder(destId);
            patchActive({ selection: out });
            s.toast(`已移动 ${out.length} 个项目`);
          } catch (err) {
            s.toast((err as Error).message || '移动失败', 'error');
          }
        })();
        return;
      }
      const valid: string[] = [];
      for (const id of ids) {
        const n = s.nodes[id];
        if (!n || n.deleted || n.system || n.kind === 'drive' || n.kind === 'special') continue;
        if (n.locked) { s.toast(`“${n.name}”已锁定`); continue; }
        if (id === destId || isAncestor(s.nodes, id, destId)) { s.toast('不能移动到自身或其子文件夹'); continue; }
        if (n.parentId === destId) continue;
        valid.push(id);
      }
      if (!valid.length) return;
      commit(`移动 ${valid.length} 个项目`, nodes => {
        for (const id of valid) {
          const n = nodes[id];
          if (!n || !n.parentId) continue;
          const oldP = nodes[n.parentId];
          if (oldP) oldP.childrenIds = oldP.childrenIds.filter(c => c !== id);
          n.name = uniqueName(nodes, destId, n.name);
          n.parentId = destId;
          nodes[destId].childrenIds.push(id);
          nodes[destId].modifiedAt = Date.now();
        }
      });
      get().toast(`已移动 ${valid.length} 个项目`);
    },

    trash: (ids) => {
      const s = get();
      const valid = ids.filter(id => {
        const n = s.nodes[id];
        if (!n || n.deleted) return false;
        if (n.system || n.kind === 'drive' || n.kind === 'special') { s.toast(`“${n.name}”是系统项目，无法删除`); return false; }
        if (n.locked) { s.toast(`“${n.name}”已锁定，无法删除`); return false; }
        return true;
      });
      if (!valid.length) return;
      if (s.fsMode === 'real') {
        const paths = valid.map(id => resolvePathId(id, s.quickMap)).filter(isAbsPath);
        const parents = [...new Set(valid.map(id => s.nodes[id]?.parentId).filter(Boolean) as string[])];
        void (async () => {
          try {
            const r = await api().trash(paths);
            for (const p of parents) await s.refreshFolder(p);
            patchActive({ selection: [] });
            if (r.failed.length) s.toast(`已移入回收站 ${r.ok.length} 项，失败 ${r.failed.length} 项`);
            else s.toast(`已将 ${r.ok.length} 个项目移到系统回收站`);
          } catch (err) {
            s.toast((err as Error).message || '删除失败', 'error');
          }
        })();
        return;
      }
      commit(`移到回收站（${valid.length} 项）`, nodes => {
        for (const id of valid) {
          const n = nodes[id];
          if (n) { n.deleted = true; n.trashedFrom = n.parentId; n.favorite = false; }
        }
      });
      patchActive({ selection: [] });
      get().toast(`已将 ${valid.length} 个项目移到回收站`);
    },

    restore: (ids) => {
      const s = get();
      const valid = ids.filter(id => s.nodes[id]?.deleted);
      if (!valid.length) return;
      commit(`还原 ${valid.length} 个项目`, nodes => {
        for (const id of valid) {
          const n = nodes[id];
          if (!n) continue;
          let dest = n.trashedFrom && nodes[n.trashedFrom] && !nodes[n.trashedFrom].deleted ? n.trashedFrom : ID.desktop;
          n.deleted = false;
          n.parentId = dest;
          n.name = uniqueName(nodes, dest, n.name);
          if (!nodes[dest].childrenIds.includes(id)) nodes[dest].childrenIds.push(id);
          nodes[dest].modifiedAt = Date.now();
          n.trashedFrom = null;
        }
      });
      patchActive({ selection: [] });
      get().toast(`已还原 ${valid.length} 个项目`);
    },

    deleteForever: (ids) => {
      const s = get();
      if (s.fsMode === 'real') {
        const paths = ids.map(id => resolvePathId(id, s.quickMap)).filter(isAbsPath);
        const parents = [...new Set(ids.map(id => s.nodes[id]?.parentId).filter(Boolean) as string[])];
        if (!paths.length) return;
        if (!window.confirm(`永久删除 ${paths.length} 个项目？此操作不可从回收站还原。`)) return;
        void (async () => {
          try {
            const r = await api().deleteForever(paths);
            for (const p of parents) await s.refreshFolder(p);
            patchActive({ selection: [] });
            s.toast(r.failed.length ? `永久删除 ${r.ok.length}，失败 ${r.failed.length}` : '已永久删除所选项目');
          } catch (err) {
            s.toast((err as Error).message || '永久删除失败', 'error');
          }
        })();
        return;
      }
      commit('永久删除', nodes => {
        const kill = (id: string) => {
          const n = nodes[id];
          if (!n) return;
          for (const c of [...n.childrenIds]) kill(c);
          if (n.parentId && nodes[n.parentId]) nodes[n.parentId].childrenIds = nodes[n.parentId].childrenIds.filter(x => x !== id);
          delete nodes[id];
        };
        ids.forEach(kill);
      });
      patchActive({ selection: [] });
      get().toast('已永久删除所选项目');
    },

    emptyTrash: () => {
      const s = get();
      if (s.fsMode === 'real') {
        s.toast('请在系统回收站中清空；真盘删除已进入系统回收站');
        return;
      }
      const ids = Object.values(s.nodes).filter(n => n.deleted).map(n => n.id);
      if (!ids.length) return;
      commit('清空回收站', nodes => {
        const kill = (id: string) => {
          const n = nodes[id];
          if (!n) return;
          for (const c of [...n.childrenIds]) kill(c);
          if (n.parentId && nodes[n.parentId]) nodes[n.parentId].childrenIds = nodes[n.parentId].childrenIds.filter(x => x !== id);
          delete nodes[id];
        };
        ids.forEach(kill);
      });
      patchActive({ selection: [] });
      get().toast('回收站已清空');
    },

    toggleTag: (ids, color) => {
      const s = get();
      const valid = ids.filter(id => s.nodes[id] && !s.nodes[id].deleted);
      if (!valid.length) return;
      const allHave = valid.every(id => s.nodes[id].tags.includes(color));
      commit(allHave ? '移除标签' : `标记为「${tagLabel(color)}」`, nodes => {
        for (const id of valid) {
          const n = nodes[id];
          n.tags = allHave ? n.tags.filter(t => t !== color) : [...new Set([...n.tags, color])];
          if (s.fsMode === 'real' && isAbsPath(resolvePathId(id, s.quickMap))) {
            const abs = resolvePathId(id, s.quickMap);
            setPersistedTags(abs, n.tags);
            void api().writeTags(abs, n.tags).catch(() => undefined);
          }
        }
      });
    },

    clearDeepSearch: () => {
      deepSearchGen = bumpGen(deepSearchGen);
      if (isElectron()) void api().searchCancel().catch(() => undefined);
      set({ deepHits: null, deepMeta: null, deepSearching: false });
    },

    cancelDeepSearch: () => {
      if (!get().deepSearching) return;
      deepSearchGen = bumpGen(deepSearchGen);
      if (isElectron()) void api().searchCancel().catch(() => undefined);
      set({ deepSearching: false });
      get().toast('已取消深度搜索', 'info');
    },

    runDeepSearch: async (query) => {
      const s = get();
      const q = query.trim();
      if (!q) { set({ deepHits: null, deepMeta: null, deepSearching: false }); return; }
      patchActive({ search: q });

      // 单飞：新搜索作废旧任务（含主进程 walk）
      if (get().deepSearching) {
        deepSearchGen = bumpGen(deepSearchGen);
        if (isElectron()) void api().searchCancel().catch(() => undefined);
      }

      if (s.fsMode !== 'real' || !isElectron()) {
        const gen = bumpGen(deepSearchGen);
        deepSearchGen = gen;
        set({ deepSearching: true });
        // e2e：localStorage aurora-e2e-slow-search=1 可拉长演示深搜以便点取消
        const slow = typeof localStorage !== 'undefined' && localStorage.getItem('aurora-e2e-slow-search') === '1';
        if (slow) await new Promise((r) => setTimeout(r, 1800));
        if (!isCurrentGen(gen, deepSearchGen)) return;
        const tabState = tab();
        const list = visibleItems(get().nodes, { ...tabState, search: q });
        const ranked = rankSearchResults(list.map(n => ({ ...n, path: n.id })), q, 300);
        set({
          deepHits: ranked.map(n => n.id),
          deepMeta: { truncated: false, scanned: list.length },
          deepSearching: false,
        });
        return;
      }

      const t = tab();
      const location = loc(t);
      const rootId = location.t === 'node' ? location.id : ID.pc;
      const root = resolvePathId(rootId, s.quickMap);
      if (!isAbsPath(root) && rootId !== ID.pc) {
        get().toast('当前位置无法深度搜索');
        return;
      }
      const searchRoot = isAbsPath(root) ? root : (s.quickMap?.[ID.desktop]?.slice(0, 3) || 'C:\\');
      // 保留旧 deepHits 直至新结果落地；代数令牌可取消
      const gen = bumpGen(deepSearchGen);
      deepSearchGen = gen;
      set({ deepSearching: true });
      try {
        const res = await api().search(searchRoot, q, { maxResults: 400, maxDepth: 6, maxScan: 20000 });
        if (!isCurrentGen(gen, deepSearchGen)) return;
        if (res.cancelled) {
          set({ deepSearching: false });
          return;
        }
        const ranked = rankSearchResults(res.items, q, 400);
        const nodes = { ...get().nodes };
        const hits: string[] = [];
        for (const it of ranked) {
          const prev = nodes[it.path];
          nodes[it.path] = {
            id: it.path,
            name: it.name,
            kind: it.kind,
            parentId: rootId,
            childrenIds: prev?.childrenIds ?? [],
            ext: it.kind === 'file' ? it.name.split('.').pop()?.toLowerCase() : undefined,
            size: it.size,
            createdAt: prev?.createdAt ?? it.modifiedAt,
            modifiedAt: it.modifiedAt,
            accessedAt: Date.now(),
            tags: prev?.tags ?? [],
            favorite: prev?.favorite,
          };
          hits.push(it.path);
        }
        const cached = !!(res as { cached?: boolean }).cached;
        if (!isCurrentGen(gen, deepSearchGen)) return;
        set({
          nodes,
          deepHits: hits,
          deepMeta: { truncated: res.truncated, scanned: res.scanned, source: res.source, cached },
          deepSearching: false,
          tabs: sanitize(get().tabs, nodes),
        });
        const via = searchSourceLabel(res.source, cached);
        get().toast(
          res.truncated
            ? `找到 ${hits.length}+ 项（${via}·已截断·${res.scanned}）`
            : `搜索完成 · ${hits.length} 项（${via}·${res.scanned}）`,
        );
        void get().refreshIndexStatus();
      } catch (err) {
        if (!isCurrentGen(gen, deepSearchGen)) return;
        set({ deepSearching: false });
        get().toast((err as Error).message || '搜索失败', 'error');
      }
    },

    toggleFavorite: (id) => {
      const s = get();
      const n = s.nodes[id];
      if (!n) return;
      if (n.system || n.kind === 'drive' || n.kind === 'special') { s.toast('该项目无法固定'); return; }
      commit(n.favorite ? '从快速访问移除' : '固定到快速访问', nodes => { nodes[id].favorite = !nodes[id].favorite; });
      get().toast(n.favorite ? `已从快速访问移除“${n.name}”` : `已将“${n.name}”固定到快速访问`);
    },

    setLocked: (id, v) => {
      commit(v ? '锁定项目' : '解锁项目', nodes => { if (nodes[id]) nodes[id].locked = v; });
    },

    renameMany: (entries) => {
      const s = get();
      const cleaned = entries.filter((e) => e.name.trim());
      if (!cleaned.length) return;

      if (s.fsMode === 'real') {
        const payload = cleaned
          .map(({ id, name }) => ({ path: resolvePathId(id, s.quickMap), name: name.trim(), id }))
          .filter((e) => isAbsPath(e.path));
        if (!payload.length) { s.toast('无法重命名所选项目'); return; }
        void (async () => {
          try {
            const outs = await api().renameMany(payload.map(({ path: p, name }) => ({ path: p, name })));
            const nodes = { ...get().nodes };
            payload.forEach((e, i) => {
              const nextPath = outs[i];
              const old = nodes[e.id] || nodes[e.path];
              if (!old) return;
              const newName = nextPath.split(/[\\/]/).pop() || e.name;
              const updated = { ...old, id: nextPath, name: newName };
              delete nodes[e.id];
              if (e.path !== e.id) delete nodes[e.path];
              nodes[nextPath] = updated;
              if (updated.parentId && nodes[updated.parentId]) {
                nodes[updated.parentId] = {
                  ...nodes[updated.parentId],
                  childrenIds: nodes[updated.parentId].childrenIds.map((cid) => (cid === e.id || cid === e.path ? nextPath : cid)),
                };
              }
            });
            set({ nodes, tabs: sanitize(get().tabs, nodes), deepHits: null });
            get().toast(`已批量重命名 ${outs.length} 个项目`);
            const parent = payload[0] && (nodes[outs[0]]?.parentId);
            if (parent) void get().refreshFolder(parent);
          } catch (err) {
            get().toast((err as Error).message || '批量重命名失败', 'error');
          }
        })();
        return;
      }

      commit(`批量重命名 ${cleaned.length} 个项目`, nodes => {
        for (const { id, name } of cleaned) {
          const n = nodes[id];
          if (n && name.trim()) n.name = name.trim();
        }
      });
      get().toast(`已批量重命名 ${cleaned.length} 个项目`);
    },

    compress: (ids) => {
      const s = get();
      const first = ids[0] ? s.nodes[ids[0]] : undefined;
      const parent = first?.parentId;
      if (!parent) return;
      const baseName = ids.length === 1 && first ? first.name.replace(/\.[^.]+$/, '') : '归档';
      const total = ids.reduce((sum, id) => sum + (s.nodes[id]?.size ?? 0), 0);
      const id = nid();
      commit('压缩为 ZIP', nodes => {
        nodes[id] = {
          id, name: uniqueName(nodes, parent, `${baseName}.zip`), kind: 'file', parentId: parent,
          childrenIds: [], size: Math.round(total * 0.62), createdAt: Date.now(), modifiedAt: Date.now(),
          accessedAt: Date.now(), tags: [],
        };
        nodes[parent].childrenIds.push(id);
      });
      get().toast('已创建 ZIP 压缩包');
    },

    undo: () => {
      const s = get();
      const snap = s.undoStack[s.undoStack.length - 1];
      if (!snap) { s.toast('没有可撤销的操作'); return; }
      set({
        nodes: snap.nodes,
        tabs: sanitize(s.tabs, snap.nodes),
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, { label: snap.label, nodes: s.nodes }],
      });
      get().toast(`已撤销：${snap.label}`);
    },
    redo: () => {
      const s = get();
      const snap = s.redoStack[s.redoStack.length - 1];
      if (!snap) return;
      set({
        nodes: snap.nodes,
        tabs: sanitize(s.tabs, snap.nodes),
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, { label: snap.label, nodes: s.nodes }],
      });
      get().toast(`已重做：${snap.label}`);
    },

    setQuickLook: (id) => set({ quickLookId: id }),
    setInfo: (id) => set({ infoId: id }),
    setPalette: (v) => set({ paletteOpen: v }),
    setShortcuts: (v) => set({ shortcutsOpen: v }),
    setBatch: (v) => set({ batchOpen: v }),
    setIndexPanel: (v) => set({ indexPanelOpen: v }),
    setContext: (m) => set({ context: m }),
    toggleDark: () => {
      const v = !get().dark;
      set({ dark: v });
      localStorage.setItem('aurora-dark', v ? '1' : '0');
    },
    setWinState: (v) => set({ winState: v }),
    toggleMax: () => set(s => ({ maximized: !s.maximized })),
    toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
    setDropTarget: (id) => set({ dropTarget: id }),
    touchAccess: (id) => set(s => {
      const n = s.nodes[id];
      if (!n) return {};
      return { nodes: { ...s.nodes, [id]: { ...n, accessedAt: Date.now() } } };
    }),

    refreshFolder: async (folderId) => {
      const s = get();
      if (s.fsMode !== 'real') return;
      const gate = getFolderRefreshGate(set);
      gate.enter();
      try {
        const showHidden = tab().showHidden;
        const next = await hydrateFolder(s.nodes, folderId, showHidden, s.quickMap);
        set({ nodes: next, tabs: sanitize(s.tabs, next) });
        const abs = resolvePathId(folderId, s.quickMap);
        const vol = isAbsPath(abs) ? volumeRootOf(abs) : null;
        if (vol && isElectron()) {
          if (vol !== get().indexRoot) set({ indexRoot: vol });
          void api().ensureIndex(vol, { maxDepth: 10, maxScan: 120_000 }).catch(() => undefined);
        }
      } catch (err) {
        get().toast((err as Error).message || '无法读取目录', 'error');
      } finally {
        gate.leave();
      }
    },

    refreshCurrent: async () => {
      const t = tab();
      const id = locNodeId(t);
      if (!id) {
        get().toast('当前位置无法刷新', 'info');
        return;
      }
      if (get().fsMode !== 'real') {
        get().toast('已刷新');
        return;
      }
      try {
        await get().refreshFolder(id);
        get().toast('已刷新');
      } catch (err) {
        get().toast((err as Error).message || '刷新失败', 'error');
      }
    },

    bootstrapReal: async () => {
      if (!isElectron()) return;
      set({ booting: true });
      try {
        const { nodes, quickMap } = await buildRealSkeleton();
        const desk = quickMap[ID.desktop] || ID.pc;
        const t = mkTab({ t: 'node', id: desk });
        const driveRoot = (quickMap[ID.desktop] || desk).slice(0, 3);
        const fixedDrives = Object.values(nodes)
          .filter((n) => n.kind === 'drive' && !n.drive?.removable && isAbsPath(n.id))
          .map((n) => ({ path: n.id, removable: !!n.drive?.removable }));
        set({
          fsMode: 'real',
          quickMap,
          nodes,
          tabs: [t],
          activeTabId: t.id,
          clipboard: null,
          undoStack: [],
          redoStack: [],
          booting: false,
          indexRoot: driveRoot.endsWith('\\') ? driveRoot : `${driveRoot}\\`,
          indexInfo: { ready: false, building: true, size: 0 },
        });
        await get().refreshFolder(desk);
        const roots = fixedDrives.length
          ? fixedDrives
          : [{ path: driveRoot }];
        void api().ensureIndexes(roots, { maxDepth: 10, maxScan: 120_000 })
          .then(() => get().refreshIndexStatus())
          .catch(() => undefined);
        get().toast(`已连接本机磁盘 · 正在索引 ${roots.length} 个卷`);
        let ticks = 0;
        const timer = setInterval(() => {
          ticks += 1;
          void get().refreshIndexStatus().then(() => {
            const info = get().indexInfo;
            if ((info?.ready && !info.building) || ticks > 90) clearInterval(timer);
          });
        }, 1500);
      } catch (err) {
        set({ booting: false });
        get().toast((err as Error).message || '无法连接磁盘，已保留演示盘', 'error');
      }
    },

    enterDemo: () => {
      const nodes = demoNodes();
      const t = mkTab({ t: 'node', id: ID.desktop });
      set({
        fsMode: 'demo',
        nodes,
        tabs: [t],
        activeTabId: t.id,
        clipboard: null,
        undoStack: [],
        redoStack: [],
      });
      get().toast('已进入极光演示盘（虚拟数据）');
    },

    exitDemoToReal: async () => {
      if (!isElectron()) {
        get().toast('请在桌面版中返回真盘');
        return;
      }
      await get().bootstrapReal();
    },
  };
});

export const useActiveTab = (): TabState =>
  useStore(s => s.tabs.find(t => t.id === s.activeTabId) ?? s.tabs[0]);

export const useItems = (): FSNode[] => {
  const nodes = useStore(s => s.nodes);
  const deepHits = useStore(s => s.deepHits);
  const tab = useActiveTab();
  return useMemo(() => {
    if (deepHits?.length && tab.search.trim()) {
      const list = deepHits.map(id => nodes[id]).filter((n): n is FSNode => !!n && !n.deleted);
      if (!tab.showHidden) return list.filter(n => !n.hidden);
      return list;
    }
    return visibleItems(nodes, tab);
  }, [nodes, tab, deepHits]);
};

export const useCurrentLocation = (): Location => {
  const tab = useActiveTab();
  return tab.history[tab.hi];
};

export const tabTitle = (nodes: Record<string, FSNode>, t: TabState): string =>
  nodeTitle(nodes, t.history[t.hi]);

export const currentNodeId = (t: TabState): string | null => {
  const l = t.history[t.hi];
  return l.t === 'node' ? l.id : null;
};

export const poolForTab = (nodes: Record<string, FSNode>, t: TabState): FSNode[] =>
  poolFor(nodes, t.history[t.hi]);
