// 会话页内查找：消息流上方一枚轻胶囊（输入框 + 上一个/下一个 + 关闭），命中用 CSS
// Custom Highlight 画上去——**不改 DOM**（那是 React 的地盘，流式还在往里写）。
// 只管这一屏的交互：取词在 session/findMatches.ts，开关由 ⌘F 走 openFindInConversation。

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useT } from "../i18n";
import { collectMatches } from "../session/findMatches";
import { GlassLayer } from "./GlassLayer";

const HIT = "find-hit";
const ACTIVE = "find-active";

let openReq: (() => void) | null = null;

/** 打开页内查找（⌘F）。引擎没有 Highlight API 就不开——宁可没有这个入口，也不给一个
 *  按下去没反应的键（能力探测降级；WKWebView 从 Safari 17.2 起就有）。 */
export function openFindInConversation(): void {
  if (!("highlights" in CSS)) return;
  openReq?.();
}

export function FindInConversation({ rootRef }: { rootRef: React.RefObject<HTMLElement | null> }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [miss, setMiss] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // 命中与当前项留在 ref 里：上色与滚动都是命令式的，每敲一个字重渲染整屏没有好处
  const matches = useRef<Range[]>([]);
  const active = useRef(0);

  useEffect(() => {
    openReq = () => setOpen(true);
    return () => { openReq = null; };
  }, []);

  // 开：抢焦点并全选（再按一次 ⌘F 就是「换一个词重查」）；关：撤高亮，别把痕迹留在流上
  useEffect(() => {
    if (open) { inputRef.current?.focus(); inputRef.current?.select(); return; }
    clearHighlights();
  }, [open]);

  // 卸载（换会话重挂）也要撤：Highlight 持有 DOM 节点，留着就是漏
  useEffect(() => clearHighlights, []);

  /** 把当前命中滚进视野中央。**滚的是命中所在元素，不是 Range**：被 content-visibility
   *  跳过渲染的块里 Range 的矩形是 0（WebKit 实测），滚 Range 等于没滚；元素本身有估高盒，
   *  滚它才能把那块唤醒。唤醒后真实高度替换估高会让落点漂（PITFALLS §1.12），
   *  所以下一帧再校准一次——第二次仍是 smooth，会把动画重定向到校正后的位置。 */
  const scrollToActive = () => {
    const range = matches.current[active.current];
    const el = range?.startContainer.parentElement;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    requestAnimationFrame(() => {
      if (matches.current[active.current] !== range) return; // 中途换词/关窗：别再动滚动
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  const paint = (scroll: boolean) => {
    if (matches.current.length === 0) { clearHighlights(); return; }
    CSS.highlights.set(HIT, new Highlight(...matches.current));
    CSS.highlights.set(ACTIVE, new Highlight(matches.current[active.current]));
    if (scroll) scrollToActive();
  };

  /** 重新取词（打字时）；forward 决定停在第一个还是最后一个命中上。 */
  const search = (next: string, forward = true) => {
    const root = rootRef.current;
    matches.current = root ? collectMatches(root, next) : [];
    active.current = forward ? 0 : Math.max(0, matches.current.length - 1);
    setMiss(next.trim() !== "" && matches.current.length === 0);
    paint(true);
  };

  const step = (forward: boolean) => {
    const n = matches.current.length;
    if (n === 0) return;
    active.current = (active.current + (forward ? 1 : n - 1)) % n;
    paint(true);
  };

  const close = () => {
    setOpen(false);
    setQuery("");
    setMiss(false);
  };

  if (!open) return null;
  return (
    <div className="find-capsule">
         <GlassLayer />
      <input
        ref={inputRef}
        className="find-input"
        value={query}
        aria-label={t("页内查找")}
        placeholder={t("页内查找")}
        spellCheck={false}
        // 新值显式交出去：setQuery 之后同一帧读 query 还是旧串（PITFALLS §9.6 同一个坑）
        onChange={(e) => { const next = e.currentTarget.value; setQuery(next); search(next); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); step(!e.shiftKey); }
          else if (e.key === "Escape") { e.preventDefault(); close(); }
        }}
      />
      {miss && <span className="find-miss">{t("没有匹配")}</span>}
      <button type="button" className="capsule-icon-btn" aria-label={t("上一个")} data-tip={t("上一个")} onClick={() => step(false)}>
        <ChevronUp size={15} />
      </button>
      <button type="button" className="capsule-icon-btn" aria-label={t("下一个")} data-tip={t("下一个")} onClick={() => step(true)}>
        <ChevronDown size={15} />
      </button>
      <button type="button" className="capsule-icon-btn" aria-label={t("关闭")} data-tip={t("关闭")} onClick={close}>
        <X size={14} />
      </button>
    </div>
  );
}

/** 撤掉两档高亮（关窗、换会话、卸载都走这里）。 */
function clearHighlights(): void {
  if (!("highlights" in CSS)) return;
  CSS.highlights.delete(HIT);
  CSS.highlights.delete(ACTIVE);
}
