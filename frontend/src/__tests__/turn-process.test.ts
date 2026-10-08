// 轮内过程折叠纯函数钉子（官方 turn-process 边界语义 + 用户定稿的
// 「已工作 X 分 X 秒」披露条标题）。
import { describe, expect, it } from "vitest";
import { computeTurnProcess, thinkingLabel, turnWorkLabel } from "../session/turnProcess";
import type { RenderItem } from "../session/renderModel";

function user(key = "u"): RenderItem {
  return { key, kind: "user" };
}
function tool(key: string, name = "bash"): RenderItem {
  return { key, kind: "tool-call", toolName: name, turn: 1 };
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

const tt = (zh: string, _en: string, vars?: Record<string, string | number>) => {
  if (!vars) return zh;
  let out = zh;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
};

describe("computeTurnProcess", () => {
  it("未闭合轮（无 turn-tail）不折", () => {
    expect(computeTurnProcess([user(), tool("c1"), assistant("a1")])).toBeNull();
  });

  it("工具-only / 无最终正文不折", () => {
    expect(computeTurnProcess([user(), tool("c1"), tail()])).toBeNull();
    expect(computeTurnProcess([user(), tail()])).toBeNull();
  });

  it("有工具 + 最终回答：过程=回答之前的项", () => {
    const info = computeTurnProcess([user(), tool("c1"), tool("c2", "subagent"), assistant("a1"), tail()]);
    expect(info).not.toBeNull();
    expect(info!.answerIndex).toBe(3);
    expect(info!.processIndices).toEqual([1, 2]);
    expect(info!.inlineReasoning).toBe(false);
  });

  it("多步中间 assistant 折叠窗正确；最终回答不计", () => {
    const info = computeTurnProcess([
      user(), assistant("mid"), tool("c1"), assistant("final"), tail(),
    ]);
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

describe("turnWorkLabel", () => {
  it("时长=轮首项 → turn-tail；分钟+秒、纯秒、小时三档", () => {
    const t0 = 1_000_000;
    const mk = (tailAt: number) => computeTurnProcess([
      { ...user(), time: t0 },
      tool("c1"),
      { ...assistant("a1"), time: t0 + 30_000 },
      { ...tail(), time: tailAt },
    ])!;

    expect(mk(t0 + 317_000).durationMs).toBe(317_000);
    expect(turnWorkLabel(317_000, tt)).toBe("已工作 5 分 17 秒");
    expect(turnWorkLabel(42_000, tt)).toBe("已工作 42 秒");
    expect(turnWorkLabel(3_723_000, tt)).toBe("已工作 1 小时 2 分");
  });

  it("缺时间戳的轮钳 0：只给「已工作 0 秒」", () => {
    const info = computeTurnProcess([user(), tool("c1"), assistant("a1"), tail()])!;
    expect(info.durationMs).toBe(0);
    expect(turnWorkLabel(info.durationMs, tt)).toBe("已工作 0 秒");
  });

  it("思考行标题带时长（用户定稿：参考 ZCode 的「思考 · 持续了 18 秒」）", () => {
    expect(thinkingLabel(18_000, tt)).toBe("思考 · 持续了 18 秒");
    expect(thinkingLabel(72_000, tt)).toBe("思考 · 持续了 1 分 12 秒");
    expect(thinkingLabel(3_780_000, tt)).toBe("思考 · 持续了 1 小时 3 分");
    expect(thinkingLabel(40, tt)).toBe("思考 · 持续了 0 秒"); // 不足 1 秒：与披露条同一把尺子
    expect(thinkingLabel(-5, tt)).toBe("思考 · 持续了 0 秒"); // 时钟回拨钳 0
  });
});
