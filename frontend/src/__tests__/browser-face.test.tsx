// 窗口级浏览器镜像（browserFace）：状态胶囊的浏览器入口要显示"agent 在看哪一页"，
// 而面板没挂载时那份 browserTabs/browserState 推送没有消费者——这里锁住它的取数与
// 首次订阅时的现状对账（browser-sync）。
// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendToShell, listeners } = vi.hoisted(() => ({
  sendToShell: vi.fn(),
  listeners: new Set<(command: string, payload?: unknown) => void>(),
}));
vi.mock("../host", () => ({
  sendToShell,
  onHostEvent: (listener: (command: string, payload?: unknown) => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
}));

import { resetBrowserFace, useBrowserFace } from "../sidebar-right/browserFace";

function Fixture() {
  const face = useBrowserFace();
  return <div data-testid="face">{`${face.title}|${face.url}|${face.loading}`}</div>;
}

function push(command: string, payload: unknown) {
  act(() => { for (const listener of listeners) listener(command, payload); });
}

beforeEach(() => {
  resetBrowserFace();
  listeners.clear();
  sendToShell.mockClear();
});
afterEach(cleanup);

describe("browserFace：窗口级浏览器镜像", () => {
  it("首次订阅向壳要一次现状（面板没开过时壳不会主动推）", () => {
    render(<Fixture />);
    expect(sendToShell).toHaveBeenCalledWith({ type: "browser-sync" });
    expect(screen.getByTestId("face").textContent).toBe("||false");
  });

  it("browserTabs 取当前标签的标题/地址/加载态", () => {
    render(<Fixture />);
    push("browserTabs", {
      activeId: "t2",
      tabs: [
        { id: "t1", title: "旧页", url: "https://a.example", active: false },
        { id: "t2", title: "新页", url: "https://b.example/x", active: true, loading: true },
      ],
    });
    expect(screen.getByTestId("face").textContent).toBe("新页|https://b.example/x|true");
  });

  it("browserState 覆盖标题/地址/加载态", () => {
    render(<Fixture />);
    push("browserState", { title: "改过了", url: "https://c.example", loading: false });
    expect(screen.getByTestId("face").textContent).toBe("改过了|https://c.example|false");
  });

  it("空白标签（没有页面）→ 地址为空串，胶囊那级据此只给'浏览器'一词", () => {
    render(<Fixture />);
    push("browserTabs", { activeId: "t1", tabs: [{ id: "t1", title: "", url: "", active: true }] });
    expect(screen.getByTestId("face").textContent).toBe("||false");
  });
});
