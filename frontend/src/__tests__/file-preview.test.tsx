// 文件预览窗口的渲染网眼（R-001 同款渲染层测试）：little 浮窗的蒙版/控制簇、
// 全屏面的装配、标签切换与关闭的接线。@vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FilePreviewOverlay, FilePreviewSurface, PreviewPageHeader } from "../components/preview/FilePreviewWindow";
import type { FilePreview } from "../components/preview/useFilePreview";
import { installHostBridge } from "../host";

beforeAll(() => {
  // 预览体一律拉 /api/file：jsdom 里没有桥，给固定文本内容（代码/纯文本渲染器
  // 要按行渲染，才能断言行号与高亮）
  // jsdom 不实现 scrollIntoView（跳行落点要用），补空实现
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => "const a = 1\nconst b = 2",
  })));
});

afterEach(cleanup);

function fake(over: Partial<FilePreview> = {}): FilePreview {
  return {
    tabs: [{ path: "/w/a.txt", name: "a.txt" }],
    activePath: "/w/a.txt",
    fullscreen: false,
    mode: "file",
    open: vi.fn(),
    close: vi.fn(),
    closeAll: vi.fn(),
    setActive: vi.fn(),
    setFullscreen: vi.fn(),
    setRenderer: vi.fn(),
    toggleWrap: vi.fn(),
    setPage: vi.fn(),
    setMode: vi.fn(),
    openReview: vi.fn(),
    ...over,
  };
}

const controlLabels = () =>
  [...document.querySelectorAll(".preview-control")].map((b) => b.getAttribute("aria-label"));

/** 全屏态真实装配：页头 + 面（SessionView 就是这么挂的）。视图控制簇只在
 *  页头出现——面里再挂一条标签条会把同一套控件画两遍。 */
const renderPage = (p: FilePreview) =>
  render(
    <>
      <PreviewPageHeader preview={p} />
      <FilePreviewSurface preview={p} wsPath="/w" />
    </>,
  );

describe("little 浮窗", () => {
  it("挂蒙版 + 浮窗，控制簇四颗（关闭/全屏/默认应用打开/Finder），标签条给出文件名", () => {
    render(<FilePreviewOverlay preview={fake()} wsPath="/w" />);
    expect(document.querySelector(".preview-veil")).not.toBeNull();
    expect(document.querySelector(".preview-window")).not.toBeNull();
    expect(screen.getByRole("tab").textContent).toContain("a.txt");
    expect(controlLabels()).toEqual(["关闭预览", "全屏预览", "默认应用打开", "在 Finder 中显示"]);
    // 窗内不再有路径行 / 分栏钮
    expect(document.querySelector(".preview-path, .preview-toolbar, .preview-pane")).toBeNull();
  });

  it("关闭钮与蒙版空白处都关掉预览；浮窗内的按下不误关", () => {
    const p = fake();
    render(<FilePreviewOverlay preview={p} wsPath="/w" />);
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
    render(<FilePreviewOverlay preview={p} wsPath="/w" />);
    (document.querySelector(".preview-tab-x") as HTMLElement).click();
    expect(p.close).toHaveBeenCalledWith("/w/a.txt");
    expect(p.closeAll).not.toHaveBeenCalled();
  });

  it("多标签时切活动标签走 setActive", () => {
    const p = fake({
      tabs: [{ path: "/w/a.txt", name: "a.txt" }, { path: "/w/b.txt", name: "b.txt" }],
      activePath: "/w/a.txt",
    });
    render(<FilePreviewOverlay preview={p} wsPath="/w" />);
    expect(document.querySelectorAll(".preview-tab")).toHaveLength(2);
    screen.getAllByRole("tab")[1].click();
    expect(p.setActive).toHaveBeenCalledWith("/w/b.txt");
  });
});

describe("渲染器与换行", () => {
  it("代码文件默认走代码渲染器：行号 + 语言标签 + hljs 高亮", async () => {
    const p = fake({ tabs: [{ path: "/w/a.ts", name: "a.ts" }], activePath: "/w/a.ts" });
    render(<FilePreviewSurface preview={p} wsPath="/w" />);
    await waitFor(() => expect(document.querySelector(".cb.preview-code")).not.toBeNull());
    expect(document.querySelectorAll(".cbRow")).toHaveLength(2);
    expect(document.querySelector(".cbLang")?.textContent).toBe("typescript");
    expect(document.querySelector(".hljs .hljs-keyword")).not.toBeNull();
  });

  it("显式选纯文本时走无卡片行号面，且换行态落在 data-wrap 上", async () => {
    const p = fake({
      tabs: [{ path: "/w/a.ts", name: "a.ts", renderer: "text", wrap: true }],
      activePath: "/w/a.ts",
    });
    render(<FilePreviewSurface preview={p} wsPath="/w" />);
    await waitFor(() => expect(document.querySelector(".preview-text")).not.toBeNull());
    expect(document.querySelector(".preview-text")?.hasAttribute("data-wrap")).toBe(true);
    expect(document.querySelectorAll(".preview-text .cbRow")).toHaveLength(2);
  });

  it("跳行目标行带 data-target（Markdown 链接 :行号 → 预览落点）", async () => {
    const p = fake({
      tabs: [{ path: "/w/a.ts", name: "a.ts", renderer: "text", line: 2 }],
      activePath: "/w/a.ts",
    });
    render(<FilePreviewSurface preview={p} wsPath="/w" />);
    await waitFor(() => expect(document.querySelector(".cbRow[data-target]")).not.toBeNull());
    expect(document.querySelectorAll(".cbRow[data-target]")).toHaveLength(1);
  });

  it("换行开关只对 code/text 出现，点击回调 toggleWrap", () => {
    const p = fake({ tabs: [{ path: "/w/a.md", name: "a.md", renderer: "markdown" }], activePath: "/w/a.md" });
    const { unmount } = renderPage(p);
    expect(screen.queryByRole("button", { name: "折行" })).toBeNull();
    unmount();
    const q = fake({ tabs: [{ path: "/w/a.md", name: "a.md", renderer: "text" }], activePath: "/w/a.md" });
    renderPage(q);
    fireEvent.click(screen.getByRole("button", { name: "折行" }));
    expect(q.toggleWrap).toHaveBeenCalled();
  });

  it("渲染器下拉列出候选、当前项打勾，选择回调 setRenderer", () => {
    const p = fake({ tabs: [{ path: "/w/a.md", name: "a.md" }], activePath: "/w/a.md" });
    renderPage(p);
    fireEvent.click(screen.getByRole("button", { name: "预览方式" }));
    const rows = [...document.querySelectorAll(".preview-view-item")];
    expect(rows.map((r) => r.textContent)).toEqual(["Markdown", "代码", "纯文本"]);
    expect(document.querySelectorAll(".preview-view-item .open-with-check")).toHaveLength(1);
    fireEvent.click(rows[1]!);
    expect(p.setRenderer).toHaveBeenCalledWith("code");
  });
});

describe("全屏页", () => {
  it("页头=返回钮 + 文件名作标题；面内不再挂四颗悬浮钮、也不挂蒙版", () => {
    const p = fake({ fullscreen: true, tabs: [{ path: "/w/report.md", name: "report.md" }] });
    renderPage(p);
    expect(document.querySelector(".preview-page-head .title")?.textContent).toBe("report.md");
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(p.setFullscreen).toHaveBeenCalledWith(false);
    expect(document.querySelector(".preview-surface")).not.toBeNull();
    expect(document.querySelector(".preview-veil")).toBeNull();
    expect(document.querySelectorAll(".preview-control")).toHaveLength(0);
  });

  it("面内不挂标签条：chrome 只由页头出一遍（真机上两处都贴顶会压字）", () => {
    const p = fake({ fullscreen: true, tabs: [{ path: "/w/a.md", name: "a.md" }, { path: "/w/b.md", name: "b.md" }] });
    renderPage(p);
    expect(document.querySelector(".preview-surface .preview-tabs")).toBeNull();
    expect(document.querySelectorAll(".preview-tab")).toHaveLength(0);
    // 视图控制簇与标签都在页头那一遍里：渲染器下拉、换行、打开方式各一份
    expect(document.querySelectorAll(".preview-view")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "预览方式" })).toHaveLength(1);
  });

  it("视图切换贴着标题右侧那一行（返回 / 文件名 / 视图切换同一行）", () => {
    const p = fake({ fullscreen: true, tabs: [{ path: "/w/a.svg", name: "a.svg" }] });
    renderPage(p);
    const row = document.querySelector(".preview-page-head .title-row")!;
    expect([...row.children].map((c) => c.className)).toEqual(["session-back", "title", "preview-view"]);
  });
});

describe("打开方式（分离按钮）", () => {
  const withShell = () => {
    const post = vi.fn();
    (window as unknown as { webkit?: unknown }).webkit = { messageHandlers: { deepdiveHost: { postMessage: post } } };
    installHostBridge({
      navigateToSession: () => {}, navigateToSettings: () => {},
      workspacePicked: () => {}, systemWake: () => {}, newSession: () => {}, openOnboarding: () => {},
    });
    return post;
  };
  const replyListing = async (post: ReturnType<typeof vi.fn>, apps: { id: string; name: string }[]) => {
    const listCall = post.mock.calls.map(([m]) => m as { type: string; reqId: string }).find((m) => m.type === "open-with-list")!;
    await act(async () => {
      window.__deepDiveHost!.dispatch("openWith", {
        reqId: listCall.reqId, defaultId: apps[0]!.id,
        apps: apps.map((a) => ({ ...a, icon: "data:image/png;base64," })),
      });
    });
  };

  afterEach(() => {
    delete (window as unknown as { webkit?: unknown }).webkit;
    delete (window as unknown as { __deepDiveHost?: unknown }).__deepDiveHost;
  });

  it("主钮直接用它打开（不发菜单），箭头才展开候选", async () => {
    const post = withShell();
    renderPage(fake({ fullscreen: true }));
    await replyListing(post, [{ id: "/Applications/Safari.app", name: "Safari" }]);
    post.mockClear();

    // 页头最右端是它（视图切换在标题行里，不在右端）
    const head = document.querySelector(".preview-page-head")!;
    expect(head.lastElementChild!.className).toContain("open-with");

    fireEvent.click(screen.getByRole("button", { name: "用 Safari 打开" }));
    expect(post).toHaveBeenCalledWith({ type: "open-path-with", path: "/w/a.txt", app: "/Applications/Safari.app" });
    expect(document.querySelectorAll(".open-with-item")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "打开方式" }));
    expect(document.querySelectorAll(".open-with-item")).toHaveLength(1);
  });

  it("从候选里选一个：切当前 App（主钮文案跟着变）并用它打开", async () => {
    const post = withShell();
    renderPage(fake({ fullscreen: true }));
    await replyListing(post, [{ id: "/Applications/Safari.app", name: "Safari" }, { id: "/Applications/Xcode.app", name: "Xcode" }]);

    fireEvent.click(screen.getByRole("button", { name: "打开方式" }));
    // 用 nth-of-type（按 button 数）而不是 nth-child：菜单首位是装饰性的材质层（GlassLayer），
    // nth-child 会被它顶位（2026-10-13 铺开系统玻璃时踩到）
    fireEvent.click(document.querySelector<HTMLElement>("button.open-with-item:nth-of-type(2)")!);
    expect(post).toHaveBeenCalledWith({ type: "open-path-with", path: "/w/a.txt", app: "/Applications/Xcode.app" });
    expect(screen.getByRole("button", { name: "用 Xcode 打开" })).not.toBeNull();
  });
});

describe("审查面", () => {
  const withShell = () => {
    const post = vi.fn();
    (window as unknown as { webkit?: unknown }).webkit = { messageHandlers: { deepdiveHost: { postMessage: post } } };
    installHostBridge({
      navigateToSession: () => {}, navigateToSettings: () => {},
      workspacePicked: () => {}, systemWake: () => {}, newSession: () => {}, openOnboarding: () => {},
    });
    return post;
  };
  const replyChanges = async (post: ReturnType<typeof vi.fn>, files: unknown[]) => {
    const call = post.mock.calls.map(([m]) => m as { type: string; reqId: string }).find((m) => m.type === "git-changes")!;
    await act(async () => {
      window.__deepDiveHost!.dispatch("gitChangesResult", { reqId: call.reqId, repo: true, branch: "main", files });
    });
  };

  afterEach(() => {
    delete (window as unknown as { webkit?: unknown }).webkit;
    delete (window as unknown as { __deepDiveHost?: unknown }).__deepDiveHost;
  });

  it("审查面不出文件页签，列出改动并给出 +N −M", async () => {
    const post = withShell();
    const p = fake({ mode: "review", tabs: [], activePath: null });
    render(<FilePreviewOverlay preview={p} wsPath="/w" />);
    await replyChanges(post, [{ path: "src/a.ts", kind: "modified", added: 20, removed: 4 }]);

    expect(document.querySelector(".preview-tabs")).toBeNull();
    expect(document.querySelector(".rv-file-name")!.textContent).toBe("a.ts");
    expect(document.querySelector(".rv-add")!.textContent).toBe("+20");
    expect(document.querySelector(".rv-del")!.textContent).toBe("−4");
  });

  it("审查面没有活动标签：控制簇只剩关闭与全屏", async () => {
    const post = withShell();
    render(<FilePreviewOverlay preview={fake({ mode: "review", tabs: [], activePath: null })} wsPath="/w" />);
    await replyChanges(post, []);
    expect(controlLabels()).toEqual(["关闭预览", "全屏预览"]);
  });

  it("文件面顶栏左端是切到审查面的钮，点了走 setMode", async () => {
    const p = fake();
    render(<FilePreviewOverlay preview={p} wsPath="/w" />);
    fireEvent.click(screen.getByRole("button", { name: "审查改动" }));
    expect(p.setMode).toHaveBeenCalledWith("review");
  });

  it("非 git 仓库给一句陈述，不是错误", async () => {
    const post = withShell();
    render(<FilePreviewOverlay preview={fake({ mode: "review", tabs: [], activePath: null })} wsPath="/w" />);
    const call = post.mock.calls.map(([m]) => m as { type: string; reqId: string }).find((m) => m.type === "git-changes")!;
    await act(async () => {
      window.__deepDiveHost!.dispatch("gitChangesResult", { reqId: call.reqId, repo: false, files: [] });
    });
    expect(document.querySelector(".rv-empty")!.textContent).toContain("不在 Git 仓库里");
  });
});
