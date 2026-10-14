// 居中弹层：全站"盖在应用之上、屏幕居中"的那一类唯一的壳
//（对话框 / 灯箱 / 引导卡 / 游戏面）。
//
// 与 Popover 的分工：Popover 贴触发器（side/align 一组定位参数、按 rect 摆）；本组件
// 不管锚点，只管"遮罩 + 居中卡片 + 关法 + 进出场"。两者共用 GlassLayer 与同一份
// keyframes（pop-in/pop-out）——"浮层该长什么样"这条事实只有一个家。
//
// 为什么要有它：此前每个对话框各写一份遮罩（`fixed; inset:0; z-scrim; rgba(0,0,0,.45)`，
// 三份逐字相同）加一份卡片盒。收成一份后，圆角/投影/材质族参数不再逐面抄。
import { useEffect, useState } from "react";
import type {
  AriaRole, MutableRefObject, ReactNode, RefCallback,
} from "react";
import { createPortal } from "react-dom";
import { GlassLayer } from "./GlassLayer";
import css from "./Modal.module.css";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** 卡片自己的类：**尺寸、内距、布局**（如 470×86vh、左栏+右栏）。
   *  圆角/描边/投影/材质族参数不在这里写——那四样归本组件的共享配方。 */
  cardClassName?: string;
  /** 卡片需要直接拿 DOM 时（尺寸量测、键盘导航）。 */
  contentRef?: MutableRefObject<HTMLDivElement | null> | RefCallback<HTMLDivElement>;
  role?: AriaRole;
  ariaLabel?: string;
  /** 点遮罩关（默认开）。卡片内部点不到遮罩：判定按 `target === currentTarget`。 */
  dismissOnOverlay?: boolean;
  /** 按 Esc 关（默认开）。 */
  dismissOnEscape?: boolean;
  children: ReactNode;
}

export function Modal({
  open, onClose, cardClassName, contentRef, role = "dialog", ariaLabel,
  dismissOnOverlay = true, dismissOnEscape = true, children,
}: ModalProps) {
  // 关：不立刻摘——先切 data-state 跑完离场动画，animationend 才摘（同 Popover）。
  const [mounted, setMounted] = useState(open);
  useEffect(() => { if (open) setMounted(true); }, [open]);

  useEffect(() => {
    if (!open || !dismissOnEscape) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, dismissOnEscape, onClose]);

  if (!mounted) return null;
  return createPortal(
    <div
      className={css.overlay}
      data-state={open ? "open" : "closed"}
      // 按下即判：在卡片里按下、拖到遮罩上抬起不该关（用 click 会误判）。
      onMouseDown={(e) => { if (dismissOnOverlay && e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={(el) => {
          if (typeof contentRef === "function") contentRef(el);
          else if (contentRef) contentRef.current = el;
        }}
        className={cardClassName ? `${css.card} ${cardClassName}` : css.card}
        data-state={open ? "open" : "closed"}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        onAnimationEnd={(e) => {
          // 子元素的 animationend 会冒泡上来（卡内带入场的视图多的是），比过 target 才认。
          if (e.target === e.currentTarget && !open) setMounted(false);
        }}
      >
        <GlassLayer />
        {children}
      </div>
    </div>,
    document.body,
  );
}
