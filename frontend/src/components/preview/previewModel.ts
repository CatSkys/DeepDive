// 预览模型（纯函数）：扩展名 → 可选渲染器 + 高亮语言 + 换行能力。
// 语义对齐官方 ui-sidebar-documentpreview 的渲染器注册表：一个文件可命中多个
// 渲染器（`.md` 同时是 Markdown 与代码、`.html` 同时是 HTML 与代码），纯文本
// 永远兜底；默认取候选表第一个。语言表取自官方 code/languages.ts，但 id 收窄
// 到本仓 highlight.js `lib/common` 实际注册的语法（shellscript→bash、
// html→xml、mdx→markdown；toml 由 Markdown.tsx 单语言注册补齐）。

export type PreviewRenderer = "image" | "pdf" | "html" | "markdown" | "code" | "text";

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "heic"];
const PDF_EXT = ["pdf"];
const HTML_EXT = ["html", "htm"];
const MARKDOWN_EXT = ["md", "markdown"];

/** hljs 语言 id → 扩展名（官方同款，收窄到本仓 common 语言集）。 */
const LANGUAGE_EXT: Readonly<Record<string, readonly string[]>> = {
  typescript: ["ts", "tsx", "mts", "cts"],
  javascript: ["js", "jsx", "mjs", "cjs"],
  bash: ["sh", "bash", "zsh"],
  json: ["json", "jsonc", "jsonl", "ndjson"],
  python: ["py", "pyw", "pyi"],
  ruby: ["rb", "rake", "gemspec"],
  go: ["go"],
  rust: ["rs"],
  java: ["java"],
  c: ["c", "h"],
  cpp: ["cc", "cpp", "cxx", "hh", "hpp", "hxx"],
  csharp: ["cs"],
  kotlin: ["kt", "kts"],
  swift: ["swift"],
  php: ["php"],
  yaml: ["yaml", "yml"],
  toml: ["toml"],
  ini: ["ini"],
  markdown: ["md", "markdown", "mdx"],
  xml: ["html", "htm", "xhtml", "xml", "xsd", "xsl", "xslt"],
  css: ["css"],
  scss: ["scss"],
  less: ["less"],
  sql: ["sql"],
  lua: ["lua"],
  graphql: ["graphql", "gql"],
};

const LANGUAGE_OF_EXT: ReadonlyMap<string, string> = new Map(
  Object.entries(LANGUAGE_EXT).flatMap(([language, extensions]) =>
    extensions.map((extension) => [extension, language] as const)),
);

/** 取扩展名（小写，无扩展名回空串）。 */
function extOf(nameOrPath: string): string {
  return nameOrPath.split(".").pop()?.toLowerCase() ?? "";
}

/** 该渲染器是否支持换行开关（官方：code / text 声明 wrap: true）。 */
export function supportsWrap(renderer: PreviewRenderer): boolean {
  return renderer === "code" || renderer === "text";
}

/** 渲染器显示名（i18n 中文源串）。 */
export function titleOf(renderer: PreviewRenderer): string {
  switch (renderer) {
    case "image": return "图片";
    case "pdf": return "PDF";
    case "html": return "HTML";
    case "markdown": return "Markdown";
    case "code": return "代码";
    case "text": return "纯文本";
  }
}

/** 该文件的候选渲染器（首个为默认，纯文本恒在末位兜底）。 */
export function renderersOf(nameOrPath: string): PreviewRenderer[] {
  const ext = extOf(nameOrPath);
  const out: PreviewRenderer[] = [];
  if (IMAGE_EXT.includes(ext)) out.push("image");
  if (PDF_EXT.includes(ext)) out.push("pdf");
  if (HTML_EXT.includes(ext)) out.push("html");
  if (MARKDOWN_EXT.includes(ext)) out.push("markdown");
  if (LANGUAGE_OF_EXT.has(ext)) out.push("code");
  out.push("text");
  return out;
}

/** 高亮语言 id；无对应语法回空串（渲染为纯文本，不猜）。 */
export function languageOf(nameOrPath: string): string {
  return LANGUAGE_OF_EXT.get(extOf(nameOrPath)) ?? "";
}

/** 引擎受控读文件面：同源经桥，绝对路径走查询串。 */
export function fileUrlOf(path: string): string {
  return `/api/file?path=${encodeURIComponent(path)}`;
}
