// 轮分组（turnGroups）与 workflow/compaction 的 ingest 折叠纯函数钉子。
import { describe, expect, it } from "vitest";
import { groupTurns } from "../turnGroups";
import { ingest, makeIngestCtx, finalizeTurns } from "../session/renderModel";
import { textOf } from "../session/eventText";
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

  it("插话（steer）留在轮内原位：轮还开着时到达的 user 不折到轮首", () => {
    // 引擎把插队消息写在当前轮中途（turn/start 与 turn/end 之间，走 next-step 领取），
    // 官方 UI 按时序摆原地。判据是"该组还没有 turn-tail"——轮前项一定落在上一轮
    // turn/end 之后，那时上一组已带 tail。
    const items = [
      mk({ key: "u1", kind: "user", turn: 1 }),
      mk({ key: "a1", kind: "assistant", turn: 1 }),
      mk({ key: "u2", kind: "user", turn: 1 }), // 插话：轮内中途
      mk({ key: "a2", kind: "assistant", turn: 1 }),
      mk({ key: "t1", kind: "turn-tail", turn: 1 }),
    ];
    const g = groupTurns(items);
    expect(g).toHaveLength(1);
    expect(g[0].items.map((x) => x.key)).toEqual(["u1", "a1", "u2", "a2", "t1"]);
  });

  it("插话落在轮首（本轮还没有任何项）时开这一轮，后续项跟在它后面", () => {
    const items = [
      mk({ key: "a1", kind: "assistant", turn: 1 }),
      mk({ key: "t1", kind: "turn-tail", turn: 1 }),
      mk({ key: "u2", kind: "user", turn: 2 }), // 轮已收尾 → 按轮前项开新轮
      mk({ key: "a2", kind: "assistant", turn: 2 }),
      mk({ key: "t2", kind: "turn-tail", turn: 2 }),
    ];
    const g = groupTurns(items);
    expect(g.map((x) => x.turn)).toEqual([1, 2]);
    expect(g[1].items.map((x) => x.key)).toEqual(["u2", "a2", "t2"]);
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

  it("无 turn 的非 user 项并入上一组，不另开 null 组（防轮序列碎片化）", () => {
    const items = [
      mk({ key: "a1", kind: "assistant", turn: 1 }),
      mk({ key: "cmd", kind: "command" }), // 漏标 turn
      mk({ key: "t1", kind: "turn-tail", turn: 1 }),
      mk({ key: "a2", kind: "assistant", turn: 2 }),
    ];
    const g = groupTurns(items);
    expect(g.map((x) => x.turn)).toEqual([1, 2]);
    expect(g[0].items.map((x) => x.key)).toEqual(["a1", "cmd", "t1"]);
  });
});

describe("command/retry ingest 标注 turn", () => {
  it("轮内 command/retry/compaction/workflow 都带上 currentTurn，groupTurns 不碎片化", () => {
    const ctx = makeIngestCtx();
    const out: RenderItem[] = [];
    const events: SessionEvent[] = [
      { type: "turn/start", seq: 1, time: 1, data: { turn: 3 } },
      { type: "user/message", seq: 2, time: 2, data: { turn: 3, message: { role: "user", content: [{ type: "text", text: "hi" }], source: { kind: "user" } } } as never },
      { type: "command/run", seq: 3, time: 3, data: { commandId: "c1", name: "plan", args: "" } },
      { type: "llm/retry", seq: 4, time: 4, data: { retryId: "r1", retry: 1, delayMs: 100 } },
      { type: "compaction/summary", seq: 5, time: 5, data: { compactionId: "cp1", summary: [] } },
      { type: "tool-workflow/run-start", seq: 6, time: 6, data: { runId: "w1", name: "wf" } },
      { type: "assistant/message", seq: 7, time: 7, data: { turn: 3, step: 1, message: { role: "assistant", content: [{ type: "text", text: "ok" }] } } as never },
      { type: "turn/end", seq: 8, time: 8, data: { turn: 3, reason: { kind: "stop" } } },
    ];
    for (const ev of events) ingest(out, { event: ev }, ctx);
    for (const it of out) {
      expect(it.turn, `${it.kind} missing turn`).toBe(3);
    }
    const g = groupTurns(out);
    expect(g).toHaveLength(1);
    expect(g[0]!.turn).toBe(3);
  });
});

describe("插话 ingest + 分组（PITFALLS §3.9）", () => {
  // 引擎把插话的 user/message 写在当前轮中途（next-step 领取）：step/start 之间，
  // 严格早于 turn/end。整条链（ingest 标 turn → finalizeTurns 插 tail → groupTurns）
  // 都要让它停在事件时序原位。
  const events: SessionEvent[] = [
    { type: "turn/start", seq: 1, time: 1, data: { turn: 1 } },
    { type: "user/message", seq: 2, time: 2, data: { id: "m1", role: "user", content: [{ type: "text", text: "开个头" }], source: { kind: "user" } } },
    { type: "assistant/message", seq: 3, time: 3, data: { turn: 1, step: 1, message: { role: "assistant", content: [{ type: "text", text: "第一步" }] } } as never },
    { type: "user/message", seq: 4, time: 4, data: { id: "m2", role: "user", content: [{ type: "text", text: "插话" }], source: { kind: "user" } } },
    { type: "assistant/message", seq: 5, time: 5, data: { turn: 1, step: 2, message: { role: "assistant", content: [{ type: "text", text: "第二步" }] } } as never },
    { type: "turn/end", seq: 6, time: 6, data: { turn: 1, reason: { kind: "stop" } } },
  ];

  it("插话停在它前后两步之间，不被折到本轮开头", () => {
    const ctx = makeIngestCtx();
    const out: RenderItem[] = [];
    for (const ev of events) ingest(out, { event: ev }, ctx);
    finalizeTurns(out, ctx);
    const g = groupTurns(out);
    expect(g).toHaveLength(1);
    expect(g[0]!.items.map((x) => x.kind)).toEqual(["user", "assistant", "user", "assistant", "turn-tail"]);
    expect(g[0]!.items.map((x) => (x.kind === "user" ? textOf(x.event) : ""))).toEqual(["开个头", "", "插话", "", ""]);
  });

  it("同轮再排一条（排队消息落在下一轮）时，插话仍在原位", () => {
    const ctx = makeIngestCtx();
    const out: RenderItem[] = [];
    // 排队消息的 user/message 在**下一轮**（turn/start 之后）才写进日志——next-turn
    // 只在开新轮的第一步被领取。
    const queued: SessionEvent[] = [
      { type: "turn/start", seq: 7, time: 7, data: { turn: 2 } },
      { type: "user/message", seq: 8, time: 8, data: { id: "m3", role: "user", content: [{ type: "text", text: "排队的" }], source: { kind: "user" } } },
      { type: "assistant/message", seq: 9, time: 9, data: { turn: 2, step: 1, message: { role: "assistant", content: [{ type: "text", text: "第二轮" }] } } as never },
      { type: "turn/end", seq: 10, time: 10, data: { turn: 2, reason: { kind: "stop" } } },
    ];
    for (const ev of [...events, ...queued]) ingest(out, { event: ev }, ctx);
    finalizeTurns(out, ctx);
    const g = groupTurns(out);
    expect(g.map((x) => x.turn)).toEqual([1, 2]);
    expect(g[0]!.items.map((x) => x.kind)).toEqual(["user", "assistant", "user", "assistant", "turn-tail"]);
    expect(g[1]!.items.map((x) => x.kind)).toEqual(["user", "assistant", "turn-tail"]);
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
