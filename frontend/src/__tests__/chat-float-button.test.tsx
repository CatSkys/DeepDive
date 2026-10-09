// 工具栏行尾那颗「对话」胶囊（Chat）：形状是图标 + 文字，**带开关态**——卡片正开着时
// 高亮、气泡实心。开/关的事实源在壳（卡片自己的 × 是在叠加层那一页里关的，主 SPA 收不到），
// 壳在每次显隐变化时推 `chatFloat` 下来，这里钉住这颗钮读的就是那一份。
// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installHostBridge } from "../host";
import { initChatFloatBridge } from "../sidebar-right/useComposerOverlay";
import { BrowserPane } from "../sidebar-right/BrowserPane";

beforeEach(() => {
  window.webkit = { messageHandlers: { deepdiveHost: { postMessage: () => { /* 本条不需要发 */ } } } };
  installHostBridge();
  initChatFloatBridge();
});

afterEach(cleanup);

// 工具栏（含这颗胶囊）只在展开态渲染——它挂在标签行行尾（见 BrowserTabStrip 的 trailing）。
const renderPane = () => render(
  <BrowserPane expanded applicationOrigin="http://127.0.0.1:1"
    onExpand={() => {}} onChat={() => {}} onExitFullscreen={() => {}} onTabsRespawned={() => {}} />,
);

describe("Chat 胶囊的开关态", () => {
  it("常态：图标 + 文字，未按下", () => {
    const { container } = renderPane();
    const pill = container.querySelector(".panel-chat-btn");
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toContain("对话");
    // 不再是那枚只有图标的工具钮（用户定稿换成带文字的胶囊）
    expect(container.querySelector(".panel-browser-tool[aria-label='对话']")).toBeNull();
    expect(pill!.getAttribute("aria-pressed")).toBe("false");
    expect(pill!.className).not.toContain("on");
  });

  it("壳推来\"已打开\"→ 高亮；推来\"已收起\"→ 复原", () => {
    const { container } = renderPane();
    const pill = () => container.querySelector(".panel-chat-btn")!;
    act(() => window.__deepDiveHost!.dispatch("chatFloat", { open: true }));
    expect(pill().getAttribute("aria-pressed")).toBe("true");
    expect(pill().className).toContain("on");
    act(() => window.__deepDiveHost!.dispatch("chatFloat", { open: false }));
    expect(pill().getAttribute("aria-pressed")).toBe("false");
    expect(pill().className).not.toContain("on");
  });

  it("气泡跟着开关态走：开着实心（填充、无描边），关着空心（只描边）", () => {
    const { container } = renderPane();
    const bubble = () => container.querySelector(".panel-chat-btn svg")!;
    expect(bubble().getAttribute("fill")).toBe("none");
    act(() => window.__deepDiveHost!.dispatch("chatFloat", { open: true }));
    expect(bubble().getAttribute("fill")).toBe("currentColor");
    expect(bubble().getAttribute("stroke-width")).toBe("0");
    act(() => window.__deepDiveHost!.dispatch("chatFloat", { open: false }));
    expect(bubble().getAttribute("fill")).toBe("none");
    expect(bubble().getAttribute("stroke-width")).toBe("2");
  });
});
