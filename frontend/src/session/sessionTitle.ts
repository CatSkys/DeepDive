// 会话标题回退的唯一事实源（R-008/X1-1）：投影标题 → 新会话（blank）→
// 任务 {id6}。此前三处各写一套且互相矛盾（Sidebar 硬编码 New Chat、
// SettingsPage 反向 t()、SessionView 回退"会话"）。
import type { SessionSummary } from "../types";

export function sessionTitle(s: SessionSummary, lang: "zh" | "en"): string {
  const proj = (s.projections?.values ?? {}).title;
  if (typeof proj === "string" && proj.trim()) return proj;
  if (s.blank) return lang === "zh" ? "新会话" : "New Chat";
  return `${lang === "zh" ? "任务" : "Task"} ${s.sessionId.slice(0, 6)}`;
}
