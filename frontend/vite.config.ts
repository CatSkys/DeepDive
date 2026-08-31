import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

// Bake the true git SHA into the bundle at build time so the sidebar badge can
// never drift from the source it was built from.
function buildSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

export default defineConfig({
  plugins: [react()],
  base: "./",
  define: {
    __DSH_BUILD_SHA__: JSON.stringify(buildSha()),
  },
  build: {
    target: "safari16",
    minify: "esbuild",
    sourcemap: false,
  },
});
