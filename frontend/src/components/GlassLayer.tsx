/**
 * 液态玻璃材质层（浮面「内容与材质分离」的那一层）。
 *
 * 宿主（浮面本身）只留几何 + 外投影 + 三个参数，材质全在这一层上：宿主写
 * `--glass-tint` / `--glass-inset` / `--glass-blur`（见 `theme.css` 的
 * `[data-liquid-glass-backdrop]`、UI-SPEC §1.4bis 表面层级表），本组件不再有别的职责。
 *
 * 三条硬约束（破了就是"这块浮面看着不对"）：
 * 1. 宿主必须**自己定位、且带显式 z-index**（= 栈上下文）。本层用负 z 垫在内容之后
 *    （照参考实现 Raycast 的 `chat-panel-glass`），内容因此不需要任何定位或抬升；
 *    但负 z 只在栈上下文里才被关在宿主内部，否则会逃到宿主祖先的背景底下（整块消失）。
 * 2. 宿主不许有自己的底色，也不许挂 backdrop-filter：底色画在材质**之上**，垫一层就是把
 *    玻璃盖死（出来是一块平灰，2026-10-14 用户报"不像玻璃"就是这个）；磨砂叠在材质上会发灰。
 *    宿主只留圆角、内距、描边与外投影。
 * 3. 要糊的内容必须与宿主在同一个 backdrop root 里（宿主与祖先别挂 backdrop-filter /
 *    filter / opacity<1 / mask / clip-path / contain:paint / isolation），否则回退档的
 *    磨砂取不到面外内容，只剩底色 = 一块实心（PITFALLS §1.20）。
 */
export function GlassLayer() {
  return <div data-liquid-glass-backdrop aria-hidden="true" />;
}
