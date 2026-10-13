// 窗口焦点 → `html[data-window-blur]`：本窗口不是 key 窗口时置上这个标记。
// 唯一的消费者是输入胶囊的失焦态（theme.css 的 `.composer` 段：内容压到 40%、
// 胶囊自己的底与玻璃不动）。不管别的"失焦要变暗"的东西——那类各自有 hover/状态
// 语义，别从这个标记上再挂第二件事。
//
// 用文档级的 focus/blur（WKWebView 的文档焦点与 NSWindow 的 key 状态同源：切到别的
// app 或本应用别的窗口时文档收 blur），不为此新开壳侧消息通道。
// 接线：main.tsx 的三个装配分支各调一次（叠加层/迷你面板/主窗；卡那一页没有输入框）。

/** 挂载时先按现状对一次：初始焦点状态不会有事件补发，页面在后台打开时得自己认出来。 */
function apply(blurred: boolean): void {
  if (blurred) document.documentElement.dataset.windowBlur = "";
  else delete document.documentElement.dataset.windowBlur;
}

export function installWindowFocus(): void {
  apply(!document.hasFocus());
  window.addEventListener("blur", () => apply(true));
  window.addEventListener("focus", () => apply(false));
}
