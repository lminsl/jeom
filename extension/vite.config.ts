import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    outDir: "dist",
    // Sourcemaps disabled: rolldown's IIFE-wrap bug puts the closing
    // `})()` on the same line as `//# sourceMappingURL=...`, commenting
    // it out and breaking content script parse. Re-enable once upstream
    // ships a fix.
    sourcemap: false,
    rollupOptions: {
      input: {
        promptLab: "src/prompt-lab/prompt-lab.html",
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5174,
    },
  },
});
