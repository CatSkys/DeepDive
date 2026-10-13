/**
 * 液态玻璃材质层（浮面的材质与内容分离的那一层）。
 *
 * 宿主（浮面本身）只留几何 + 外投影 + 三个参数，底色、内缘高光、磨砂/系统材质全在
 * 这一层上：宿主写 `--glass-tint` / `--glass-inset` / `--glass-blur`（见 `theme.css`
 * 的 `[data-liquid-glass-backdrop]` 与 UI-SPEC §1.4bis 表面层级表），本组件不再有
 * 别的职责。
 *
 * 两条使用约束（都是硬约束，破了就是"这块浮面看着不对"）：
 * 1. 必须是宿主的**第一个子元素**——内容靠 `[data-liquid-glass-backdrop] ~ *` 那条
 *    兄弟规则抬到它上面，排在后面前面的内容会被它盖住。
 * 2. 宿主**及其祖先**不许有 backdrop-root 触发器（backdrop-filter / filter /
 *    opacity<1 / mask / clip-path / transform / contain:paint / isolation），
 *    否则采样被锁进宿主内部、只剩自己的底色＝一块实心（PITFALLS §1.20）。
 */
export function GlassLayer() {
  return <div data-liquid-glass-backdrop aria-hidden="true" />;
}
