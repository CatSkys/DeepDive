// 预览类型判定（纯函数）：扩展名 → 预览渲染方式。无扩展名/未知二进制归
// fallback（尝试按文本读，读失败给「用默认应用打开」引导）。

export type PreviewKind = "image" | "pdf" | "html" | "markdown" | "code" | "fallback";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "heic"]);
const PDF_EXT = new Set(["pdf"]);
const HTML_EXT = new Set(["html", "htm"]);
const MD_EXT = new Set(["md", "markdown"]);
/** 常见文本/代码扩展名之外的一律 fallback（先按文本试，二进制引导外部打开）。 */
const CODE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "css", "scss", "less", "html",
  "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "hpp", "m", "mm",
  "sh", "bash", "zsh", "fish", "sql", "yml", "yaml", "toml", "ini", "cfg", "conf",
  "xml", "csv", "tsv", "txt", "log", "env", "gitignore", "lock", "proto", "graphql",
]);

export function previewKindOf(nameOrPath: string): PreviewKind {
  const ext = nameOrPath.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXT.has(ext)) return "image";
  if (PDF_EXT.has(ext)) return "pdf";
  if (HTML_EXT.has(ext)) return "html";
  if (MD_EXT.has(ext)) return "markdown";
  if (CODE_EXT.has(ext)) return "code";
  return "fallback";
}

/** 引擎受控读文件面：同源经桥，绝对路径走查询串。 */
export function fileUrlOf(path: string): string {
  return `/api/file?path=${encodeURIComponent(path)}`;
}
