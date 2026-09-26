// 页内查找条：⌘F 或工具栏「…」菜单打开；Enter 下一个、⇧Enter 上一个、Esc 关闭。
// 只有原生载体用得上（壳侧的 WKFindConfiguration），所以由壳载体自己挂。
import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { t } from "../i18n";

/** 页内查找条：⌘F 或「…」菜单打开；Enter 下一个、⇧Enter 上一个、Esc 关闭。
 *  查找词由本组件持有，但**每次都要把新词显式交出去**：`setQuery` 之后同一帧里读 `query`
 *  还是旧值，只按上一帧的串去查（实测"打字期间查的是少一个字的串，最后一击永远没查"）。 */
export function BrowserFindBar({ query, setQuery, found, onStep, onClose, focusTick }: {
  query: string;
  setQuery: (v: string) => void;
  found: boolean | null;
  onStep: (forward: boolean, query: string) => void;
  onClose: () => void;
  focusTick: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, [focusTick]);
  return (
    <div className="panel-browser-find">
      <input
        ref={ref}
        className="panel-browser-find-input"
        value={query}
        aria-label={t("页内查找")}
        placeholder={t("页内查找")}
        spellCheck={false}
        onChange={(e) => { const next = e.currentTarget.value; setQuery(next); onStep(true, next); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onStep(!e.shiftKey, query); }
          else if (e.key === "Escape") { e.preventDefault(); onClose(); }
        }}
      />
      {found === false && <span className="panel-browser-find-miss">{t("没有匹配")}</span>}
      <button type="button" className="panel-browser-tool" aria-label={t("上一个")} data-tip={t("上一个")}
        onClick={() => onStep(false, query)}>
        <ChevronLeft size={15} />
      </button>
      <button type="button" className="panel-browser-tool" aria-label={t("下一个")} data-tip={t("下一个")}
        onClick={() => onStep(true, query)}>
        <ChevronRight size={15} />
      </button>
      <button type="button" className="panel-browser-tool" aria-label={t("关闭")} data-tip={t("关闭")} onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  );
}

