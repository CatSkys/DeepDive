// 迷你面板「会话进行中」的辉光：**只有最上方一条**沿线滑动的光——三个同款光带
// （细带 + 拖尾）错拍循环，一条滑出去时下一条已在路上，接成不断流。只管画这一件事；
// "在跑"的判断归调用方（MiniPanelApp 按 store.sessions[].running 决定挂不挂它），
// 扫动周期在 theme.css 里由 --loop-breathe 推出（与状态点呼吸同族）。

export function MiniRunningGlow() {
  return (
    <div className="mini-running-glow" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}
