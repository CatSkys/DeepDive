// 浏览器页上的悬浮对话卡（叠加层那一页）：整页透明、一张可拖动的卡（标题栏 + 本轮内容 +
// 原样复用的 Composer），并把**卡片矩形**报给壳——卡外要透传点击给底下的网页。
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
  // jsdom 不做布局：所有 getBoundingClientRect 都是 0，而"上报可点矩形"必须是非零才会发。
  // 给一个固定矩形，测的是"报了什么"而不是浏览器怎么排版。
  Element.prototype.getBoundingClientRect = function () {
    return { x: 100, y: 200, left: 100, top: 200, right: 700, bottom: 260, width: 600, height: 60, toJSON: () => ({}) } as DOMRect;
  };
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

describe("悬浮对话卡叠加层", () => {
  it("渲染的是同一个 Composer（不是另做的精简版），并把卡片矩形报给壳", async () => {
    const { container } = render(<ComposerOverlayApp sessionId="sess-1" />);
    // 复用会话输入框：它的根是 .composer-wrap（另做一份就会缺这个结构）
    expect(container.querySelector(".composer-wrap")).not.toBeNull();
    expect(container.querySelector(".chat-float")).not.toBeNull();
    // 顶栏（拖动 + 右上关闭）与"本轮内容"槽位
    expect(container.querySelector(".chat-float-head")).not.toBeNull();
    expect(container.querySelector(".chat-float-close")).not.toBeNull();
    // 等一次 300ms 的心跳推 rect（首帧也要立刻推一次）：报的是**卡片**矩形，
    // 整条透明层本身不收事件（否则会把网页的点击与滚轮全吞掉）。
    await vi.waitFor(() => {
      const pill = sent.find((m) => m.type === "composer-pill") as { rect?: { w: number; h: number } } | undefined;
      expect(pill?.rect?.w).toBeGreaterThan(0);
      expect(pill?.rect?.h).toBeGreaterThan(0);
    });
    void screen;
  });
});
