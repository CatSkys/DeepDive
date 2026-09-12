// 文件预览窗口的渲染网眼（R-001 同款渲染层测试）：little 浮窗的蒙版/控制簇、
// 全屏面的装配、标签切换与关闭的接线。@vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FilePreviewOverlay, FilePreviewSurface, PreviewPageHeader } from "../components/preview/FilePreviewWindow";
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
    fullscreen: false,
    open: vi.fn(),
    close: vi.fn(),
    closeAll: vi.fn(),
    setActive: vi.fn(),
    setFullscreen: vi.fn(),
    ...over,
  };
}

const controlLabels = () =>
  [...document.querySelectorAll(".preview-control")].map((b) => b.getAttribute("aria-label"));

describe("little 浮窗", () => {
  it("挂蒙版 + 浮窗，控制簇四颗（关闭/全屏/默认应用打开/Finder），标签条给出文件名", () => {
    render(<FilePreviewOverlay preview={fake()} />);
    expect(document.querySelector(".preview-veil")).not.toBeNull();
    expect(document.querySelector(".preview-window")).not.toBeNull();
    expect(screen.getByRole("tab").textContent).toContain("a.txt");
    expect(controlLabels()).toEqual(["关闭预览", "全屏预览", "默认应用打开", "在 Finder 中显示"]);
    // 窗内不再有路径行 / 分栏钮
    expect(document.querySelector(".preview-path, .preview-toolbar, .preview-pane")).toBeNull();
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

  it("多标签时切活动标签走 setActive", () => {
    const p = fake({
      tabs: [{ path: "/w/a.txt", name: "a.txt" }, { path: "/w/b.txt", name: "b.txt" }],
      activePath: "/w/a.txt",
    });
    render(<FilePreviewOverlay preview={p} />);
    expect(document.querySelectorAll(".preview-tab")).toHaveLength(2);
    screen.getAllByRole("tab")[1].click();
    expect(p.setActive).toHaveBeenCalledWith("/w/b.txt");
  });
});

describe("全屏页", () => {
  it("页头=返回钮 + 文件名作标题；面内不再挂四颗悬浮钮、也不挂蒙版", () => {
    const p = fake({ fullscreen: true, tabs: [{ path: "/w/report.md", name: "report.md" }] });
    render(
      <>
        <PreviewPageHeader preview={p} />
        <FilePreviewSurface preview={p} />
      </>,
    );
    expect(document.querySelector(".preview-page-head .title")?.textContent).toBe("report.md");
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(p.setFullscreen).toHaveBeenCalledWith(false);
    expect(document.querySelector(".preview-surface")).not.toBeNull();
    expect(document.querySelector(".preview-veil")).toBeNull();
    expect(document.querySelectorAll(".preview-control")).toHaveLength(0);
  });
});
