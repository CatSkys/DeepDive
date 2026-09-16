// 工作树分区的渲染规格：列表来自壳跑 git；新建按 `worktree add -b` 走；删除要二次确认；
// 主工作树不给删也不给注册；缺省目录落在仓库同级。
// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { worktreeList, worktreeAdd, worktreeRemove, revealPath, createWorkspace, confirmDialog } = vi.hoisted(() => ({
  worktreeList: vi.fn(), worktreeAdd: vi.fn(), worktreeRemove: vi.fn(),
  revealPath: vi.fn(), createWorkspace: vi.fn(), confirmDialog: vi.fn(),
}));
const workspaces = [{ workspaceId: "w1", path: "/repo/proj", title: "proj", sessionIds: [], createdAt: "", updatedAt: "" }];
vi.mock("../host", () => ({ worktreeList, worktreeAdd, worktreeRemove, revealPath }));
vi.mock("../store", () => ({ useStore: () => ({ workspaces, createWorkspace }) }));
vi.mock("../components/DialogHost", () => ({ confirmDialog }));
// i18n 的 useT 走 store（这里没有 provider），且**必须返回稳定引用**：真实现按语言缓存
// 闭包（i18n.ts 的 tFuncCache，注释里写明"放依赖不引发每渲染重跑"），mock 若不稳，
// 组件里 useCallback([t]) 的 effect 会每渲染重跑，测出假问题。
const tFunc = vi.hoisted(() => ({
  lang: "zh" as const,
  t: (s: string) => s,
  tt: (zh: string, _en: string, vars?: Record<string, string | number>) => {
    let out = zh;
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
    return out;
  },
}));
vi.mock("../i18n", () => ({ useT: () => tFunc }));

import { WorktreeSection } from "../worktree/WorktreeSection";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function rows() {
  return [
    { path: "/repo/proj", head: "86ae71d", branch: "main", detached: false, bare: false, prunable: false, locked: false },
    { path: "/repo/proj-wt", head: "aaaa111", branch: "worktree-1", detached: false, bare: false, prunable: false, locked: false },
  ];
}

describe("工作树分区", () => {
  it("列出 git 的工作树，主工作树标出来且不给删/注册", async () => {
    worktreeList.mockResolvedValue({ ok: true, worktrees: rows() });
    const { container } = render(<WorktreeSection />);
    await waitFor(() => expect(container.textContent).toContain("/repo/proj-wt"));
    expect(container.textContent).toContain("主工作树");
    expect(container.textContent).toContain("worktree-1");
    // 主工作树那行只有「在 Finder 中显示」：取"含主工作树路径、不含另一条路径"的最外层元素
    const hits = [...container.querySelectorAll("div")].filter(
      (d) => d.textContent?.includes("/repo/proj") && !d.textContent?.includes("proj-wt") && d.textContent?.includes("Finder"),
    );
    const mainRow = hits[hits.length - 1]!;
    expect(mainRow.textContent).toContain("在 Finder 中显示");
    expect(mainRow.textContent).not.toContain("删除");
    expect(mainRow.textContent).not.toContain("注册为工作区");
  });

  it("新建走 worktree add -b <branch> <path>（默认目录在仓库同级）", async () => {
    worktreeList.mockResolvedValue({ ok: true, worktrees: rows() });
    worktreeAdd.mockResolvedValue({ ok: true, output: "Preparing worktree" });
    const { getByPlaceholderText, getByText, container } = render(<WorktreeSection />);
    // 等列表落地（busy 期间创建钮是禁用的）
    await waitFor(() => expect(container.textContent).toContain("/repo/proj-wt"));
    fireEvent.change(getByPlaceholderText("分支名"), { target: { value: "feat/x" } });
    fireEvent.change(getByPlaceholderText("目录（绝对路径）"), { target: { value: "/repo/proj-feat-x" } });
    getByText("创建").click();
    await waitFor(() => expect(worktreeAdd).toHaveBeenCalledWith("/repo/proj", "feat/x", "/repo/proj-feat-x"));
  });

  it("删除要确认；确认后按 remove 走并把 git 的拒绝原文显示出来", async () => {
    worktreeList.mockResolvedValue({ ok: true, worktrees: rows() });
    worktreeRemove.mockResolvedValue({ ok: false, error: "fatal: contains modified or untracked files" });
    confirmDialog.mockResolvedValue(true);
    const { container, getAllByText } = render(<WorktreeSection />);
    await waitFor(() => expect(container.textContent).toContain("/repo/proj-wt"));
    getAllByText("删除")[0]!.click();
    await waitFor(() => expect(worktreeRemove).toHaveBeenCalledWith("/repo/proj", "/repo/proj-wt"));
    await waitFor(() => expect(container.textContent).toContain("contains modified or untracked files"));
  });

  it("取消确认就不动 git", async () => {
    worktreeList.mockResolvedValue({ ok: true, worktrees: rows() });
    confirmDialog.mockResolvedValue(false);
    const { container, getAllByText } = render(<WorktreeSection />);
    await waitFor(() => expect(container.textContent).toContain("/repo/proj-wt"));
    getAllByText("删除")[0]!.click();
    await waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    expect(worktreeRemove).not.toHaveBeenCalled();
  });

  it("注册为工作区调 store.createWorkspace（工作树路径）", async () => {
    worktreeList.mockResolvedValue({ ok: true, worktrees: rows() });
    createWorkspace.mockResolvedValue({ workspaceId: "w2" });
    const { container, getByText } = render(<WorktreeSection />);
    await waitFor(() => expect(container.textContent).toContain("/repo/proj-wt"));
    getByText("注册为工作区").click();
    await waitFor(() => expect(createWorkspace).toHaveBeenCalledWith("/repo/proj-wt"));
  });

  it("不是 git 仓库时把壳给的错误显示出来", async () => {
    worktreeList.mockResolvedValue({ ok: false, worktrees: [], error: "fatal: not a git repository" });
    const { container } = render(<WorktreeSection />);
    await waitFor(() => expect(container.textContent).toContain("not a git repository"));
  });
});
