import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electron = process.env.AURORA_ELECTRON === "1";

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(electron ? [] : [viteSingleFile()])],
  base: electron ? "./" : "/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: electron
      ? {
          output: {
            manualChunks: {
              office: ["mammoth", "xlsx", "jszip"],
              motion: ["framer-motion"],
            },
          },
        }
      : undefined,
    chunkSizeWarningLimit: 900,
  },
});
