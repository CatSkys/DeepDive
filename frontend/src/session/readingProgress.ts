// 会话阅读进度（0–1）的一条 DOM 通道：会话页写，侧栏选中会话行的灰底读。
//
// 为什么不进 store：读数随滚动一直在变，进 React 会把整条会话流卷进重渲染（同一考量
// 见 SessionView 的 syncFadeRamp）。
// 为什么写到**灰底自己**（不是根元素、也不是侧栏容器）：自定义属性一变，用到它的子树就
// 要重算样式——写根元素等于每帧重算整棵可见树，写侧栏容器是那几十行，写在读者身上只有
// 一个元素。灰底本体在 theme.css 的 .row-read（transform: scaleX）。
//
// 为什么自己按帧逼近、不用 CSS transition：transition 是"值一变就从当前值重新起跑"，而
// 滚动事件的节奏跟它对不上——走一小段又被新读数拽回去，快速滚动时就是一帧一停的抖动
// （用户 2026-10-09 报"鬼畜抖动"）。这里每帧最多写一次、且只朝目标走：快滚时它跟着走，
// 撒手时拿最后一点差距收尾——参考实现 Search 的弹性正是这个效果。

const READ_VAR = "--session-read";
/** 每帧吃掉差距的份额：时间常数约三帧，收尾快慢与参考实现的 .easeOut(0.15) 同量级。 */
const FOLLOW = 0.25;
/** 差得比这还小就当到了：指数逼近没有终点，得有个收尾，否则永远挂着一帧。 */
const SETTLED = 0.002;

/** 灰底本体（唯一读者）：只有选中的那一行有，换选中行时由 ref 重挂。 */
let bar: HTMLElement | null = null;
/** 已经落到界面上的读数。 */
let shown = 0;
/** 会话页最新报的读数。 */
let target = 0;
/** 逼近帧的句柄（null = 没在跑）。 */
let frame: number | null = null;

function write(): void {
  bar?.style.setProperty(READ_VAR, shown.toFixed(3));
}

function step(): void {
  const diff = target - shown;
  if (Math.abs(diff) < SETTLED) {
    shown = target;
    frame = null;
  } else {
    shown += diff * FOLLOW;
    frame = requestAnimationFrame(step);
  }
  write();
}

/** 登记/注销灰底本体（侧栏挂上、卸下选中行各一次）。登记时补一次现值：换会话/重排
 *  之后不必等下一次滚动就对得上。 */
export function setReadingBar(el: HTMLElement | null): void {
  bar = el;
  write();
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

/** 会话页滚动时报读数：逐帧收敛过去（见文件头）。同一个读数不重排帧。 */
export function publishReadingProgress(fraction: number): void {
  if (fraction === target) return;
  target = fraction;
  if (frame === null) frame = requestAnimationFrame(step);
}

/** 挂载/换会话时直接落位：新会话的灰底不该从上一个会话的读数扫过来。 */
export function placeReadingProgress(fraction: number): void {
  if (frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
  target = fraction;
  shown = fraction;
  write();
}
