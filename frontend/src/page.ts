// 这一份 SPA 的宿主页判定：壳按 URL 的片段/参数选一页挂载（main.tsx）。
// **「快捷会话」空间只属于悬浮面板那条线**（迷你面板页与它的命令中心卡）——主窗不认它
// 与其会话（用户 2026-10-14：「悬浮快捷会话不在主面板中显示」）。store 按这一份决定
// 空间与会话列表里有没有快捷空间；判据本体在 store/pageVisibility.ts。
// 写成函数而不是常量：单测默认跑在 node 环境（vitest 默认 environment），导入期读
// window 会让**任何**间接 import 到这里的测试文件整片炸（2026-10-14 实测）。
// 叠加层（?composer=）与悬浮注释（?tooltip=）在 main.tsx 就地判定——它们不读空间面。

/** 迷你面板页：壳 QuickPanelWindow 载 `#/mini`。 */
export function isMiniPanelPage(): boolean {
  return window.location.hash === "#/mini";
}

/** 命令中心卡的宿主页：壳 second webview 载 `?minicc=1`（不带 fragment）。 */
export function isMiniCardPage(): boolean {
  return new URLSearchParams(window.location.search).get("minicc") === "1";
}

/** 悬浮面板那条线：#/mini 面板页 + ?minicc=1 命令中心卡（两块 webview，同一份规则）。 */
export function isPanelPage(): boolean {
  return isMiniPanelPage() || isMiniCardPage();
}
