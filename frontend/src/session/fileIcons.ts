// 文件路径 → 语言/类型图标名。图标素材是 Material Icon Theme（MIT，见
// frontend/node_modules/material-icon-theme/LICENSE），名字表照该包官方清单
// dist/material-icons.json 抄，不自己发明——清单里几处与直觉不同（ogg 归 video、
// package.json 归 nodejs、vite.config.ts 归 vite），照抄即正确。
// 纯函数无资产：名字到素材存在性的保证由 FileIcon.tsx 的
// Record<FileIconName, string> + 逐名 ?raw import 在编译期兜住（漏一个就类型报错）。

export type FileIconName =
  | "audio" | "console" | "css" | "database" | "docker" | "document" | "git"
  | "go" | "html" | "image" | "java" | "javascript" | "json" | "kotlin" | "less"
  | "license" | "lock" | "makefile" | "markdown" | "nodejs" | "pdf" | "php"
  | "pnpm" | "powerpoint" | "python" | "react" | "react_ts" | "readme" | "ruby"
  | "rust" | "sass" | "stylus" | "svg" | "swift" | "table" | "toml" | "tsconfig"
  | "typescript" | "video" | "vite" | "vue" | "word" | "xml" | "yaml" | "yarn"
  | "zip";

/** 未收录的扩展名回落到通用文件图标（清单里的 document）。 */
const DEFAULT_ICON: FileIconName = "document";

/** 按整名匹配；含点号的名字走「逐级剥掉尾部」查找（见 resolveFileIconName）。 */
const BY_NAME: Record<string, FileIconName> = {
  dockerfile: "docker",
  makefile: "makefile",
  readme: "readme",
  license: "license",
  "package.json": "nodejs",
  "package-lock.json": "nodejs",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  ".gitignore": "git",
  "tsconfig.json": "tsconfig",
  "vite.config.ts": "vite",
};

/** 按扩展名匹配。 */
const BY_EXTENSION: Record<string, FileIconName> = {
  ts: "typescript", mts: "typescript", cts: "typescript",
  tsx: "react_ts",
  js: "javascript", mjs: "javascript", cjs: "javascript",
  jsx: "react",
  css: "css", scss: "sass", sass: "sass", less: "less", styl: "stylus",
  json: "json", jsonl: "json",
  md: "markdown", markdown: "markdown", txt: "document",
  py: "python", rs: "rust", go: "go", rb: "ruby", php: "php",
  java: "java", kt: "kotlin", swift: "swift", vue: "vue",
  html: "html", htm: "html",
  sh: "console", bash: "console", zsh: "console", fish: "console",
  yml: "yaml", yaml: "yaml", toml: "toml", xml: "xml", sql: "database",
  svg: "svg",
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image", avif: "image",
  pdf: "pdf",
  doc: "word", docx: "word",
  xls: "table", xlsx: "table", csv: "table",
  ppt: "powerpoint", pptx: "powerpoint",
  mp3: "audio", wav: "audio", m4a: "audio", flac: "audio", opus: "audio",
  ogg: "video", mp4: "video", mov: "video", webm: "video", m4v: "video",
  zip: "zip", tar: "zip", gz: "zip", "7z": "zip",
  lock: "lock",
};

export function resolveFileIconName(filePath: string): FileIconName {
  const leaf = (filePath.split("/").pop() ?? "").toLowerCase();
  if (!leaf) return DEFAULT_ICON;
  // 整名优先，且逐级剥掉尾部段落：Dockerfile.dev → Dockerfile、
  // package.json.bak → package.json。无扩展名的 Makefile / LICENSE 靠这轮命中。
  const parts = leaf.split(".");
  for (let i = parts.length; i > 0; i--) {
    const hit = BY_NAME[parts.slice(0, i).join(".")];
    if (hit) return hit;
  }
  const dot = leaf.lastIndexOf(".");
  return BY_EXTENSION[dot >= 0 ? leaf.slice(dot + 1) : ""] ?? DEFAULT_ICON;
}
