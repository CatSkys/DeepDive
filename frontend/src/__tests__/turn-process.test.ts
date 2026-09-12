// 轮内过程折叠纯函数钉子（官方 turn-process 边界语义）。
import { describe, expect, it } from "vitest";
import { computeTurnProcess, turnProcessLabel } from "../session/turnProcess";
import type { RenderItem } from "../session/renderModel";

function user(key = "u"): RenderItem {
  return { key, kind: "user" };
}
function tool(key: string, name = "bash"): RenderItem {
  return { key, kind: "tool-call", toolName: name, turn: 1 };
}
/** 带 diff 的编辑类工具（引擎在 tool 结果 meta.diffs 里给 hunted 增删）。 */
function edit(key: string, added: number, removed: number): RenderItem {
  const rows = [
    { path: "a.ts", oldText: Array.from({ length: removed }, (_, i) => `old${i}`).join("\n"), newText: Array.from({ length: added }, (_, i) => `new${i}`).join("\n") },
  ];
  return { key, kind: "tool-call", toolName: "edit", turn: 1, diffs: rows as RenderItem["diffs"] };
}
function assistant(key: string, think = false): RenderItem {
  const event = {
    type: "assistant/message" as const,
    seq: 1,
    time: 0,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: "assistant" as const,
        content: [
          ...(think ? [{ type: "reasoning" as const, text: "thinking…" }] : []),
          { type: "text" as const, text: "answer" },
        ],
      },
    },
  };
  return { key, kind: "assistant", turn: 1, event: event as RenderItem["event"] };
}
function tail(key = "t"): RenderItem {
  return { key, kind: "turn-tail", turn: 1 };
}

const tt = (zh: string, _en: string, vars?: Record<string, string | number>) =>
  vars ? zh.replaceAll("{n}", String(vars.n)) : zh;

describe("computeTurnProcess", () => {
  it("未闭合轮（无 turn-tail）不折", () => {
    expect(computeTurnProcess([user(), tool("c1"), assistant("a1")])).toBeNull();
  });

  it("工具-only / 无最终正文不折", () => {
    expect(computeTurnProcess([user(), tool("c1"), tail()])).toBeNull();
    expect(computeTurnProcess([user(), tail()])).toBeNull();
  });

  it("有工具 + 最终回答：过程=回答之前的项，计数正确", () => {
    const info = computeTurnProcess([user(), tool("c1"), tool("c2", "subagent"), assistant("a1"), tail()]);
    expect(info).not.toBeNull();
    expect(info!.answerIndex).toBe(3);
    expect(info!.processIndices).toEqual([1, 2]);
    expect(info!.toolCallCount).toBe(1);
    expect(info!.subagentCount).toBe(1);
    expect(info!.messageCount).toBe(0);
    expect(info!.inlineReasoning).toBe(false);
  });

  it("多步中间 assistant 计入 messageCount；最终回答不计", () => {
    const info = computeTurnProcess([
      user(), assistant("mid"), tool("c1"), assistant("final"), tail(),
    ]);
    expect(info!.messageCount).toBe(1);
    expect(info!.answerIndex).toBe(3);
    expect(info!.processIndices).toEqual([1, 2]);
  });

  it("仅思考无外部过程：inlineReasoning=true，processIndices 空", () => {
    const info = computeTurnProcess([user(), assistant("a1", true), tail()]);
    expect(info).not.toBeNull();
    expect(info!.processIndices).toEqual([]);
    expect(info!.inlineReasoning).toBe(true);
  });

  it("无过程也无思考：null", () => {
    expect(computeTurnProcess([user(), assistant("a1"), tail()])).toBeNull();
  });
});

describe("turnProcessLabel", () => {
  it("工具按语义族分组、编辑带 diff 行数；消息/subagent 照旧；全空回「已思考」", () => {
    const tools = computeTurnProcess([user(), tool("c1"), tool("c2"), assistant("a1"), tail()])!;
    expect(turnProcessLabel(tools, tt)).toBe("命令 2"); // bash ×2 → 命令族

    const mixed = computeTurnProcess([
      user(),
      assistant("m"),
      tool("r1", "read"),
      tool("r2", "read"),
      edit("e1", 12, 3),
      tool("b1"),
      tool("s", "subagent_x"),
      assistant("a1"),
      tail(),
    ])!;
    expect(turnProcessLabel(mixed, tt)).toBe("读取 2 · 编辑 1 [+12 −3] · 命令 1 · 1 条中间消息 · 1 个 subagent");
    expect(mixed.byVariant).toEqual({ read: 2, edit: 1, shell: 1 });

    const think = computeTurnProcess([user(), assistant("a1", true), tail()])!;
    expect(turnProcessLabel(think, tt)).toBe("已思考");
  });

  it("无 diff 的编辑不挂空徽标", () => {
    const info = computeTurnProcess([user(), tool("e1", "edit"), assistant("a1"), tail()])!;
    expect(turnProcessLabel(info, tt)).toBe("编辑 1");
    expect(info.diff).toEqual({ added: 0, removed: 0 });
  });
});
