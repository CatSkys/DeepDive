// 会话流外围纯函数：TodoList 摘要与 tool/result 提取（R-001 指定覆盖面）。
import { describe, expect, it } from "vitest";
import { extractToolResult, parseTodos, subagentChildIdOf } from "../session/renderModel";
import { normalizeSessionEvent } from "../wire/normalize";
import type { ToolResultData } from "../types";

describe("parseTodos", () => {
  it("统计 {todos:[…]} 的 done/active/pending", () => {
    const args = JSON.stringify({
      todos: [
        { content: "a", status: "completed" },
        { content: "b", status: "in_progress" },
        { content: "c", status: "pending" },
      ],
    });
    const r = parseTodos(args);
    expect(r).toMatchObject({ done: 1, active: 1, pending: 1, total: 3 });
    expect(r?.items.map((x) => x.content)).toEqual(["a", "b", "c"]);
  });

  it("接受裸数组与 todo/description 字段回退", () => {
    const args = JSON.stringify([{ todo: "x", status: "pending" }, { description: "y" }]);
    const r = parseTodos(args);
    expect(r?.total).toBe(2);
    expect(r?.items.map((x) => x.content)).toEqual(["x", "y"]);
    expect(r?.items[1]?.status).toBe("pending"); // 缺 status 回退 pending
  });

  it("非 JSON / 空串 / 空数组返回 null", () => {
    expect(parseTodos("not json")).toBeNull();
    expect(parseTodos("")).toBeNull();
    expect(parseTodos('{"todos":[]}')).toBeNull();
  });
});

describe("extractToolResult", () => {
  it("递归走 message.content，收集 text 块并以换行拼接", () => {
    const d: ToolResultData = {
      turn: 1, step: 1,
      message: { content: [{ type: "text", text: "line1" }, { type: "other", content: [{ type: "text", text: "line2" }] }] },
    };
    expect(extractToolResult(d).output).toBe("line1\nline2");
  });

  // wire v1（M0）：A 的备选形态先过 normalizeSessionEvent 收敛，extract 只认
  // canonical（message.content / message.isError / message.source.callId）。
  const normalizeResult = (data: unknown): ToolResultData =>
    (normalizeSessionEvent({ type: "tool/result", seq: 1, time: 2, data }) as { data: ToolResultData }).data;

  it("A 备选形态经 normalize 兜出文本块：output → text → result(JSON)", () => {
    expect(extractToolResult(normalizeResult({ turn: 1, step: 1, output: "raw" })).output).toBe("raw");
    expect(extractToolResult(normalizeResult({ turn: 1, step: 1, text: "txt" })).output).toBe("txt");
    expect(extractToolResult(normalizeResult({ turn: 1, step: 1, result: { ok: 1 } })).output).toBe('{"ok":1}');
  });

  it("A 备选经 normalize 后统一认 message.source.callId；canonical 优先", () => {
    expect(extractToolResult(normalizeResult({ turn: 1, step: 1, toolCallId: "a" })).callId).toBe("a");
    expect(extractToolResult(normalizeResult({ turn: 1, step: 1, callId: "b" })).callId).toBe("b");
    expect(extractToolResult(normalizeResult({ turn: 1, step: 1, toolCallId: "a", callId: "b", message: { source: { kind: "tool", callId: "c" } } })).callId).toBe("c");
  });

  it("failed：isError（顶层备选或 message 侧）/ ok:false 经 normalize 后都在 message.isError", () => {
    expect(extractToolResult(normalizeResult({ turn: 1, step: 1, isError: true })).failed).toBe(true);
    expect(extractToolResult(normalizeResult({ turn: 1, step: 1, ok: false })).failed).toBe(true);
    expect(extractToolResult(normalizeResult({ turn: 1, step: 1, message: { isError: true } })).failed).toBe(true);
    expect(extractToolResult(normalizeResult({ turn: 1, step: 1 })).failed).toBe(false);
  });

  it("path 字符串原样透出", () => {
    expect(extractToolResult({ turn: 1, step: 1, path: "/tmp/x.md" }).path).toBe("/tmp/x.md");
    // 越界输入（非字符串 path）只被运行时守卫挡下，不走类型：故意断言
    const malformed = { turn: 1, step: 1, path: 42 } as unknown as ToolResultData;
    expect(extractToolResult(malformed).path).toBeUndefined();
  });
});

describe("subagentChildIdOf：后台委派撒种文本拆子会话 id", () => {
  // 夹具取自真实会话日志（2026-10-12 实证）：引擎 durable 文本，模型自己也读它
  it("`started subagent <id>`：单行正中 → 拆出 id", () => {
    expect(subagentChildIdOf("started subagent 5cbf65e7-5b41-4ec0-9d0f-34658ab8e629"))
      .toBe("5cbf65e7-5b41-4ec0-9d0f-34658ab8e629");
  });
  it("首行之后还有内容时不误伤不猜：非该格式一律 undefined", () => {
    // 前台一次性子会话的结果=子会话产出文本，没有这行撒种文本 → undefined（行不脉冲）
    expect(subagentChildIdOf("调研结果如下……\nstarted subagent 5cbf65e7")).toBeUndefined();
    expect(subagentChildIdOf("started task abc123")).toBeUndefined();
    expect(subagentChildIdOf("")).toBeUndefined();
  });
});
