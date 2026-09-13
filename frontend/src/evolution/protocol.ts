// 自进化协议的解析层：模型在回复里输出 info string 为 `lesson` 的围栏代码块，内容是
// 一段 JSON 提案。标准与红线在 `docs/EVOLUTION-POLICY.md`（仓库内、可演进），
// 触发判据与输出格式在引擎技能 `deepdive-evolution`（随应用发）。
//
// 这里是**形状边界**：不合形状一律 null——采集端丢弃、显示端退回普通代码块，
// 绝不猜字段。origin（会话/轮/事件序号）由采集端盖戳，不采信模型自报的定位信息。

export const LESSON_LANG = "lesson";
/** 校验回执块的 info string（后台校验运行用它把结果写回队列）。 */
export const VERDICT_LANG = "lesson-verify";

export type LessonHome = "agents" | "pitfalls" | "spec" | "skill" | "policy";
export type LessonCategory = "incident" | "workflow" | "fact" | "rule";
export type LessonStatus = "pending" | "applied" | "dismissed" | "expired";

const HOMES: readonly LessonHome[] = ["agents", "pitfalls", "spec", "skill", "policy"];
const CATEGORIES: readonly LessonCategory[] = ["incident", "workflow", "fact", "rule"];

export interface LessonEvidence {
  /** 逐字摘录（≤500 字）；助手内容只能作上下文，不能单独当证据。 */
  excerpt: string;
  /** 可选出处提示（日志 / 提交号 / 文件:行）。 */
  note?: string;
}

/** 效果主张：可被日志证伪的预测；null = 风格类（可沉淀，不进效果统计）。 */
export interface LessonPredict {
  metric: "repeat-incident" | "steps";
  /** 可 grep 的签名；提出前应自证能在日志里命中。 */
  signature: string;
  windowDays: number;
}

/** 到期校验的结论：落地前（基线）与落地后同一长度的两个窗口各命中几次。 */
export interface LessonVerdict {
  /** 落地前同长度窗口的命中数（基线）；0 = 样本不足，判不了。 */
  before: number;
  /** 落地后窗口的命中数（repeat-incident）/ 每次会话的平均工具调用数（steps）。 */
  after: number;
  verdict: "effective" | "ineffective" | "unverified";
  at: number;
}

export interface LessonProposal {
  id: string;
  category: LessonCategory;
  home: LessonHome;
  /** 落点的标题锚（插到该节末尾）；找不到锚点整条拒绝，不猜位置。 */
  anchor: string;
  content: string;
  inference: "explicit" | "implicit";
  evidence: LessonEvidence[];
  predict: LessonPredict | null;
  status: LessonStatus;
  createdAt: number;
  updatedAt: number;
  /** 采集出处（应用盖戳）：会话 / 轮 / 事件序号。 */
  origin: { sessionId: string; turn: number; eventSeq: number };
  /** 采纳后交办的那条会话（落库由它完成，见 SPEC §3.4）。 */
  appliedSessionId?: string;
  /** 采纳（交办）时刻：到期校验的窗口锚点（政策 §4「落库时把窗口切两半」）。
   *  createdAt 是提议时刻，一条提案可能压很多天才被采纳，不能当落地基线。 */
  appliedAt?: number;
  /** 上一次校验派发时刻：回执可能丢（重启/会话中途关闭），用它做重发守卫，
   *  而不是「没回执就每分钟重发」。 */
  lastVerifyAt?: number;
  /** 到期校验的结论（有 predict 的才有；见 SPEC §3.5）。 */
  verdict?: LessonVerdict;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

function parseEvidence(v: unknown): LessonEvidence[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: LessonEvidence[] = [];
  for (const raw of v) {
    if (typeof raw !== "object" || raw === null) return null;
    const o = raw as Record<string, unknown>;
    const excerpt = str(o.excerpt);
    if (excerpt === null || excerpt.length > 500) return null;
    const note = str(o.note);
    out.push({ excerpt, ...(note === null ? {} : { note }) });
  }
  return out;
}

function parsePredict(v: unknown): LessonPredict | null | undefined {
  if (v === null || v === undefined) return null; // 风格类
  if (typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (o.metric !== "repeat-incident" && o.metric !== "steps") return undefined;
  const signature = str(o.signature);
  const windowDays = o.windowDays;
  if (signature === null) return undefined;
  if (typeof windowDays !== "number" || !Number.isFinite(windowDays) || windowDays < 1 || windowDays > 365) return undefined;
  return { metric: o.metric, signature, windowDays };
}

/** 解析一份提案；形状不合回 null。origin 缺省（显示端）时用占位，不参与去重。 */
export function parseLesson(
  text: string,
  origin: LessonProposal["origin"] = { sessionId: "", turn: -1, eventSeq: -1 },
): LessonProposal | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return null; // 不是 JSON：按普通代码块处理
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;

  const category = o.category as LessonCategory;
  const home = o.home as LessonHome;
  const anchor = str(o.anchor);
  const content = str(o.content);
  if (!CATEGORIES.includes(category) || !HOMES.includes(home)) return null;
  if (anchor === null || content === null || content.length > 2000) return null;
  const evidence = parseEvidence(o.evidence);
  if (evidence === null) return null;
  const predict = parsePredict(o.predict);
  if (predict === undefined) return null;

  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    category,
    home,
    anchor,
    content,
    inference: o.inference === "explicit" ? "explicit" : "implicit",
    evidence,
    predict,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    origin,
  };
}

/** 解析一条校验回执；形状不合回 null（采集端丢弃，显示端按普通代码块渲染）。
 *  **判定不采信模型**：它只报两个窗口的数字，有效/无效由 judgeVerdict 按政策阈值算。 */
export function parseVerdict(text: string): { id: string; before: number; after: number } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id);
  const before = o.before;
  const after = o.after;
  if (id === null) return null;
  if (typeof before !== "number" || !Number.isFinite(before) || before < 0) return null;
  if (typeof after !== "number" || !Number.isFinite(after) || after < 0) return null;
  return { id, before, after };
}

/** 判定阈值（政策 §4）：痕迹类要砍到基线一半以下，步数类至少 −30%；基线为 0
 *  说明这个签名本来就不出现，样本不足，不写成败。 */
export function judgeVerdict(metric: "repeat-incident" | "steps", before: number, after: number): LessonVerdict["verdict"] {
  if (before <= 0) return "unverified";
  const ratio = metric === "steps" ? 0.7 : 0.5;
  return after <= before * ratio ? "effective" : "ineffective";
}

/** 从一段助手文本里抠出所有 lesson 块（采集端用；显示端只看单块）。 */
export function lessonBlocks(text: string): string[] {
  return fencedBlocks(text, "lesson");
}

/** 从一段助手文本里抠出所有校验回执块。 */
export function verdictBlocks(text: string): string[] {
  return fencedBlocks(text, VERDICT_LANG);
}

function fencedBlocks(text: string, lang: string): string[] {
  const out: string[] = [];
  const re = new RegExp("```\\s*" + lang + "\\s*\\n([\\s\\S]*?)```", "g");
  for (let m = re.exec(text); m !== null; m = re.exec(text)) out.push(m[1] ?? "");
  return out;
}
