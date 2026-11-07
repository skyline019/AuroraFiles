import { useEffect } from 'react';
import { useStore, currentNodeId } from '@/lib/store';
import { ID, visibleItems, extOf, categoryOf } from '@/lib/fs';
import { galleryStepPool, stepInPool } from '@/lib/asyncGate';

/** Global keyboard shortcuts shared by Electron + web shells. */
export function useGlobalKeys() {
  useEffect(() => {
    const activeTab = () => {
      const st = useStore.getState();
      return st.tabs.find((t) => t.id === st.activeTabId) ?? st.tabs[0];
    };
    const itemsNow = () => {
      const st = useStore.getState();
      return visibleItems(st.nodes, activeTab());
    };
    const selectAll = () => useStore.getState().setSelection(itemsNow().map((i) => i.id));
    const invert = () => {
      const st = useStore.getState();
      const sel = new Set(activeTab().selection);
      st.setSelection(itemsNow().map((i) => i.id).filter((id) => !sel.has(id)));
    };
    const selFirst = () => {
      const st = useStore.getState();
      const id = activeTab().selection[0];
      return id ? st.nodes[id] : undefined;
    };
    const openSelected = () => {
      const st = useStore.getState();
      const id = activeTab().selection[0];
      if (id) st.openNode(id);
    };
    const quickLookToggle = () => {
      const st = useStore.getState();
      if (st.quickLookId) {
        st.setQuickLook(null);
        return;
      }
      const n = selFirst();
      if (!n) return;
      if (n.kind !== 'file') {
        st.toast('请选择文件以快速查看', 'info');
        return;
      }
      const cat = categoryOf(extOf(n.name));
      if (cat === 'app' || cat === 'sys' || cat === 'db') st.toast(`“${n.name}”不支持快速查看`, 'info');
      else st.setQuickLook(n.id);
    };

    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const tab = activeTab();
      const target = e.target as HTMLElement;
      const typing = !!target.closest('input, textarea, [contenteditable="true"]');
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (st.paletteOpen) return;
      if (e.key === 'Escape') {
        if (st.quickLookId) { st.setQuickLook(null); return; }
        if (st.batchOpen) { st.setBatch(false); return; }
        if (st.shortcutsOpen) { st.setShortcuts(false); return; }
        if (st.infoId) { st.setInfo(null); return; }
        if (typing) return;
        if (tab.search) { st.patchTab({ search: '' }); return; }
        if (tab.selection.length) st.setSelection([]);
        return;
      }
      if (st.quickLookId || st.batchOpen || st.shortcutsOpen) return;

      if (mod && key === 'k') { e.preventDefault(); st.setPalette(true); return; }
      if (mod && key === 'e') { e.preventDefault(); window.dispatchEvent(new CustomEvent('aurora:focus-search')); return; }
      if (typing) return;

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const list = st.deepHits?.length && tab.search.trim()
          ? st.deepHits.map((id) => st.nodes[id]).filter((n): n is NonNullable<typeof n> => !!n && !n.deleted)
          : visibleItems(st.nodes, tab);
        if (!list.length) return;
        e.preventDefault();
        const pool = tab.view === 'gallery' ? galleryStepPool(list) : list;
        const ids = pool.map((n) => n.id);
        const anchor = tab.selection.find((id) => ids.includes(id)) ?? tab.selection[tab.selection.length - 1];
        const cols = tab.view === 'grid'
          ? Math.max(1, Math.floor((window.innerWidth - 280) / (tab.iconSize + 28)))
          : 1;
        let delta = 0;
        if (e.key === 'ArrowLeft') delta = -1;
        else if (e.key === 'ArrowRight') delta = 1;
        else if (e.key === 'ArrowUp') delta = -cols;
        else if (e.key === 'ArrowDown') delta = cols;
        const next = stepInPool(ids, anchor, delta);
        if (!next) return;
        if (e.shiftKey && anchor && tab.view !== 'gallery') {
          const a = ids.indexOf(tab.selection[0] ?? anchor);
          const from = Math.min(a, ids.indexOf(next));
          const to = Math.max(a, ids.indexOf(next));
          st.setSelection(ids.slice(from, to + 1));
        } else {
          st.setSelection([next]);
        }
        return;
      }

      if (e.key === 'F2') { e.preventDefault(); const id = tab.selection[0]; if (id) st.beginRename(id); return; }
      if (e.key === 'F3') return;
      if (e.key === 'F5') { e.preventDefault(); void st.refreshCurrent(); return; }
      if (e.key === 'F6') { e.preventDefault(); if (tab.selection.length) st.setBatch(true); return; }
      if (e.key === 'Enter') {
        if (e.altKey) { e.preventDefault(); const id = tab.selection[0]; if (id) st.setInfo(id); return; }
        openSelected();
        return;
      }
      if (e.key === ' ') { e.preventDefault(); quickLookToggle(); return; }
      if (e.key === 'Backspace') { e.preventDefault(); st.back(); return; }
      if (e.key === 'Delete') {
        if (!tab.selection.length) return;
        if (e.shiftKey) st.deleteForever(tab.selection);
        else {
          const nodeId = currentNodeId(tab);
          const first = tab.selection.map((id) => st.nodes[id]).find(Boolean);
          if (first?.deleted || nodeId === ID.trash) st.deleteForever(tab.selection);
          else st.trash(tab.selection);
        }
        return;
      }
      if (e.key === '?' || (e.shiftKey && e.key === '/')) { st.setShortcuts(true); return; }

      if (e.altKey) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); st.back(); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); st.forward(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); st.up(); return; }
        if (key === 't') { e.preventDefault(); st.addTab(); return; }
        if (key === 'w') { e.preventDefault(); st.closeTab(st.activeTabId); return; }
        if (mod && key === 'c') {
          e.preventDefault();
          const stt = useStore.getState();
          const n = selFirst();
          const nid0 = currentNodeId(activeTab());
          const targetId = n?.id ?? nid0;
          if (targetId) {
            import('@/lib/fs').then(({ pathString }) => {
              navigator.clipboard?.writeText(pathString(stt.nodes, targetId)).catch(() => undefined);
              stt.toast('已复制路径');
            });
          }
          return;
        }
        return;
      }

      if (!mod) return;
      switch (key) {
        case 'a': e.preventDefault(); selectAll(); return;
        case 'u': if (e.shiftKey) { e.preventDefault(); invert(); } return;
        case 'c': e.preventDefault(); if (tab.selection.length) st.setClipboard('copy', tab.selection); return;
        case 'x': e.preventDefault(); if (tab.selection.length) st.setClipboard('cut', tab.selection); return;
        case 'v': e.preventDefault(); st.paste(); return;
        case 'd': e.preventDefault(); if (tab.selection.length) st.duplicate(tab.selection); return;
        case 'z': e.preventDefault(); st.undo(); return;
        case 'y': e.preventDefault(); st.redo(); return;
        case 'n': if (e.shiftKey) { e.preventDefault(); st.createFolder(); } return;
        case '.': case '>': if (e.shiftKey) { e.preventDefault(); st.patchTab({ showHidden: !tab.showHidden }); st.toast(tab.showHidden ? '已隐藏系统文件' : '正在显示隐藏文件'); } return;
        case '1': case '2': case '3': case '4': {
          e.preventDefault();
          const views = ['grid', 'list', 'columns', 'gallery'] as const;
          st.patchTab({ view: views[parseInt(key, 10) - 1] });
          return;
        }
        case '+': case '=': e.preventDefault(); st.patchTab({ iconSize: Math.min(116, tab.iconSize + 8) }); return;
        case '-': e.preventDefault(); st.patchTab({ iconSize: Math.max(52, tab.iconSize - 8) }); return;
      }
    };

    const onSelectAll = () => selectAll();
    const onInvert = () => invert();
    window.addEventListener('keydown', onKey);
    document.addEventListener('aurora:select-all', onSelectAll);
    document.addEventListener('aurora:invert', onInvert);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('aurora:select-all', onSelectAll);
      document.removeEventListener('aurora:invert', onInvert);
    };
  }, []);
}
