// 迷你面板「会话进行中」的辉光：一圈沿边缘滚动的高光（亮弧在环形遮罩里转，
// 参数全在 theme.css 的 .mini-running-glow 上）。光晕那层必须是**真实子元素**：
// 它的 blur 只能挂在没有遮罩的包裹层上，缩进 ::before 会被容器/自身的环遮罩裁没
// （见 theme.css 那块的说明与 PITFALLS §1.23）。只管画这一件事；"在跑"的判断
// 归调用方（MiniPanelApp 按 store.sessions[].running 决定挂不挂它）。

export function MiniRunningGlow() {
  return (
    <div className="mini-running-glow" aria-hidden="true">
      <span className="mini-running-glow-halo" />
    </div>
  );
}
