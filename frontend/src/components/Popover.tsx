// 浮层宿主：全站弹层的**唯一一个壳**。
//
// 它只管"壳"——把此前每个浮面各写一份的东西收成一份：portal 挂容器、量触发器与自身尺寸、
// 外点 / Esc / 窗口 resize 关闭、材质层（GlassLayer）、进出场动效与 `data-state`。
// **落位算术不在本文件**：归 `./floatingPlacement.ts`（全站唯一一份，见那里头注的三条硬约束）。
// **内容由调用方给**，本组件不认识菜单项，也不管宿主的尺寸、圆角、投影——那些在调用方
// 自己的类里（见 theme.css 的浮层配方）。
//
// 模型照参考实现（Raycast 的 popover）：一组 side/sideOffset/align/alignOffset 定位参数 +
// `position: fixed` + `transform-origin` 取"贴触发器的那一角"；开关是两态
// `data-state=open|closed`，进场 .25s 带过冲、离场 .15s（`Popover.module.css`）。
//
// 为什么 portal 到 body：会话头的触发器与设置面板的滚动容器会把行内/绝对定位的菜单裁掉，
// 挂 body 才能"浮在一切之上"（PITFALLS §1.7）。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CSSProperties, HTMLAttributes, MutableRefObject, ReactNode, RefCallback, RefObject,
} from "react";
import { createPortal } from "react-dom";
import { GlassLayer } from "./GlassLayer";
import { placeFloating } from "./floatingPlacement";
import type {
  FloatingAlign, FloatingAnchor, FloatingPlacement, FloatingSide,
} from "./floatingPlacement";
import css from "./Popover.module.css";

/** 触发器：一个元素、一条矩形，或**装元素的 ref**。
 *  收 ref 是有原因的：`anchor={triggerRef.current}` 在子组件渲染时永远是 null
 *  ——ref 要到提交阶段才赋值，于是第一帧拿不到触发器。给 ref 则在测量那一刻才解析。 */
export type PopoverAnchor =
  | HTMLElement
  | FloatingAnchor
  | RefObject<HTMLElement | null>
  | MutableRefObject<HTMLElement | null>;

const isRef = (a: PopoverAnchor | null): a is RefObject<HTMLElement | null> =>
  a !== null && !(a instanceof HTMLElement) && "current" in a;

/** 元素/ref → 元素（两条路都收的地方用；解不出来给 null）。 */
function elementOf(a: HTMLElement | RefObject<HTMLElement | null> | null): HTMLElement | null {
  if (a === null) return null;
  return a instanceof HTMLElement ? a : a.current;
}

/** 解析出"量哪条矩形"。ref 还没挂上、或组件已卸载（current 为 null）时给出 null。 */
function anchorRectOf(anchor: PopoverAnchor | null): FloatingAnchor | null {
  if (anchor === null) return null;
  const el = isRef(anchor) ? anchor.current : anchor;
  if (!el) return null;
  return el instanceof HTMLElement ? el.getBoundingClientRect() : el;
}

/** 开向与对齐用的是落位模块那两个类型，别在本文件另立一份同义词。 */
export type PopoverSide = FloatingSide;
export type PopoverAlign = FloatingAlign;

/** 离场兜底时限：与 `.box[data-state="closed"]` 的 `var(--dur-fast)` 同长。
 *  为什么除了 animationend 还要它：动画事件在"动画根本没跑"的运行时不会来
 *  （jsdom、元素被外部样式表禁掉动画），只靠事件会永久留一个不可见的节点。 */
const EXIT_MS = 150;

export interface PopoverProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "style"> {
  /** 开合由调用方持有：本组件据此跑进场/离场并从 DOM 里摘掉。 */
  open: boolean;
  /** 触发器：元素或已知矩形；null（还没量到）时不渲染。 */
  anchor: PopoverAnchor | null;
  /** 外点 / Esc / 窗口 resize 都走它。 */
  onClose: () => void;
  /** 宿主自己的类（尺寸族、圆角、投影都在那里）。 */
  className?: string;
  side?: PopoverSide;
  sideOffset?: number;
  align?: PopoverAlign;
  alignOffset?: number;
  /** 固定宽；`"anchor"` = 与触发器同宽。不给则由宿主的 CSS 定。 */
  width?: number | "anchor";
  /** 内容高度估计：决定翻面与限高。 */
  height?: number;
  /** 限高的硬上限（实际取它与可用空间的较小者）。 */
  maxHeight?: number;
  /** 内容元素：调用方要拿它做键盘导航/滚动时传进来（`useRef<HTMLDivElement | null>(null)`）。 */
  contentRef?: MutableRefObject<HTMLDivElement | null> | RefCallback<HTMLDivElement>;
  /** 关掉"外点即关"。菜单里点开旁位卡（模型详情卡）那类场景由调用方自己管关闭。 */
  dismissOnOutside?: boolean;
  /** 另算"内部"的元素：与本浮层同属一个菜单的旁位卡那类——点它不该顺手关掉本浮层。
   *  收 ref 也收元素；**传 ref**（`useRef(null)` 本身）在这里是常态：旁位卡往往渲染在
   *  本浮层之后，渲染时 `ref.current` 还是 null，只有判定那一刻才解析得到。 */
  alsoInside?: (HTMLElement | RefObject<HTMLElement | null> | null)[];
  /** 关掉"Esc 即关"。由 hover 驱动的浮层不接 Esc（它不是被"打开"的，Esc 该留给外面）。 */
  dismissOnEscape?: boolean;
  /** 追加内联样式，合在算出的定位之后（滚动、最大宽那类逐面之差写这里）。 */
  style?: CSSProperties;
  /** 挂到哪儿（默认 body）。浏览器面板那类"网页自己有浮层容器"的宿主传自己的容器。 */
  container?: HTMLElement | null;
  children: ReactNode;
}

export function Popover({
  open, anchor, onClose, className, side = "bottom", sideOffset = 6,
  align = "start", alignOffset = 0, width, height = 240, maxHeight,
  contentRef, dismissOnOutside = true, dismissOnEscape = true, alsoInside, style, container,
  children, ...rest
}: PopoverProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<FloatingPlacement | null>(null);
  /** 没显式给尺寸时，另一条轴的尺寸由宿主自己的 CSS 决定，只有挂载后才量得到——而
   *  align=center/end 与边界收敛都要它。量到就进 state，让下面那次重算把它算进去
   *  （仍是 layout effect，绘制前完成，用户看不到中间态）。 */
  const [crossSize, setCrossSize] = useState(0);
  /** 触发器常是宿主自己的 ref（`anchor={triggerRef.current}`）：子组件渲染时 ref 还没挂
   *  （ref 在提交阶段才赋值），第一帧拿到的 anchor 就是 null——提交后补看一次。真没挂上
   *  （触发器是条件渲染的）就停在这里，等 props 变化再量。 */
  const [seenAnchor, setSeenAnchor] = useState(false);
  // 落地开向与轴镜像一份：不进 state，免得白跑一次渲染。
  const sideRef = useRef<PopoverSide>(side);
  const axisRef = useRef<"height" | "width">(
    side === "top" || side === "bottom" ? "height" : "width");
  const cross = width === "anchor" ? 0 : width ?? crossSize;

  // 开：同帧量、同帧落位（layout effect 在绘制前跑完，不会闪一帧在旧位置）。
  // 关：**不摘 box**——先让宿主跑完离场动画，animationend 才摘（见下面的 onAnimationEnd）。
  useLayoutEffect(() => {
    if (!open) return;
    const r = anchorRectOf(anchor);
    if (!r) return;
    const b = placeFloating(r, {
      side, gap: sideOffset, align, alignOffset,
      size: width, cross, height, maxHeight,
    });
    sideRef.current = b.side;
    axisRef.current = b.axis;
    setBox(b);
  }, [open, anchor, seenAnchor, side, sideOffset, align, alignOffset, width, cross, height, maxHeight]);

  // 尺寸未给的场合：挂载后补量一次**另一条轴**，改的幅度超过半个像素才算（避免量—排—量的
  // 来回）。`axis` 是"内容超限时该滚的那一轴"（竖开=高、横开=宽），对齐与夹边要的是它的
  // **对轴**，别拿滚轴自己当尺寸——竖开时量成高、横向夹边就会整体跑偏。
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!open || !el || width !== undefined) return;
    const r = el.getBoundingClientRect();
    const v = axisRef.current === "width" ? r.height : r.width;
    if (v > 0 && Math.abs(v - crossSize) > 0.5) setCrossSize(v);
  }, [open, width, crossSize, box]);

  // 外点：mousedown 而非 click——按下即关，指针在被按住的元素上抬起时不会误触发它
  // （全仓弹层的既有口径，别改成 pointerdown：同一件事两套事件名只会多一处不一致）。
  // 点是触发器自己时不管：那是"再按一下收起"，由触发器持有开关，这里关了会被它立刻开回来。
  useEffect(() => {
    if (!open || !dismissOnOutside) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (hostRef.current?.contains(t)) return;
      // 触发器与"另算内部"的元素都算内部（见各自的注释）。
      const trigger = isRef(anchor) ? anchor.current : anchor instanceof HTMLElement ? anchor : null;
      if (trigger?.contains(t)) return;
      if (alsoInside?.some((item) => elementOf(item)?.contains(t))) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, dismissOnOutside, anchor, onClose, alsoInside]);

  // Esc：只截菜单这一层，不惊动外层（弹窗里的下拉按 Esc 只收下拉）。
  useEffect(() => {
    if (!open || !dismissOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, dismissOnEscape, onClose]);

  useEffect(() => {
    if (open && !anchor && !seenAnchor) setSeenAnchor(true);
  }, [open, anchor, seenAnchor]);

  // 离场收尾的第二条路（见 EXIT_MS）。open 回升时定时器随 effect 清理一起撤掉——
  // 离场中途被重新打开不会把新开的那个摘掉。
  useEffect(() => {
    if (open || !box) return;
    const timer = window.setTimeout(() => setBox(null), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open, box]);

  // 窗口尺寸变了位置就错了（参考实现同样直接关掉，不重算）。
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", onClose);
    return () => window.removeEventListener("resize", onClose);
  }, [open, onClose]);

  if (!box) return null;
  return createPortal(
    <div
      {...rest}
      ref={(el) => {
        hostRef.current = el;
        if (typeof contentRef === "function") contentRef(el);
        else if (contentRef) contentRef.current = el;
      }}
      className={className ? `${css.box} ${className}` : css.box}
      data-state={open ? "open" : "closed"}
      data-side={sideRef.current}
      style={style ? { ...box.style, ...style } : box.style}
      // 离场动画收尾才摘：只有真关着才摘（离场中途被重新打开时这条是进场动画的 end）。
      // 必须比 target 与 currentTarget——子元素的 animationend 会冒泡上来（浮层里带
      // 入场的视图多的是，它们先结束就会把宿主提前摘掉）。
      onAnimationEnd={(e) => {
        rest.onAnimationEnd?.(e);
        if (e.target === e.currentTarget && !open) setBox(null);
      }}
    >
      <GlassLayer />
      {children}
    </div>,
    container ?? document.body,
  );
}
