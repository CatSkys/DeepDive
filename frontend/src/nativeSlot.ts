// 原生视图槽位：把 SPA 里标记了 `data-native-slot` 的元素的 rect 推给壳，壳据此在窗口里摆
// 原生视图（侧栏浏览器的 WKWebView 载体）。与 titlebar.ts 的 rect 表同一套思路，但两处
// 用途不同、互不影响：那条是"52px 条带里的控件放行"，这条是"页面里挖个洞交给原生视图"。
//
// 三条纪律（原生视图恒在 SPA 之上，错了就是浮层被压住/点击落到页面上）：
//   ① 槽位不可见或未挂载 → 必须显式推 visible:false，不能靠 rect 归零表达；
//   ② 任何 DOM 浮层压到槽位上（命令面板、弹窗、菜单）→ 也推 visible:false。判据用命中测试
//      （elementFromPoint 的最上层元素是否仍在槽位内），这样将来新增浮层不必逐个登记；
//   ③ 主文档开始导航（整页重载）时槽位立刻作废，壳侧要 fail-hidden 而不是沿用旧 rect。
//
// 无壳桥时全部静默：纯浏览器里走 iframe 载体，这个模块不参与。

import { inShell, sendToShell } from "./host";

/** 槽位元素的标记属性（壳只认 id，不认类名）。 */
export const NATIVE_SLOT_ATTR = "data-native-slot";

/** 槽位自己声明"这一格要不要收点击"：缩略图态给 0（点它应该展开面板，不是操作网页），
 *  展开态给 1（人直接操作网页）。原生视图恒在 SPA 之上，不收点击必须由壳让位——
 *  见 BrowserHost.setInteractive。 */
export const NATIVE_SLOT_INTERACTIVE_ATTR = "data-native-slot-interactive";

interface SlotBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PUSH_INTERVAL_MS = 300;

function readRect(el: Element): SlotBox | null {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** 命中测试：槽位中心与两个内缩点处的最上层 DOM 元素是否都还在槽位内。
 *
 *  内缩量**不能小于宿主容器的圆角**：圆角外的角区被父级 `overflow:hidden` 裁掉，探针
 *  落在那里命中的是父级本身，于是"自家圆角"会被误判成"被浮层盖住"（浏览器缩略图那格
 *  14px 圆角 + 4px 探针 → 恒判 visible:false，原生视图永远不显示）。12px 对常见圆角
 *  （control 8 / card 14 / panel 18）都安全；槽位很小时按四分之一边长收窄。 */
function unobstructed(el: Element, box: SlotBox): boolean {
  const inset = Math.max(1, Math.min(12, box.w / 4, box.h / 4));
  const probes: Array<[number, number]> = [
    [box.x + box.w / 2, box.y + box.h / 2],
    [box.x + inset, box.y + inset],
    [box.x + box.w - inset, box.y + box.h - inset],
  ];
  for (const [px, py] of probes) {
    const hit = document.elementFromPoint(px, py);
    if (hit === null || !el.contains(hit)) return false;
  }
  return true;
}

/** 上一轮推过的槽位 id：这一轮不在 DOM 里的要**显式**推 visible:false。
 *  纪律①（见文件头）说的是"未挂载也要显式表达"，而槽位元素整块卸载时（面板收起、
 *  浏览器页换成空态）循环自然漏掉它——壳会沿用旧 rect 把原生视图留在原地盖住界面。 */
let pushedIds: string[] = [];

/** 推一次所有槽位（导出供测试与立即生效用）。 */
export function pushNativeSlots(): void {
  if (!inShell()) return;
  const seen: string[] = [];
  for (const el of document.querySelectorAll(`[${NATIVE_SLOT_ATTR}]`)) {
    const id = el.getAttribute(NATIVE_SLOT_ATTR) ?? "";
    if (id === "") continue;
    const box = readRect(el);
    const visible = box !== null && unobstructed(el, box);
    const interactive = el.getAttribute(NATIVE_SLOT_INTERACTIVE_ATTR) === "1";
    sendToShell({ type: "native-slot", id, visible, interactive, rect: box ?? { x: 0, y: 0, w: 0, h: 0 } });
    seen.push(id);
  }
  for (const id of pushedIds) {
    if (seen.includes(id)) continue;
    sendToShell({ type: "native-slot", id, visible: false, interactive: false, rect: { x: 0, y: 0, w: 0, h: 0 } });
  }
  pushedIds = seen;
}

/** 隐藏全部槽位（整页导航前调用；壳侧据此立刻把原生视图收起来）。 */
export function hideNativeSlots(): void {
  if (!inShell()) return;
  for (const el of document.querySelectorAll(`[${NATIVE_SLOT_ATTR}]`)) {
    const id = el.getAttribute(NATIVE_SLOT_ATTR) ?? "";
    if (id !== "") sendToShell({ type: "native-slot", id, visible: false, interactive: false, rect: { x: 0, y: 0, w: 0, h: 0 } });
  }
}

/** 挂上推送循环：resize / 滚动 / 过渡结束 / 兜底轮询。返回拆除函数。 */
export function initNativeSlotBridge(): () => void {
  if (!inShell()) return () => { /* 纯浏览器：无壳桥，槽位机制不参与 */ };
  pushNativeSlots();
  const onScroll = () => pushNativeSlots();
  window.addEventListener("resize", pushNativeSlots);
  window.addEventListener("scroll", onScroll, { capture: true, passive: true });
  document.addEventListener("transitionend", pushNativeSlots, true);
  const timer = window.setInterval(pushNativeSlots, PUSH_INTERVAL_MS);
  window.addEventListener("pagehide", hideNativeSlots);
  return () => {
    window.removeEventListener("resize", pushNativeSlots);
    window.removeEventListener("scroll", onScroll, { capture: true });
    document.removeEventListener("transitionend", pushNativeSlots, true);
    window.clearInterval(timer);
    window.removeEventListener("pagehide", hideNativeSlots);
  };
}
