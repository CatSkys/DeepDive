// 会话阅读进度（0–1）的一条 DOM 通道：会话页写，侧栏选中会话行的灰底读。
//
// 为什么不进 store：读数随滚动一直在变，进 React 会把整条会话流卷进重渲染（同一考量
// 见 SessionView 的 syncFadeRamp）。
// 为什么写到**侧栏容器**而不是根元素：自定义属性一变，用到它的子树就要重算样式——写根
// 元素等于每帧把整棵可见树重算一遍（快速滚动时最明显，用户 2026-10-09 报"没有 Search
// 那么丝滑"），写侧栏容器就只有那几十行。目标由 SidebarSessionList 挂 ref 时登记；
// 没人登记就等于没人看，不写。灰底本体在 theme.css 的 .row-read（transform: scaleX）。

const READ_VAR = "--session-read";

/** 已发布的读数：同一个值不重写（见 publishReadingProgress）。 */
let published = -1;
/** 发布目标：侧栏会话列表容器。 */
let target: HTMLElement | null = null;

/** 登记/注销发布目标（侧栏挂载、卸载各一次）。 */
export function setReadingTarget(el: HTMLElement | null): void {
  target = el;
  // 登记时补一次现值：切空间/重挂侧栏后，不必等下一次滚动就对得上
  if (el && published >= 0) el.style.setProperty(READ_VAR, String(published));
}

/** 视口在滚动区里的位置：顶部 0、底部 1。整段都看得见（滚不动）时没有"读到哪了"
 *  可言，给 0——空会话与短会话不该挂一条满灰底。
 *  按百分之一位取整：读数随滚动一直在变，步长粗一档就少几次样式重算（参考实现同一考量）。 */
export function readingProgressOf(el: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): number {
  const ceiling = el.scrollHeight - el.clientHeight;
  if (ceiling <= 0) return 0;
  return Math.round(Math.min(1, Math.max(0, el.scrollTop / ceiling)) * 100) / 100;
}

/** 把读数发布给侧栏（同一个值不重写）。 */
export function publishReadingProgress(fraction: number): void {
  if (fraction === published) return;
  published = fraction;
  target?.style.setProperty(READ_VAR, String(fraction));
}
