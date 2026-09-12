// 把 pdfjs-dist 的三份运行时资产拷进构建产物（dist/pdfjs/），供 PDF 预览按同源
// URL 读取：cMaps（CJK 等字符映射）、standard_fonts（非嵌入字体的替补字形）、
// wasm（图像解码）。刻意不走 CDN：桌面应用离线可用，且 WKWebView 里跨源取资产
// 会被拦。构建后由 package.json 的 build 脚本调用（vite 不会自动带出 node_modules
// 里的整目录资产）。
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/pdfjs-dist");
const dest = resolve(root, "dist/pdfjs");
const dirs = ["cmaps", "standard_fonts", "wasm"];

if (!existsSync(src)) {
  console.error("copy-pdfjs-assets: node_modules/pdfjs-dist 不存在，先 npm install");
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of dirs) {
  const from = resolve(src, dir);
  if (!existsSync(from)) {
    console.error(`copy-pdfjs-assets: 缺少 ${dir}/（pdfjs-dist 版本变了？）`);
    process.exit(1);
  }
  cpSync(from, resolve(dest, dir), { recursive: true });
}
console.log(`copy-pdfjs-assets: ${dirs.join(" ")} → dist/pdfjs/`);
