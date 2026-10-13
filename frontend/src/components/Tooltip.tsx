import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, Ref } from "react";
import { displayKeyCaps } from "../keybinds";
import { hideTip, showTip, sideOf, TIP_GAP, type TipSide } from "../tooltip/tipAnchor";
import { shellCapabilities } from "../platform";

// 全局悬浮注释（替代原生 title）：任意元素加
//   data-tip="文案"  data-tip-keys="⌘,"（右侧键帽快捷键，可省）
//   data-tip-pos="top|bottom|left|right"（缺省 top，空间不足自动翻转到对侧）
//
// 两条路，同一份注释本体（TooltipChip）：
//   · 壳内（mac）：**壳的独立 Tooltip 窗口**承载——那块窗口的底是系统液态玻璃
//     （`WindowGlassView(surface: .floating)`），窗口按这里报上去的锚点矩形摆。本组件因此
//     只管"什么时候挂哪一条"，一个字都不画（上报在 `tooltip/tipAnchor.ts`）。
//   · 页内（浏览器调试 / 没有那条壳能力的平台）：自己画、自己落位——与触发元素对齐并
//     夹在视口内，空间不足翻转到对侧；滚动/按下/移出即收。目标元素从 DOM 移除时
//     mouseout 不会触发（偶发不消失的根因），可见期以 400ms 轮询校验连接性与
//     ：hover/:focus 兜底隐藏。

type Pos = TipSide;
const MARGIN = 8;
/** 页内这份的离场时长：与 theme.css 的 tip-out 同长（跑完才摘 DOM）。 */
const CLOSE_MS = 150;

interface Tip {
  el: HTMLElement;
  text: string;
  caps: string[];
  pos: Pos;
  closing: boolean;
}

/** 键帽组：≤3 枚逐枚成块，更多压成一枚（Windows 的 Ctrl/Alt 是多字符 token）。 */
export function KeyCaps({ caps }: { caps: string[] }) {
  return caps.length <= 3 ? (
    <span className="tip-keys-row">
      {caps.map((cap, i) => (
        <kbd key={i} className="tip-key">
          {cap}
        </kbd>
      ))}
    </span>
  ) : (
    <kbd className="tip-key">{caps.join("")}</kbd>
  );
}

/** 注释本体（文字 + 键帽），**两处共用**：页内那条与壳的 Tooltip 窗口那一页。
 *  `phase`/`style`/`boxRef` 只给页内那份用（它自己落位、自己量、自己跑离场）；窗口那一页
 *  由壳摆窗口、原生跑动效，只传文案与键帽。 */
export function TooltipChip({
  text,
  caps,
  phase,
  style,
  boxRef,
}: {
  text: string;
  caps: string[];
  phase?: "open" | "closing";
  style?: CSSProperties;
  boxRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={boxRef} className="tip" role="tooltip" data-phase={phase} style={style}>
      <span className="tip-text">{text}</span>
      {caps.length > 0 && <KeyCaps caps={caps} />}
    </div>
  );
}

export function TooltipHost() {
  const native = shellCapabilities().tooltip;
  const [tip, setTip] = useState<Tip | null>(null);
  const [placed, setPlaced] = useState<{ top: number; left: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current === null) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const hide = useCallback(() => {
    current.current = null;
    if (native) {
      hideTip();
      return;
    }
    // 页内这份留住 DOM 把离场跑完（关闭 0.15s，比打开快——"快出慢入"）
    setTip((t) => (t === null || t.closing ? t : { ...t, closing: true }));
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setTip(null);
      setPlaced(null);
    }, CLOSE_MS);
  }, [native, cancelClose]);

  useEffect(() => {
    const over = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (!el) return;
      if (el === current.current) return;
      current.current = el;
      if (native) {
        showTip(el);
        return;
      }
      cancelClose();
      setTip({
        el,
        text: el.dataset.tip ?? "",
        caps: displayKeyCaps(el.dataset.tipKeys ?? ""),
        pos: sideOf(el),
        closing: false,
      });
      setPlaced(null); // 渲染后测量再落位
    };
    const out = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-tip]");
      if (el && el === current.current) hide();
    };
    const down = () => hide();
    const onScroll = () => hide();
    document.addEventListener("mouseover", over);
    document.addEventListener("mouseout", out);
    document.addEventListener("focusin", over);
    document.addEventListener("focusout", out);
    document.addEventListener("mousedown", down);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mouseout", out);
      document.removeEventListener("focusin", over);
      document.removeEventListener("focusout", out);
      document.removeEventListener("mousedown", down);
      window.removeEventListener("scroll", onScroll, true);
      cancelClose();
    };
  }, [hide, native, cancelClose]);

  // 兜底巡检：目标已脱离文档、或指针/焦点已不在其上（重渲染吞掉
  // mouseout 的场景）→ 收起。轮询只在注释可见期间运行/卸载（AUD-040：
  // 曾挂在 mount effect 常开，无 tip 也每 400ms 校验一次）。离场途中不再重复收。
  useEffect(() => {
    if (!tip || native) return;
    const watch = setInterval(() => {
      if (tip.closing) return;
      const el = current.current;
      if (el && el.isConnected && el.matches(":hover, :focus")) return;
      hide();
    }, 400);
    return () => clearInterval(watch);
  }, [tip, hide, native]);

  // 渲染后按实测尺寸落位：先按偏好边对齐，空间不足翻转到对侧，再夹进视口
  useLayoutEffect(() => {
    if (native || !tip || tip.closing || !boxRef.current) return;
    const b = boxRef.current.getBoundingClientRect();
    const r = tip.el.getBoundingClientRect();
    let pos = tip.pos;
    const fits = (p: Pos) => {
      if (p === "top") return r.top - b.height - TIP_GAP >= MARGIN;
      if (p === "bottom") return window.innerHeight - r.bottom - b.height - TIP_GAP >= MARGIN;
      if (p === "left") return r.left - b.width - TIP_GAP >= MARGIN;
      return window.innerWidth - r.right - b.width - TIP_GAP >= MARGIN;
    };
    const flip: Record<Pos, Pos> = { top: "bottom", bottom: "top", left: "right", right: "left" };
    if (!fits(pos)) pos = flip[pos];
    let top: number;
    let left: number;
    if (pos === "top") {
      top = r.top - b.height - TIP_GAP;
      left = r.left + r.width / 2 - b.width / 2;
    } else if (pos === "bottom") {
      top = r.bottom + TIP_GAP;
      left = r.left + r.width / 2 - b.width / 2;
    } else if (pos === "left") {
      top = r.top + r.height / 2 - b.height / 2;
      left = r.left - b.width - TIP_GAP;
    } else {
      top = r.top + r.height / 2 - b.height / 2;
      left = r.right + TIP_GAP;
    }
    setPlaced({
      top: Math.min(Math.max(MARGIN, top), window.innerHeight - b.height - MARGIN),
      left: Math.min(Math.max(MARGIN, left), window.innerWidth - b.width - MARGIN),
    });
  }, [tip, native]);

  if (native || !tip) return null;
  return createPortal(
    <TooltipChip
      text={tip.text}
      caps={tip.caps}
      phase={tip.closing ? "closing" : "open"}
      boxRef={boxRef}
      style={placed ? { top: placed.top, left: placed.left } : { visibility: "hidden" }}
    />,
    document.body,
  );
}
