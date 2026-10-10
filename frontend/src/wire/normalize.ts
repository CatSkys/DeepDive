// A→v1 归一化 + wire 版本侦测（M0，docs/WIRE-V1.md §1/§4）：归一化卡点只有
// api.ts 的三条入口（follow 快照 / follow 追加 / page）——dsh 引擎（实现注记 A）
// 在 tool/call、tool/result 上存在的备选拼写在这里收敛成 v1 规范形状，渲染层
// 只见 v1。未知事件类型原样透传（sessionEvents 联合尾部 catch-all 成员），
// 由摄取层 default 分支忽略——不包装、不崩、不丢。

import { WIRE_VERSION } from "./v1";
import type { SessionEvent, ToolResultData } from "./sessionEvents";

/* ── 版本侦测 ──
   unary 响应头（X-DeepDive-Wire）与 $events ready 帧（wireVersion）上报；
   从未上报 = A（dsh 引擎，双读模式）。引擎比前端新（> WIRE_VERSION）时
   wireVersionUnsupported 为真——消费方据此 fail-loud，不猜形状。 */

let seenVersion: number | null = null;

export function reportWireVersion(version: number): void {
  seenVersion = version;
}

export function wireVersionSeen(): number | null {
  return seenVersion;
}

export function wireVersionUnsupported(): boolean {
  return seenVersion !== null && seenVersion > WIRE_VERSION;
}

/** unary 响应头 → 版本上报：`X-DeepDive-Wire: 1`；头缺席 = 实现注记 A（不上报）。 */
export function readWireVersionHeader(res: { headers: { get(name: string): string | null } }): void {
  const raw = res.headers.get("x-deepdive-wire");
  if (raw === null) return;
  const v = Number(raw);
  if (Number.isFinite(v)) reportWireVersion(v);
}

/* ── 归一化 ── */

type LoosePayload = Record<string, unknown>;

/** tool/call：A 的 id/toolName/argsRaw/command 备选拼写收敛到 callId/name/arguments。 */
function normalizeToolCall(ev: SessionEvent): SessionEvent {
  const d = { ...(ev.data as LoosePayload) };
  if (d.callId === undefined && typeof d.id === "string") d.callId = d.id;
  if (d.name === undefined && typeof d.toolName === "string") d.name = d.toolName;
  if (d.arguments === undefined) {
    if (d.argsRaw !== undefined) d.arguments = d.argsRaw;
    else if (d.command !== undefined) d.arguments = d.command;
  }
  delete d.id;
  delete d.toolName;
  delete d.argsRaw;
  delete d.command;
  return { ...ev, data: d };
}

/** tool/result：toolCallId/callId/ok 备选拼写收敛到 message.source.callId 与
 *  message.isError；message.content 缺席时从 output/text/result 兜出文本块
 *  （与摄取层 extractToolResult 的兜出次序一致），备选键摘除。 */
function normalizeToolResult(ev: SessionEvent): SessionEvent {
  const d = { ...(ev.data as LoosePayload) } as LoosePayload & ToolResultData;
  const msg = { ...((d.message ?? {}) as LoosePayload) };
  const source = { ...((msg.source ?? {}) as LoosePayload) };
  if (source.callId === undefined) {
    const callId = typeof d.toolCallId === "string" ? d.toolCallId : typeof d.callId === "string" ? d.callId : undefined;
    if (callId !== undefined) {
      source.callId = callId;
      // canonical source kind：工具结果消息的 source 就是 "tool"（A 实测同款）
      if (typeof source.kind !== "string") source.kind = "tool";
    }
  }
  // source 折叠后必须写回 msg（canonical 场景是同值回写，无 source 的输入不凭空加）
  if (source.callId !== undefined) msg.source = source;
  if (msg.isError === undefined) {
    if (d.isError === true || d.ok === false) msg.isError = true;
  }
  if (msg.content === undefined) {
    const text = typeof d.output === "string" ? d.output
      : d.text !== undefined ? String(d.text)
      : d.result !== undefined ? JSON.stringify(d.result)
      : undefined;
    if (text !== undefined) msg.content = [{ type: "text", text }];
  }
  delete d.toolCallId;
  delete d.callId;
  delete d.ok;
  delete d.output;
  delete d.text;
  delete d.result;
  delete d.isError;
  return { ...ev, data: { ...d, message: Object.keys(msg).length ? msg : undefined } };
}

/** 会话事件入口统一过这里：tool/call、tool/result 归一，其余原样透传。 */
export function normalizeSessionEvent(raw: unknown): SessionEvent {
  if (typeof raw !== "object" || raw === null) return raw as SessionEvent;
  const ev = raw as SessionEvent;
  if (ev.type === "tool/call") return normalizeToolCall(ev);
  if (ev.type === "tool/result") return normalizeToolResult(ev);
  return ev;
}
