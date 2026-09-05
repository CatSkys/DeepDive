// 会话展示层的格式化纯函数：工具参数摘要、时长/时钟/速率、截断、排队文本。
// 从 SessionView.tsx 整体搬迁（R-007）；只做字符串搬运，不碰事件语义。
import { tt } from "../i18n";
import type { SessionQueuedItem } from "../types";

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

export function formatRunDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return tt(`${total}秒`, `${total}s`);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return tt(`${m}分${s}秒`, `${m}m${s}s`);
}

export function formatLatencySeconds(ms: number): string {
  const s = ms / 1000;
  return s >= 10 ? String(Math.round(s)) : (Math.round(s * 10) / 10).toString().replace(/\.0$/, "");
}

/** 经过时长（StatusCapsule/LoadingState 的 elapsed 收敛目的地，AUD-047）：
 *  <60s → "{n}s"；<60m → "{n}m"；否则 "{h}h {m}m"（均向下取整）。 */
export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatTokensPerSecond(tps: number): string {
  return tps >= 100 ? String(Math.round(tps)) : tps >= 10 ? (Math.round(tps * 10) / 10).toString().replace(/\.0$/, "") : (Math.round(tps * 100) / 100).toString().replace(/\.0$/, "");
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
