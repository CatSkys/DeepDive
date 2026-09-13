// 自进化协议：提案块解析（形状边界）+ 会话里零 UI（合法块不渲染、坏块看得见）。
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../store", () => ({ useStore: () => ({ lang: "zh" }) }));

import { Markdown } from "../components/Markdown";
import { applyPrompt, reviewPrompt, verifyPrompt } from "../evolution/prompts";
import { activityDays, activityMax, statusSlices } from "../evolution/chartData";
import { judgeVerdict, lessonBlocks, parseLesson, parseVerdict, verdictBlocks, type LessonProposal } from "../evolution/protocol";

afterEach(cleanup);

const lesson = {
  category: "incident",
  home: "pitfalls",
  anchor: "### 4.17 桥端口一变",
  content: "### 4.18 改包后必须重签\n- 症状：…",
  evidence: [{ excerpt: "Killed: 9 …", note: "engine 自检" }],
  predict: { metric: "repeat-incident", signature: "Taskgated Invalid Signature", windowDays: 14 },
};
const fenced = (body: string) => "```lesson\n" + body + "\n```";
const origin = { sessionId: "s1", turn: 4, eventSeq: 99 };

describe("parseLesson", () => {
  it("接受合法形状，并把 origin 盖戳（不采信模型自报的定位）", () => {
    const p = parseLesson(JSON.stringify(lesson), origin);
    expect(p).not.toBeNull();
    expect(p!.home).toBe("pitfalls");
    expect(p!.status).toBe("pending");
    expect(p!.origin).toEqual(origin);
    expect(p!.evidence).toEqual(lesson.evidence);
  });

  it("predict 为 null 是风格类（可以沉淀、不进统计）", () => {
    const p = parseLesson(JSON.stringify({ ...lesson, predict: null }), origin);
    expect(p).not.toBeNull();
    expect(p!.predict).toBeNull();
  });

  it("坏 JSON / 未知 home / 未知 category / 缺证据 / 空证据 / 缺锚点 / 超长正文 / 坏 predict 一律 null", () => {
    const bad = [
      "{ not json",
      JSON.stringify({ ...lesson, home: "code" }),
      JSON.stringify({ ...lesson, category: "vibe" }),
      JSON.stringify({ ...lesson, evidence: [] }),
      JSON.stringify({ ...lesson, evidence: [{ note: "没摘录" }] }),
      JSON.stringify({ ...lesson, anchor: "   " }),
      JSON.stringify({ ...lesson, content: "x".repeat(2001) }),
      JSON.stringify({ ...lesson, predict: { metric: "feels-better", signature: "x", windowDays: 14 } }),
      JSON.stringify({ ...lesson, predict: { metric: "steps", signature: "x", windowDays: 0 } }),
      JSON.stringify({ ...lesson, evidence: [{ excerpt: "x".repeat(501) }] }),
    ];
    for (const text of bad) expect(parseLesson(text, origin), text.slice(0, 40)).toBeNull();
  });
});

describe("lessonBlocks", () => {
  it("一段回复里可以带多块", () => {
    const text = `说明\n${fenced(JSON.stringify(lesson))}\n中间\n${fenced(JSON.stringify({ ...lesson, home: "agents" }))}`;
    expect(lessonBlocks(text)).toHaveLength(2);
  });
});

describe("图表数据（纯函数）", () => {
  const mk = (over: Partial<LessonProposal>): LessonProposal => ({
    id: "x", category: "incident", home: "pitfalls", anchor: "a", content: "c",
    inference: "implicit", evidence: [{ excerpt: "e" }], predict: null, status: "pending",
    createdAt: 0, updatedAt: 0, origin: { sessionId: "s", turn: 0, eventSeq: 0 }, ...over,
  });
  it("状态构成：结论优先于状态，零值切片不出现", () => {
    const slices = statusSlices([
      mk({ id: "1" }),
      mk({ id: "2", status: "applied", predict: { metric: "repeat-incident", signature: "s", windowDays: 14 } }),
      mk({ id: "3", status: "applied", verdict: { before: 12, after: 0, verdict: "effective", at: 1 } }),
      mk({ id: "4", status: "expired", verdict: { before: 12, after: 52, verdict: "ineffective", at: 1 } }),
      mk({ id: "5", status: "dismissed" }),
    ]);
    const by = Object.fromEntries(slices.map((s) => [s.key, s.value]));
    expect(by).toEqual({ pending: 1, applied: 1, effective: 1, ineffective: 1, dismissed: 1 });
    expect(slices.some((s) => s.key === "expired")).toBe(false);
  });

  it("近 30 天活动：按本地日归集新增与交办，桶数固定", () => {
    const now = new Date(2026, 8, 12, 12, 0).getTime();
    const days = activityDays(
      [mk({ createdAt: now }), mk({ createdAt: now - 86400000 })],
      [{ id: "r", kind: "apply", at: now, sessionId: "s" }, { id: "r2", kind: "review", at: now, sessionId: "s" }],
      now, 30,
    );
    expect(days).toHaveLength(30);
    expect(days.at(-1)).toMatchObject({ created: 1, runs: 2 });
    expect(days.at(-2)?.created).toBe(1);
    expect(activityMax(days)).toBe(3);
  });
});

describe("校验回执", () => {
  it("解析合法回执，坏形状一律 null", () => {
    expect(parseVerdict('{"id":"l-1","before":12,"after":0}')).toEqual({ id: "l-1", before: 12, after: 0 });
    expect(parseVerdict('{"id":"l-1","before":-1,"after":0}')).toBeNull();
    expect(parseVerdict('{"id":"l-1","before":12}')).toBeNull();
    expect(parseVerdict("不是 JSON")).toBeNull();
    // 判定在应用侧：模型只报两个数
    expect(judgeVerdict("repeat-incident", 12, 0)).toBe("effective");
    expect(judgeVerdict("repeat-incident", 12, 6)).toBe("effective");
    expect(judgeVerdict("repeat-incident", 12, 7)).toBe("ineffective");
    expect(judgeVerdict("steps", 10, 7)).toBe("effective");
    expect(judgeVerdict("steps", 10, 8)).toBe("ineffective");
    expect(judgeVerdict("repeat-incident", 0, 3)).toBe("unverified");
  });

  it("从助手文本里抠出回执块", () => {
    const text = '结论如下\n```lesson-verify\n{"id":"l-9","before":1,"after":52}\n```\n完。';
    expect(verdictBlocks(text)).toHaveLength(1);
    expect(parseVerdict(verdictBlocks(text)[0])?.after).toBe(52);
  });
});

describe("落库交办提示（与 agent 的契约）", () => {
  it("带落点、锚点、原文、逐字证据与提案 id，并限定只改一处", () => {
    const p = parseLesson(JSON.stringify(lesson), origin)!;
    const text = applyPrompt(p);
    expect(text).toContain("docs/PITFALLS.md");
    expect(text).toContain(lesson.anchor);
    expect(text).toContain(lesson.content);
    expect(text).toContain(lesson.evidence[0].excerpt);
    expect(text).toContain(p.id);
    expect(text).toContain("docs/EVOLUTION-POLICY.md"); // 先读政策再落
    expect(text).toContain("只改这一处");
  });
});

describe("复盘 / 校验提示（与 agent 的契约）", () => {
  it("复盘提示带上会话与三个摩擦信号，并限定只读", () => {
    const text = reviewPrompt([{ sessionId: "s1", logHint: "s1", updatedAt: 1, turns: 2, failed: 3, corrections: 1 }], ["npm run build"]);
    expect(text).toContain("s1");
    expect(text).toContain("$DSH_HOME/sessions/*/s1/session.v3.jsonl.zstd");
    expect(text).toContain("失败工具调用 3 次");
    expect(text).toContain("用户纠正 1 次");
    expect(text).toContain("docs/EVOLUTION-POLICY.md");
    expect(text).toContain("只读分析");
    expect(text).toContain("成本上限");
    expect(text).toContain("npm run build"); // 已知坑签名喂给复盘，才能判"第二次出现"
  });

  it("校验提示要求数签名并回一个 lesson-verify 块", () => {
    const p = parseLesson(JSON.stringify(lesson), origin)!;
    const text = verifyPrompt(p);
    expect(text).toContain(lesson.predict.signature);
    expect(text).toContain("lesson-verify.mjs"); // 走固化脚本（before/after 一起给）
    expect(text).toContain("```lesson-verify");
    expect(text).toContain("成本上限");
    expect(text).toContain(p.id);
  });
});

describe("会话里零 UI（SPEC §8）", () => {
  it("合法的 lesson 块在消息流里什么都不渲染", () => {
    const { container } = render(<Markdown text={fenced(JSON.stringify(lesson))} />);
    expect(container.querySelector(".cb")).toBeNull();       // 不是代码块
    expect((container.textContent ?? "").trim()).toBe("");   // 也不是任何卡片
  });

  it("不合法的块退回普通代码块，让「模型没按格式写」看得见", () => {
    const { container } = render(<Markdown text={fenced("随便一段不是 JSON 的文本")} />);
    expect(container.querySelector(".cb")).not.toBeNull();
  });
});
