// 使用统计数据层：引擎没有 usage RPC（UNARY_ROUTES 已核对，PITFALLS §4.6），
// 用量从 session.list × session.history 的持久事件前端折叠而来。
// 口径（与参考稿对齐的本地定义）：
//   tokens = inputTokens + outputTokens（cacheRead/reasoning 引换单列，不计入）；
//   轮次   = user/message（source.kind==="user"）条数；
//   活跃日 = 当日 tokens>0 或有轮次（本地时区自然日）；
//   聊天时长 = 单会话 Σ(step/start→assistant/message) + Σ(tool/call→tool/result)
//   的墙钟合计，跨会话取最大；compaction/summary 的 usage 也是真实调用，一并计入。
// 折叠为纯函数（__tests__ 钉形状）；collectUsageStats 是唯一带 IO 的入口。

import { api } from "../api";
import type {
  AssistantMessageData, CompactionSummaryData, SessionEvent, ToolCallData, ToolResultData, UserMessageData,
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
const FETCH_POOL = 6;

async function collectSessionEvents(sessionId: string): Promise<SessionEvent[]> {
  const out: SessionEvent[] = [];
  let atSeq: number | undefined;
  for (;;) {
    const page = await api.history({ sessionId, atSeq, maxMessages: HISTORY_PAGE });
    out.push(...page.events.map((e) => e.event));
    if (!page.hasMore || page.events.length === 0) break;
    atSeq = page.events[0]!.event.seq;
  }
  // 翻页自尾向头，页间倒序；配对折叠依赖时序，统一按 seq 归位
  out.sort((a, b) => a.seq - b.seq);
  return out;
}

/** 拉全部顶级会话（子会话 usage 折进父会话会重复计——origin=subagent 不取；
 *  blank 会话无事件，跳过省一次往返）。 */
export async function collectUsageStats(): Promise<UsageStats> {
  const fold = makeUsageFold();
  const { items } = await api.sessions();
  const chats = items.filter((s) => s.origin !== "subagent" && !s.blank);
  for (let i = 0; i < chats.length; i += FETCH_POOL) {
    const batch = chats.slice(i, i + FETCH_POOL);
    // 单会话拉取失败（如取数中途被删）只损失该会话，不拖垮整页
    const pages = await Promise.all(batch.map((s) => collectSessionEvents(s.sessionId).catch(() => [] as SessionEvent[])));
    for (const events of pages) foldSessionEvents(fold, events);
  }
  return statsFromFold(fold, Date.now());
}
