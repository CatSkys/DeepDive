// 会话引用（引擎 context/session-reference，rc.2 web profile 已装配）：
// 规范 mention = `@[label](dsh-session:<base64url(JSON(sessionId))>)`，
// 宿主 agent/pre-step 在 session.prompt 文本里解析它并注入被引用会话的
// 只读快照（每消息最多 3 条 = 引擎 MAX_REFERENCES，超出引擎侧报错）。
// 候选规则对齐官方 resolver.candidates：排除当前会话、query 大小写不
// 敏感匹配标题、近期优先。
import type { SessionSummary } from "../types";
import { sessionTitle } from "./sessionTitle";

/** 菜单里展示的候选上限（引擎默认候选 50，界面取近期 10 条）。 */
export const SESSION_REFERENCE_LIMIT = 10;

/** 与引擎 encodeSessionReferenceUri 同构：base64url、无 padding、可往返。 */
export function encodeSessionReferenceUri(sessionId: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify(sessionId));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "dsh-session:" + btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** 官方 formatSessionReferenceMention 同构：label 的 \\ 与 ] 需转义。 */
export function formatSessionReferenceMention(sessionId: string, label: string): string {
  const escaped = label.replace(/[\\\]]/g, (m) => `\\${m}`);
  return `@[${escaped}](${encodeSessionReferenceUri(sessionId)})`;
}

export interface SessionMentionCandidate {
  sessionId: string;
  label: string;
  updatedAt: number;
  mention: string;
}

export function sessionMentionCandidates(
  sessions: SessionSummary[],
  currentSessionId: string | null,
  query: string,
  lang: "zh" | "en",
): SessionMentionCandidate[] {
  const q = query.trim().toLowerCase();
  return sessions
    .filter((s) => s.sessionId !== currentSessionId)
    .filter((s) => (q ? sessionTitle(s, lang).toLowerCase().includes(q) : true))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, SESSION_REFERENCE_LIMIT)
    .map((s) => ({
      sessionId: s.sessionId,
      label: sessionTitle(s, lang),
      updatedAt: s.updatedAt,
      mention: formatSessionReferenceMention(s.sessionId, sessionTitle(s, lang)),
    }));
}
