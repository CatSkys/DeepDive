// 浏览器页上的悬浮对话卡（叠加层那一页）：整页透明、一张可拖动的卡（标题栏 + 本轮内容 +
// 原样复用的 Composer），并把**卡片矩形**报给壳——卡外要透传点击给底下的网页。
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

// 卡的会话流走 useSessionEvents（真钩子要引擎连接，jsdom 里取不到数）：这里钉住它的
// 三个返回值，`h.running` 控摘要侧的 running 投影（用户报障"刚发出、turn/start 还没到"
// 那段窗口里卡片没有 loader），`h.items` 控流式增长（同一处报障：发完消息不自己滚到底）。
const h = vi.hoisted(() => ({ running: false, items: [] as unknown[] }));
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      sessions: vi.fn(async () => ({
        items: h.running ? [{ sessionId: "sess-1", updatedAt: 1, running: true, blank: false }] : [],
      })),
    },
  };
});
vi.mock("../session/useSessionEvents", () => ({
  useSessionEvents: () => ({
    items: h.items,
    liveRunning: false,
    runningSince: undefined,
  }),
}));

import { ComposerOverlayApp } from "../sidebar-right/ComposerOverlay";

// jsdom 不排版：滚动尺寸与 scrollTop 全是 0，贴底与否测不出来。在原型上装一套
// 可写可观测的滚动度量，测的是"谁写了 scrollTop"，不是浏览器怎么滚。
const scroll = { height: 500, top: 0, client: 200 };
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { get: () => scroll.height, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => scroll.client, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    get: () => scroll.top,
    set: (v: number) => { scroll.top = v; },
    configurable: true,
  });
});

afterEach(cleanup);
beforeEach(() => {
  sent.length = 0;
  h.running = false;
  h.items = [{
    key: "u1",
    kind: "user",
    event: { type: "user/message", seq: 1, time: 1, data: { role: "user", id: "u1", content: [{ type: "text", text: "hi" }], source: { kind: "user" } } },
  }];
  scroll.height = 500;
  scroll.top = 0;
  delete window.__deepDiveHost;
  window.webkit = { messageHandlers: { deepdiveHost: { postMessage: (m) => sent.push(m as Record<string, unknown>) } } };
});

describe("悬浮对话卡叠加层", () => {
  it("渲染的是同一个 Composer（不是另做的精简版），并把卡片矩形报给壳", async () => {
    const { container } = render(<ComposerOverlayApp sessionId="sess-1" />);
    // 复用会话输入框：它的根是 .composer-wrap（另做一份就会缺这个结构）
    expect(container.querySelector(".composer-wrap")).not.toBeNull();
    expect(container.querySelector(".chat-float")).not.toBeNull();
    // 顶栏（拖动 + 右上关闭）；卡里直接是本轮内容，没有"收起/展开"那一行
    expect(container.querySelector(".chat-float-head")).not.toBeNull();
    expect(container.querySelector(".chat-float-close")).not.toBeNull();
    expect(container.querySelector(".chat-float-body")).not.toBeNull();
    // 等一次 300ms 的心跳推 rect（首帧也要立刻推一次）：报的是**卡片**矩形，
    // 整条透明层本身不收事件（否则会把网页的点击与滚轮全吞掉）。
    await vi.waitFor(() => {
      const pill = sent.find((m) => m.type === "composer-pill") as { rect?: { w: number; h: number } } | undefined;
      expect(pill?.rect?.w).toBeGreaterThan(0);
      expect(pill?.rect?.h).toBeGreaterThan(0);
    });
    for (let i = 0; i < 3; i++) {
      fireEvent.click(container.querySelector(".chat-float-close")!);
      expect(container.querySelector(".chat-float")).toBeNull();
      act(() => window.__deepDiveHost!.dispatch("chatShow", {}));
      expect(container.querySelector(".chat-float")).not.toBeNull();
    }
    void screen;
  });

  it("会话在跑时卡里出 loader（运行中指示器由 TurnList 挂在流末，两处共用同一份）", async () => {
    const idle = render(<ComposerOverlayApp sessionId="sess-1" />);
    // 空闲：只有那一轮用户气泡，没有 loader
    await waitFor(() => expect(idle.container.querySelector(".msg-block.user")).not.toBeNull());
    expect(idle.container.querySelector(".loading-state")).toBeNull();
    idle.unmount();

    // 摘要投影说会话在跑（事件侧 liveRunning 还没跟上）——loader 必须在，
    // 这正是"刚按下发送、卡里一片死寂"的那段窗口。摘要是 store 轮询来的，
    // 所以按"开着卡时它就在跑"来构造。
    h.running = true;
    const busy = render(<ComposerOverlayApp sessionId="sess-1" />);
    await waitFor(() => {
      expect(busy.container.querySelector(".loading-state")).not.toBeNull();
    });
  });

  it("流式长高时自己滚到底；用户上滑之后不再抢滚动", async () => {
    const { container, rerender } = render(<ComposerOverlayApp sessionId="sess-1" />);
    // 打开就贴底
    expect(scroll.top).toBe(scroll.height);

    // 回复逐段到达 → 内容变高，视图仍钉在底部（用户报障：发完消息要自己拉）
    scroll.height = 900;
    h.items = [...h.items, { key: "a1", kind: "assistant", event: { type: "assistant/message", seq: 2, time: 2, data: { role: "assistant", content: [{ type: "text", text: "在的" }] } } }];
    rerender(<ComposerOverlayApp sessionId="sess-1" />);
    expect(scroll.top).toBe(900);

    // 用户上滑看历史 → 交还控制权，后续增长不把人拽回底部
    scroll.top = 100;
    fireEvent.scroll(container.querySelector(".chat-turn")!);
    scroll.height = 1400;
    h.items = [...h.items, { key: "a2", kind: "assistant", event: { type: "assistant/message", seq: 3, time: 3, data: { role: "assistant", content: [{ type: "text", text: "还有一段" }] } } }];
    rerender(<ComposerOverlayApp sessionId="sess-1" />);
    expect(scroll.top).toBe(100);

    // 自己滚回底部 → 恢复跟随
    scroll.top = 1400;
    fireEvent.scroll(container.querySelector(".chat-turn")!);
    h.items = [...h.items, { key: "a3", kind: "assistant", event: { type: "assistant/message", seq: 4, time: 4, data: { role: "assistant", content: [{ type: "text", text: "到底了" }] } } }];
    rerender(<ComposerOverlayApp sessionId="sess-1" />);
    expect(scroll.top).toBe(1400);
  });
});
