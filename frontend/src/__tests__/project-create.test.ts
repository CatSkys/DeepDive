// 建项目空间的共享实现（设置页弹窗与新手引导卡共用）：钉住编排顺序与失败分支——
// 壳负责建目录/写指令，引擎负责注册；名称与目录末级名一致时不改名。
import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareWorkspace = vi.fn();
const workspaceRename = vi.fn();
const setWsIcon = vi.fn();

vi.mock("../host", () => ({ prepareWorkspace: (...args: unknown[]) => prepareWorkspace(...args) }));
vi.mock("../api", () => ({ api: { workspaceRename: (...args: unknown[]) => workspaceRename(...args) } }));
vi.mock("../wsIcons", () => ({ setWsIcon: (...args: unknown[]) => setWsIcon(...args) }));

import { createProject } from "../components/projectCreate";

const actions = (over: Partial<{ workspaceId: string | null; error?: string }> = {}) => {
  const createWorkspace = vi.fn(async () => ({ workspaceId: "ws-1", ...over }));
  const refresh = vi.fn(async () => undefined);
  return { createWorkspace, refresh };
};

beforeEach(() => {
  prepareWorkspace.mockReset();
  workspaceRename.mockReset();
  setWsIcon.mockReset();
});

describe("createProject", () => {
  it("名称为空直接拒（不调壳）", async () => {
    const a = actions();
    expect((await createProject({ name: "  ", hasShell: true }, a)).error).toContain("项目名称");
    expect(prepareWorkspace).not.toHaveBeenCalled();
  });

  it("无壳桥且带项目指令 → 明确报错（写不了 AGENTS.md）", async () => {
    const a = actions();
    const result = await createProject({ name: "x", instructions: "规则", hasShell: false }, a);
    expect(result.error).toContain("桌面应用");
    expect(a.createWorkspace).not.toHaveBeenCalled();
  });

  it("走壳建目录 → 引擎注册；目录末级名与项目名不同才改名", async () => {
    prepareWorkspace.mockResolvedValue({ path: "/tmp/auto-name", agentsFile: true });
    const a = actions();
    const result = await createProject({ name: "我的网站", hasShell: true, glyph: "rocket" }, a);
    expect(prepareWorkspace).toHaveBeenCalledWith({ name: "我的网站" });
    expect(a.createWorkspace).toHaveBeenCalledWith("/tmp/auto-name");
    expect(workspaceRename).toHaveBeenCalledWith({ workspaceId: "ws-1", title: "我的网站" });
    expect(setWsIcon).toHaveBeenCalledWith("ws-1", "rocket");
    expect(result).toMatchObject({ workspaceId: "ws-1", path: "/tmp/auto-name" });
  });

  it("目录末级名与项目名一致 → 不改名（引擎默认标题已是它）", async () => {
    prepareWorkspace.mockResolvedValue({ path: "/tmp/我的网站", agentsFile: false });
    const a = actions();
    await createProject({ name: "我的网站", hasShell: true }, a);
    expect(workspaceRename).not.toHaveBeenCalled();
  });

  it("壳没响应 → 把壳的原因交出去，不注册", async () => {
    prepareWorkspace.mockResolvedValue({ path: "", agentsFile: false, error: "磁盘满了" });
    const a = actions();
    expect((await createProject({ name: "x", hasShell: true }, a)).error).toContain("磁盘满了");
    expect(a.createWorkspace).not.toHaveBeenCalled();
  });

  it("引擎注册失败 → 报错；成功但无 id 也算失败", async () => {
    prepareWorkspace.mockResolvedValue({ path: "/tmp/x", agentsFile: false });
    const a = actions({ workspaceId: null });
    expect((await createProject({ name: "x", hasShell: true }, a)).error).toContain("创建项目失败");
  });
});
