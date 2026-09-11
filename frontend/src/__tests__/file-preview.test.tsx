// 文件预览窗口的渲染网眼（R-001 同款渲染层测试）：little 浮窗的蒙版/控制簇、
// 全屏面的装配、分栏双 pane 的接线与回调。分栏在真实数据上难凑（要一个会话
// 出两个产物文件），这里用假 state 钉住结构。@vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FilePreviewOverlay, FilePreviewSurface } from "../components/preview/FilePreviewWindow";
import type { FilePreview } from "../components/preview/useFilePreview";

beforeAll(() => {
  // 预览体一律拉 /api/file：jsdom 里没有桥，给个固定失败响应走「无法预览」分支
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, text: async () => "" })));
});

afterEach(cleanup);

function fake(over: Partial<FilePreview> = {}): FilePreview {
  return {
    tabs: [{ path: "/w/a.txt", name: "a.txt" }],
    activePath: "/w/a.txt",
    splitPath: null,
    fullscreen: false,
    open: vi.fn(),
    close: vi.fn(),
    closeAll: vi.fn(),
    setActive: vi.fn(),
    toggleSplit: vi.fn(),
    setFullscreen: vi.fn(),
    ...over,
  };
}

describe("little 浮窗", () => {
  it("挂蒙版 + 浮窗，控制簇是关闭/全屏两颗，标签条给出文件名", () => {
    render(<FilePreviewOverlay preview={fake()} />);
    expect(document.querySelector(".preview-veil")).not.toBeNull();
    expect(document.querySelector(".preview-window")).not.toBeNull();
    expect(screen.getByRole("tab").textContent).toContain("a.txt");
    const controls = [...document.querySelectorAll(".preview-control")];
    expect(controls.map((b) => b.getAttribute("aria-label"))).toEqual(["关闭预览", "全屏预览"]);
  });

  it("关闭钮与蒙版空白处都关掉预览；浮窗内的按下不误关", () => {
    const p = fake();
    render(<FilePreviewOverlay preview={p} />);
    (document.querySelector(".preview-control") as HTMLElement).click();
    expect(p.closeAll).toHaveBeenCalledTimes(1);
    // 空白处（target === 蒙版自身）关闭
    const veil = document.querySelector(".preview-veil") as HTMLElement;
    veil.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(p.closeAll).toHaveBeenCalledTimes(2);
    // 浮窗内的按下冒泡到蒙版，但 target 不是蒙版 → 不关
    (document.querySelector(".preview-window") as HTMLElement).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(p.closeAll).toHaveBeenCalledTimes(2);
  });

  it("标签的 × 关单个标签，不触发整窗关闭", () => {
    const p = fake();
    render(<FilePreviewOverlay preview={p} />);
    (document.querySelector(".preview-tab-x") as HTMLElement).click();
    expect(p.close).toHaveBeenCalledWith("/w/a.txt");
    expect(p.closeAll).not.toHaveBeenCalled();
  });
});

describe("全屏面", () => {
  it("不挂蒙版，控制簇第二颗变「退出全屏」并回调 setFullscreen(false)", () => {
    const p = fake({ fullscreen: true });
    render(<FilePreviewSurface preview={p} />);
    expect(document.querySelector(".preview-surface")).not.toBeNull();
    expect(document.querySelector(".preview-veil")).toBeNull();
    const controls = [...document.querySelectorAll(".preview-control")];
    expect(controls.map((b) => b.getAttribute("aria-label"))).toEqual(["关闭预览", "退出全屏"]);
    (controls[1] as HTMLElement).click();
    expect(p.setFullscreen).toHaveBeenCalledWith(false);
  });
});

describe("分栏", () => {
  const two = () => fake({
    tabs: [{ path: "/w/a.txt", name: "a.txt" }, { path: "/w/b.txt", name: "b.txt" }],
    activePath: "/w/b.txt",
    splitPath: "/w/b.txt",
  });

  it("分栏时两个 pane，分栏侧带 data-split", () => {
    render(<FilePreviewSurface preview={two()} />);
    const panes = [...document.querySelectorAll(".preview-pane")];
    expect(panes).toHaveLength(2);
    expect(panes.filter((x) => x.hasAttribute("data-split"))).toHaveLength(1);
    // 主 pane 收「其余标签」，分栏侧是 b.txt
    const paths = [...document.querySelectorAll(".preview-path")].map((n) => n.textContent);
    expect(paths).toEqual(["/w/a.txt", "/w/b.txt"]);
  });

  it("单标签时 pane 一个、分栏钮禁用", () => {
    render(<FilePreviewSurface preview={fake()} />);
    expect(document.querySelectorAll(".preview-pane")).toHaveLength(1);
    expect((screen.getByRole("button", { name: "分栏（同屏双预览）" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("分栏钮回调 toggleSplit", () => {
    const p = fake({ tabs: [{ path: "/w/a.txt", name: "a.txt" }, { path: "/w/b.txt", name: "b.txt" }] });
    render(<FilePreviewSurface preview={p} />);
    screen.getByRole("button", { name: "分栏（同屏双预览）" }).click();
    expect(p.toggleSplit).toHaveBeenCalled();
  });
});
