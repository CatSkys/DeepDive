// 补齐项纯函数钉子：轮分组（turnGroups）与 workflow/compaction 的 ingest 折叠。
import { describe, expect, it } from "vitest";
import { groupTurns, foldDecision } from "../turnGroups";
import { ingest, makeIngestCtx } from "../session/renderModel";
import type { RenderItem } from "../session/renderModel";
import type { SessionEvent } from "../types";

const mk = (patch: Partial<RenderItem> & Pick<RenderItem, "key" | "kind">): RenderItem => ({ ...patch });

describe("groupTurns", () => {
  it("user 是轮前项：挂到自己触发的下一个轮", () => {
    const items = [
      mk({ key: "u1", kind: "user" }),
      mk({ key: "a1", kind: "assistant", turn: 1 }),
      mk({ key: "t1", kind: "turn-tail", turn: 1 }),
      mk({ key: "u2", kind: "user" }),
      mk({ key: "a2", kind: "assistant", turn: 2 }),
    ];
    const g = groupTurns(items);
    expect(g.map((x) => x.turn)).toEqual([1, 2]);
    expect(g[0].items.map((x) => x.key)).toEqual(["u1", "a1", "t1"]);
    expect(g[1].items.map((x) => x.key)).toEqual(["u2", "a2"]);
  });

  it("command/retry 是轮内项：留在当前轮，不越到下一轮", () => {
    const items = [
      mk({ key: "a1", kind: "assistant", turn: 1 }),
      mk({ key: "cmd", kind: "command", turn: 1 }),
      mk({ key: "retry", kind: "retry", turn: 1 }),
      mk({ key: "t1", kind: "turn-tail", turn: 1 }),
      mk({ key: "a2", kind: "assistant", turn: 2 }),
    ];
    const g = groupTurns(items);
    expect(g).toHaveLength(2);
    expect(g[0].items.map((x) => x.key)).toEqual(["a1", "cmd", "retry", "t1"]);
  });

  it("日志开头先于任何轮的项归 null 组", () => {
    const g = groupTurns([mk({ key: "pre", kind: "user" }), mk({ key: "a1", kind: "assistant", turn: 1 })]);
    expect(g.map((x) => x.turn)).toEqual([1]);
    expect(g[0].items.map((x) => x.key)).toEqual(["pre", "a1"]);
  });

  it("foldDecision：<阈值不折叠；≥阈值保留最近 keepRecent 轮", () => {
    expect(foldDecision(4)).toBeNull();
    expect(foldDecision(5)).toEqual({ foldFrom: 3 });
    expect(foldDecision(8, 5, 3)).toEqual({ foldFrom: 5 });
  });
});

describe("workflow ingest（5.4）", () => {
  const runStart: SessionEvent = { type: "tool-workflow/run-start", seq: 1, time: 1, data: { runId: "wf1", name: "三方评审" } };
  const s1: SessionEvent = { type: "tool-workflow/agent-start", seq: 2, time: 2, data: { runId: "wf1", seq: 0, label: "审 A", phase: "draft", childId: "c1" } };
  const s2: SessionEvent = { type: "tool-workflow/agent-start", seq: 3, time: 3, data: { runId: "wf1", seq: 1, label: "审 B" } };
  const e1: SessionEvent = { type: "tool-workflow/agent-end", seq: 4, time: 4, data: { runId: "wf1", seq: 0, outcome: "completed" } };
  const end: SessionEvent = { type: "tool-workflow/run-end", seq: 5, time: 5, data: { runId: "wf1", stopReason: "completed" } };

  it("run-start 开卡、成员按 seq 就地补结果、run-end 定格", () => {
    const ctx = makeIngestCtx();
    const out: RenderItem[] = [];
    for (const ev of [runStart, s1, s2, e1, end]) ingest(out, { event: ev }, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("workflow");
    expect(out[0]!.args).toBe("三方评审");
    expect(out[0]!.members).toEqual([
      { seq: 0, label: "审 A", phase: "draft", childId: "c1", outcome: "completed" },
      { seq: 1, label: "审 B", phase: undefined, childId: undefined, outcome: undefined },
    ]);
    expect(out[0]!.commandStatus).toBe("success");
  });
});

describe("compaction ingest（3.4）", () => {
  it("compaction/summary 渲染为压缩卡，摘要 text 块拼接", () => {
    const ctx = makeIngestCtx();
    const out: RenderItem[] = [];
    ingest(out, {
      event: {
        type: "compaction/summary", seq: 1, time: 1,
        data: { compactionId: "cp1", summary: [{ type: "text", text: "早前结论 A" }, { type: "text", text: "结论 B" }], shadowedTokenCount: 1234 },
      } as SessionEvent,
    }, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("compaction");
    expect(out[0]!.output).toBe("早前结论 A\n\n结论 B");
    expect(out[0]!.args).toBe("1234");
  });
});
