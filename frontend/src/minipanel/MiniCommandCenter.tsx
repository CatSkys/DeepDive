// 迷你面板的悬浮**命令中心**（照参考图那类命令面板）：一张浮在页面之上的卡片——
// 顶部搜索框，下面按模式给行（历史 = 会话列表，设置 = 设置行）。**页面本身不换**：
// 卡片之外还是原来的草稿/会话页，Esc、点卡片外、或再点那颗钮收回。
// 键盘：↑↓ 走行、Enter 激活、Esc 先清空搜索、空搜索再按才关。行件在
// MiniHistoryRows / MiniSettingsRows，本文件只管卡片框架与键盘。
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { useT } from "../i18n";
import { MiniHistoryRows } from "./MiniHistoryRows";
import { MiniSettingsRows } from "./MiniSettingsRows";

export type MiniOverlayMode = "history" | "settings";

export function MiniCommandCenter({
  mode,
  sessionId,
  onClose,
}: {
  mode: MiniOverlayMode;
  /** 设置模式的行集按脸给：有会话用会话那一支，否则草稿那一支。 */
  sessionId: string | null;
  onClose: () => void;
}) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  /** 行件的键盘处理（历史模式用；设置模式的行是控件，不走 ↑↓）：每次渲染注册一份最新的。 */
  const navRef = useRef<((e: ReactKeyboardEvent<HTMLInputElement>) => void) | null>(null);
  const registerNav = useCallback((handler: (e: ReactKeyboardEvent<HTMLInputElement>) => void) => {
    navRef.current = handler;
  }, []);
  useEffect(() => {
    navRef.current = null; // 换模式先清掉旧模式那份处理
  }, [mode]);

  // 打开即聚焦搜索框（壳的 quickPanelFocus 只推给会话输入框，这里自己拿焦点）
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 点卡片外收掉。三类不算"外"：卡片自己、卡片弹出的菜单（.ctx-menu）、以及
  // 挂在 body 上的浮层（ModelMenu / Dropdown 的弹层——它们不在这块页面里）。
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (cardRef.current?.contains(target)) return;
      if (target.closest(".ctx-menu")) return;
      if (!target.closest(".app.mini-panel")) return;
      onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  const onSearchKeys = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (query !== "") setQuery("");
      else onClose();
      return;
    }
    navRef.current?.(e);
  };

  return (
    <div className="mini-cc" ref={cardRef} role="dialog" aria-label={mode === "history" ? t("会话历史") : t("会话设置")}>
      <label className="mini-cc-search">
        <Search size={15} aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKeys}
          placeholder={mode === "history" ? t("搜索会话…") : t("搜索设置…")}
          aria-label={mode === "history" ? t("搜索会话…") : t("搜索设置…")}
        />
        {query !== "" && (
          <button
            type="button"
            className="mini-cc-clear"
            aria-label={t("清空")}
            data-tip={t("清空")}
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <X size={13} />
          </button>
        )}
      </label>
      <div className="mini-cc-body">
        {mode === "history"
          ? <MiniHistoryRows query={query} registerNav={registerNav} onDone={onClose} />
          : <MiniSettingsRows sessionId={sessionId} query={query} />}
      </div>
    </div>
  );
}
