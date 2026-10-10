// renderModel 的纯派生函数群（从 renderModel.ts 拆出，行数棘轮）：推理帧时长
// 折算、todo 参数解析、变更类工具的 call 侧 diff 推导。不碰
// RenderItem 数组与摄取上下文，vitest 直接钉行为。
import type { FileDiff } from "../types";

/** 从持久化的消息流帧（`data.stream`）里读**推理那一段**的时长。
 *  帧的真实形状（实测 log，`assistant/message` → `data.stream`）：
 *    {type:'chunk', time, chunk:{type:'block-start'|'block-end', index, blockType:'reasoning'|…}}
 *    {type:'reasoning-chunks', time0, index, dt:[每两段之间的毫秒差], texts:[…]}
 *  —— 推理块的首末两个 chunk 帧给出区间；批（reasoning-chunks）是持久化的压缩形式，
 *  `time0 + Σdt` 即该批末帧时间。两种都认，取最早起点与最晚终点。
 *  不猜字段：拿不到就返回 undefined（调用方退回「已思考」）。 */
export function streamThinkMs(stream: unknown): number | undefined {
  if (!Array.isArray(stream)) return undefined;
  let start: number | undefined;
  let end: number | undefined;
  for (const raw of stream) {
    if (typeof raw !== "object" || raw === null) continue;
    const frame = raw as {
      type?: string;
      time?: number;
      time0?: number;
      dt?: unknown;
      chunk?: { type?: string; blockType?: string };
    };
    const isReasoningBlock = frame.chunk?.blockType === "reasoning";
    if (frame.type === "chunk" && isReasoningBlock && typeof frame.time === "number") {
      if (frame.chunk?.type === "block-start") start = start === undefined ? frame.time : Math.min(start, frame.time);
      else if (frame.chunk?.type === "block-end") end = end === undefined ? frame.time : Math.max(end, frame.time);
      continue;
    }
    if (frame.type === "reasoning-chunks" && typeof frame.time0 === "number") {
      const dt = Array.isArray(frame.dt) ? frame.dt.filter((x): x is number => typeof x === "number") : [];
      const last = frame.time0 + dt.reduce((sum, d) => sum + d, 0);
      start = start === undefined ? frame.time0 : Math.min(start, frame.time0);
      end = end === undefined ? last : Math.max(end, last);
    }
  }
  if (start === undefined || end === undefined) return undefined;
  return Math.max(0, end - start);
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

/// 变更类工具的 call 侧 pending diff：从调用参数推导（官方 presentCall 同款；
/// 0.1.2 起 wire 不再携带预计算 view）。参数名对照 vendored 源码——
/// tool-fs write{file_path,content} / edit{file_path,old_string,new_string}、
/// str_replace_editor{command,path,file_text|old_str,new_str}。
export function deriveCallDiffs(toolName: string, args: string): FileDiff[] | null {
  let parsed: Record<string, unknown> | undefined;
  try {
    const p = JSON.parse(args);
    if (p && typeof p === "object" && !Array.isArray(p)) parsed = p as Record<string, unknown>;
  } catch { return null; /* 非 JSON 参数不推导 */ }
  if (!parsed) return null;
  const str = (k: string) => (typeof parsed![k] === "string" ? parsed![k] as string : undefined);
  if (toolName === "write" || toolName === "file_write") {
    const path = str("file_path") ?? str("path");
    const text = str("content") ?? str("file_text");
    return path && text !== undefined ? [{ path, oldText: null, newText: text }] : null;
  }
  if (toolName === "edit") {
    const path = str("file_path") ?? str("path");
    const oldText = str("old_string");
    const newText = str("new_string");
    return path && oldText !== undefined && newText !== undefined ? [{ path, oldText, newText }] : null;
  }
  if (toolName === "str_replace_editor") {
    const path = str("path") ?? str("file_path");
    if (!path) return null;
    const command = str("command");
    if (command === "create") {
      const text = str("file_text");
      return text !== undefined ? [{ path, oldText: null, newText: text }] : null;
    }
    if (command === "str_replace") {
      const oldText = str("old_str");
      const newText = str("new_str");
      return oldText !== undefined && newText !== undefined ? [{ path, oldText, newText }] : null;
    }
  }
  return null;
}

