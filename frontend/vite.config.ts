/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    target: "safari16",
    sourcemap: false,
  },
  test: {
    // 范围钉在 frontend/src：vitest v4 从仓库根（无 include 默认全仓）跑的场合
    // 会把 vendored 的 deepseek-harness/scripts/*.spec 一并抓进来当失败——那些
    // 属于上游自身的验证套件，与本仓 test 无关。（2026-10-10 实测教训。）
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
