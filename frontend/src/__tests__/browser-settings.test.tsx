// 浏览器设置的壳桥回归：入口不触发磁盘扫描，子页按需请求，危险动作必须确认。
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendToShell, listeners, confirmDialog } = vi.hoisted(() => ({
  sendToShell: vi.fn(),
  listeners: new Set<(command: string, payload?: unknown) => void>(),
  confirmDialog: vi.fn<(...args: [{ message: string; danger?: boolean }]) => Promise<boolean>>(),
}));
vi.mock("../host", () => ({
  sendToShell,
  onHostEvent: (listener: (command: string, payload?: unknown) => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
}));
vi.mock("../prefs", () => ({ usePrefs: () => ({
  browserZoomDefault: 1, browserZoomRememberSite: true, browserTabSleepMinutes: 30,
  setBrowserZoomDefault: vi.fn(), setBrowserZoomRememberSite: vi.fn(), setBrowserTabSleepMinutes: vi.fn(),
}) }));
vi.mock("../sidebar-right/browserPrefs", () => ({
  BROWSER_SEARCH_TEMPLATES: [{ id: "bing", label: "Bing", template: "https://bing.com/?q={q}" }],
  useBrowserPrefs: () => [{ searchTemplate: "https://bing.com/?q={q}", searchOnPlainText: true }, vi.fn()],
}));
vi.mock("../i18n", () => ({
  t: (text: string) => text,
  tt: (zh: string, _en: string, vars?: Record<string, string | number>) =>
    Object.entries(vars ?? {}).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), zh),
}));
vi.mock("../components/DialogHost", () => ({ confirmDialog }));

import { BrowserSection } from "../settings/BrowserSection";
import { useBrowserLibraryBridge } from "../sidebar-right/browserHistory";

function Fixture() {
  useBrowserLibraryBridge();
  return <BrowserSection />;
}

function push(command: string, payload: unknown) {
  act(() => { for (const listener of listeners) listener(command, payload); });
}

function enter(name: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
}

beforeEach(() => { sendToShell.mockClear(); confirmDialog.mockReset(); });
afterEach(() => { cleanup(); listeners.clear(); });

describe("浏览器设置按需请求与危险确认", () => {
  it("首页不发历史、书签或 cookie 请求", () => {
    render(<Fixture />);
    expect(sendToShell).not.toHaveBeenCalled();
  });

  it("历史和书签 tab 只请求各自清单，返回后仍按当前 tab 请求", () => {
    render(<Fixture />);
    enter("历史与书签");
    expect(sendToShell).toHaveBeenCalledWith({ type: "browser-history", action: "list", limit: 200 });
    expect(sendToShell).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: "书签" }));
    expect(sendToShell).toHaveBeenLastCalledWith({ type: "browser-bookmarks", action: "list" });
    expect(sendToShell).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("tab", { name: "历史" }));
    expect(sendToShell).toHaveBeenLastCalledWith({ type: "browser-history", action: "list", limit: 200 });
    expect(sendToShell).toHaveBeenCalledTimes(3);
  });

  it("登录数据直到点击扫描才请求来源", () => {
    render(<Fixture />);
    enter("登录数据");
    expect(sendToShell).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "扫描" }));
    expect(sendToShell).toHaveBeenCalledExactlyOnceWith({ type: "browser-cookies", action: "sources" });
  });

  it("清空书签取消不执行，确认后才发 clear，且确认标记危险", async () => {
    render(<Fixture />);
    enter("历史与书签");
    fireEvent.click(screen.getByRole("tab", { name: "书签" }));
    push("browserBookmarks", { entries: [{ url: "https://example.com", title: "Example", at: 1 }] });
    const clear = screen.getByRole("button", { name: "清空" });
    confirmDialog.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    fireEvent.click(clear);
    await waitFor(() => expect(confirmDialog).toHaveBeenCalledWith({ message: "清空全部书签？", danger: true }));
    await act(async () => {});
    expect(sendToShell).not.toHaveBeenCalledWith({ type: "browser-bookmarks", action: "clear" });

    fireEvent.click(clear);
    await waitFor(() => expect(sendToShell).toHaveBeenCalledWith({ type: "browser-bookmarks", action: "clear" }));
    expect(confirmDialog).toHaveBeenCalledTimes(2);
  });

  it("隐私三项清理均需危险确认，取消不发指令", async () => {
    render(<Fixture />);
    enter("隐私与权限");
    expect(sendToShell).toHaveBeenCalledWith({ type: "browser-shield", action: "sync" });
    push("browserShield", { enabled: true, paused: ["example.com"], hidden: 2, permissions: 1, trouble: "" });
    const cases = [
      ["全部恢复", "恢复所有站点的拦截？", { type: "browser-shield", action: "forgetPaused" }],
      ["全部恢复（2）", "恢复所有隐藏的页面元素？", { type: "browser-hidden", action: "forgetAll" }],
      ["忘记全部（1）", "忘记所有摄像头和麦克风权限？", { type: "browser-permission", action: "forgetAll" }],
    ] as const;
    for (const [label, message, command] of cases) {
      const button = screen.getByRole("button", { name: label });
      confirmDialog.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      fireEvent.click(button);
      await waitFor(() => expect(confirmDialog).toHaveBeenLastCalledWith({ message, danger: true }));
      await act(async () => {});
      expect(sendToShell).not.toHaveBeenCalledWith(command);
      fireEvent.click(button);
      await waitFor(() => expect(sendToShell).toHaveBeenCalledWith(command));
    }
  });

  it("清除 cookie 也必须危险确认", async () => {
    render(<Fixture />);
    enter("登录数据");
    confirmDialog.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const clear = screen.getByRole("button", { name: "清除" });
    fireEvent.click(clear);
    await waitFor(() => expect(confirmDialog).toHaveBeenCalledWith({
      message: "清除浏览器 cookie 与站点存储？所有站点都会退出登录。", danger: true,
    }));
    await act(async () => {});
    expect(sendToShell).not.toHaveBeenCalled();
    fireEvent.click(clear);
    await waitFor(() => expect(sendToShell).toHaveBeenCalledExactlyOnceWith({ type: "browser-cookies", action: "clear" }));
  });
});
