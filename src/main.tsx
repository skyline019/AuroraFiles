import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { useStore } from "./lib/store";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

/** Playwright / 本地调试钩子（仅浏览器全局，不进生产语义） */
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
