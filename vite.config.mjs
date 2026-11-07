import path from "node:path";
import fssync from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electron = process.env.AURORA_ELECTRON === "1";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(electron ? [] : [viteSingleFile()]),
    electron
      ? {
          name: "aurora-splash-html",
          closeBundle() {
            const indexPath = path.resolve(__dirname, "dist/index.html");
            const splashPath = path.resolve(__dirname, "dist/splash.html");
            if (!fssync.existsSync(indexPath)) return;
            const html = fssync.readFileSync(indexPath, "utf8");
            // Script-free splash: main process injects ./assets/entry.js after first paint
            const splash = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
            fssync.writeFileSync(splashPath, splash);
          },
        }
      : null,
  ].filter(Boolean),
  base: electron ? "./" : "/",
  define: {
    "import.meta.env.VITE_AURORA_ELECTRON": JSON.stringify(electron ? "1" : ""),
  },
  resolve: {
    // Array form: `@aurora-app` must precede `@` (prefix match).
    alias: [
      {
        find: "@aurora-app",
        replacement: path.resolve(
          __dirname,
          electron ? "src/AppElectron.tsx" : "src/AppWeb.tsx",
        ),
      },
      { find: "@", replacement: path.resolve(__dirname, "src") },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        "**/perf-out/**",
        "**/release/**",
        "**/test-results/**",
        "**/playwright-report/**",
        "**/.asar-tmp/**",
      ],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Avoid HTML modulepreload of heavy chunks on cold start
    modulePreload: electron ? false : true,
    rollupOptions: electron
      ? {
          output: {
            entryFileNames: "assets/entry.js",
            chunkFileNames: "assets/[name]-[hash].js",
            assetFileNames: "assets/[name]-[hash][extname]",
            manualChunks(id) {
              // Keep motion off the critical path; only load if something imports it
              if (id.includes("node_modules/framer-motion")) return "motion";
              if (
                id.includes("node_modules/xlsx")
                || id.includes("node_modules/mammoth")
                || id.includes("node_modules/jszip")
              ) {
                return "office";
              }
              return undefined;
            },
          },
        }
      : undefined,
    chunkSizeWarningLimit: 900,
  },
});
