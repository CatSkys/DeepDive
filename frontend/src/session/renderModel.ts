// 摄取引擎（SessionView 的"模型脸"）：SessionEvent 流 → RenderItem[]，含 O(1) 索引
// 上下文、轮终收尾与 schedule/todo 等纯折叠。从 SessionView.tsx 整体搬迁（R-007）；
// ingest 单函数（228 行）为存量原样保留。不含 React，vitest 直接钉行为。
import type {
  AssistantMessageData, StreamChunk, ToolCallData, ToolResultData,
  SessionEvent, UserMessageData,
} from "../types";
import { narrowDiffs } from "../diffModel";
import { messageText, userText } from "./eventText";
import { truncate } from "./format";
import { isBrowserTool } from "./toolKind";
import { deriveCallDiffs, streamThinkMs } from "./renderHelpers";

// 对外导出保留在 renderModel（调用方与测试的导入点不变）。
export { parseTodos, deriveCallDiffs } from "./renderHelpers";

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
  /** 思考时长（ms）。reasoning 项＝首帧→末帧的时间戳之差；assistant 项＝被它取代的
   *  那条 reasoning 的时长（内嵌推理只有文本、没有时间，时长在裁切时交接过来）。 */
  thinkMs?: number;
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
  /** 重试行的结构化数据（RetryRow 渲染用；同 retryId 的后续事件就地覆盖）。 */
  retryData?: import("../types").LlmRetryData;
  // 编辑类工具的文件变更（call 侧=pending 态；result 侧=已应用，权威）
  diffs?: import("../types").FileDiff[];
  // 工具结果图片（read_image：attachment 引用，字节经 session/attachment 取）
  resultImages?: ResultImage[];
  // turn-local produced file paths (attached during finalizeTurns)
  produced?: string[];
  // turn-local present 工具声明的交付文件（finalizeTurns 时挂上）
  presented?: import("../types").PresentedFile[];
  // turn/end 的 seq：branch（session.fork atSeq）的收尾锚点
  forkSeq?: number;
  // 轮终原因（3.5 轮失败增强：error 消息/max-tokens 继续按钮）
  endReason?: import("../types").TurnEndReason;
  // 就地修改版本戳：直播流增量/结果落定写的是**已存在** item 的字段（对象身份
  // 不动，React key 稳定）；每次写脏自增 1，memo 化行组件的比较器靠它分辨。
  // 新建项不带（观测方按 0 处理）。经 touch() 写，别散落 it.v++。
  v?: number;
}

/** 写脏一个已存在的渲染项（就地修改的统一出口）：v 自增。 */
function touch(it: RenderItem): void {
  it.v = (it.v ?? 0) + 1;
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

function toolCallIdOf(data: ToolCallData): string {
  return data.callId;
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

/** tool/result 里图片附件引用（字节经 session/attachment 取）。 */
export interface ResultImage {
  attachmentId: string;
  mediaType: string;
  name?: string;
  width?: number;
  height?: number;
}

/** 产物白名单（mutation-only，上游 ui-deliverables turn-deliverables 同款）。 */
export const MUTATION_TOOLS: ReadonlySet<string> = new Set([
  "write", "edit", "str_replace_editor", "multiedit", "apply_patch",
]);

/// Pull the output text + failure + path + result images from a tool/result
/// payload (typed). 0.1.5 read_image 的内容块 = 文本信封 + {type:'image',
/// attachment:{attachmentId,…}}——图片经 attachment RPC 取字节直出工具卡。
export function extractToolResult(data: ToolResultData): { callId?: string; output: string; failed: boolean; path?: string; images: ResultImage[] } {
  const msg = data.message;
  let output = "";
  const parts: string[] = [];
  const images: ResultImage[] = [];
  const walk = (c: unknown) => {
    if (!c) return;
    if (typeof c === "string") { parts.push(c); return; }
    if (Array.isArray(c)) { c.forEach(walk); return; }
    if (typeof c === "object") {
      const o = c as Record<string, unknown>;
      if (typeof o.text === "string") parts.push(o.text);
      if (o.type === "image" && o.attachment && typeof o.attachment === "object") {
        images.push(o.attachment as ResultImage);
      }
      if (o.content !== undefined) walk(o.content);
    }
  };
  walk(msg?.content);
  if (parts.length) output = parts.join("\n");
  if (!output) output = truncate(JSON.stringify(data));
  const failed = msg?.isError === true;
  const callId = msg?.source?.callId;
  const path = typeof data.path === "string" ? data.path : undefined;
  return { callId, output, failed, path, images };
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
  /** turn → present 工具声明的交付文件（同轮同路径只留一条，取最后一次声明）。 */
  presented: Map<number, import("../types").PresentedFile[]>;
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
  /** turn → the latest accumulated assistant text (copy-able tail payload). */
  turnText: Map<number, string>;
  /** turn → tail anchor time (the closing assistant message, if any). */
  turnTime: Map<number, number>;
  /** turn → 本轮最后一条 assistant 持久消息 id（消息反馈寻址键）。 */
  /** 最近一次 turn/start 的 turn 号：user/message 事件不带 turn（wire 契约），
   *  靠它给 user item 标注归属——否则一步失败、零 assistant 输出的轮没有
   *  tail 锚点，轮终错误（如 MISSING_CREDENTIAL）永远渲染不出来。 */
  currentTurn?: number;
  /** 本会话的 agent 是否操控过浏览器（命中浏览器 MCP 工具即置位）。O(1) 记账：
   *  状态胶囊的浏览器入口据此出现——流式热路径上不许整窗扫描（PITFALLS §3.3）。 */
  browserUsed: boolean;
}

/** Fresh ingest context — history replay, live mux passes and tests share one shape. */
export function makeIngestCtx(): IngestCtx {
  return { timing: new Map(), outputs: new Map(), produced: new Map(), presented: new Map(), callIndex: new Map(), callPaths: new Map(), commandIndex: new Map(), retryIndex: new Map(), workflowIndex: new Map(), turnReason: new Map(), turnText: new Map(), turnTime: new Map(), currentTurn: undefined, browserUsed: false };
}

export function ingest(out: RenderItem[], entry: { event: SessionEvent; output?: string }, ctx: IngestCtx) {
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
      if (txt) out.push({ ...base, kind: "user", turn: ctx.currentTurn });
      break;
    }
    case "turn/start": {
      const d = ev.data as { turn: number };
      ctx.currentTurn = d.turn;
      ctx.timing.set(d.turn, { start: ev.time, end: undefined, firstToken: undefined });
      break;
    }
    case "turn/end": {
      const d = ev.data as { turn: number; reason: import("../types").TurnEndReason };
      const t = ctx.timing.get(d.turn) ?? {};
      t.end = ev.time;
      t.endSeq = ev.seq;
      ctx.timing.set(d.turn, t);
      ctx.turnReason.set(d.turn, d.reason);
      break;
    }
    case "assistant/chunk": {
      // Stream frames append chunk items for text-deltas; reasoning deltas
      // accumulate into a live trace item that the final assistant/message
      // replaces with the settled ThinkingState.
      // key 带 chunk 类别后缀：直播流帧是进程级伪事件（无 seq），只取
      // `${seq}:${type}` 会让文本行与思考行撞成同一个 "undefined:assistant/chunk"
      // —— 同列表重复 key 会让 React 复用组件实例，思考块的展开状态会串到
      // 另一段思考上（表现为「该收起的不收起」）。
      const d = ev.data as { turn: number; step: number; chunk: StreamChunk };
      const chunk = d.chunk;
      if (chunk.type === "text-delta" && typeof chunk.text === "string" && chunk.text) {
        const turn = d.turn;
        const t0 = ctx.timing.get(turn);
        if (t0 && t0.firstToken === undefined) t0.firstToken = ev.time;
        const last = out[out.length - 1];
        if (last && last.kind === "chunk" && last.turn === turn) { last.output = (last.output ?? "") + chunk.text; touch(last); }
        // 直播伪事件没有 seq（帧不进持久日志）：base.key 是常量，同一轮里
        // 每个新 item 直接同 key——React 复用实例，思考展开状态串行到别的
        // 思考行（行头点开无效，2026-10-10 实测）。用 out.length 唯一化。
        else out.push({ ...base, key: `${base.key}:text:${out.length}`, kind: "chunk", output: chunk.text, turn });
      }
      if (chunk.type === "reasoning-delta" && typeof chunk.text === "string" && chunk.text) {
        const turn = d.turn;
        const last = out[out.length - 1];
        if (last && last.kind === "reasoning" && last.turn === turn) {
          last.output = (last.output ?? "") + chunk.text;
          // 直播路径的时长记账（首帧 → 末帧）。持久化那份走消息自带的 stream（见
          // streamThinkMs）：引擎把 delta 压成批次后写日志，直播事件里没有那个 stream，
          // 所以两条路都要算——同一把尺子，两个数据来源。
          last.thinkMs = Math.max(0, ev.time - (last.time ?? ev.time));
          touch(last);
        } else out.push({ ...base, key: `${base.key}:reasoning:${out.length}`, kind: "reasoning", output: chunk.text, turn, thinkMs: 0 });
      }
      break;
    }
    case "assistant/message": {
      const d = ev.data as AssistantMessageData;
      const turn = d.turn;
      const text = messageText(d.message?.content);
      // Replace the live-streamed chunk/reasoning items for this step with
      // the final blocks. Discard them — re-appending interleaves stale
      // fragments. The settlement may arrive AFTER the turn/end already
      // inserted this turn's `turn-tail` row (直播桥先到、日志落账后到是合法
      // 错序)，所以同 turn 的 tail 行也一并摘下，durable 落位后再插回末尾——
      // tail 的不变式是「排在本 turn 最后一项之后」，否则 durable 会被推到
      // tail 之后，出现「半截 echo → 已工作行 → 完整正文」的乱序（实测截图）。
      let cut = out.length - 1;
      let tailRow: RenderItem | undefined;
      while (cut >= 0) {
        const it = out[cut]!;
        if ((it.kind === "chunk" || it.kind === "reasoning") && it.turn === turn) { cut -= 1; continue; }
        if (it.kind === "turn-tail" && it.turn === turn) { tailRow = it; cut -= 1; continue; }
        break;
      }
      // 这一步的思考时长：从**消息自带的流帧**（`data.stream`）里算——它是持久化的，
      // 重载后仍在（直播的 delta 帧不进日志，实测 log 里没有 assistant/chunk，之前用
      // delta 记账算出来的时长一重载就没了，用户报"这个时间会莫名消失"）。
      let thinkMs = streamThinkMs((ev.data as { stream?: unknown }).stream);
      if (thinkMs === undefined) {
        for (let i = cut + 1; i < out.length; i++) {
          if (out[i]!.kind === "reasoning" && out[i]!.thinkMs !== undefined) thinkMs = out[i]!.thinkMs;
        }
      }
      out.length = cut + 1;
      // Track the accumulated tail payload.
      if (text) out.push({ ...base, kind: "assistant", turn, thinkMs });
      if (text) ctx.turnText.set(turn, text);
      if (d.usage) {
        // 多步轮按官方口径跨 step 求和（turn-metrics 的 fold 规则）
      }
      ctx.turnTime.set(turn, ev.time);
      if (tailRow !== undefined) out.push(tailRow);
      break;
    }
    case "deliverables/presented": {
      // present 工具声明的交付文件（官方 turn-deliverables 同源）。按路径去重：
      // 同一文件重复声明只留最后一次（描述可能被修正）；轮尾随产物一起呈现。
      const d = ev.data as { turn: number; files: import("../types").PresentedFile[] };
      const turn = d.turn ?? ctx.currentTurn ?? -1;
      const list = ctx.presented.get(turn) ?? [];
      for (const f of d.files ?? []) {
        if (!f || typeof f.path !== "string" || f.path.trim() === "") continue;
        const at = list.findIndex((x) => x.path === f.path);
        if (at >= 0) list[at] = f;
        else list.push(f);
      }
      if (list.length > 0) ctx.presented.set(turn, list);
      break;
    }
    case "tool/call": {
      const d = ev.data as ToolCallData;
      const callId = toolCallIdOf(d);
      const args = toolArgsString(d.arguments);
      if (isBrowserTool(d.name)) ctx.browserUsed = true;
      const prev = ctx.callIndex.get(callId);
      if (prev !== undefined) {
        out[prev].args = args || out[prev].args;
        touch(out[prev]);
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
      // call 侧 diff：从调用参数推导（0.1.2 引擎不再预计算下发，官方
      // presentCall 同款——write/edit/str_replace_editor 三族的具名参数）。
      const pendingDiffs = deriveCallDiffs(d.name ?? "tool", args);
      if (pendingDiffs && prev !== undefined) { out[prev].diffs = pendingDiffs; touch(out[prev]); }
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
      // result 侧 diff 权威：事件 meta.diffs（tool-fs FsDiffMeta）
      const appliedDiffs = narrowDiffs(d.meta?.diffs);
      if (prevIdx !== undefined) {
        const item = out[prevIdx];
        if (item) {
          item.output = extracted.output;
          item.failed = extracted.failed;
          if (appliedDiffs) item.diffs = appliedDiffs;
          // read_image 等结果图片：内容块里的 attachment 引用直出工具卡。
          if (extracted.images.length > 0) item.resultImages = extracted.images;
          touch(item);
        }
      }
      // produced files: mutation-only 白名单（上游 turn-deliverables mutationPath
      // 同款：write/edit/str_replace_editor，另收我们渲染的 multiedit/apply_patch；
      // read/file_read 等只读工具的成功结果不算产物）。
      if (!extracted.failed) {
        const callTool = prevIdx !== undefined ? out[prevIdx]?.toolName : undefined;
        if (callTool !== undefined && !MUTATION_TOOLS.has(callTool)) break;
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
      // turn 必标：缺 turn 的项会被 groupTurns 拆成独立 null 组，打断轮序列
      // 并令大纲轨与正文错位（「大纲有轮、正文没有」事故）。
      out.push({
        ...base,
        kind: "command",
        commandId: d.commandId,
        toolName: d.name,
        args: d.args ?? "",
        commandStatus: "running",
        turn: ctx.currentTurn,
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
        touch(out[idx]);
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
        turn: ctx.currentTurn,
      });
      break;
    }
    case "llm/retry": {
      const d = ev.data as import("../types").LlmRetryData;
      const prev = d.retryId ? ctx.retryIndex.get(d.retryId) : undefined;
      if (prev !== undefined && out[prev]) {
        out[prev].time = ev.time;
        out[prev].retryData = d;
        touch(out[prev]);
      } else {
        const idx = out.length;
        out.push({ ...base, kind: "retry", retryId: d.retryId, retryData: d, turn: ctx.currentTurn });
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
          turn: ctx.currentTurn,
        });
        ctx.workflowIndex.set(d.runId, idx);
      }
      const card = out[idx]!;
      if (ev.type === "tool-workflow/agent-start") {
        const s = ev.data as import("../types").WorkflowAgentStartData;
        card.members = card.members ?? [];
        card.members.push({ seq: s.seq, label: s.label, phase: s.phase, childId: s.childId, outcome: undefined });
        if (!card.args) card.args = s.label;
        touch(card);
      } else if (ev.type === "tool-workflow/agent-end") {
        const e2 = ev.data as import("../types").WorkflowAgentEndData;
        card.members = card.members ?? [];
        const m = card.members.find((x) => x.seq === e2.seq);
        if (m) { m.outcome = e2.outcome; touch(card); }
      } else if (ev.type === "tool-workflow/run-end") {
        card.commandStatus = (ev.data as import("../types").WorkflowRunEndData).stopReason === "completed" ? "success" : "error";
        card.commandText = (ev.data as import("../types").WorkflowRunEndData).stopReason;
        touch(card);
      }
      break;
    }
    default:
      break;
  }
}

/**
 * Emit a per-turn tail item (meta + produced files). Official DSH renders a
 * `turn-tail` node per closed turn independent of whether the last block is
 * assistant text, so interrupted / tool-only turns keep their metrics+files.
 * Inserted right after the turn's last assistant item; a turn already having
 * a tail is updated in place.
 */
/** 日志尾部开轮状态：返回最后一个「已开启且未闭合」轮的开始时间；没有未闭合轮时
 *  undefined。快照（含断线重连）拿它对账事件侧的运行态锁存——运行态此前只由
 *  turn/start / turn/end 这对事件开关，漏掉一个 turn/end（断线、丢帧、重连落在
 *  轮结束之后）就会让「Deep diving…」一直转（用户报「中止后 loading 还在」）。 */
export function openTurnSince(entries: readonly { event: SessionEvent }[]): number | undefined {
  let open: number | undefined;
  for (const { event } of entries) {
    if (event.type === "turn/start") open = event.time;
    else if (event.type === "turn/end") open = undefined;
  }
  return open;
}

export function finalizeTurns(items: RenderItem[], ctx: IngestCtx) {
  const closed = [...ctx.timing.entries()].filter(([, t]) => t.start !== undefined && t.end !== undefined);
  if (closed.length === 0) return;
  // Build the tail payload per closed turn once.
  const tails = new Map<number, RenderItem>();
  for (const [turn, t] of closed) {
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
      produced: ctx.produced.get(turn) ?? [],
      presented: ctx.presented.get(turn) ?? [],
      endReason: ctx.turnReason.get(turn),
    });
  }
  // 把每个 turn 的 tail 插在该 turn 最后一项之后。判定「本 turn 的最后一项」靠预先算好的
  // 下标表，不靠向后扫本 turn 的下一次出现（后者对每个带 turn 的项扫到末尾，而本函数在
  // 每个 turn/end 都跑一次）。表不跨调用缓存——ingest 往同一数组尾部追加会作废下标。
  const lastIndexOf = new Map<number, number>();
  const tailed = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const turn = item.turn;
    if (turn === undefined) continue;
    lastIndexOf.set(turn, i);
    // 已在尾的 turn 不再发（实时通路每个 turn/end 都再收尾，重发会让旧 turn 多一条 tail）。
    if (item.kind === "turn-tail") tailed.add(turn);
  }
  // Rebuild left-to-right so an earlier insert never invalidates a later anchor.
  const order: RenderItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    order.push(item);
    const turn = item.turn;
    if (turn === undefined || lastIndexOf.get(turn) !== i) continue;
    if (!tails.has(turn) || tailed.has(turn)) continue;
    order.push(tails.get(turn)!);
    tailed.add(turn);
  }
  items.length = 0;
  items.push(...order);
}
