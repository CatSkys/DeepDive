// 使用统计数据层：引擎没有 usage RPC（UNARY_ROUTES 已核对，PITFALLS §4.6），
// 用量从 session/list × session/follow+page 的持久事件前端折叠而来。
// 口径（与参考稿对齐的本地定义）：
//   tokens = inputTokens + outputTokens（cacheRead/reasoning 引换单列，不计入）；
//   轮次   = user/message（source.kind==="user"）条数；
//   活跃日 = 当日 tokens>0 或有轮次（本地时区自然日）；
//   聊天时长 = 单会话 Σ(step/start→assistant/message) + Σ(tool/call→tool/result)
//   的墙钟合计，跨会话取最大；compaction/summary 的 usage 也是真实调用，一并计入。
// 折叠为纯函数（__tests__ 钉形状）；collectUsageStats 是唯一带 IO 的入口。
//
// 数据模型（用户定稿，2026-09-12）：**用量按会话记录在本地，与归档/删除无关**——
// 只要那段时间用过就算数，归档或删掉聊天不抹账。因此：
//   · localStorage 的每会话折叠（deepdive.usageFold）是**事实源**：页面第一帧就把
//     整份缓存折出来直接展示（含已归档、已删除会话的历史），不等任何 IO；
//   · 引擎侧读历史只能走 session/follow 开窗 + session/page 回翻（没有 history
//     RPC），且要逐会话开流（159 会话十几秒）→ 所以只在**后台补差**：只读 updatedAt
//     变化过、且本地没删的会话，结果合并写回缓存（不 prune，历史不丢）；
//   · onProgress 渐进上报：先出缓存里的账，后台补完再刷一版。
// 另两处必须先修的病（本轮实测）：
//   · **悬挂**：某些会话（如本地已删除但引擎仍列出的）follow 流既不开也不报错，
//     promise 永不 settle → 整轮收集永不完成（页面因 ③ 看着不慢，但缓存写不进去、
//     刷新一直转）。处置：每会话加超时，超时按失败算且不写缓存；
//   · **会话清单由调用方给**：直接用 api.sessions() 会把本地已删除/已归档的会话
//     一起算进来（前者悬挂、后者不该计入），改由页面传 store 里已过滤的列表。

import { api } from "../api";
import type {
  AssistantMessageData, CompactionSummaryData, SessionEvent, SessionSummary, ToolCallData, ToolResultData, UserMessageData,
} from "../types";
import type { Lang } from "../i18n";

export interface UsageDay {
  /** 本地时区 yyyy-mm-dd */
  day: string;
  tokens: number;
  turns: number;
  byModel: Record<string, number>;
}

export interface UsageStats {
  /** 按 day 升序；只含出现过事件的日 */
  days: UsageDay[];
  totalTokens: number;
  peakDayTokens: number;
  longestChatMs: number;
  currentStreak: number;
  longestStreak: number;
}

/** 跨会话累积的折叠态；day 表按需生长。 */
export interface UsageFold {
  days: Map<string, UsageDay>;
  longestChatMs: number;
}

export function makeUsageFold(): UsageFold {
  return { days: new Map(), longestChatMs: 0 };
}

export function dayKeyOf(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** day key ±n 天（本地时区）。 */
export function addDays(key: string, delta: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return dayKeyOf(new Date(y!, m! - 1, d! + delta).getTime());
}

function dayOf(fold: UsageFold, ms: number): UsageDay {
  const key = dayKeyOf(ms);
  let day = fold.days.get(key);
  if (!day) {
    day = { day: key, tokens: 0, turns: 0, byModel: {} };
    fold.days.set(key, day);
  }
  return day;
}

/** 折叠一个会话的完整升序事件。call→result / step→message 的配对跨页存活，
 *  调用方须把该会话所有页拼齐后一次性传入。union 尾部 catch-all 使 switch
 *  不自动收窄 data（PITFALLS §2.3），已知 case 在 case 内显式 as 到载荷类型。 */
export function foldSessionEvents(fold: UsageFold, events: SessionEvent[]): void {
  let openStepStart: number | null = null;
  const pendingCalls = new Map<string, number>();
  let activeMs = 0;
  for (const ev of events) {
    switch (ev.type) {
      case "step/start":
        openStepStart = ev.time;
        break;
      case "assistant/message": {
        if (openStepStart !== null) {
          activeMs += Math.max(0, ev.time - openStepStart);
          openStepStart = null;
        }
        const d = ev.data as AssistantMessageData;
        const tokens = (d.usage?.inputTokens ?? 0) + (d.usage?.outputTokens ?? 0);
        const source = d.message.source;
        const model = source.model || source.provider;
        if (tokens > 0) {
          const day = dayOf(fold, ev.time);
          day.tokens += tokens;
          day.byModel[model] = (day.byModel[model] ?? 0) + tokens;
        }
        break;
      }
      case "compaction/summary": {
        const d = ev.data as CompactionSummaryData;
        const tokens = (d.usage?.inputTokens ?? 0) + (d.usage?.outputTokens ?? 0);
        if (tokens > 0) dayOf(fold, ev.time).tokens += tokens;
        break;
      }
      case "tool/call": {
        const d = ev.data as ToolCallData;
        pendingCalls.set(d.callId ?? d.id ?? "", ev.time);
        break;
      }
      case "tool/result": {
        const d = ev.data as ToolResultData;
        const callId = d.message?.source?.callId ?? d.callId ?? d.toolCallId;
        const dispatched = callId !== undefined ? pendingCalls.get(callId) : undefined;
        if (dispatched !== undefined && callId !== undefined) {
          activeMs += Math.max(0, ev.time - dispatched);
          pendingCalls.delete(callId);
        }
        break;
      }
      case "user/message": {
        const d = ev.data as UserMessageData;
        if (d.source?.kind === "user") dayOf(fold, ev.time).turns += 1;
        break;
      }
    }
  }
  fold.longestChatMs = Math.max(fold.longestChatMs, activeMs);
}

function runLengthEndingAt(active: Set<string>, cursorStart: string): number {
  let cursor = cursorStart;
  let n = 0;
  while (active.has(cursor)) {
    n += 1;
    cursor = addDays(cursor, -1);
  }
  return n;
}

/** 由折叠态汇出面板数字。nowMs 注入以便测试钉住连续天数。 */
export function statsFromFold(fold: UsageFold, nowMs: number): UsageStats {
  const days = [...fold.days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  const totalTokens = days.reduce((s, d) => s + d.tokens, 0);
  const peakDayTokens = days.reduce((m, d) => Math.max(m, d.tokens), 0);
  const active = new Set(days.filter((d) => d.tokens > 0 || d.turns > 0).map((d) => d.day));
  // 当前连续：今天还没聊不算断（从昨天起算），更早断档即止
  const today = dayKeyOf(nowMs);
  const currentStreak = active.has(today)
    ? runLengthEndingAt(active, today)
    : active.has(addDays(today, -1))
      ? runLengthEndingAt(active, addDays(today, -1))
      : 0;
  let longestStreak = 0;
  let run = 0;
  let prev = "";
  for (const day of active) {
    run = prev !== "" && addDays(prev, 1) === day ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    prev = day;
  }
  return { days, totalTokens, peakDayTokens, longestChatMs: fold.longestChatMs, currentStreak, longestStreak };
}

/** 模型目录：全量按总 tokens 降序（只含有量的），驱动图例配色稳定。 */
export function modelOrderOf(stats: UsageStats): string[] {
  const totals = new Map<string, number>();
  for (const d of stats.days) {
    for (const [m, v] of Object.entries(d.byModel)) totals.set(m, (totals.get(m) ?? 0) + v);
  }
  return [...totals.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([m]) => m);
}

/** 以今天结尾的最近 n 个自然日 day key（升序）。 */
export function lastNDayKeys(n: number, nowMs: number): string[] {
  const today = dayKeyOf(nowMs);
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) keys.push(addDays(today, -i));
  return keys;
}

/* ── 展示格式化（zh 跟随参考稿：亿/万；en 用 K/M/B）── */

function oneDecimal(v: number): string {
  const s = v.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

export function formatTokensShort(n: number, lang: Lang): string {
  if (lang === "zh") {
    if (n >= 1e8) return `${oneDecimal(n / 1e8)}亿`;
    if (n >= 1e4) return `${oneDecimal(n / 1e4)}万`;
    return String(Math.round(n));
  }
  if (n >= 1e9) return `${oneDecimal(n / 1e9)}B`;
  if (n >= 1e6) return `${oneDecimal(n / 1e6)}M`;
  if (n >= 1e3) return `${oneDecimal(n / 1e3)}K`;
  return String(Math.round(n));
}

export function formatDuration(ms: number, lang: Lang): string {
  const min = Math.round(ms / 60000);
  if (lang === "zh") {
    if (min >= 1440) {
      const d = Math.floor(min / 1440);
      const h = Math.round((min % 1440) / 60);
      return h > 0 ? `${d}天${h}小时` : `${d}天`;
    }
    if (min >= 60) {
      const h = Math.floor(min / 60);
      const m = min % 60;
      return m > 0 ? `${h}小时${m}分钟` : `${h}小时`;
    }
    return `${min}分钟`;
  }
  if (min >= 1440) {
    const d = Math.floor(min / 1440);
    const h = Math.round((min % 1440) / 60);
    return h > 0 ? `${d}d ${h}h` : `${d}d`;
  }
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${min}m`;
}

export function formatDays(n: number, lang: Lang): string {
  return lang === "zh" ? `${n}天` : `${n}d`;
}

/** yyyy-mm-dd → zh「9月2日」/ en「Sep 2」 */
export function formatDayShort(key: string, lang: Lang): string {
  const [, m, d] = key.split("-").map(Number);
  if (lang === "zh") return `${m}月${d}日`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(Number(key.slice(0, 4)), m! - 1, d!));
}

/** yyyy-mm-dd → zh「2026年9月3日」/ en「Sep 3, 2026」 */
export function formatDayFull(key: string, lang: Lang): string {
  const [y, m, d] = key.split("-").map(Number);
  if (lang === "zh") return `${y}年${m}月${d}日`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(y!, m! - 1, d!));
}

/** yyyy-mm → zh「9月」/ en「Sep」 */
export function formatMonthLabel(key: string, lang: Lang): string {
  const [y, m] = key.split("-").map(Number);
  if (lang === "zh") return `${m}月`;
  return new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(y!, m! - 1, 1));
}

/* ── 取数（唯一 IO 入口）── */

const HISTORY_PAGE = 500;
const FETCH_POOL = 24;

/* ── 每会话折叠缓存：键为 sessionId，值带 updatedAt 做失效判定 ── */
const CACHE_KEY = "deepdive.usageFold";
const CACHE_VERSION = 1;

interface SessionUsage {
  updatedAt: number;
  days: UsageDay[];
  longestChatMs: number;
}

function readCache(): Record<string, SessionUsage> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { v?: number; sessions?: Record<string, SessionUsage> };
    return parsed.v === CACHE_VERSION && parsed.sessions ? parsed.sessions : {};
  } catch { /* 缓存损坏/无 localStorage → 当作没缓存，重算即可 */ }
  return {};
}

function writeCache(sessions: Record<string, SessionUsage>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ v: CACHE_VERSION, sessions }));
  } catch { /* 配额满/受限环境：不写缓存，下次照样能算出来 */ }
}

/** 把单会话的折叠结果并入全局（日聚合相加、最长聊天取最大）。 */
export function mergeSessionUsage(fold: UsageFold, days: UsageDay[], longestChatMs: number): void {
  for (const d of days) {
    let target = fold.days.get(d.day);
    if (!target) {
      target = { day: d.day, tokens: 0, turns: 0, byModel: {} };
      fold.days.set(d.day, target);
    }
    target.tokens += d.tokens;
    target.turns += d.turns;
    for (const [model, tokens] of Object.entries(d.byModel)) {
      target.byModel[model] = (target.byModel[model] ?? 0) + tokens;
    }
  }
  fold.longestChatMs = Math.max(fold.longestChatMs, longestChatMs);
}

/** 单会话读取的超时（毫秒）：流不开不报错的悬挂会话不能拖住整页（见头注释）。 */
const SESSION_TIMEOUT_MS = 8000;

function collectSessionEvents(sessionId: string): Promise<SessionEvent[]> {
  return new Promise<SessionEvent[]>((resolve, reject) => {
    const out: SessionEvent[] = [];
    // 快照是全量替换语义（mux 断线/流重开会重发快照）：每次快照清仓重装；
    // snapGen 让旧一代的翻页循环追加作废，防止重连把同一批账计两遍。
    let snapGen = 0;
    // 0.1.2：冷读走 session/follow 开窗快照（带 cursor），向前翻页走
    // session/page（throughSeq 必须取自开窗帧）；读完即关流。
    const close = api.followSession(
      { kind: "session", sessionId },
      {
        onSnapshot: (s) => {
          const gen = ++snapGen;
          out.length = 0;
          out.push(...s.entries.map((e) => e.event));
          const firstSeq = s.entries[0]?.event.seq;
          if (!s.hasMore || firstSeq === undefined) { close(); resolve(out); return; }
          void pullOlder(gen, s.cursor, firstSeq).catch(reject);
        },
        onEvent: () => { /* 统计只读历史：直播增量忽略 */ },
      },
      HISTORY_PAGE,
    );
    // 翻页只能在快照到达后驱动：throughSeq/beforeSeq 都取自开窗帧，快照前
    // 并不存在（2026-09-13 修复：原来在快照前同步调一次直接 return，超过
    // 一窗的会话永远翻不了页、8s 超时被整只跳过——长会话的量进不了统计）。
    const pullOlder = async (gen: number, throughSeq: number, beforeSeq: number) => {
      for (;;) {
        const page = await api.page({ address: { kind: "session", sessionId }, throughSeq, beforeSeq, maxMessages: HISTORY_PAGE });
        if (gen !== snapGen) return;
        out.push(...page.entries.map((e) => e.event));
        if (!page.hasMore || page.entries.length === 0) break;
        beforeSeq = page.entries[0]!.event.seq;
      }
      close();
      resolve(out);
    };
    // 兜底：引擎长时间不开窗（重启/断连），调用方按失败处理
    window.setTimeout(() => reject(new Error("session/follow snapshot timeout")), 8000);
  }).then((events) => {
    // 翻页自尾向头，页间倒序；配对折叠依赖时序，统一按 seq 归位
    events.sort((a, b) => a.seq - b.seq);
    return events;
  });
}

/** 拉全部顶级会话（子会话 usage 折进父会话会重复计——origin=subagent 不取；
 *  blank 会话无事件，跳过省一次往返）。 */
/** 给单会话读取加超时：超时/失败都算 null（不写缓存，下轮重试）。 */
function withTimeout(promise: Promise<SessionEvent[]>, ms: number): Promise<SessionEvent[] | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), ms);
    promise.then(
      (events) => { window.clearTimeout(timer); resolve(events); },
      () => { window.clearTimeout(timer); resolve(null); },
    );
  });
}

export interface UsageProgress {
  stats: UsageStats;
  /** 本轮已补的会话数 / 需要补的会话数（缓存里已有的不计入 total）。 */
  done: number;
  total: number;
}

/**
 * @param chats 需要**补差**的会话（调用方给：引擎列表里排除子会话/空会话/本地已删除；
 *   已归档会话的历史已在缓存里，不必再读）。
 * @param onProgress 进度回调：第一次回调发生在任何 IO 之前（纯缓存折叠，可直接渲染）。
 */
export async function collectUsageStats(chats: readonly SessionSummary[], onProgress?: (p: UsageProgress) => void): Promise<UsageStats> {
  const cached = readCache();
  const fold = makeUsageFold();
  // ① 缓存里已有的全部先入账（含已归档/已删除会话的历史——它们不再出现在会话列表里，
  //    但用过的量照算）
  for (const entry of Object.values(cached)) mergeSessionUsage(fold, entry.days, entry.longestChatMs);
  // ② 只对"变过的"会话做后台补差
  const pending = chats.filter((s) => cached[s.sessionId]?.updatedAt !== s.updatedAt);
  let done = 0;
  onProgress?.({ stats: statsFromFold(fold, Date.now()), done, total: pending.length });
  const fresh: Record<string, SessionUsage> = {};
  for (let i = 0; i < pending.length; i += FETCH_POOL) {
    const batch = pending.slice(i, i + FETCH_POOL);
    // 单会话拉取失败/超时只损失该会话，不拖垮整页——且**不写缓存**，
    // 否则这次的空结果会被当成权威数据钉住
    const pages = await Promise.all(batch.map((s) => withTimeout(collectSessionEvents(s.sessionId), SESSION_TIMEOUT_MS)));
    batch.forEach((s, k) => {
      const events = pages[k];
      if (events === null) return;
      const local = makeUsageFold();
      foldSessionEvents(local, events);
      const days = [...local.days.values()];
      fresh[s.sessionId] = { updatedAt: s.updatedAt, days, longestChatMs: local.longestChatMs };
      mergeSessionUsage(fold, days, local.longestChatMs);
    });
    done += batch.length;
    onProgress?.({ stats: statsFromFold(fold, Date.now()), done, total: pending.length });
  }
  // ③ 合并写回：只覆盖/新增本轮算过的会话，其余（归档/已删除/未变）原样保留
  writeCache({ ...cached, ...fresh });
  return statsFromFold(fold, Date.now());
}
