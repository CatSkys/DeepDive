// 会话展示层的格式化纯函数：工具参数摘要、时长/时钟/速率、截断、排队文本。
// 从 SessionView.tsx 整体搬迁（R-007）；只做字符串搬运，不碰事件语义。
import { t, tt } from "../i18n";
import type { SessionQueuedItem } from "../types";
import { resolveFileIconName } from "./fileIcons";

/// Derived DSH-style tool summary from arguments (first line of the payload).
export function summarizeArgs(args: string): string {
  if (!args) return "";
  try {
    const p = JSON.parse(args);
    if (p && typeof p === "object") {
      for (const key of ["command", "path", "file_path", "url", "query", "prompt", "code", "description", "message", "module"]) {
        if (typeof p[key] === "string" && p[key]) return firstLine(p[key]);
      }
      const keys = Object.keys(p);
      if (keys.length === 0) return "";
      const v = p[keys[0]];
      if (typeof v === "string" && v) return firstLine(v);
      return firstLine(args);
    }
    return typeof p === "string" ? firstLine(p) : "";
  } catch {
    return firstLine(args);
  }
}

/// 项目内路径相对化（用户定稿）：工具行摘要以会话 cwd 开头时剥掉前缀，
/// 显示项目内路径（frontend/src/...）而不是完整绝对路径。cwd 未知或路径
/// 在项目外原样返回。
export function relativizePath(text: string, cwd?: string): string {
  if (!cwd || !text.startsWith(cwd + "/")) return text;
  return text.slice(cwd.length + 1);
}

export function commandOf(args: string): string {
  try {
    const p = JSON.parse(args);
    if (typeof p?.command === "string") return p.command;
  } catch { /* fallthrough */ }
  return args;
}

export function prettyArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}

// ---------- formatting ----------

export function basename(p: string): string {
  return p.split(/[/\\]/).pop() ?? p;
}

export function firstLine(s: string): string {
  return s.split("\n")[0].trim();
}

export function formatClock(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
/** 秒级延时（重试行「7.9s」用）：≥10s 取整，否则保留一位小数、去掉 .0 */
export function formatLatencySeconds(ms: number): string {
  const s = ms / 1000;
  return s >= 10 ? String(Math.round(s)) : (Math.round(s * 10) / 10).toString().replace(/\.0$/, "");
}

/** 经过时长（StatusCapsule/LoadingState 的 elapsed 收敛目的地，AUD-047）：
 *  <60s → "{n}s"；<60m → "{m}m {s}s"；否则 "{h}h {m}m {s}s"（均向下取整）。
 *  秒恒在（用户定稿：分钟后没秒就是"1m"地停着不走，看不出在动；小时同理）。 */
export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m ${sec}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m ${sec}s`;
}
/** 文件大小的说法（附件 chip 的名字右侧那一截）：B / KB / MB，一位小数。
 *  chip 与消息里的文件是同一种东西，两处必须同一口径（用户定稿：看着是一套）。 */
export function sizeText(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 时长的紧凑说法（子智能体行右侧那种「1 小时」）：小时 → 「N 小时」，分钟 → 「N 分」，
 *  不到一分钟 → 「N 秒」。与 fmtTime 用同一套单位词（读起来是一种语言），
 *  但语义是**时长**不是"多久以前"；也不与披露条的「已工作 X」混用（那是句子）。 */
export function compactElapsed(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  if (h > 0) return tt("{h} 小时", "{h}h", { h });
  const m = Math.floor(total / 60);
  if (m > 0) return tt("{m} 分", "{m}m", { m });
  return tt("{s} 秒", "{s}s", { s: total });
}

export function truncate(s: string, n = 400): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

/** 排队消息文本（edit 仅支持文本，取 text 块拼接）。 */
export function queueText(item: SessionQueuedItem): string {
  return item.message.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");
}

/** 排队消息里的附件部件计数。引擎存的是**耐久引用**（image/file 各带 attachment），
 *  所以这里只看类型：胶囊要能说出"这条不只是文字"，编辑钮也要据此判断能不能改。 */
export function queueAttachments(item: SessionQueuedItem): { images: number; files: number } {
  let images = 0;
  let files = 0;
  for (const part of item.message.content) {
    if (part.type === "image") images += 1;
    else if (part.type === "file") files += 1;
  }
  return { images, files };
}

/** 胶囊那一行显示什么：文本部件拼接，附件部件折成标记。标记**按类型**说人话
 *  （图片 / 视频 / 音频 / 文件，同类的合并计数），与 chip 的图标同一套判定
 *  （resolveFileIconName）。纯附件消息因此不会渲染成空胶囊。 */
export function queueLabel(item: SessionQueuedItem): string {
  const parts: string[] = [];
  const text = queueText(item);
  if (text) parts.push(text);
  const { images } = queueAttachments(item);
  if (images > 0) parts.push(images > 1 ? tt("{n} 张图片", "{n} images", { n: images }) : t("图片"));
  // 文件部件按类型归并：视频/音频各成一类，其余归「文件」
  const buckets: Array<{ kind: "video" | "audio" | "file"; n: number }> = [];
  for (const part of item.message.content) {
    if (part.type !== "file") continue;
    const name = (part as { attachment?: { name?: string } }).attachment?.name ?? "";
    const icon = resolveFileIconName(name);
    const kind = icon === "video" ? "video" as const : icon === "audio" ? "audio" as const : "file" as const;
    const found = buckets.find((b) => b.kind === kind);
    if (found) found.n += 1;
    else buckets.push({ kind, n: 1 });
  }
  for (const b of buckets) {
    if (b.kind === "video") parts.push(b.n > 1 ? tt("{n} 个视频", "{n} videos", { n: b.n }) : t("视频"));
    else if (b.kind === "audio") parts.push(b.n > 1 ? tt("{n} 个音频", "{n} audio files", { n: b.n }) : t("音频"));
    else parts.push(b.n > 1 ? tt("{n} 个文件", "{n} files", { n: b.n }) : t("文件"));
  }
  return parts.join(" · ");
}

/// ask_user_question 行摘要：首题问题文本（多题标注数量），避免裸 JSON。
export function askSummary(args: string): string {
  try {
    const p = JSON.parse(args);
    const questions = p?.questions ?? (Array.isArray(p) ? p : null);
    if (!Array.isArray(questions) || questions.length === 0) return "";
    const first = String(questions[0]?.question ?? "").split("\n")[0].trim();
    return questions.length > 1 ? tt("{first} 等 {n} 题", "{first} +{n} more", { first, n: questions.length }) : first;
  } catch { return ""; }
}
