// 事件摄取黄金回放：夹具按 types.ts 联合 + PITFALLS §2/§3 的真实 wire 形状构造
// （satisfies 编译期校验契约）。这里锁的是会话流的全部不变量，SessionView
// 后续拆分（R-010）以这组测试为安全网。
import { describe, expect, it } from "vitest";
import { finalizeTurns, ingest, makeIngestCtx, openTurnSince } from "../session/renderModel";
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

/** 历史回灌通路：一次 ingest 全部条目，最后只收尾一次。 */
function replayBulk(events: SessionEvent[]): RenderItem[] {
  const ctx = makeIngestCtx();
  const out: RenderItem[] = [];
  for (const event of events) ingest(out, { event }, ctx);
  finalizeTurns(out, ctx);
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

  it("思考时长：重载路径从消息自带的 stream 算（delta 帧不进日志，靠它才不丢）", () => {
    const ctx2 = makeIngestCtx();
    const items: RenderItem[] = [];
    // 只投递消息本体（模拟重载：日志里根本没有 assistant/chunk 流帧事件），
    // 时长来自 data.stream，形状照实测 log：推理块首末 chunk 帧 + 批次 dt 压缩形式。
    ingest(items, {
      event: {
        type: "assistant/message", seq: 9_999, time: 5_000,
        data: {
          turn: 9, step: 1,
          message: {
            role: "assistant", id: "m9",
            content: [{ type: "reasoning", text: "想" }, { type: "text", text: "答" }],
            source: { kind: "model", provider: "", model: "" },
          },
          stream: [
            { type: "chunk", time: 1_000, chunk: { type: "block-start", index: 0, blockType: "reasoning" } },
            { type: "reasoning-chunks", time0: 1_000, index: 0, dt: [3_000, 400], texts: ["想", "想好", "想好了"] },
            { type: "chunk", time: 4_400, chunk: { type: "block-end", index: 0, blockType: "reasoning" } },
          ],
        },
      } as SessionEvent,
    }, ctx2);
    // 3400 = 推理块末帧(4400) − 首帧(1000)：与直播那条断言同一个数——两条路同一把尺子
    //（批次 time0 + Σdt = 1000 + 3400 也是 4400）
    expect(items.find((x) => x.kind === "assistant")?.thinkMs).toBe(3_400);
  });

  it("思考时长：直播路径从 delta 帧算（首帧 → 末帧，不是「到消息为止」）", () => {
    const ctx2 = makeIngestCtx();
    const items: RenderItem[] = [];
    for (const [t, text] of [[1_000, "先"], [4_400, "想想"]] as const) {
      ingest(items, {
        event: {
          type: "assistant/chunk", seq: t, time: t,
          data: { turn: 9, step: 1, chunk: { type: "reasoning-delta", index: 0, text } },
        } as SessionEvent,
      }, ctx2);
    }
    ingest(items, {
      event: {
        type: "assistant/message", seq: 9_999, time: 5_000,
        data: {
          turn: 9, step: 1,
          message: {
            role: "assistant", id: "m9",
            content: [{ type: "text", text: "答" }],
            source: { kind: "model", provider: "", model: "" },
          },
        },
      } as SessionEvent,
    }, ctx2);
    const a = items.find((x) => x.kind === "assistant");
    // 3400 = 末帧(4400) − 首帧(1000)：**推理那一段**，不是「到消息为止」的 4000
    expect(a?.thinkMs).toBe(3_400);
    expect(items.some((x) => x.kind === "reasoning")).toBe(false);
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

  // 直播流帧是进程级伪事件（无 seq，useSessionEvents 合成）：key 若只取
  // `${seq}:${type}`，chunk 与 reasoning 两条直播项会撞成同一个
  // "undefined:assistant/chunk" —— 同列表重复 key 会让 React 复用实例，
  // 思考块的展开状态会串到另一段思考上（表现为「该收起的不收起」）。
  // 直播流帧是进程级伪事件（无 seq，useSessionEvents 合成）：key 若只取
  // `${seq}:${type}`，chunk 与 reasoning 两条直播项会撞成同一个
  // "undefined:assistant/chunk" —— 同列表重复 key 会让 React 复用实例，
  // 思考块的展开状态会串到另一段思考上（表现为「该收起的不收起」）。
  it("直播伪事件（无 seq）里 chunk 与 reasoning 的 key 互不相同", () => {
    const ctx = makeIngestCtx();
    const out: RenderItem[] = [];
    const live = (chunk: unknown, time: number) => ({ event: { type: "assistant/chunk", time, data: { turn: 1, step: 1, chunk } } as unknown as SessionEvent });
    ingest(out, live({ type: "reasoning-delta", index: 0, text: "先想想" }, 1_000), ctx);
    ingest(out, live({ type: "text-delta", index: 0, text: "答案是" }, 1_010), ctx);
    expect(out.map((x) => x.kind)).toEqual(["reasoning", "chunk"]);
    expect(new Set(out.map((x) => x.key)).size).toBe(out.length);
  });

  // 思考块是否显示「思考中 + 展开」由 SessionView 按「本项是否是列表最后一项」
  // 判定（官方 running={streaming && i === last} 口径）。这条锁该判定所依赖的
  // 不变量：直播思考项一入列就在尾部，其后一有工具/答案就不再是尾部 —— 即
  // 「这一条思考结束了」，UI 随即自动收起。
  it("直播思考项在尾部；其后一入列别的东西，它就不再是尾部（思考结束）", () => {
    const ctx = makeIngestCtx();
    const out: RenderItem[] = [];
    const live = (chunk: unknown, time: number) => ({ event: { type: "assistant/chunk", time, data: { turn: 1, step: 1, chunk } } as unknown as SessionEvent });
    ingest(out, live({ type: "reasoning-delta", index: 0, text: "先想想" }, 1_000), ctx);
    expect(out[out.length - 1]?.kind).toBe("reasoning");
    ingest(out, { event: EV.call1 }, ctx);
    expect(out[out.length - 1]?.kind).not.toBe("reasoning");
    expect(out.map((x) => x.kind)).toEqual(["reasoning", "tool-call"]);
  });
});

describe("ingest 交付文件（deliverables/presented）", () => {
  const presented = (seq: number, files: unknown[]) => ({
    type: "deliverables/presented", seq, time: 1_800, data: { turn: 1, callId: "c9", files },
  }) as unknown as SessionEvent;

  it("present 声明的文件挂到本轮轮尾（图片/文档都在）", () => {
    const ctx = makeIngestCtx();
    const out: RenderItem[] = [];
    for (const ev of [EV.turn1Start, EV.msg1, presented(20, [{ path: "shot.png", description: "跑分截图" }, { path: "/tmp/rep.md" }]), EV.turn1End]) {
      ingest(out, { event: ev }, ctx);
    }
    finalizeTurns(out, ctx);
    const tail = out.find((x) => x.kind === "turn-tail");
    expect(tail?.presented).toEqual([{ path: "shot.png", description: "跑分截图" }, { path: "/tmp/rep.md" }]);
  });

  it("同路径重复声明只留最后一次（描述以最新为准），且不乱挂到别的轮", () => {
    const ctx = makeIngestCtx();
    const out: RenderItem[] = [];
    for (const ev of [
      EV.turn1Start, EV.msg1,
      presented(20, [{ path: "shot.png", description: "旧描述" }]),
      presented(21, [{ path: "shot.png", description: "新描述" }, { path: "doc.md" }]),
      EV.turn1End,
    ]) ingest(out, { event: ev }, ctx);
    finalizeTurns(out, ctx);
    expect(out.find((x) => x.kind === "turn-tail")?.presented).toEqual([
      { path: "shot.png", description: "新描述" },
      { path: "doc.md" },
    ]);
  });

  it("空 files / 非法条目不进渲染项", () => {
    const ctx = makeIngestCtx();
    const out: RenderItem[] = [];
    for (const ev of [EV.turn1Start, EV.msg1, presented(20, []), presented(21, [{ path: "  " }, { description: "无路径" }]), EV.turn1End]) {
      ingest(out, { event: ev }, ctx);
    }
    finalizeTurns(out, ctx);
    expect(out.find((x) => x.kind === "turn-tail")?.presented).toEqual([]);
  });
});

describe("openTurnSince（快照对账运行态）", () => {
  it("轮已闭合 → undefined；轮未闭合 → 该轮开始时刻", () => {
    expect(openTurnSince([{ event: EV.turn1Start }, { event: EV.turn1End }])).toBeUndefined();
    expect(openTurnSince([{ event: EV.turn1Start }])).toBe(EV.turn1Start.time);
    // 结束事件漏掉（断线/丢帧）也要判成「未闭合」，否则 loading 永远转
    expect(openTurnSince([{ event: EV.turn1Start }, { event: EV.turn1End }, { event: EV.turn2Start }])).toBe(EV.turn2Start.time);
    expect(openTurnSince([])).toBeUndefined();
  });
});

// 两条通路（切会话/断线重连后的历史回灌 vs 实时流）必须落在同一份渲染项上：
// 回灌走「一次 ingest 全部 + 收尾一次」，实时走「逐条 ingest + 每个 turn/end 收尾」。
// 二者若分叉，同一段会话在重连前后会渲染成两个样子——这是收尾逻辑（tail 锚点、
// 流式项替换、幂等）全部改动的安全网。
describe("全量回灌 ≡ 实时增量", () => {
  it("同一份事件日志，两条通路产出逐项相同的渲染项", () => {
    const ALL = Object.values(EV);
    expect(replayBulk(ALL)).toEqual(replay(ALL));
  });

  it("同一轮多步：每步的流式项各被本步的 assistant/message 取代，跨步不残留（PITFALLS §3.1/§3.2）", () => {
    const ctx = makeIngestCtx();
    const out: RenderItem[] = [];
    const stream = (seq: number, step: number, chunkType: string, text: string) => ({
      type: "assistant/chunk", seq, time: seq * 10, data: { turn: 1, step, chunk: { type: chunkType, index: 0, text } },
    }) as unknown as SessionEvent;
    const settled = (seq: number, step: number, text: string) => ({
      type: "assistant/message", seq, time: seq * 10,
      data: {
        turn: 1, step,
        message: { role: "assistant", id: `m${step}`, content: [{ type: "text", text }], source: { kind: "model", provider: "deepseek", model: "r1" } },
      },
    }) as unknown as SessionEvent;
    for (const ev of [
      EV.turn1Start,
      stream(2, 1, "text-delta", "第一步"),
      settled(3, 1, "第一步"),
      stream(4, 2, "reasoning-delta", "第二步想想"),
      settled(5, 2, "第二步"),
      EV.turn1End,
    ]) ingest(out, { event: ev }, ctx);
    finalizeTurns(out, ctx);

    expect(out.some((x) => x.kind === "chunk" || x.kind === "reasoning")).toBe(false);
    expect(out.filter((x) => x.kind === "assistant")).toHaveLength(2);
    expect(out.filter((x) => x.kind === "turn-tail")).toHaveLength(1);
  });
});
