/**
 * Lazy-loaded overlay surface — keeps Overlays.tsx (and its deps) off the cold start graph.
 */
import { AnimatePresence } from 'framer-motion';
import { useStore } from '@/lib/store';
import {
  ContextMenu, QuickLook, InfoPanel, BatchRename, CommandPalette, ShortcutsHelp, IndexPanel, Toasts,
} from '@/components/Overlays';

export default function OverlayHost() {
  const s = useStore();
  return (
    <>
      <ContextMenu />
      <AnimatePresence>{s.quickLookId && <QuickLook key="ql" />}</AnimatePresence>
      <AnimatePresence>{s.infoId && <InfoPanel key="info" />}</AnimatePresence>
      <AnimatePresence>{s.batchOpen && <BatchRename key="batch" />}</AnimatePresence>
      <AnimatePresence>{s.paletteOpen && <CommandPalette key="palette" />}</AnimatePresence>
      <AnimatePresence>{s.shortcutsOpen && <ShortcutsHelp key="shortcuts" />}</AnimatePresence>
      <AnimatePresence>{s.indexPanelOpen && <IndexPanel key="index" />}</AnimatePresence>
      <Toasts />
    </>
  );
}
