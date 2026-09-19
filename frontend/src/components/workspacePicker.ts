// ＋新建项目入口（侧栏项目行与 Hero 项目菜单共用）：打开 NewProjectDialog
// 表单弹窗（名称/图标/目录/项目指令）。本文件另管 pick-workspace 桥事件的
// 路由：弹窗开着时，原生目录选择器的结果（workspacePicked 回推）归弹窗；
// 弹窗没开时回落 App 的旧路径（选定即注册工作空间）。文案经参数注入（本
// 文件不挂 i18n，避免 store→i18n 之外的循环依赖面扩大）。
import { sendToShell } from "../host";

type PickSink = (path: string) => void;
let sink: PickSink | null = null;

/** 登记目录选择结果的路由目标（弹窗挂载时）——只登记，不触发选择器。 */
export function setWorkspacePickSink(s: PickSink | null): void {
  sink = s;
}

/** 调起壳原生「选择目录」面板（工作区文件夹按钮点击时）；选定后经
 *  routeWorkspacePicked 进 sink。 */
export function beginWorkspacePick(s: PickSink): void {
  sink = s;
  sendToShell({ type: "pick-workspace" });
}

/** 弹窗卸载时清 sink：此后 workspacePicked 回落 App 旧路径，不悬挂。 */
export function endWorkspacePick(): void {
  sink = null;
}

/** App 的 workspacePicked 入口先走这里：返回 true 表示已被弹窗消费。 */
export function routeWorkspacePicked(path: string): boolean {
  if (!sink) return false;
  const s = sink;
  sink = null;
  s(path);
  return true;
}
