// 自进化提案队列的本地持久化：提案（含状态）与"落库交办会话"的 id。
// 与自动化同款纪律：读入是外部输入边界，形状不合的条目丢弃，不逐字段猜。

import type { LessonCategory, LessonEvidence, LessonHome, LessonPredict, LessonProposal, LessonStatus } from "./protocol";

const KEY_PROPOSALS = "deepdive.evolution.proposals";
const KEY_SESSION = "deepdive.evolution.session";
const KEY_HOME_SESSION = "deepdive.evolution.homeSession";
const KEY_RUNS = "deepdive.evolution.runs";
const KEY_LAST_REVIEW = "deepdive.evolution.lastReview";
const KEY_LAST_CONSOLIDATE = "deepdive.evolution.lastConsolidate";
const KEY_OWN_SESSIONS = "deepdive.evolution.ownSessions";
const KEY_APPLIED_TODAY = "deepdive.evolution.appliedToday";

/** 一次运行记录（复盘 / 落库 / 撤销 / 整理为模型会话；校验 / 机械门 / 落地确认
 *  为壳侧本机执行，sessionId 为空串、UI 不给「打开会话」）。 */
export interface EvolutionRun {
  id: string;
  kind: "review" | "verify" | "apply" | "revoke" | "gate" | "land" | "consolidate";
  at: number;
  sessionId: string;
  note?: string;
}

const RUN_KINDS: readonly EvolutionRun["kind"][] = ["review", "verify", "apply", "revoke", "gate", "land", "consolidate"];

/** 每日自动落地限速计数（dsh-evolve-modes 的批次默认 3）：{day: "YYYY-MM-DD", count}。 */
export interface AppliedToday {
  day: string;
  count: number;
}

/** 台账上限：待审上限由政策定（默认 100），这里给总保留量留一倍余量。 */
export const KEEP_PROPOSALS = 200;
const HOMES: readonly LessonHome[] = ["agents", "pitfalls", "spec", "skill", "policy", "global"];
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
  const appliedAt = num(o.appliedAt);
  const lastVerifyAt = num(o.lastVerifyAt);
  const lastLandAt = num(o.lastLandAt);
  const applyAttempts = num(o.applyAttempts);
  const revokeAt = num(o.revokeAt);
  const gate = parseGate(o.gate);
  const landing = parseLanding(o.landing);
  const verdict = parseVerdict(o.verdict);
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
    ...(appliedAt === null ? {} : { appliedAt }),
    ...(lastVerifyAt === null ? {} : { lastVerifyAt }),
    ...(lastLandAt === null ? {} : { lastLandAt }),
    ...(applyAttempts === null ? {} : { applyAttempts }),
    ...(revokeAt === null ? {} : { revokeAt }),
    ...(gate === null ? {} : { gate }),
    ...(landing === null ? {} : { landing }),
    ...(verdict === null ? {} : { verdict }),
  };
}

/** 机械门结论（读盘边界：形状不合当没有）。 */
function parseGate(v: unknown): LessonProposal["gate"] | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.verbatim !== "boolean" || typeof o.anchorFound !== "boolean") return null;
  const at = num(o.at);
  if (at === null) return null;
  return { verbatim: o.verbatim, anchorFound: o.anchorFound, at };
}

/** 落地确认（读盘边界：形状不合当没有）。 */
function parseLanding(v: unknown): LessonProposal["landing"] | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.landed !== "boolean" || !Array.isArray(o.files)) return null;
  const at = num(o.at);
  if (at === null) return null;
  const files = o.files.filter((f): f is string => typeof f === "string");
  const commit = typeof o.commit === "string" && o.commit !== "" ? o.commit : undefined;
  const reason = typeof o.reason === "string" && o.reason !== "" ? o.reason : undefined;
  return {
    landed: o.landed,
    files,
    at,
    ...(commit === undefined ? {} : { commit }),
    ...(reason === undefined ? {} : { reason }),
  };
}

/** 校验结论（读盘边界：形状不合当没有）。 */
function parseVerdict(v: unknown): LessonProposal["verdict"] | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const before = num(o.before);
  const after = num(o.after);
  const at = num(o.at);
  if (before === null || after === null || at === null) return null;
  if (o.verdict !== "effective" && o.verdict !== "ineffective" && o.verdict !== "unverified") return null;
  return { before, after, verdict: o.verdict, at };
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

function parseRun(v: unknown): EvolutionRun | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id);
  const sessionId = str(o.sessionId);
  const at = num(o.at);
  if (id === null || sessionId === null || at === null) return null;
  if (!RUN_KINDS.includes(o.kind as EvolutionRun["kind"])) return null;
  const note = str(o.note);
  return { id, kind: o.kind as EvolutionRun["kind"], at, sessionId, ...(note === null ? {} : { note }) };
}

export function loadRuns(): EvolutionRun[] {
  const raw = localStorage.getItem(KEY_RUNS);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(parseRun).filter((r): r is EvolutionRun => r !== null);
}

export function saveRuns(runs: EvolutionRun[]): void {
  localStorage.setItem(KEY_RUNS, JSON.stringify(runs.slice(0, 50)));
}

export function loadLastReview(): number | null {
  const raw = localStorage.getItem(KEY_LAST_REVIEW);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function saveLastReview(at: number | null): void {
  if (at === null) localStorage.removeItem(KEY_LAST_REVIEW);
  else localStorage.setItem(KEY_LAST_REVIEW, String(at));
}

/** 自进化自己开的会话（复盘/校验/落库）：复盘挑靶子时要排除，免得分析自己。 */
export function loadOwnSessions(): string[] {
  const raw = localStorage.getItem(KEY_OWN_SESSIONS);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
}

export function saveOwnSessions(ids: string[]): void {
  localStorage.setItem(KEY_OWN_SESSIONS, JSON.stringify(ids.slice(-50)));
}

export function loadApplySession(): string | null {
  return localStorage.getItem(KEY_SESSION);
}

export function saveApplySession(sessionId: string | null): void {
  if (sessionId === null) localStorage.removeItem(KEY_SESSION);
  else localStorage.setItem(KEY_SESSION, sessionId);
}

/** home 作用域（skill/global）的交办会话：cwd=$DSH_HOME，沙箱边界即引擎目录。 */
export function loadHomeSession(): string | null {
  return localStorage.getItem(KEY_HOME_SESSION);
}

export function saveHomeSession(sessionId: string | null): void {
  if (sessionId === null) localStorage.removeItem(KEY_HOME_SESSION);
  else localStorage.setItem(KEY_HOME_SESSION, sessionId);
}

export function loadLastConsolidate(): number | null {
  const raw = localStorage.getItem(KEY_LAST_CONSOLIDATE);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function saveLastConsolidate(at: number | null): void {
  if (at === null) localStorage.removeItem(KEY_LAST_CONSOLIDATE);
  else localStorage.setItem(KEY_LAST_CONSOLIDATE, String(at));
}

export function loadAppliedToday(): AppliedToday {
  const raw = localStorage.getItem(KEY_APPLIED_TODAY);
  if (raw === null) return { day: "", count: 0 };
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== "object" || v === null) return { day: "", count: 0 };
    const o = v as Record<string, unknown>;
    if (typeof o.day !== "string" || typeof o.count !== "number") return { day: "", count: 0 };
    return { day: o.day, count: o.count };
  } catch {
    return { day: "", count: 0 }; // 损坏的旧缓存：当没写过
  }
}

export function saveAppliedToday(v: AppliedToday): void {
  localStorage.setItem(KEY_APPLIED_TODAY, JSON.stringify(v));
}
