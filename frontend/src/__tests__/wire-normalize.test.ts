// wire v1 归一化与版本侦测（M0）：A（dsh）备选拼写 → v1 规范形状的收敛、
// canonical 输入逐键不变、未知事件透传、版本判定。这三个面都是「引擎换血
// 期间渲染层不改」的合同，所以在这里钉住。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeSessionEvent } from "../wire/normalize";
import { WIRE_VERSION } from "../wire/v1";

describe("normalizeSessionEvent", () => {
  it("canonical tool/call 逐键不变", () => {
    const ev = { type: "tool/call", seq: 1, time: 2, data: { turn: 1, step: 1, callId: "c1", name: "write", arguments: "{}" } };
    expect(normalizeSessionEvent(ev)).toEqual(ev);
  });

  it("tool/call 的 A 备选拼写收敛并摘除（id/toolName/argsRaw）", () => {
    const ev = { type: "tool/call", seq: 3, time: 4, data: { turn: 1, step: 1, id: "c2", toolName: "edit", argsRaw: '{"path":"x"}' } };
    expect(normalizeSessionEvent(ev)).toEqual({
      type: "tool/call", seq: 3, time: 4,
      data: { turn: 1, step: 1, callId: "c2", name: "edit", arguments: '{"path":"x"}' },
    });
  });

  it("tool/result 的 A 备选兜出 message（callId/isError/文本块）", () => {
    const ev = { type: "tool/result", seq: 5, time: 6, data: { turn: 1, step: 2, toolCallId: "c2", output: "done", ok: false } };
    expect(normalizeSessionEvent(ev)).toEqual({
      type: "tool/result", seq: 5, time: 6,
      data: { turn: 1, step: 2, message: { source: { kind: "tool", callId: "c2" }, content: [{ type: "text", text: "done" }], isError: true } },
    });
  });

  it("tool/result canonical（message 在）逐键不变", () => {
    const ev = {
      type: "tool/result", seq: 7, time: 8,
      data: {
        turn: 1, step: 2,
        message: { source: { kind: "tool", callId: "c1" }, content: [{ type: "text", text: "ok" }], isError: false },
        meta: { diffs: [{ path: "a", oldText: null, newText: "b" }] },
      },
    };
    expect(normalizeSessionEvent(ev)).toEqual(ev);
  });

  it("未知事件类型原样透传（catch-all 容忍）", () => {
    const ev = { type: "brand/new-thing", seq: 9, time: 10, data: { whatever: true } };
    expect(normalizeSessionEvent(ev)).toEqual(ev);
  });
});

describe("wire 版本侦测", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("未上报 = 实现注记 A：null 且不判不支持", async () => {
    const m = await import("../wire/normalize");
    expect(m.wireVersionSeen()).toBeNull();
    expect(m.wireVersionUnsupported()).toBe(false);
  });

  it("上报 v1 后仍受支持", async () => {
    const m = await import("../wire/normalize");
    m.reportWireVersion(WIRE_VERSION);
    expect(m.wireVersionSeen()).toBe(WIRE_VERSION);
    expect(m.wireVersionUnsupported()).toBe(false);
  });

  it("引擎版本比前端新 → fail-loud 判定（消费方据此显式报错）", async () => {
    const m = await import("../wire/normalize");
    m.reportWireVersion(WIRE_VERSION + 1);
    expect(m.wireVersionUnsupported()).toBe(true);
  });
});
