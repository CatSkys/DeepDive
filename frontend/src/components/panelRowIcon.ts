// 命令面板族**行图标**的渲染参数（唯一一份）：⌘K 面板与命令中心卡的行共用，改就改这里。
//
// 为什么不是 lucide 的默认：参考面板（Raycast 动作面板）的图标是它自己那套 0 0 16 16 的
// 字形、统一 `stroke-width="1.5"`，渲成 16px 就是 1.5px 的线；lucide 是 24 格外框上默认
// `stroke-width="2"`，渲到 15px 只剩 1.25px——细一圈（参考图里 "+" 的横杠量出来正好
// 3 图像 px = 1.5 CSS px）。取 `absoluteStrokeWidth` 是为了让**渲出来的像素**与参考一致：
// 不加它的话 strokeWidth 会随 size 缩放，换个尺寸线又变了。
//
// 只对**描边型**图标有意义。填充型（`Icons.tsx` 的 `IconProjectAddOutline16`，那条路径是
// `fill="currentColor"`）与自绘字形（`IconPicker.tsx` 的 `WsGlyph`）不吃这一套，它们各自
// 已经在自己的 16 格坐标系里画好了线宽——所以别把 ROW_ICON 摊给它们。
import type { LucideProps } from "lucide-react";

export const ROW_ICON = {
  size: 15,
  strokeWidth: 1.5,
  absoluteStrokeWidth: true,
} satisfies LucideProps;
