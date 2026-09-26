// 浏览器全屏时的悬浮输入框（叠加层那一页）：整页透明、原样复用同一个 Composer，
// 并把自己的**可点矩形**报给壳——胶囊之外要透传点击给底下的网页（壳按它做 hitTest）。
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom（本仓没配 vitest environmentOptions）里 `localStorage` 这个裸全局不存在，
// 而 Composer 的草稿按会话存在那儿 —— 补一份内存实现，别让测试去改产品代码。
beforeAll(() => {
  if (!globalThis.localStorage) {
    const map = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, String(v)); },
      removeItem: (k: string) => { map.delete(k); },
      clear: () => { map.clear(); },
      key: (i: number) => [...map.keys()][i] ?? null,
      get length() { return map.size; },
    } as unknown as Storage;
  }
  // jsdom 也没有 ResizeObserver（Composer 量测折行要用）——空实现足够，量测本身不测
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  }
  // jsdom 不实现 matchMedia（store 初始化窄视口要用），补标准 stub
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

const sent: Array<Record<string, unknown>> = [];

vi.mock("../host", () => ({
  inShell: () => true,
  sendToShell: (m: Record<string, unknown>) => { sent.push(m); },
  onHostEvent: () => () => { /* 叠加层不订阅壳事件 */ },
  openExternalUrl: () => { /* 未走到 */ },
}));

import { ComposerOverlayApp } from "../sidebar-right/ComposerOverlay";

afterEach(cleanup);
beforeEach(() => { sent.length = 0; });

describe("悬浮输入框叠加层", () => {
  it("渲染的是同一个 Composer（不是另做的精简版），并把胶囊矩形报给壳", async () => {
    const { container } = render(<ComposerOverlayApp sessionId="sess-1" />);
    // 复用会话输入框：它的根是 .composer-wrap（另做一份就会缺这个结构）
    expect(container.querySelector(".composer-wrap")).not.toBeNull();
    expect(container.querySelector(".composer-float")).not.toBeNull();
    // 等一次 300ms 的心跳推 rect（首帧也要立刻推一次）
    await vi.waitFor(() => {
      expect(sent.some((m) => m.type === "composer-pill")).toBe(true);
    });
    void screen;
  });
});
