import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "@aurora-app";
import { useStore } from "./lib/store";

if (import.meta.env.VITE_AURORA_ELECTRON === "1") {
  // Avoid false "interactive" before bootstrapReal runs
  useStore.setState({ booting: true });
}

const rootEl = document.getElementById("root")!;
rootEl.replaceChildren();
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/** Playwright / 本地调试钩子 */
declare global {
  interface Window {
    __aurora?: {
      getState: () => ReturnType<typeof useStore.getState>;
      setState: (partial: Partial<ReturnType<typeof useStore.getState>>) => void;
    };
  }
}
window.__aurora = {
  getState: () => useStore.getState(),
  setState: (partial) => useStore.setState(partial),
};
