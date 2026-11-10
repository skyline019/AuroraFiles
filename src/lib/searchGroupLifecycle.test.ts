/**
 * Store 生命周期契约：退出搜索保留分组；navigate 保留分组（常驻）；back/forward 不剥分组
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { seedFS, ID } from './fs';

function activeTab() {
  const st = useStore.getState();
  return st.tabs.find((t) => t.id === st.activeTabId)!;
}

function resetDemoAt(nodeId: string) {
  const nodes = seedFS();
  useStore.setState({
    nodes,
    fsMode: 'demo',
    deepHits: null,
    deepMeta: null,
    deepSearching: false,
    folderRefreshing: false,
    booting: false,
  });
  useStore.getState().navigate({ t: 'node', id: nodeId });
  // navigate 不再清 groupBy；显式复位会话偏好
  useStore.getState().patchTab({
    groupByCategory: false,
    categoryFilter: [],
    collapsedCategories: [],
    search: '',
  });
}

describe('CONTRACT search/group lifecycle', () => {
  beforeEach(() => {
    resetDemoAt(ID.pics);
  });

  it('clearDeepSearch + empty search keeps groupBy and categoryFilter and collapsed', async () => {
    const st = useStore.getState();
    st.patchTab({
      groupByCategory: true,
      categoryFilter: ['image'],
      collapsedCategories: ['folder'],
      view: 'list',
    });
    await st.runDeepSearch('图');
    expect((useStore.getState().deepHits || []).length).toBeGreaterThan(0);
    expect(activeTab().groupByCategory).toBe(true);

    st.clearDeepSearch();
    st.patchTab({ search: '' });

    const tab = activeTab();
    expect(tab.groupByCategory).toBe(true);
    expect(tab.categoryFilter).toEqual(['image']);
    expect(tab.collapsedCategories).toEqual(['folder']);
    expect(tab.search).toBe('');
    expect(useStore.getState().deepHits).toBeNull();
  });

  it('scheduleDeepSearch("") clears hits but must not reset groupBy', () => {
    const st = useStore.getState();
    st.patchTab({ groupByCategory: true, search: '图' });
    useStore.setState({ deepHits: ['x'], deepMeta: { truncated: false, scanned: 1 } });
    st.scheduleDeepSearch('');
    // debounce 0 path for empty is sync clearDeepSearch
    expect(useStore.getState().deepHits).toBeNull();
    expect(activeTab().groupByCategory).toBe(true);
  });

  it('navigate into another folder keeps groupBy; resets filter/collapse/search/hits', () => {
    const st = useStore.getState();
    st.patchTab({
      groupByCategory: true,
      categoryFilter: ['image'],
      collapsedCategories: ['pdf'],
      search: '图',
    });
    useStore.setState({ deepHits: ['a'], deepMeta: { truncated: false, scanned: 1 } });

    st.navigate({ t: 'node', id: ID.docs });

    const tab = activeTab();
    expect(tab.groupByCategory).toBe(true);
    expect(tab.categoryFilter).toEqual([]);
    expect(tab.collapsedCategories).toEqual([]);
    expect(tab.search).toBe('');
    expect(useStore.getState().deepHits).toBeNull();
    expect(useStore.getState().deepSearching).toBe(false);
  });

  it('navigate to drive E keeps groupBy (常驻)', () => {
    const st = useStore.getState();
    st.patchTab({ groupByCategory: true, categoryFilter: ['image'] });
    st.navigate({ t: 'node', id: ID.e });
    const tab = activeTab();
    expect(tab.history[tab.hi]).toEqual({ t: 'node', id: ID.e });
    expect(tab.groupByCategory).toBe(true);
    expect(tab.categoryFilter).toEqual([]);
  });

  it('back preserves groupBy that was set after arriving (does not strip)', () => {
    const st = useStore.getState();
    st.navigate({ t: 'node', id: ID.docs });
    st.patchTab({ groupByCategory: true, categoryFilter: ['pdf'], collapsedCategories: ['folder'] });
    st.back();
    // back must NOT clear group flags
    const tab = activeTab();
    expect(tab.history[tab.hi]).toEqual({ t: 'node', id: ID.pics });
    expect(tab.groupByCategory).toBe(true);
    expect(tab.categoryFilter).toEqual(['pdf']);
    expect(tab.collapsedCategories).toEqual(['folder']);
    expect(tab.search).toBe('');
    expect(useStore.getState().deepHits).toBeNull();
  });

  it('forward preserves groupBy likewise', () => {
    const st = useStore.getState();
    st.navigate({ t: 'node', id: ID.docs });
    st.back();
    st.patchTab({ groupByCategory: true, categoryFilter: ['image'] });
    st.forward();
    const tab = activeTab();
    expect(tab.history[tab.hi]).toEqual({ t: 'node', id: ID.docs });
    expect(tab.groupByCategory).toBe(true);
    expect(tab.categoryFilter).toEqual(['image']);
  });

  it('runDeepSearch does not flip groupBy off', async () => {
    const st = useStore.getState();
    st.patchTab({ groupByCategory: true });
    await st.runDeepSearch('图');
    expect(activeTab().groupByCategory).toBe(true);
    expect(activeTab().search).toBe('图');
    expect((useStore.getState().deepHits || []).length).toBeGreaterThan(0);
  });
});
