// 迷你面板「会话进行中」的整面板辉光：三层同款内辉光错拍循环，盖在面板内容之上、
// 不接事件——视觉上像一圈圈往里推的光。只管画这一件事；"在跑"的判断归调用方
// （MiniPanelApp 按 store.sessions[].running 决定挂不挂它），周期引 --loop-breathe
// 与状态点呼吸同拍（UI-SPEC §1.7）。

export function MiniRunningGlow() {
  return (
    <div className="mini-running-glow" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}
