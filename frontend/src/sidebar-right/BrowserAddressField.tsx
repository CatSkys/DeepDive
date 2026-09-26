// 地址栏本体与它的补全列表（参考 `Omnibox.swift` 的 field + list）。
//
// 两处用它，形状完全一样：**选中标签那一枚**（平时只读显示当前地址，点它才编辑）与
// **空白标签页中间那块大框**。补全列表挂在框正下方（不是覆盖），行内是"地址 + 标题"，
// 搜索那条带放大镜与引擎名——这三样在参考里是同一份 `list`。
//
// 只管"输入 + 选一条"，进出地址栏的时机（谁聚焦、什么时候展开成框）归 BrowserChrome。
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { t } from "../i18n";
import { browserPrefs } from "./browserPrefs";
import { completeVisits, useVisitsRevision } from "./browserHistory";
import { looksLikeSearch, searchUrlFor, shortAddress } from "./browserUrl";
import type { PaneFace } from "./useIframeBrowser";

/** 补全列表的一行：`url` 是要去的地方，`title` 是它的名字（空的就只显示地址）。 */
interface Suggestion { url: string; label: string; title: string; kind: "search" | "visit" }

/** 引擎名：模板里的主机去掉 www 与后缀（`https://www.google.com/search?q=` → `Google`）。 */
function engineName(template: string): string {
  try {
    const host = new URL(template).hostname.replace(/^www\./, "");
    const stem = host.split(".")[0] ?? host;
    return stem.charAt(0).toUpperCase() + stem.slice(1);
  } catch {
    return "";
  }
}

/** 框 + 补全列表。`big` = 空白标签页那款（560 宽、圆角 14、带阴影），否则是标签行里的那款。 */
export function AddressField({ face, big = false, focusTick = 0, onEditingChange, onPick }: {
  face: PaneFace;
  big?: boolean;
  /** 变化即聚焦一次（壳转来的 ⌘L / 面板点标签） */
  focusTick?: number;
  /** 进出编辑态（标签行那款据此"就地展开成地址框"） */
  onEditingChange?: (editing: boolean) => void;
  /** 选定了要去的地方（原生载体走 face.navigate，顺带收掉编辑态） */
  onPick: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [active, setActive] = useState(-1);
  const prefs = browserPrefs();
  // 壳推来新历史就重画一次补全（缓存是同步读的，不订阅只会等下一次敲键）
  useVisitsRevision();

  const setMode = (on: boolean) => {
    setEditing(on);
    onEditingChange?.(on);
    if (!on) setActive(-1);
  };

  useEffect(() => {
    if (focusTick === 0) return;
    setMode(true);
    inputRef.current?.focus();
    inputRef.current?.select();
    // 只在 tick 变化时触发一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);

  const draft = face.draft;
  const recents = completeVisits(draft);
  const searchHint = prefs.searchOnPlainText && looksLikeSearch(draft)
    ? searchUrlFor(draft, prefs.searchTemplate)
    : null;
  const suggestions: Suggestion[] = [
    ...(searchHint !== null
      ? [{ url: searchHint, label: `${t("搜索")} “${draft.trim()}”`, title: engineName(prefs.searchTemplate), kind: "search" as const }]
      : []),
    ...recents.map((item) => ({ url: item.url, label: shortAddress(item.url), title: item.title, kind: "visit" as const })),
  ];

  const pick = (url: string) => {
    setMode(false);
    onPick(url);
  };

  const unknown = face.address === "unknown";
  return (
    <div className={`panel-browser-field${big ? " big" : ""}`}>
      <div className="panel-browser-field-box">
        <input
          ref={inputRef}
          className={`panel-browser-field-input${unknown && !editing ? " unknown" : ""}`}
          value={draft}
          aria-label={t("地址")}
          placeholder={t("输入地址或搜索")}
          spellCheck={false}
          autoComplete="off"
          onFocus={() => setMode(true)}
          onBlur={() => window.setTimeout(() => setMode(false), 120)}
          onChange={(e) => { face.setDraft(e.currentTarget.value); setActive(-1); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setMode(false); e.currentTarget.blur(); return; }
            if (suggestions.length === 0) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % suggestions.length); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1)); return; }
            if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(suggestions[active]!.url); }
          }}
        />
        {unknown && !editing && <span className="panel-browser-field-note">{t("页面已跳转，地址未知")}</span>}
      </div>
      {editing && suggestions.length > 0 && (
        <div className="panel-browser-offers" role="listbox">
          {suggestions.map((item, index) => (
            <button
              key={`${item.url}-${index}`}
              type="button"
              role="option"
              aria-selected={index === active}
              className={`panel-browser-offer${index === active ? " active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); pick(item.url); }}
            >
              {item.kind === "search" && <Search size={11} className="panel-browser-offer-mark" />}
              <span className="panel-browser-offer-key">{item.label}</span>
              {item.title !== "" && <span className="panel-browser-offer-title">{item.title}</span>}
            </button>
          ))}
        </div>
      )}
      {face.failure !== undefined && editing && (
        <div className="panel-browser-offers">
          <div className="panel-browser-offer refused">
            {face.failure === "empty" ? t("请输入地址")
              : face.failure === "protocol" ? t("只支持 http/https 地址")
              : face.failure === "credentials" ? t("地址里不能带用户名或密码")
              : face.failure === "application-origin" ? t("不能打开 DeepDive 自己的地址")
              : t("地址无效")}
          </div>
        </div>
      )}
    </div>
  );
}
