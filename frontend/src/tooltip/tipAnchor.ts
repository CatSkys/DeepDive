// 壳内悬浮注释的**锚点上报**：注释不在页里画，而是把"挂在哪个元素、什么文案、要哪一侧"
// 推给壳，由壳的独立 Tooltip 窗口（原生液态玻璃 + 那一页 webview 里的注释本体）出现在
// 锚点旁边。管上报，不管渲染——注释长什么样归 components/Tooltip.tsx 的 TooltipChip。
//
// 为什么不在页里画：注释的材质是**系统液态玻璃**，而原生玻璃只能垫在整块 webview 之下，
// 糊不到同一份文档里的内容（PITFALLS §4.38）。注释因此与命令中心卡同一条架构——
// 要原生材质就得连内容一起搬进自己的 webview，窗口才是宿主。
//
// 几何口径与 `mini-cc-frame` / `composer-pill` 一致：CSS 视口坐标（y 向下）、间距按页面
// 这一侧的值报来（壳里不写第二份，翻转与夹取也由壳按屏幕算）。
import { displayKeyCaps } from "../keybinds";
import { sendRects } from "../host";
import { hasRectChannel } from "../platform";

/** 注释要浮在锚点哪一侧（`data-tip-pos`；缺省上方）。 */
export type TipSide = "top" | "bottom" | "left" | "right";

/** 注释与锚点之间的间距（页内那份自己落位时同样吃这个值）。 */
export const TIP_GAP = 8;

export function sideOf(el: HTMLElement): TipSide {
  const v = el.dataset.tipPos;
  return v === "bottom" || v === "left" || v === "right" ? v : "top";
}

/** 把一条注释的锚点推给壳（`tooltip-show`）。文案与键帽一并带上——窗口那一页只渲染，
 *  不认 data-tip（它没有触发元素）。 */
export function showTip(el: HTMLElement): void {
  if (!hasRectChannel()) return;
  const r = el.getBoundingClientRect();
  sendRects({
    type: "tooltip-show",
    text: el.dataset.tip ?? "",
    caps: displayKeyCaps(el.dataset.tipKeys ?? ""),
    side: sideOf(el),
    gap: TIP_GAP,
    anchor: { x: r.left, y: r.top, w: r.width, h: r.height },
  });
}

/** 收起注释（`tooltip-hide`）。壳侧收起自带 0.15s 离场，页里不必再等。 */
export function hideTip(): void {
  if (!hasRectChannel()) return;
  sendRects({ type: "tooltip-hide" });
}
