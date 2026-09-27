// 子会话视图（SessionView）= 只读预览页：页头照全屏产物预览那一套（返回父会话
// + 标题），**不挂输入框**——用户定稿（子智能体是"看"的，不是"聊"的）。
// 这里钉的就是这条：子会话页出预览页头、没有 Composer；普通会话不受影响。
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  // jsdom 没有 ResizeObserver（SessionView 量底部悬浮区要用）——空实现足够
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  }
});

const openSession = vi.fn();

// 只桩掉 SessionView 之外的重件：真渲染的只有会话页的骨架与页头，断言的是
// "有没有 Composer / 页头长什么样"，不牵动流内每张卡。
vi.mock("../store", () => ({
  useStore: () => ({
    sessions: [current],
    approvals: new Map(),
    questions: new Map(),
    queues: new Map(),
    workspaces: [],
    activeWorkspaceId: null,
    openSession,
  }),
}));
vi.mock("../session/useSessionEvents", () => ({
  useSessionEvents: () => ({
    items: [], liveRunning: false, runningSince: null, plan: null, scheduleRecords: [],
    hasMore: false, loadingOlder: false, loadOlder: vi.fn(), loadError: false, retry: vi.fn(),
  }),
}));
vi.mock("../session/useSessionModels", () => ({ useSessionModels: () => null }));
vi.mock("../sidebar-right/useComposerOverlay", () => ({ useComposerOverlay: () => false }));
vi.mock("../sidebar-right/SessionPanel", () => ({ SessionPanel: () => null }));
vi.mock("../sidebar-right/PanelTrigger", () => ({ PanelTrigger: () => null }));
vi.mock("../session/TurnList", () => ({ TurnList: () => <div className="turn-list" /> }));
vi.mock("../session/SessionHeader", () => ({
  SessionHeader: ({ title }: { title: string }) => <div className="session-header-title">{title}</div>,
}));
vi.mock("../components/Composer", () => ({ Composer: () => <div data-testid="composer" /> }));

import { SessionView } from "../components/SessionView";
import type { SessionSummary } from "../types";

const summary = {
  sessionId: "s-child",
  updatedAt: 1726000000000,
  running: false,
  blank: false,
  origin: "subagent",
  parentSessionId: "s-parent",
  projections: { values: { title: "探索代码库" } },
} as unknown as SessionSummary;

/** 普通会话对照：同一个渲染路径，只把 origin 摘掉。 */
const plain = { ...summary, origin: undefined, parentSessionId: undefined } as unknown as SessionSummary;
let current = summary;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("子会话视图（只读预览页）", () => {
  it("出预览页头（返回父会话 + 标题），且整页没有输入框", () => {
    const { container } = render(<SessionView sessionId="s-child" />);
    expect(container.querySelector(".session-header.preview-page-head")).not.toBeNull();
    expect(screen.getByText("探索代码库")).toBeTruthy();
    expect(screen.queryByTestId("composer")).toBeNull();
    expect(container.querySelector(".session-bottom")).toBeNull();
    // 普通会话那套页头（模型/胶囊/右侧面板入口）整体让位
    expect(container.querySelector(".session-header-title")).toBeNull();
  });

  it("返回钮回到父会话", () => {
    render(<SessionView sessionId="s-child" />);
    fireEvent.click(screen.getByLabelText("返回父会话"));
    expect(openSession).toHaveBeenCalledWith("s-parent");
  });

  it("普通会话照旧挂 Composer（子会话的只读不外溢）", () => {
    current = plain;
    try {
      render(<SessionView sessionId="s-child" />);
      expect(screen.getByTestId("composer")).toBeTruthy();
    } finally {
      current = summary;
    }
  });
});
