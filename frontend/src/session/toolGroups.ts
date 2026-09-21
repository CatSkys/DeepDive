// 工具执行合并（"查阅"组）的纯模型。照 ZCode 的
// ToolCallBlocks/renderers/explore.tsx 与 v4/conversationAssistantWorkItems.ts：
//   · 连续的同类工具合并成一个"查阅"组，摘要为「N 搜索, M 文件」这种按桶计数；
//   · **至少两条**才成组，单条仍是普通行；
//   · 换族即断组；
//   · 桶序固定 search → list → file，0 的桶不出现（分隔符 ", "）。
//
// 哪些算"查阅"（他们的 isExploreToolCall 口径）：
//   读族、搜索族一律算；**写族一律不算**；命令族只有只读命令才算。
// 只读命令这一步是唯一需要判定的地方——ZCode 有 EXECUTE_WRITE_COMMAND_RE /
// SHELL_REDIRECT_WRITE_RE / EXECUTE_READ_COMMAND_RE 三张表，本仓没有可用的
// 按次判据（ToolCallData 只有 name/arguments，引擎不标只读），所以这里取
// **保守白名单**：命令必须以白名单里的只读程序起头，且不含写操作/重定向；
// 认不出来就不合并（宁可不合并，也不把写操作并进"查阅"）。
import type { RenderItem } from "./renderModel";
import { toolVariant } from "./toolKind";

export type ExploreBucket = "search" | "list" | "file";

/** 只读命令白名单（按每段的首词判定）。刻意短且保守：只收"看一眼"类程序；
 *  `cd`/`echo`/`ps` 这类无副作用的也收（真实调用几乎都以 `cd X &&` 起头）。 */
const READ_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  "cd", "echo", "ps", "pwd", "env", "printenv", "which", "command", "type", "man",
  "grep", "rg", "ripgrep", "find", "fd", "bfs", "ugrep",
  "ls", "tree", "dir", "wc", "stat", "file", "du", "df",
  "cat", "head", "tail", "sed", "awk", "sort", "uniq", "cut", "tr", "nl", "basename", "dirname",
  "strings", "xxd", "hexdump", "od", "jq", "plutil", "defaults", "mdls",
  "hdiutil", "diskutil", "mount", "sw_vers", "uname", "whoami", "id", "shasum", "openssl", "tar",
  "git", "node", "python3", "npm", "npx", "sleep", "date", "realpath", "readlink",
]);

/** 出现这些就当写操作/有副作用：整条命令不合并。 */
const WRITE_TOKENS = /(^|\s)(rm|mv|cp|mkdir|rmdir|touch|chmod|chown|ln|dd|tee|truncate|killall|kill|pkill|open|install|uninstall|make|git\s+(add|commit|push|pull|checkout|switch|reset|clean|stash|merge|rebase|apply|cherry-pick))([\s;&|]|$)/;
/** 就地改写：只有 sed/perl 的 -i 才是写（`grep -ni` 这类组合短选项不算）。 */
const IN_PLACE_TOOL = /(^|\s)(sed|perl)\b/;
const IN_PLACE_FLAG = /(^|\s)-\w*i(\s|$)/;

/** 命令族是不是只读（保守：认不出来就不算）。
 *  真实负载形态：`cd X && hdiutil info | grep -i … | head -20; echo "==="; ps -p N …`——
 *  所以按 && || ; | 切段逐段判首词，且先剥掉 `2>/dev/null`、`2>&1` 这类 fd 重定向
 *  （它们不是写文件）。 */
/** 把引号段（含双引号里的反斜杠转义）换成空占位：`grep -i "a\|b"` → `grep -i ""`。
 *  引号里的内容不参与词法判定——否则模式串里的 `|`、`rm` 都会被当成真结构。
 *  残留风险小且方向安全：`bash -c "rm …"` 的首词是 bash，本就不在白名单。 */
function stripQuoted(command: string): string {
  let out = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (quote === null) {
      if (c === '"' || c === "'") {
        quote = c as '"' | "'";
        out += '""';
      } else out += c;
      continue;
    }
    if (c === "\\") { i += 1; continue; } // 双引号里的转义
    if (c === quote) quote = null;
  }
  return out;
}

export function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  // 剥 fd 重定向（`2>/dev/null`、`2>&1`）与引号段，再做词法判定
  const stripped = stripQuoted(trimmed.replace(/\d*>\s*\/dev\/null/g, "").replace(/\d*>&\d/g, ""));
  if (WRITE_TOKENS.test(stripped)) return false;
  if (/(^|[^>])>{1,2}/.test(stripped)) return false;
  if (IN_PLACE_TOOL.test(stripped) && IN_PLACE_FLAG.test(stripped)) return false;
  const segments = stripped.split(/&&|\|\||;|\||&/).map((x) => x.trim()).filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every((seg) => {
    const words = seg.split(/\s+/);
    // 跳过 `FOO=bar` / `sudo` / `time` 这类前缀词，取真正执行的那个程序
    let first = "";
    for (const w of words) {
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || w === "sudo" || w === "time") continue;
      first = w;
      break;
    }
    if (!first) return false;
    const bare = first.split("/").pop() ?? first;
    return READ_ONLY_COMMANDS.has(bare);
  });
}

/** 一条渲染项算不算"查阅"（读族 / 搜索族 / 只读命令）。 */
export function isExploreItem(item: RenderItem): boolean {
  if (item.kind !== "tool-call") return false;
  const name = item.toolName ?? "";
  const variant = toolVariant(name);
  if (variant === "edit" || variant === "code" || variant === "skill" || variant === "question") return false;
  if (variant === "read" || variant === "search") return true;
  if (variant === "shell") {
    // 命令可能在 arguments / command 字段里（ToolCallData 的兼容字段），这里统一读 args
    return isReadOnlyCommand(item.args ?? "");
  }
  return false;
}

/** 组内按桶计数：搜索 / 列表 / 文件（照他们的 classifyExploreToolCall 口径）。 */
export function classifyExploreItem(item: RenderItem): ExploreBucket {
  const fingerprint = `${item.toolName ?? ""} ${item.args ?? ""}`;
  if (/(\bgrep\b|\bsearch\b|\bfetch\b|\bweb.?search\b|\bweb.?fetch\b|\brg\b|\bripgrep\b)/i.test(fingerprint)) return "search";
  if (/(\bglob\b|\bfind\b|\blist\b|\btree\b|\bdir\b|\bls\b|\bfd\b)/i.test(fingerprint)) return "list";
  return "file";
}

const BUCKET_ORDER: readonly ExploreBucket[] = ["search", "list", "file"];
const BUCKET_LABEL: Record<ExploreBucket, [string, string]> = {
  search: ["搜索", "search"],
  list: ["列表", "list"],
  file: ["文件", "file"],
};

/** 「N 搜索, M 文件」：桶序固定、0 不出现、逗号分隔（照他们的 formatExploreSummary）。 */
export function formatExploreSummary(items: readonly RenderItem[], t: (zh: string, en: string, n: number) => string): string {
  const counts: Record<ExploreBucket, number> = { search: 0, list: 0, file: 0 };
  for (const item of items) counts[classifyExploreItem(item)] += 1;
  const parts: string[] = [];
  for (const bucket of BUCKET_ORDER) {
    if (counts[bucket] > 0) parts.push(`${counts[bucket]} ${t(...BUCKET_LABEL[bucket], counts[bucket])}`);
  }
  return parts.join(", ");
}

/** 组标签「查阅」（他们 chat.toolCall.explore.label）。 */
export const EXPLORE_LABEL: [string, string] = ["查阅", "Explore"];

/** 一个合并组：成员连续、同族、至少两条。 */
export interface ExploreGroup {
  kind: "explore-group";
  /** React key：锚在**首个**成员上，流式追加不会重置身份与展开态（他们同款）。 */
  key: string;
  /** 成员在原始 items 里的下标（调用方据此判过程折叠的显隐与落点）。 */
  indices: number[];
  members: RenderItem[];
}

export type RenderUnit = { kind: "item"; index: number; item: RenderItem } | ExploreGroup;

/** 把一串渲染项折成「普通行 / 查阅组」的序列（仅相邻同族且 ≥2 条成组）。 */
export function groupExploreItems(items: readonly RenderItem[]): RenderUnit[] {
  const units: RenderUnit[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i]!;
    if (!isExploreItem(item)) {
      units.push({ kind: "item", index: i, item });
      i += 1;
      continue;
    }
    // 向前收同族的连续项
    let j = i;
    const members: RenderItem[] = [];
    const indices: number[] = [];
    while (j < items.length && isExploreItem(items[j]!)) {
      members.push(items[j]!);
      indices.push(j);
      j += 1;
    }
    if (members.length >= 2) {
      units.push({ kind: "explore-group", key: `explore:${members[0]!.key}`, indices, members });
    } else {
      units.push({ kind: "item", index: i, item });
    }
    i = j;
  }
  return units;
}
