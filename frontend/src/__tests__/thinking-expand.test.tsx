// 思考行的展开交互规格（用户实测「上面的思考链都无法打开」的 DOM 级钉测）：
// Item 层渲染 reasoning 行 → 点击头部 → 展开态必须能看到推理正文。
// 这里走真 React 渲染 + fireEvent，与 ThinkingState 内部的 manual 状态机对齐。
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// 字典透传（同 bot-settings 的口径：这层测交互行为不测文案，免装 store 上下文）
vi.mock("../i18n", () => ({
  useT: () => ({ t: (s: string) => s, tt: (zh: string) => zh, lang: "zh" }),
}));
vi.mock("../session/useFocusStream", () => ({
  useFocusStream: (full: string) => full, // 非运行态立即全量（同真实语义）
}));

// jsdom 没有 ResizeObserver（useEdgeFade 的视口测量用）——桩成空观察者
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as Record<string, unknown>).ResizeObserver = ResizeObserverStub;

import { fireEvent, render, screen } from "@testing-library/react";
import { Item } from "../session/Item";
import type { RenderItem } from "../session/renderModel";

function reasoningItem(): RenderItem {
  return {
    key: "r1",
    kind: "reasoning",
    turn: 1,
    output: "第一步：先看新闻源。第二步：抓澎湃和新浪的头条。",
    thinkMs: 4_000,
  } as unknown as RenderItem;
}

describe("思考行展开", () => {
  it("点击已结束的思考行，展开态能看到推理正文", () => {
    render(
      <Item item={reasoningItem()} itemV={1} running={false} sessionId="s" />,
    );
    const head = screen.getByRole("button", { name: /已思考/ });
    expect(head.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(head);

    const after = screen.getByRole("button", { name: /已思考|已收起/ });
    expect(after!.getAttribute("aria-expanded")).toBe("true");
    // 展开后正文必须可见（慢揭示对非 running 立即补齐）
    expect(document.querySelector(".thinking-rows")?.textContent).toContain("澎湃");
  });
});
