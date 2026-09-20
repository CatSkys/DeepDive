// 建项目空间（= 工作区）的唯一实现：设置页「新建项目」弹窗与新手引导卡共用。
//
// 分工：壳负责自动建目录（未显式选目录时建在 ~/Documents/DeepDive Projects/<名字>）
// 与写项目指令（AGENTS.md，已存在则不动），引擎负责注册工作区，本函数只做编排与
// 名称对齐（目录末级名 ≠ 项目名时改名）。与 store 的耦合靠调用方传入两个动作，
// 这样纯函数部分可测、也不把 store 依赖引进非组件模块。
import { api } from "../api";
import { prepareWorkspace } from "../host";
import { tt } from "../i18n";
import { setWsIcon } from "../wsIcons";

export interface CreateProjectArgs {
  name: string;
  /** 已选目录；缺省由壳自动建。 */
  path?: string;
  instructions?: string;
  /** 侧栏图标 glyph（本地 localStorage，非引擎数据）。 */
  glyph?: string;
  /** 没有壳桥（浏览器预览）时：带项目指令必须报错（写不了 AGENTS.md），无指令可继续。 */
  hasShell: boolean;
}

export interface CreateProjectActions {
  createWorkspace: (path: string) => Promise<{ workspaceId: string | null; error?: string }>;
  refresh: () => Promise<void>;
}

export interface CreateProjectResult {
  workspaceId?: string;
  path?: string;
  /** 失败原因（人读，已本地化）；成功时 undefined。 */
  error?: string;
}

export async function createProject(
  args: CreateProjectArgs,
  actions: CreateProjectActions,
): Promise<CreateProjectResult> {
  const name = args.name.trim();
  if (!name) return { error: tt("请填写项目名称", "Enter a project name") };
  if (!args.hasShell && args.instructions?.trim()) {
    return { error: tt("写入项目指令需要桌面应用。", "Writing project instructions requires the desktop app.") };
  }

  let target = args.path?.trim() ?? "";
  if (args.hasShell) {
    const prep = await prepareWorkspace({
      name,
      ...(target ? { path: target } : {}),
      ...(args.instructions?.trim() ? { instructions: args.instructions.trim() } : {}),
    });
    if (prep.error || !prep.path) {
      return { error: prep.error ?? tt("创建项目失败：壳未响应。", "Create project failed: the shell did not respond.") };
    }
    target = prep.path;
  }
  if (!target) return { error: tt("请选择项目文件夹", "Choose a project folder") };

  try {
    const res = await actions.createWorkspace(target);
    if (res.error || !res.workspaceId) {
      return { error: tt("创建项目失败：{m}", "Create project failed: {m}", { m: res.error ?? "unknown" }) };
    }
    if (args.glyph) setWsIcon(res.workspaceId, args.glyph);
    // 目录末级名与项目名不同才改名（一致时引擎给的标题就是它）。
    const base = target.split("/").filter(Boolean).pop() ?? "";
    if (base !== name) {
      try {
        await api.workspaceRename({ workspaceId: res.workspaceId, title: name });
        await actions.refresh();
      } catch { /* 引擎可能对重名标题去重改名，落库失败不挡创建 */ }
    }
    return { workspaceId: res.workspaceId, path: target };
  } catch (err) {
    return { error: tt("创建项目失败：{m}", "Create project failed: {m}", { m: (err as Error).message }) };
  }
}
