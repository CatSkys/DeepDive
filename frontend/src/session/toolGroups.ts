// 工具执行合并的纯模型：把连续的同类工具折成一个组。照 ZCode 的三组口径——
//   · 查阅 explore （ToolCallBlocks/renderers/explore.tsx）：读族、搜索族、
//     **只读命令**；摘要「N 搜索, M 文件」（桶序固定 搜索→列表→文件，0 不出现）。
//   · 终端 execute （renderers/execute-group.tsx）：命令族里**非只读**的那些；
//     摘要（用户 2026-10-10 定稿，偏离官方的 N commands）：「最新命令摘要 ·
//     N 个命令」+「· X 个失败」——行右侧是摘要不是命令原文（跟浏览器控制行
//     一个观感），摘要形态见 format.ts 的 commandDigest。
//     （他们还有「, Y 个已停止」，本仓行上没有该状态。）
//   · 更改 changes （renderers/changes-group.tsx）：写族（write/edit/apply_patch…）；
//     摘要「N 个文件」+「·」+ 文件清单，单个文件时只显示文件名。
//     **他们默认关掉这一组**（ENABLE_CHANGES_TOOL_CALL_GROUPING = false），
//     本仓按用户要求三组全开。
//
// 共同规则（他们 conversationAssistantWorkItems.ts 的分组循环）：只有**相邻同类**才算一组、
// **至少两条**（单条仍是普通行）、换类即断组、无条数上限；组的 key 锚在首个成员上，
// 流式追加不会重置身份与展开态。
//
// 命令族的"只读"判定：引擎不给按次信号（ToolCallData 只有 name/arguments），
// 故取保守白名单——认不出的命令进"终端"组，而不是"查阅"组。
import type { RenderItem } from "./renderModel";
import { derivePath } from "./renderModel";
import { bashSummary } from "./format";
import { toolVariant } from "./toolKind";

export type ToolGroupKind = "explore" | "execute" | "changes";

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

/** 出现这些就当写操作/有副作用：整条命令不算只读（于是进"终端"组）。 */
const WRITE_TOKENS = /(^|\s)(rm|mv|cp|mkdir|rmdir|touch|chmod|chown|ln|dd|tee|truncate|killall|kill|pkill|open|install|uninstall|make|git\s+(add|commit|push|pull|checkout|switch|reset|clean|stash|merge|rebase|apply|cherry-pick))([\s;&|]|$)/;
/** 就地改写：只有 sed/perl 的 -i 才是写（`grep -ni` 这类组合短选项不算）。 */
const IN_PLACE_TOOL = /(^|\s)(sed|perl)\b/;
const IN_PLACE_FLAG = /(^|\s)-\w*i(\s|$)/;

/** 从工具参数里取命令串。引擎两种形态都发过：原始命令串，或 JSON
 *  （`{"command":"…"}` / `{"cmd":…}` / `{"script":…}`）。**不剥 JSON 会让所有
 *  bash 都判不出只读**——真实会话里那批 `cd X && … | grep …` 就是这么全落空的。 */
export function commandOf(args: string): string {
  const trimmed = args.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    for (const key of ["command", "cmd", "script"]) {
      const v = parsed[key];
      if (typeof v === "string" && v) return v;
    }
  } catch { /* 不是合法 JSON：当原始命令处理 */ }
  return trimmed;
}

/** 把引号段（含双引号里的转义）换成空占位：`grep -i "a\|b"` → `grep -i ""`。
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
    if (c === "\\") { i += 1; continue; } // 引号里的转义
    if (c === quote) quote = null;
  }
  return out;
}

/** 命令是不是只读（保守：认不出来就不是）。真实负载形态：
 *  `cd X && hdiutil info | grep -i "disk9\|disk10" 2>/dev/null | head -20; echo "==="; ps -p N` */
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
    let first = "";
    for (const w of seg.split(/\s+/)) {
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || w === "sudo" || w === "time") continue;
      first = w;
      break;
    }
    if (!first) return false;
    const bare = first.split("/").pop() ?? first;
    return READ_ONLY_COMMANDS.has(bare);
  });
}

// kind 判据缓存（shell 族要 JSON.parse args + 词法判定，是热路径上最贵的单点）。
// 键=item、值带 item.v：args 被更新（tool/call 补发）时 v 自增，缓存随之失效。
const kindCache = new WeakMap<RenderItem, { v: number; kind: ToolGroupKind | null }>();

/** 一条渲染项属于哪个组；null = 不参与合并（代码/技能/提问/其它）。 */
export function groupKindOf(item: RenderItem): ToolGroupKind | null {
  const v = item.v ?? 0;
  const hit = kindCache.get(item);
  if (hit && hit.v === v) return hit.kind;
  let kind: ToolGroupKind | null;
  if (item.kind !== "tool-call") kind = null;
  else {
    const variant = toolVariant(item.toolName ?? "");
    if (variant === "edit") kind = "changes";
    else if (variant === "read" || variant === "search") kind = "explore";
    else if (variant === "shell") kind = isReadOnlyCommand(commandOf(item.args ?? "")) ? "explore" : "execute";
    else kind = null;
  }
  kindCache.set(item, { v, kind });
  return kind;
}

export type ExploreBucket = "search" | "list" | "file";

// 桶归类缓存：fingerprint 与正则全在热路径上重跑（ToolGroupRow 每次渲染都要）。
const bucketCache = new WeakMap<RenderItem, { v: number; bucket: ExploreBucket }>();

/** 组内按桶计数：搜索 / 列表 / 文件（照他们的 classifyExploreToolCall 口径）。 */
export function classifyExploreItem(item: RenderItem): ExploreBucket {
  const v = item.v ?? 0;
  const hit = bucketCache.get(item);
  if (hit && hit.v === v) return hit.bucket;
  const fingerprint = `${item.toolName ?? ""} ${commandOf(item.args ?? "")}`;
  let bucket: ExploreBucket;
  if (/(\bgrep\b|\bsearch\b|\bfetch\b|\bweb.?search\b|\bweb.?fetch\b|\brg\b|\bripgrep\b)/i.test(fingerprint)) bucket = "search";
  else if (/(\bglob\b|\bfind\b|\blist\b|\btree\b|\bdir\b|\bls\b|\bfd\b)/i.test(fingerprint)) bucket = "list";
  else bucket = "file";
  bucketCache.set(item, { v, bucket });
  return bucket;
}

const BUCKET_ORDER: readonly ExploreBucket[] = ["search", "list", "file"];
const BUCKET_LABEL: Record<ExploreBucket, [string, string]> = {
  search: ["搜索", "search"],
  list: ["列表", "list"],
  file: ["文件", "file"],
};

/** 组内改动到的文件（去重，按首次出现顺序；取叶子名）。 */
export function changedFiles(members: readonly RenderItem[]): string[] {
  const out: string[] = [];
  for (const m of members) {
    const p = derivePath(m.toolName ?? "", m.args ?? "");
    const leaf = p?.split("/").pop();
    if (leaf && !out.includes(leaf)) out.push(leaf);
  }
  return out;
}

/** 组摘要（按组类拼）。`ttPair` 由调用方注入——i18n 入口在宿主。
 *  · 查阅：桶序固定、0 不出现、", " 分隔 —— 即「N 搜索, M 文件」
 *  · 终端：「最新命令摘要 · N 个命令」+ 失败计数（他们的「已停止」本仓行上没有该状态）
 *  · 更改：「N 个文件 · 文件清单」，单个文件时只显示文件名 */
export function formatGroupSummary(
  kind: ToolGroupKind,
  members: readonly RenderItem[],
  ttPair: (zh: string, en: string, vars?: Record<string, string | number>) => string,
): string {
  if (kind === "explore") {
    const counts: Record<ExploreBucket, number> = { search: 0, list: 0, file: 0 };
    for (const item of members) counts[classifyExploreItem(item)] += 1;
    const parts: string[] = [];
    for (const bucket of BUCKET_ORDER) {
      if (counts[bucket] > 0) parts.push(`${counts[bucket]} ${ttPair(...BUCKET_LABEL[bucket])}`);
    }
    return parts.join(", ");
  }
  if (kind === "execute") {
    const parts: string[] = [];
    // 当前在干什么 = 组内最新一条命令的摘要（流式期间即正在跑的那条；
    // description 优先、命令摘要回退，与单条终端行同一入口 bashSummary）
    const last = members[members.length - 1];
    const cmd = last ? bashSummary(last.args ?? "") : "";
    if (cmd) parts.push(cmd);
    parts.push(ttPair("{n} 个命令", "{n} commands", { n: members.length }));
    const failed = members.filter((m) => m.failed).length;
    if (failed > 0) parts.push(ttPair("{n} 个失败", "{n} failed", { n: failed }));
    return parts.join(" · ");
  }
  const files = changedFiles(members);
  if (files.length === 1) return files[0]!;
  const head = ttPair("{n} 个文件", "{n} files", { n: files.length });
  return files.length > 0 ? `${head} · ${files.join(", ")}` : head;
}

/** 一个合并组：成员连续、同类、至少两条。 */
export interface ToolGroup {
  kind: "tool-group";
  groupKind: ToolGroupKind;
  /** React key：锚在**首个**成员上（他们同款）。 */
  key: string;
  /** 成员在原始 items 里的下标（调用方据此判过程折叠的显隐与落点）。 */
  indices: number[];
  members: RenderItem[];
}

export type RenderUnit = { kind: "item"; index: number; item: RenderItem } | ToolGroup;

// ── 版本感知缓存 ──
// 流式热路径上每条 delta 都会把整窗重新派生一遍（TurnList 每轮渲染调
// groupTools/groupKindOf），而 item 的就地修改靠 renderModel 的 v 戳记账。
// 组的形状只由「成员集 + 成员的 kind 判据（含 args 词法）」决定，两个内容
// 代理校验后即可整组复用，JSON.parse/正则不再每次重跑。

/** 组内改动到的文件（去重，按首次出现顺序；取叶子名）。 */
function groupV(items: readonly RenderItem[]): number {
  let v = 0;
  for (const it of items) v += it.v ?? 0;
  return v;
}

/** 把一串渲染项折成「普通行 / 组」的序列（仅相邻同类且 ≥2 条成组）。 */
function buildToolUnits(items: readonly RenderItem[]): RenderUnit[] {
  const units: RenderUnit[] = [];
  let i = 0;
  while (i < items.length) {
    const kind = groupKindOf(items[i]!);
    if (kind === null) {
      units.push({ kind: "item", index: i, item: items[i]! });
      i += 1;
      continue;
    }
    let j = i;
    const members: RenderItem[] = [];
    const indices: number[] = [];
    while (j < items.length && groupKindOf(items[j]!) === kind) {
      members.push(items[j]!);
      indices.push(j);
      j += 1;
    }
    if (members.length >= 2) {
      units.push({ kind: "tool-group", groupKind: kind, key: `group:${members[0]!.key}`, indices, members });
    } else {
      units.push({ kind: "item", index: i, item: items[i]! });
    }
    i = j;
  }
  return units;
}

// 组的单位列表缓存：键锚在组的**首个成员**（一个 item 只属于一个组），
// 校验用 len+末成员引用+v 总和——新成员（append/收尾插入）必改 len 或 last，
// 就地修改必改 v。回灌重建产生全新 item 对象，WeakMap 旧值随其回收。
const unitCache = new WeakMap<RenderItem, { len: number; last: RenderItem; v: number; units: RenderUnit[] }>();

/** 把一串渲染项折成「普通行 / 组」的序列（仅相邻同类且 ≥2 条成组）。 */
export function groupTools(items: readonly RenderItem[]): RenderUnit[] {
  if (items.length === 0) return [];
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const hit = unitCache.get(first);
  if (hit && hit.len === items.length && hit.last === last && hit.v === groupV(items)) return hit.units;
  const units = buildToolUnits(items);
  unitCache.set(first, { len: items.length, last, v: groupV(items), units });
  return units;
}
