// 流式正文渲染纪律（用户报障：打字期间没有格式，落定才排版）：
// ① 流式 chunk 项必须走与落定同一条 markdown 渲染链（边输出边带格式）；
// ② 已完成的块要被"冻结"复用——增量只重算正在增长的那个尾块，元素不重挂
//    （这是流式不卡的前提，官方 incremental 渲染的块冻结纪律）。
// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Markdown } from "../components/Markdown";
import { Item } from "../session/Item";

afterEach(cleanup);
afterEach(() => vi.useRealTimers());

describe("流式正文渲染", () => {
  it("流式 chunk 项渲染 markdown，而不是纯文本", () => {
    vi.useFakeTimers();
    const item = { key: "1:assistant/chunk", kind: "chunk", output: "## 标题\n\n**粗体**与`码`\n", turn: 1 } as unknown as Parameters<typeof Item>[0]["item"];
    const { container } = render(<Item item={item} running sessionId="s" />);
    // 直播项经 useFocusStream 受控揭示（打字机的替代观感），推进若干帧让揭示追平缓冲
    act(() => { vi.advanceTimersByTime(500); });
    expect(container.querySelector(".md")).not.toBeNull();
    expect(container.querySelector("h2")?.textContent).toBe("标题");
    expect(container.querySelector("strong")?.textContent).toBe("粗体");
    expect(container.querySelector("code")?.textContent).toBe("码");
  });

  it("已完成块被复用：追加增量不重挂前面的块", () => {
    const { container, rerender } = render(<Markdown text={"## 标题\n\n第一段"} />);
    const heading = container.querySelector("h2");
    expect(heading).not.toBeNull();
    rerender(<Markdown text={"## 标题\n\n第一段\n\n第二段"} />);
    // 同一个 DOM 节点 = 没有重挂（highlight.js/KaTeX/行内解析都没重跑）
    expect(container.querySelector("h2")).toBe(heading);
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });

  it("带语言的围栏照常高亮（行级记忆化不该吃掉高亮），重复渲染仍是高亮", () => {
    const { container, rerender } = render(<Markdown text={"```ts\nconst a: number = 1;\n```"} />);
    expect(container.querySelectorAll(".cb .hljs > span").length).toBeGreaterThan(0);
    rerender(<Markdown text={"```ts\nconst a: number = 1;\n```"} />);
    expect(container.querySelectorAll(".cb .hljs > span").length).toBeGreaterThan(0);
    // 无语言围栏保持纯文本（不猜语言）
    const { container: c2 } = render(<Markdown text={"```\nplain text\n```"} />);
    expect(c2.querySelectorAll(".cb .hljs > span").length).toBe(0);
  });

  it("代码块在流式追加时逐行增量复用：已完成的行节点不变", () => {
    const { container, rerender } = render(<Markdown text={"```ts\nconst a = 1;\n```"} />);
    const firstRow = container.querySelector(".cbRow");
    rerender(<Markdown text={"```ts\nconst a = 1;\nconst b = 2;\n```"} />);
    expect(container.querySelectorAll(".cbRow")).toHaveLength(2);
    expect(container.querySelector(".cbRow")).toBe(firstRow);
  });
});
