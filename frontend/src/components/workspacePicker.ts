// ＋新建项目的唯一入口（侧栏项目行与 Hero 项目菜单共用）：壳内走原生目录
// 选择器（选定后壳推 workspacePicked → store.createWorkspace 接管）；纯
// 浏览器环境退化为手输绝对路径。文案经参数注入（本文件不挂 i18n，避免
// store→i18n 之外的循环依赖面扩大）。
import { sendToShell } from "../host";

export function pickNewWorkspace(hasShell: boolean, promptTitle: string, create: (path: string) => void): void {
  if (hasShell) {
    sendToShell({ type: "pick-workspace" });
    return;
  }
  const path = prompt(promptTitle);
  if (path && path.trim()) create(path.trim());
}
