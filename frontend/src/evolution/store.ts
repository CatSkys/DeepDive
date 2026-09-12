// 自进化提案队列的本地持久化：提案（含状态）与"落库交办会话"的 id。
// 与自动化同款纪律：读入是外部输入边界，形状不合的条目丢弃，不逐字段猜。

import type { LessonCategory, LessonEvidence, LessonHome, LessonPredict, LessonProposal, LessonStatus } from "./protocol";

const KEY_PROPOSALS = "deepdive.evolution.proposals";
const KEY_SESSION = "deepdive.evolution.session";

/** 台账上限：待审上限由政策定（默认 100），这里给总保留量留一倍余量。 */
export const KEEP_PROPOSALS = 200;
const HOMES: readonly LessonHome[] = ["agents", "pitfalls", "spec", "skill", "policy"];
const CATEGORIES: readonly LessonCategory[] = ["incident", "workflow", "fact", "rule"];
const STATUSES: readonly LessonStatus[] = ["pending", "applied", "dismissed", "expired"];

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseEvidence(v: unknown): LessonEvidence[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: LessonEvidence[] = [];
  for (const raw of v) {
    if (typeof raw !== "object" || raw === null) return null;
    const o = raw as Record<string, unknown>;
    const excerpt = str(o.excerpt);
    if (excerpt === null) return null;
    const note = str(o.note);
    out.push({ excerpt, ...(note === null ? {} : { note }) });
  }
  return out;
}

function parsePredict(v: unknown): LessonPredict | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const signature = str(o.signature);
  const windowDays = num(o.windowDays);
  if (o.metric !== "repeat-incident" && o.metric !== "steps") return null;
  if (signature === null || windowDays === null) return null;
  return { metric: o.metric, signature, windowDays };
}

function parseProposal(v: unknown): LessonProposal | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id);
  const anchor = str(o.anchor);
  const content = str(o.content);
  const evidence = parseEvidence(o.evidence);
  if (id === null || anchor === null || content === null || evidence === null) return null;
  if (!HOMES.includes(o.home as LessonHome) || !CATEGORIES.includes(o.category as LessonCategory)) return null;
  if (!STATUSES.includes(o.status as LessonStatus)) return null;
  const origin = (o.origin ?? {}) as Record<string, unknown>;
  const createdAt = num(o.createdAt) ?? Date.now();
  const appliedSessionId = str(o.appliedSessionId);
  return {
    id,
    category: o.category as LessonCategory,
    home: o.home as LessonHome,
    anchor,
    content,
    inference: o.inference === "explicit" ? "explicit" : "implicit",
    evidence,
    predict: parsePredict(o.predict),
    status: o.status as LessonStatus,
    createdAt,
    updatedAt: num(o.updatedAt) ?? createdAt,
    origin: {
      sessionId: str(origin.sessionId) ?? "",
      turn: num(origin.turn) ?? -1,
      eventSeq: num(origin.eventSeq) ?? -1,
    },
    ...(appliedSessionId === null ? {} : { appliedSessionId }),
  };
}

export function loadProposals(): LessonProposal[] {
  const raw = localStorage.getItem(KEY_PROPOSALS);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return []; // 损坏的旧缓存：当没写过，下一次 save 覆盖
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(parseProposal).filter((p): p is LessonProposal => p !== null);
}

export function saveProposals(proposals: LessonProposal[]): void {
  const trimmed = [...proposals].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, KEEP_PROPOSALS);
  localStorage.setItem(KEY_PROPOSALS, JSON.stringify(trimmed));
}

export function loadApplySession(): string | null {
  return localStorage.getItem(KEY_SESSION);
}

export function saveApplySession(sessionId: string | null): void {
  if (sessionId === null) localStorage.removeItem(KEY_SESSION);
  else localStorage.setItem(KEY_SESSION, sessionId);
}
