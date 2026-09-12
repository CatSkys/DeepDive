// 事件摄取黄金回放：夹具按 types.ts 联合 + PITFALLS §2/§3 的真实 wire 形状构造
// （satisfies 编译期校验契约）。这里锁的是会话流的全部不变量，SessionView
// 后续拆分（R-010）以这组测试为安全网。
import { describe, expect, it } from "vitest";
import { finalizeTurns, ingest, makeIngestCtx } from "../session/renderModel";
import type { RenderItem } from "../session/renderModel";
import type { SessionEvent } from "../types";

const EV = {
  userReal: {
    type: "user/message", seq: 1, time: 1_000,
    data: { role: "user", id: "u1", content: [{ type: "text", text: "把 README 改成英文" }], source: { kind: "user" } },
  },
  // 注入上下文也是 user/message（PITFALLS §2.4），不得渲染成气泡
  userInjected: {
    type: "user/message", seq: 2, time: 1_010,
    data: { role: "user", id: "u2", content: [{ type: "text", text: "<system-reminder>skill-catalog…</system-reminder>" }], source: { kind: "skill-catalog" } },
  },
  turn1Start: { type: "turn/start", seq: 3, time: 1_050, data: { turn: 1 } },
  chunkText1: { type: "assistant/chunk", seq: 4, time: 1_100, data: { turn: 1, step: 1, chunk: { type: "text-delta", index: 0, text: "计划" } } },
  chunkText2: { type: "assistant/chunk", seq: 5, time: 1_120, data: { turn: 1, step: 1, chunk: { type: "text-delta", index: 0, text: "如下" } } },
  chunkThink: { type: "assistant/chunk", seq: 6, time: 1_130, data: { turn: 1, step: 1, chunk: { type: "reasoning-delta", index: 0, text: "先想想" } } },
  msg1: {
    type: "assistant/message", seq: 7, time: 1_200,
    data: {
      turn: 1, step: 1,
      usage: { inputTokens: 12, outputTokens: 90 },
      message: {
        role: "assistant", id: "m1",
        content: [{ type: "reasoning", text: "先想想" }, { type: "text", text: "计划如下" }],
        source: { kind: "model", provider: "deepseek", model: "r1" },
      },
    },
  },
  call1: { type: "tool/call", seq: 8, time: 1_250, data: { turn: 1, step: 2, callId: "c1", name: "write", arguments: { path: "/tmp/a.md", content: "x" } } },
  result1: {
    type: "tool/result", seq: 9, time: 1_300,
    data: { turn: 1, step: 2, message: { source: { kind: "tool", callId: "c1" }, content: [{ type: "text", text: "wrote 1 file" }] } },
  },
  turn1End: { type: "turn/end", seq: 10, time: 1_400, data: { turn: 1, reason: "completed" } },
  turn2Start: { type: "turn/start", seq: 11, time: 1_500, data: { turn: 2 } },
  msg2: {
    type: "assistant/message", seq: 12, time: 1_600,
    data: {
      turn: 2, step: 1,
      message: { role: "assistant", id: "m2", content: [{ type: "text", text: "完成" }], source: { kind: "model", provider: "deepseek", model: "r1" } },
    },
  },
  turn2End: { type: "turn/end", seq: 13, time: 1_700, data: { turn: 2, reason: "completed" } },
  // 空 turn：无任何 item → 不发 tail（PITFALLS §3.4）
  turn3Start: { type: "turn/start", seq: 14, time: 1_800, data: { turn: 3 } },
  turn3End: { type: "turn/end", seq: 15, time: 1_810, data: { turn: 3, reason: "interrupted" } },
  // 一步失败轮（MISSING_CREDENTIAL 实测 wire 形状）：LLM 调用没发出，turn 里
  // 除 user 外没有任何带 turn 的 item —— turn-tail 必须仍有锚点，否则轮终
  // 错误（无凭据/无效 key/网络错误）在 UI 上完全静默（2026-09-06 新用户实测）。
  turn4Start: { type: "turn/start", seq: 16, time: 1_900, data: { turn: 4 } },
  user4: {
    type: "user/message", seq: 17, time: 1_905,
    data: { role: "user", id: "u4", content: [{ type: "text", text: "你好" }], source: { kind: "user" } },
  },
  chunkFinishError: {
    type: "assistant/chunk", seq: 18, time: 1_910,
    data: { turn: 4, step: 1, chunk: { type: "finish", reason: { kind: "error", failure: { message: "llm-deepseek: no API key", code: "MISSING_CREDENTIAL" } } } },
  },
  turn4End: {
    type: "turn/end", seq: 19, time: 1_915,
    data: { turn: 4, reason: { kind: "error", error: { message: "llm-deepseek: no API key", code: "MISSING_CREDENTIAL" } } },
  },
} satisfies Record<string, SessionEvent>;

/** 与 SessionView 实时通路一致：逐条 ingest，turn/end 时收尾。 */
function replay(events: SessionEvent[]): RenderItem[] {
  const ctx = makeIngestCtx();
  const out: RenderItem[] = [];
  for (const event of events) {
    ingest(out, { event }, ctx);
    if (event.type === "turn/end") finalizeTurns(out, ctx);
  }
  return out;
}

describe("ingest 黄金回放", () => {
  const out = replay(Object.values(EV));

  it("渲染序 = 用户气泡 → turn1 文本+工具+tail → turn2 文本+tail → turn4 user+错误tail（注入上下文不渲染，2026-09-04 用户拍板隐藏）", () => {
    expect(out.map((x) => x.kind)).toEqual([
      "user", "assistant", "tool-call", "turn-tail", "assistant", "turn-tail", "user", "turn-tail",
    ]);
    expect(out.filter((x) => x.kind === "user")).toHaveLength(2);
  });

  it("流式 chunk 被 assistant/message 取代后不残留（PITFALLS §3.1/§3.2）", () => {
    expect(out.some((x) => x.kind === "chunk")).toBe(false);
    expect(out.some((x) => x.kind === "reasoning")).toBe(false);
    expect(out.filter((x) => x.kind === "assistant")).toHaveLength(2);
  });

  it("工具行按 callId O(1) 归并：result 回填 output 且不新增行", () => {
    const tool = out.find((x) => x.kind === "tool-call");
    expect(tool?.toolCallId).toBe("c1");
    expect(tool?.toolName).toBe("write");
    expect(tool?.args).toContain("/tmp/a.md");
    expect(tool?.output).toBe("wrote 1 file");
    expect(tool?.failed).toBe(false);
    expect(out.filter((x) => x.kind === "tool-call")).toHaveLength(1);
  });

  it("turn-tail 携带产物与可复制文本，锚定在该 turn 最后一项之后", () => {
    const [tail1, tail2] = out.filter((x) => x.kind === "turn-tail");
    expect(tail1?.turn).toBe(1);
    expect(tail1?.produced).toEqual(["/tmp/a.md"]);
    expect(tail2?.turn).toBe(2);
    expect(tail2?.produced).toEqual([]);
    // tail 的 event 是可复制文本载荷（turnText）
    expect(tail2?.event?.type).toBe("assistant/message");
  });

  it("空 turn 不发 tail；一步失败轮（零 assistant 输出）经 user 锚点仍发 tail", () => {
    const tails = out.filter((x) => x.kind === "turn-tail");
    expect(tails).toHaveLength(3);
    expect(tails.map((x) => x.turn)).toEqual([1, 2, 4]);
    const failTail = tails[2];
    expect(failTail?.endReason?.kind).toBe("error");
    expect((failTail?.endReason as { error?: { code?: string } }).error?.code).toBe("MISSING_CREDENTIAL");
  });

  it("key 全局唯一（seq:type）", () => {
    const keys = out.map((x) => x.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("finalizeTurns 幂等", () => {
  it("重复收尾不重复插入旧 turn 的 tail（实时通路每个 turn/end 都再收尾一次）", () => {
    const ctx = makeIngestCtx();
    const out: RenderItem[] = [];
    const turn1: SessionEvent[] = [EV.turn1Start, EV.chunkText1, EV.msg1, EV.turn1End];
    for (const ev of turn1) ingest(out, { event: ev }, ctx);
    finalizeTurns(out, ctx);
    finalizeTurns(out, ctx);
    finalizeTurns(out, ctx);
    expect(out.filter((x) => x.kind === "turn-tail")).toHaveLength(1);
  });
});

describe("ingest 流式累积", () => {
  it("text-delta 在同一 turn 落进同一条 chunk 行（PITFALLS §2.1：文本在 chunk.text）", () => {
    const ctx = makeIngestCtx();
    const out: RenderItem[] = [];
    ingest(out, { event: EV.chunkText1 }, ctx);
    ingest(out, { event: EV.chunkText2 }, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("chunk");
    expect(out[0]?.output).toBe("计划如下");
  });

  it("reasoning-delta 独立于 text chunk 行累积", () => {
    const ctx = makeIngestCtx();
    const out: RenderItem[] = [];
    ingest(out, { event: EV.chunkText1 }, ctx);
    ingest(out, { event: EV.chunkThink }, ctx);
    expect(out.map((x) => x.kind)).toEqual(["chunk", "reasoning"]);
    expect(out[1]?.output).toBe("先想想");
  });
});
