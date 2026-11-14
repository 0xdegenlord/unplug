import { defineConfig } from "vite";
export default defineConfig({
  define: { global: "globalThis" },
  resolve: { alias: { buffer: "buffer/" } },
  optimizeDeps: { include: ["buffer"] },
  build: { target: "es2022", chunkSizeWarningLimit: 2500 },
});
