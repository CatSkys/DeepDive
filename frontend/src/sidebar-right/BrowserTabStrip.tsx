// 侧栏浏览器的标签栏：横向的 site icon 式标签（图标 + 关闭），末尾一枚 new tab。
// 标签本体只显示站点图标（用户定稿：site icon 式，不堆长标题）——名字走 aria-label 与悬停提示。
//
// 标签状态的事实源在壳里（BrowserTabs.swift），这里只是它的一张脸：切/关都发消息给壳，
// 壳回一条新的清单（`browserTabs`）。
import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { t, tt } from "../i18n";
import type { BrowserTabFace } from "./useNativeBrowser";

/** 主机名（标签的降级字母与提示都用它）：去掉 www.，解析不出（about:blank/空串）就回空。 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** 标签名：标题优先，没标题用主机名，空白页给"新标签页"。 */
function tabName(tab: BrowserTabFace): string {
  if (tab.title !== "") return tab.title;
  return hostOf(tab.url) || t("新标签页");
}

/** 站点图标；页面没声明或取不到就退回主机名首字母（极简那一档）。 */
function TabIcon({ tab }: { tab: BrowserTabFace }) {
  const [broken, setBroken] = useState(false);
  // 同一个标签换页后图标地址也换了：上一个取不到不该把它永久钉在首字母上
  useEffect(() => setBroken(false), [tab.icon]);
  if (broken || tab.icon === "") {
    return <span className="panel-browser-tab-glyph">{(hostOf(tab.url) || "·").slice(0, 1).toUpperCase()}</span>;
  }
  return <img className="panel-browser-tab-icon" src={tab.icon} alt="" onError={() => setBroken(true)} />;
}

export function BrowserTabStrip({ tabs, activeId, onSelect, onClose, onNew }: {
  tabs: BrowserTabFace[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="panel-browser-tabs" role="tablist" aria-label={t("标签页")}>
      {tabs.map((tab) => {
        const name = tabName(tab);
        return (
          <div
            key={tab.id}
            className={`panel-browser-tab${tab.id === activeId ? " active" : ""}${tab.asleep ? " asleep" : ""}`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === activeId}
              className="panel-browser-tab-body"
              aria-label={tab.asleep ? tt("{name}（已休眠）", "{name} (asleep)", { name }) : name}
              data-tip={name}
              onClick={() => onSelect(tab.id)}
            >
              <TabIcon tab={tab} />
            </button>
            {/* 只剩一个标签时不给关闭钮：壳会补一个空白页，点了像"没反应" */}
            {tabs.length > 1 && (
              <button
                type="button"
                className="panel-browser-tab-close"
                aria-label={t("关闭标签")}
                data-tip={t("关闭标签")}
                onClick={() => onClose(tab.id)}
              >
                <X size={11} />
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="panel-browser-tab-new"
        aria-label={t("新建标签")}
        data-tip={t("新建标签")}
        onClick={onNew}
      >
        <Plus size={13} />
      </button>
    </div>
  );
}
