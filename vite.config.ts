/// <reference types="vitest/config" />
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Exclude everything git-ignored (built lib/, .prusik worktrees, etc.)
// from vitest. (Approach borrowed from dragology.)
const gitIgnored = execSync(
  "git ls-files --others --ignored --exclude-standard --directory",
)
  .toString()
  .trim()
  .split("\n")
  .map((p) => (p.endsWith("/") ? `${p}**` : p));

// https://vitejs.dev/config/
export default defineConfig({
  base: "./",
  server: { port: 5183 },
  plugins: [
    react(),
    basicSsl(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,webm}"],
        maximumFileSizeToCacheInBytes: 50 * 1024 * 1024,
      },
      manifest: {
        name: "designtoucher",
        short_name: "designtoucher",
        description: "kinda like touchdesigner, kinda not",
        theme_color: "#000000",
        background_color: "#000000",
        display: "standalone",
        orientation: "any",
        start_url: ".",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  test: {
    exclude: gitIgnored,
  },
});
