// 摄取引擎（SessionView 的"模型脸"）：SessionEvent 流 → RenderItem[]，含 O(1) 索引
// 上下文、轮终收尾与 schedule/todo 等纯折叠。从 SessionView.tsx 整体搬迁（R-007）；
// ingest 单函数（228 行）为存量原样保留。不含 React，vitest 直接钉行为。
import type {
  AssistantMessageData, HistoryEntryView, StreamChunk, ToolCallData, ToolResultData,
  SessionEvent, UserMessageData,
} from "../types";
import { narrowDiffs } from "../diffModel";
import { messageText, userText } from "./eventText";
import { truncate } from "./format";

export interface WorkflowMember {
  seq: number;
  label: string;
  phase?: string;
  childId?: string;
  outcome?: "completed" | "failed" | "cancelled";
}

export interface RenderItem {
  key: string;
  kind: "user" | "assistant" | "tool-call" | "chunk" | "reasoning" | "turn-tail" | "command" | "compaction" | "retry" | "workflow";
  event?: SessionEvent;
  toolName?: string;
  toolCallId?: string;
  args?: string;
  output?: string;
  failed?: boolean;
  time?: number;
  turn?: number;
  /** 命令卡：run/done 以 commandId 配对，done 到达时就地补状态与结果文本。 */
  commandId?: string;
  commandStatus?: "running" | "success" | "error";
  commandText?: string;
  /** 工作流卡：成员按 seq 归并（agent-start/end 配对）。 */
  members?: WorkflowMember[];
  /** 压缩卡：compactionId 去重键。 */
  compactionId?: string;
  /** 重试行：retryId 去重键（同一等待更新不新增）。 */
  retryId?: string;
  // 编辑类工具的文件变更（call 侧=pending 态；result 侧=已应用，权威）
  diffs?: import("../types").FileDiff[];
  // attached turn-level stats for the closing assistant message meta row
  meta?: TurnMeta;
  // turn-local produced file paths (attached during finalizeTurns)
  produced?: string[];
  // turn/end 的 seq：branch（session.fork atSeq）的收尾锚点
  forkSeq?: number;
  // 轮终原因（3.5 轮失败增强：error 消息/max-tokens 继续按钮）
  endReason?: import("../types").TurnEndReason;
  // 本轮累计 token 用量（assistant usage，轮尾弹层）
  usage?: import("../types").TokenUsage;
}

export interface TurnMeta {
  runMs: number;
  ttftMs: number | null;
  tokensPerSecond: number | null;
}

/** schedule/change 折叠（5.3，官方 schedule 域 fold）：create→登记、
 *  delete→移除、dispatch/advance→定格。纯函数，vitest 钉住。 */
export function foldSchedule(records: import("../types").ScheduleRecord[], data: import("../types").ScheduleChangeData): import("../types").ScheduleRecord[] {
  if (data.operation === "create") {
    if (records.some((r) => r.id === data.schedule.id)) return records;
    return [...records, data.schedule];
  }
  if (data.operation === "delete") return records.filter((r) => r.id !== data.id);
  return records; // dispatch/advance 只影响投递史，目录不展示已派发项
}

export function parseTodos(args: string): { done: number; total: number; active: number; pending: number; items: Array<{ content: string; status: string }> } | null {
  if (!args) return null;
  try {
    const p = JSON.parse(args);
    const todos = p?.todos ?? (Array.isArray(p) ? p : null);
    if (!Array.isArray(todos) || todos.length === 0) return null;
    const items = todos.map((t: unknown) => {
      const o = (t ?? {}) as Record<string, unknown>;
      const content = typeof o.content === "string" ? o.content : typeof o.todo === "string" ? o.todo : typeof o.description === "string" ? o.description : JSON.stringify(t);
      return { content, status: typeof o.status === "string" ? o.status : "pending" };
    });
    const done = items.filter((x) => x.status === "completed").length;
    const active = items.filter((x) => x.status === "in_progress").length;
    return { done, total: items.length, active, pending: items.length - done - active, items };
  } catch {
    return null;
  }
}

function toolCallIdOf(data: ToolCallData): string {
  return data.callId ?? data.id ?? "";
}

/// Read the stored args of a rendered tool-call item (for derived file path).
function extractArgsOf(out: RenderItem[], idx: number | undefined): string {
  return idx !== undefined && out[idx] ? out[idx].args ?? "" : "";
}

/// Derive an openable file path from a mutation tool's arguments (official
/// FILE_PATH_KEYS: path / file_path). Only write/edit/read variants produce one.
export function derivePath(toolName: string, args: string): string | undefined {
  if (!/^(write|edit|read|str_replace_editor|file_read|file_write)$/.test(toolName)) return undefined;
  try {
    const p = JSON.parse(args);
    const picked = p?.path ?? p?.file_path;
    if (typeof picked === "string" && picked) return picked.split("\n")[0].trim();
  } catch { /* non-JSON args */ }
  return undefined;
}

function toolArgsString(argumentsField: unknown): string {
  if (typeof argumentsField === "string") return argumentsField;
  if (argumentsField === undefined || argumentsField === null) return "";
  try { return JSON.stringify(argumentsField, null, 2); } catch { return String(argumentsField); }
}

/// Pull the output text + failure + path from a tool/result payload (typed).
export function extractToolResult(data: ToolResultData): { callId?: string; output: string; failed: boolean; path?: string } {
  const msg = data.message;
  let output = "";
  const parts: string[] = [];
  const walk = (c: unknown) => {
    if (!c) return;
    if (typeof c === "string") { parts.push(c); return; }
    if (Array.isArray(c)) { c.forEach(walk); return; }
    if (typeof c === "object") {
      const o = c as Record<string, unknown>;
      if (typeof o.text === "string") parts.push(o.text);
      if (o.content !== undefined) walk(o.content);
    }
  };
  walk(msg?.content);
  if (parts.length) output = parts.join("\n");
  if (!output && typeof data.output === "string") output = data.output;
  if (!output && data.text) output = String(data.text);
  if (!output && data.result !== undefined) output = JSON.stringify(data.result);
  if (!output) output = truncate(JSON.stringify(data));
  const failed = data.isError === true || msg?.isError === true || data.ok === false;
  const callId = data.toolCallId ?? data.callId ?? msg?.source?.callId;
  const path = typeof data.path === "string" ? data.path : undefined;
  return { callId, output, failed, path };
}

/**
 * Ingest context passed through the append pass. Holds O(1) indexes keyed by
 * stable business id (call id, turn) instead of scanning the rendered array —
 * the official ConversationAssembler "hot append must not scan the window"
 * rule.
 */
export interface IngestCtx {
  timing: Map<number, { start?: number; end?: number; firstToken?: number; endSeq?: number }>;
  outputs: Map<string, { output: string; failed: boolean }>;
  produced: Map<number, string[]>;
  /** callId → rendered tool-call item index (stable identity). */
  callIndex: Map<string, number>;
  /** callId → derived file path (from tool/call arguments) for produced lanes. */
  callPaths: Map<string, string>;
  /** commandId → rendered command item index (run/done 配对，O(1) 定位). */
  commandIndex: Map<string, number>;
  /** retryId → rendered retry item index（同一等待去重更新）. */
  retryIndex: Map<string, number>;
  /** runId → rendered workflow item index（成员就地归并，O(1)）. */
  workflowIndex: Map<string, number>;
  /** turn → 轮终原因 / 累计用量（轮尾渲染）. */
  turnReason: Map<number, import("../types").TurnEndReason>;
  turnUsage: Map<number, import("../types").TokenUsage>;
  /** turn → the latest accumulated assistant text (copy-able tail payload). */
  turnText: Map<number, string>;
  /** turn → tail anchor time (the closing assistant message, if any). */
  turnTime: Map<number, number>;
}

/** Fresh ingest context — history replay, live mux passes and tests share one shape. */
export function makeIngestCtx(): IngestCtx {
  return { timing: new Map(), outputs: new Map(), produced: new Map(), callIndex: new Map(), callPaths: new Map(), commandIndex: new Map(), retryIndex: new Map(), workflowIndex: new Map(), turnReason: new Map(), turnUsage: new Map(), turnText: new Map(), turnTime: new Map() };
}

export function ingest(out: RenderItem[], entry: { event: SessionEvent; output?: string; view?: HistoryEntryView }, ctx: IngestCtx) {
  const ev = entry.event;
  const base = { key: `${ev.seq}:${ev.type}`, event: ev, time: ev.time };
  // `ev.data` is a union of every event payload (the trailing catch-all is
  // `unknown`), so a `type` switch does not auto-narrow it. Each branch casts
  // to its own payload type — the narrow, exhaustive case union does that work.
  switch (ev.type) {
    case "user/message": {
      const d = ev.data as UserMessageData;
      const txt = userText(d);
      // 注入上下文（source.kind=plugin/skill-catalog/goal…，无正文）不渲染：
      // 系统提示词/插件/技能目录/goal 注入对用户是噪音（2026-09-04 用户拍板隐藏）
      if (txt) out.push({ ...base, kind: "user" });
      break;
    }
    case "turn/start": {
      const d = ev.data as { turn: number };
      ctx.timing.set(d.turn, { start: ev.time, end: undefined, firstToken: undefined });
      break;
    }
    case "turn/end": {
      const d = ev.data as { turn: number; reason: unknown };
      const t = ctx.timing.get(d.turn) ?? {};
      t.end = ev.time;
      t.endSeq = ev.seq;
      ctx.timing.set(d.turn, t);
      ctx.turnReason.set(d.turn, d.reason as import("../types").TurnEndReason);
      break;
    }
    case "assistant/chunk": {
      // Stream frames append chunk items for text-deltas; reasoning deltas
      // accumulate into a live trace item that the final assistant/message
      // replaces with the settled ThinkingState.
      const d = ev.data as { turn: number; step: number; chunk: StreamChunk };
      const chunk = d.chunk;
      if (chunk.type === "text-delta" && typeof chunk.text === "string" && chunk.text) {
        const turn = d.turn;
        const t0 = ctx.timing.get(turn);
        if (t0 && t0.firstToken === undefined) t0.firstToken = ev.time;
        const last = out[out.length - 1];
        if (last && last.kind === "chunk" && last.turn === turn) last.output = (last.output ?? "") + chunk.text;
        else out.push({ ...base, kind: "chunk", output: chunk.text, turn });
      }
      if (chunk.type === "reasoning-delta" && typeof chunk.text === "string" && chunk.text) {
        const turn = d.turn;
        const last = out[out.length - 1];
        if (last && last.kind === "reasoning" && last.turn === turn) last.output = (last.output ?? "") + chunk.text;
        else out.push({ ...base, kind: "reasoning", output: chunk.text, turn });
      }
      break;
    }
    case "assistant/message": {
      const d = ev.data as AssistantMessageData;
      const turn = d.turn;
      const text = messageText(d.message?.content);
      // Replace the live-streamed chunk/reasoning items for this step with
      // the final blocks. Discard them — re-appending interleaves stale
      // fragments.
      let cut = out.length - 1;
      while (cut >= 0 && (out[cut].kind === "chunk" || out[cut].kind === "reasoning") && out[cut].turn === turn) cut -= 1;
      out.length = cut + 1;
      // Track the accumulated tail payload.
      if (text) out.push({ ...base, kind: "assistant", turn });
      if (text) ctx.turnText.set(turn, text);
      if (d.usage) {
        // 多步轮按官方口径跨 step 求和（turn-metrics 的 fold 规则）
        const acc = ctx.turnUsage.get(turn) ?? {};
        const add = (a?: number, b?: number) => (a ?? 0) + (b ?? 0);
        ctx.turnUsage.set(turn, {
          inputTokens: add(d.usage.inputTokens, acc.inputTokens),
          outputTokens: add(d.usage.outputTokens, acc.outputTokens),
          cacheReadTokens: add(d.usage.cacheReadTokens, acc.cacheReadTokens),
          cacheWriteTokens: add(d.usage.cacheWriteTokens, acc.cacheWriteTokens),
          reasoningTokens: add(d.usage.reasoningTokens, acc.reasoningTokens),
        });
      }
      ctx.turnTime.set(turn, ev.time);
      break;
    }
    case "tool/call": {
      const d = ev.data as ToolCallData;
      const callId = toolCallIdOf(d);
      const args = d.arguments !== undefined ? toolArgsString(d.arguments) : d.argsRaw ?? d.command ?? "";
      const prev = ctx.callIndex.get(callId);
      if (prev !== undefined) {
        out[prev].args = args || out[prev].args;
      } else {
        const idx = out.length;
        out.push({
          ...base,
          kind: "tool-call",
          toolName: d.name ?? "tool",
          toolCallId: callId,
          args,
          turn: d.turn,
        });
        if (callId) ctx.callIndex.set(callId, idx);
      }
      // call 侧 diff 视图：引擎从 arguments 预推导的 pending 态变更
      const pendingDiffs = entry.view?.for === "call" && entry.view.view.card === "diff"
        ? narrowDiffs(entry.view.view.diffs)
        : null;
      if (pendingDiffs && prev !== undefined) out[prev].diffs = pendingDiffs;
      const p = derivePath(d.name ?? "tool", args);
      if (callId && p) ctx.callPaths.set(callId, p);
      break;
    }
    case "tool/result": {
      const d = ev.data as ToolResultData;
      const extracted = extractToolResult(d);
      const callId = extracted.callId ?? "";
      ctx.outputs.set(callId, { output: extracted.output, failed: extracted.failed });
      const prevIdx = ctx.callIndex.get(callId);
      // result 侧 diff 权威：事件 meta.diffs 优先，缺则用 history 视图槽位
      const appliedDiffs = narrowDiffs(d.meta?.diffs)
        ?? (entry.view?.for === "result" && entry.view.view.card === "diff" ? narrowDiffs(entry.view.view.diffs) : null);
      if (prevIdx !== undefined) {
        const item = out[prevIdx];
        if (item) {
          item.output = extracted.output;
          item.failed = extracted.failed;
          if (appliedDiffs) item.diffs = appliedDiffs;
        }
      }
      // produced files: successful mutation calls carrying a derived path
      if (!extracted.failed) {
        const filePath = ctx.callPaths.get(callId) ?? extracted.path ?? derivePath(prevIdx !== undefined ? out[prevIdx]?.toolName ?? "" : "", extractArgsOf(out, prevIdx));
        if (filePath) {
          const turn = d.turn ?? (prevIdx !== undefined ? out[prevIdx]?.turn : undefined) ?? -1;
          const list = ctx.produced.get(turn) ?? [];
          if (!list.includes(filePath)) {
            list.push(filePath);
            ctx.produced.set(turn, list);
          }
        }
      }
      break;
    }
    case "command/run": {
      const d = ev.data as import("../types").CommandRunData;
      const idx = out.length;
      out.push({
        ...base,
        kind: "command",
        commandId: d.commandId,
        toolName: d.name,
        args: d.args ?? "",
        commandStatus: "running",
      });
      if (d.commandId) ctx.commandIndex.set(d.commandId, idx);
      break;
    }
    case "command/done": {
      const d = ev.data as import("../types").CommandDoneData;
      const idx = ctx.commandIndex.get(d.commandId);
      if (idx !== undefined && out[idx]) {
        out[idx].commandStatus = d.kind;
        out[idx].commandText = d.text;
      }
      break;
    }
    case "compaction/summary": {
      const d = ev.data as import("../types").CompactionSummaryData;
      out.push({
        ...base,
        kind: "compaction",
        compactionId: d.compactionId,
        output: (d.summary ?? []).filter((b) => typeof b.text === "string").map((b) => b.text).join("\n\n"),
        args: d.shadowedTokenCount !== undefined ? String(d.shadowedTokenCount) : "",
      });
      break;
    }
    case "llm/retry": {
      const d = ev.data as import("../types").LlmRetryData;
      const prev = d.retryId ? ctx.retryIndex.get(d.retryId) : undefined;
      if (prev !== undefined && out[prev]) {
        out[prev].time = ev.time;
        out[prev].output = retryText(d);
      } else {
        const idx = out.length;
        out.push({ ...base, kind: "retry", retryId: d.retryId, output: retryText(d) });
        if (d.retryId) ctx.retryIndex.set(d.retryId, idx);
      }
      break;
    }
    case "tool-workflow/run-start":
    case "tool-workflow/agent-start":
    case "tool-workflow/agent-end":
    case "tool-workflow/run-end": {
      // 工作流运行卡（5.4）：run-start 开卡，成员按 seq 就地归并，run-end 定格
      const d = ev.data as import("../types").WorkflowRunStartData & Partial<import("../types").WorkflowAgentStartData & import("../types").WorkflowAgentEndData & import("../types").WorkflowRunEndData>;
      let idx = ctx.workflowIndex.get(d.runId);
      if (idx === undefined || !out[idx]) {
        idx = out.length;
        out.push({
          ...base,
          kind: "workflow",
          toolCallId: d.runId,
          args: ev.type === "tool-workflow/run-start" ? (ev.data as import("../types").WorkflowRunStartData).name : "",
        });
        ctx.workflowIndex.set(d.runId, idx);
      }
      const card = out[idx]!;
      if (ev.type === "tool-workflow/agent-start") {
        const s = ev.data as import("../types").WorkflowAgentStartData;
        card.members = card.members ?? [];
        card.members.push({ seq: s.seq, label: s.label, phase: s.phase, childId: s.childId, outcome: undefined });
        if (!card.args) card.args = s.label;
      } else if (ev.type === "tool-workflow/agent-end") {
        const e2 = ev.data as import("../types").WorkflowAgentEndData;
        card.members = card.members ?? [];
        const m = card.members.find((x) => x.seq === e2.seq);
        if (m) m.outcome = e2.outcome;
      } else if (ev.type === "tool-workflow/run-end") {
        card.commandStatus = (ev.data as import("../types").WorkflowRunEndData).stopReason === "completed" ? "success" : "error";
        card.commandText = (ev.data as import("../types").WorkflowRunEndData).stopReason;
      }
      break;
    }
    default:
      break;
  }
}

/** 重试行文本：延迟与次数 + 失败摘要（failure.code 优先，过长截断）。 */
function retryText(d: import("../types").LlmRetryData): string {
  const delay = d.delayMs !== undefined ? `${Math.round(d.delayMs / 1000)}s` : "";
  const attempt = d.maxRetries !== undefined ? `${d.retry}/${d.maxRetries}` : String(d.retry ?? "");
  const why = d.failure?.code ?? d.failure?.message ?? "";
  return [why, delay, attempt].filter(Boolean).join(" · ");
}

/**
 * Emit a per-turn tail item (meta + produced files). Official DSH renders a
 * `turn-tail` node per closed turn independent of whether the last block is
 * assistant text, so interrupted / tool-only turns keep their metrics+files.
 * Inserted right after the turn's last assistant item; a turn already having
 * a tail is updated in place.
 */
export function finalizeTurns(items: RenderItem[], ctx: IngestCtx) {
  const closed = [...ctx.timing.entries()].filter(([, t]) => t.start !== undefined && t.end !== undefined);
  if (closed.length === 0) return;
  // Build the tail payload per closed turn once.
  const tails = new Map<number, RenderItem>();
  for (const [turn, t] of closed) {
    const runMs = Math.max(0, (t.end ?? 0) - (t.start ?? 0));
    const ttftMs = t.firstToken !== undefined ? Math.max(0, t.firstToken - (t.start ?? 0)) : null;
    const tokensPerSecond = ttftMs !== null && runMs > ttftMs ? Math.round(((runMs - ttftMs) / 1000) * 100) / 100 : null;
    const txt = ctx.turnText.get(turn) ?? "";
    tails.set(turn, {
      key: `tail:${turn}`,
      kind: "turn-tail",
      turn,
      time: ctx.turnTime.get(turn),
      forkSeq: t.endSeq,
      event: txt
        ? ({ type: "assistant/message", seq: -1, time: ctx.turnTime.get(turn) ?? 0, data: { turn, step: 1, message: { role: "assistant", content: [{ type: "text", text: txt }], source: { kind: "model", provider: "", model: "" }, id: `tail:${turn}` } } } as SessionEvent)
        : undefined,
      meta: { runMs, ttftMs, tokensPerSecond },
      produced: ctx.produced.get(turn) ?? [],
      endReason: ctx.turnReason.get(turn),
      usage: ctx.turnUsage.get(turn),
    });
  }
  // Insert each turn's tail right after the LAST item belonging to that turn,
  // scanning left-to-right so earlier splices never invalidate a later anchor.
  // The live mux path re-finalizes on every turn/end, so a turn already
  // carrying a tail keeps it — re-emitting would duplicate every earlier tail.
  const order: RenderItem[] = [];
  const emitted = new Set<number>();
  const tailed = new Set(items.filter((it) => it.kind === "turn-tail").map((it) => it.turn));
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    order.push(item);
    const turn = item.turn;
    if (turn !== undefined) {
      // Is this the last item carrying this turn? The scan above exits either
      // at the array end (yes) or on the next item of the same turn (no).
      let j = i + 1;
      while (j < items.length && items[j].turn !== turn) j++;
      if (j >= items.length && tails.has(turn) && !emitted.has(turn) && !tailed.has(turn)) {
        order.push(tails.get(turn)!);
        emitted.add(turn);
      }
    }
    i++;
  }
  items.length = 0;
  items.push(...order);
}
