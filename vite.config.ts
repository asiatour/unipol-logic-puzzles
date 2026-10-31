import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { youwareVitePlugin } from "@youware/vite-plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [youwareVitePlugin(), react()],
  // GitHub Pages project site: https://<user>.github.io/<repo>/
  // Override with PAGES_BASE if the repository (or a custom domain) changes.
  base: process.env.PAGES_BASE ?? "/unipol-logic-puzzles/",
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    sourcemap: true,
  },
});
