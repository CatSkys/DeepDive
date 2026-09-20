// 渲染层组件测试（R-001 网眼补齐）：jsdom 环境跑真实 React 渲染——此前
// 保护网只罩纯函数层，AUD-021/AUD-012 两个 P1 都从渲染层漏过去。
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Markdown } from "../components/Markdown";
import { StoreProvider, useStore } from "../store";

// jsdom 不实现 matchMedia（store 初始化窄视口要用），补标准 stub
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

// ArchivedSection 走真实 StoreProvider（store boot 的 api 调用一并 mock：
// store 消费 sessions/agentPresets/openWorkspaces/openControl/onEvents/
// createSession/workspaceCreate——流式面以一次性基线帧驱动）
vi.mock("../api", () => ({
  api: {
    sessions: vi.fn(async () => ({
      items: [{ sessionId: "s-archive", updatedAt: 1726000000000, running: false, blank: false }],
    })),
    agentPresets: vi.fn(async () => ({ presets: [] })),
    openWorkspaces: vi.fn((onFrame: (f: unknown) => void) => {
      onFrame({ type: "baseline", value: { items: [], archivedSessionIds: ["s-archive"] } });
      return () => undefined;
    }),
    openControl: vi.fn(() => () => undefined),
    onEvents: vi.fn(() => () => undefined),
    createSession: vi.fn(async () => ({ sessionId: "s-new" })),
    workspaceCreate: vi.fn(async () => ({ workspace: { workspaceId: "w1" }, created: true })),
  },
  probeMethod: vi.fn(async () => false),
}));

afterEach(cleanup);

describe("Markdown 组件渲染", () => {
  it("链接与图片渲染为可交互元素（AUD-021 回归钉）", () => {
    const { container } = render(
      <Markdown text={"见[文档](https://example.com/x)与![截图](/img/a.png)"} />,
    );
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://example.com/x");
    expect(a?.textContent).toBe("文档"); // label 不再被整段吞掉
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/api/file?path=%2Fimg%2Fa.png"); // 0.1.5：单斜杠开头本地路径重写 /api/file
    expect(img?.getAttribute("alt")).toBe("截图");
  });

  it("代码块与表格渲染（分隔行不成为数据行）", () => {
    const { container } = render(
      <Markdown text={"```ts\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |"} />,
    );
    expect(container.querySelector(".cb code, .cbCode.hljs, .cbCode")?.textContent).toContain("const a = 1;");
    const tds = [...container.querySelectorAll("td")].map((x) => x.textContent);
    expect(tds).toEqual(["1", "2"]); // 首个数据行不再是 ---/---
  });
});

describe("ArchivedSection（AUD-012 回归钉）", () => {
  // 超时给宽：整仓并行跑 jsdom 时首帧拉取偶尔超过默认 5s（本文件单独跑 <2s）。
  // 放宽的只是等待预算，"不再新增拉取"那条断言照样能抓住真的循环。
  it("挂载后只拉取一轮，不随重渲循环拉取", { timeout: 20_000 }, async () => {
    const { api } = await import("../api");
    const { ArchivedSection } = await import("../components/SettingsPage");
    render(
      <StoreProvider>
        <ArchivedSection />
      </StoreProvider>,
    );
    // 列表行渲染出来（拉取成功）；标题走 sessionTitle（zh=任务/en=Task，语言无关匹配）
    await waitFor(() => {
      expect(screen.getByText(/^(任务|Task) s-arch$/)).toBeTruthy();
    });
    const callsAfterFirstPaint = vi.mocked(api.sessions).mock.calls.length;
    expect(callsAfterFirstPaint).toBeGreaterThanOrEqual(1);
    // 稳定后不再有新增拉取（旧 [t] 每渲染新闭包 → 无限 fetch 循环）
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(api.sessions).mock.calls.length).toBe(callsAfterFirstPaint);
  });
});

describe("Store boot 策略（草稿页语义回归钉）", () => {
  it("冷启动落草稿页：不自动建会话、不自动打开历史会话", async () => {
    const { api } = await import("../api");
    function Probe() {
      const store = useStore();
      return <div>active:{String(store.activeSessionId)}</div>;
    }
    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );
    // 越过首个 refresh tick（含其异步后续），3s 轮询也不会补建会话
    await new Promise((r) => setTimeout(r, 60));
    expect(vi.mocked(api.createSession).mock.calls.length).toBe(0);
    expect(screen.getByText("active:null")).toBeTruthy();
  });
});
