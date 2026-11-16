import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The marketing site, deliberately its own Vite project.
 *
 * It lives beside the app rather than inside it: the app's build has fixed entry points
 * (index.html, mini.html) and a Tauri-tuned dev server on a strict port, and adding a third
 * entry would couple a public website's release cadence to the desktop app's. Nothing here is
 * reachable from the app's tsconfig (`include: ["src"]`) or its Rollup inputs.
 *
 * `base` is relative so the built site works from a subpath — GitHub Pages serves project
 * sites from /<repo>/, and absolute asset paths 404 there.
 */
export default defineConfig({
  base: "./",
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
  },
});
