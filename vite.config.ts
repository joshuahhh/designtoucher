/// <reference types="vitest/config" />
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { defineConfig } from "vite";

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
  plugins: [react(), basicSsl()],
  test: {
    exclude: gitIgnored,
  },
});
