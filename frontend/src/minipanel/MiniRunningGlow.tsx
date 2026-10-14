// 迷你面板「会话进行中」的动效，两种形态由调用方选（命令中心的「更换进行中动效」）：
// · ring —— 一圈沿面板边缘滚动的高光（conic 亮弧 + 环形遮罩）；
// · line —— 顶边一条 1px 的辉光带左右往复（Raycast 的 loaderGlow 形态）。
// 形态参数全在 theme.css 的两个类上，这里只画。ring 那版的光晕层必须是**真实子元素**：
// 它的 blur 只能挂在没有遮罩的包裹层上，否则会被环遮罩裁没（theme.css 的说明、PITFALLS §1.23）。
// 「在跑」的判断与选哪一版都归调用方（MiniPanelApp：store.sessions[].running + prefs）。

import type { MiniRunningGlowStyle } from "../prefs";

export function MiniRunningGlow({ variant }: { variant: MiniRunningGlowStyle }) {
  if (variant === "line") return <div className="mini-running-line" aria-hidden="true" />;
  return (
    <div className="mini-running-glow" aria-hidden="true">
      <span className="mini-running-glow-halo" />
    </div>
  );
}
