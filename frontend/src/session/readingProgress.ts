// 会话阅读进度（0–1）的一条 DOM 通道：会话页写，侧栏选中会话行的灰底读。
//
// 为什么走根元素的 --session-read 而不是 store：读数随滚动一直在变，进 React 会把
// 整条会话流卷进重渲染（同一考量见 SessionView 的 syncFadeRamp）。灰底本体在
// theme.css 的 .row-read，观感与浏览器标签胶囊的阅读进度（.panel-browser-tab-read）同款。

/** 已发布的读数：同一个值不重写根元素的样式（见 publishReadingProgress）。 */
let published = -1;

/** 视口在滚动区里的位置：顶部 0、底部 1。整段都看得见（滚不动）时没有"读到哪了"
 *  可言，给 0——空会话与短会话不该挂一条满灰底。
 *  按百分之一位取整：滚动每帧都在变，而根元素上的自定义属性一变，可见树就要重算
 *  样式；百分之一的步长把一次滚动的写入压到个位数（参考实现同一考量）。 */
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
  document.documentElement.style.setProperty("--session-read", String(fraction));
}
