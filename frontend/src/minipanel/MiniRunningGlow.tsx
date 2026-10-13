// 迷你面板「会话进行中」的辉光：一圈沿边缘滚动的高光（亮弧在环形遮罩里转，
// 参数全在 theme.css 的 .mini-running-glow 上）。只管画这一件事；"在跑"的判断
// 归调用方（MiniPanelApp 按 store.sessions[].running 决定挂不挂它）。

export function MiniRunningGlow() {
  return <div className="mini-running-glow" aria-hidden="true" />;
}
