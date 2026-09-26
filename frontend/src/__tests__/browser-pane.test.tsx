// 缩略图预览的网眼：面板收起时那一格显示壳给的**整屏快照**（不是把 WKWebView 缩小放进去
// ——pageZoom 是重新排版），展开时才把槽位挖给壳的原生视图；快照没到之前不显示空白。
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: Array<Record<string, unknown>> = [];

vi.mock("../host", () => ({
  inShell: () => true,
  sendToShell: (m: Record<string, unknown>) => { sent.push(m); },
  onHostEvent: () => () => { /* no shell events in this test */ },
  openExternalUrl: () => { /* not exercised */ },
}));

import { BrowserPane } from "../sidebar-right/BrowserPane";

afterEach(cleanup);
beforeEach(() => { sent.length = 0; });

describe("BrowserPane（壳载体）", () => {
  it("展开态把槽位挖给壳的原生视图，且那一格可点（interactive）", () => {
    const { container } = render(
      <BrowserPane expanded applicationOrigin="http://127.0.0.1:1" onExpand={() => {}} onChat={() => {}} caption="X 的屏幕" />,
    );
    const slot = container.querySelector('[data-native-slot="browser"]');
    expect(slot).not.toBeNull();
    expect(slot?.getAttribute("data-native-slot-interactive")).toBe("1");
    expect(container.querySelector(".sr-browser-shot")).toBeNull();
  });

  it("收起态不挖槽位（不把缩小版的 WKWebView 摆进去），只等快照图", () => {
    const { container } = render(
      <BrowserPane expanded={false} applicationOrigin="http://127.0.0.1:1" onExpand={() => {}} onChat={() => {}} caption="X 的屏幕" />,
    );
    expect(container.querySelector('[data-native-slot="browser"]')).toBeNull();
    expect(container.querySelector(".sr-browser-shot")).toBeNull();
    // 还没有地址 → 空态；并向壳要过一次当前状态
    expect(container.querySelector(".sr-browser-empty")).not.toBeNull();
    expect(sent.some((m) => m.type === "browser-sync")).toBe(true);
  });
});
