// 浏览器顶部那一行——**它就是这一格的"窗口标题栏"**（参考 `TabBar.swift` + `App.swift` 的 `window_`）：
// 一排标签胶囊，行尾是后退/前进/刷新/书签/「…」/「对话」。
//
// 标签的形状照参考：**站点图标 + 标题的胶囊**；选中的那一枚**就地展开成地址框**
// （`AddressField`，显示当前 URL、点它才编辑），其余是灰底只读胶囊（点它切过去）。
// 补全列表挂在地址框正下方——参考里补全不是浮到页面中央的，它就在框下面。
//
// 与参考的一处必要差异：它一个窗口就是一个浏览器，这一行直接吃窗口的标题栏（交通灯嵌在行首）；
// 我们的浏览器是聊天窗口里的一格，所以这一行占面板顶部，交通灯是应用自己的、不在这里。
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { t, tt } from "../i18n";
import { AddressField } from "./BrowserAddressField";
import type { PaneFace } from "./useIframeBrowser";
import type { BrowserTabFace } from "./useNativeBrowser";

/** 主机名（降级首字母与提示用它）：去掉 www.，解析不出就回空。 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** 标签名（参考 `Tab.label` 的同一口径）：标题 → 主机名 → "新标签页"。 */
function tabName(tab: BrowserTabFace): string {
  if (tab.title !== "") return tab.title;
  return hostOf(tab.url) || t("新标签页");
}

/** 站点图标；页面没声明或取不到就退回主机名首字母（参考 `Mark` 的同一档）。 */
function TabIcon({ tab }: { tab: BrowserTabFace }) {
  const [broken, setBroken] = useState(false);
  if (broken || tab.icon === "") {
    return <span className="panel-browser-tab-glyph">{(hostOf(tab.url) || "•").slice(0, 1).toUpperCase()}</span>;
  }
  return <img className="panel-browser-tab-icon" src={tab.icon} alt="" onError={() => setBroken(true)} />;
}

/** 只读标签胶囊：图标 + 标题，指向它时才露出关闭叉（参考的同一取舍）。 */
function TabPill({ tab, closable, onSelect, onClose }: {
  tab: BrowserTabFace;
  closable: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const name = tabName(tab);
  return (
    <div className={`panel-browser-tab${tab.asleep ? " asleep" : ""}`}>
      <button
        type="button"
        role="tab"
        aria-selected={false}
        className="panel-browser-tab-body"
        aria-label={tab.asleep ? tt("{name}（已休眠）", "{name} (asleep)", { name }) : name}
        data-tip={name}
        onClick={onSelect}
      >
        <TabIcon tab={tab} />
        <span className="panel-browser-tab-title">{name}</span>
      </button>
      {closable && (
        <button
          type="button"
          className="panel-browser-tab-close"
          aria-label={t("关闭标签")}
          data-tip={t("关闭标签")}
          onClick={onClose}
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

export function BrowserTabStrip({ face, tabs, activeId, onSelect, onClose, onNew, onPick, focusTick = 0, trailing }: {
  face: PaneFace;
  tabs: BrowserTabFace[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  /** 地址框里选定了一条（原生载体走 face.navigate） */
  onPick: (url: string) => void;
  /** 变化即聚焦地址框一次（壳转来的 ⌘L） */
  focusTick?: number;
  /** 行尾那一组（后退/前进/刷新/书签/「…」/「对话」），由 BrowserToolbar 给 */
  trailing: React.ReactNode;
}) {
  const active = tabs.find((tab) => tab.id === activeId);
  const others = tabs.filter((tab) => tab.id !== activeId);
  const activeName = active ? tabName(active) : t("新标签页");

  return (
    <div className="panel-browser-chrome" role="tablist" aria-label={t("标签页")}>
      {/* 选中那枚：**还是一枚标签**（图标 + 地址 + 关闭叉），只是中间那截显示的是地址、
          点进去就能编辑。参考 TabPill 的 editing 分支就是这个意思——不是"标签旁边多一个地址栏"。 */}
      {active && (
        <div className={`panel-browser-tab live${active.asleep ? " asleep" : ""}`}>
          <TabIcon tab={active} />
          <div className="panel-browser-tab-live-field" data-tip={activeName}>
            <AddressField
              face={face}
              focusTick={focusTick}
              onPick={onPick}
            />
          </div>
          {tabs.length > 1 && (
            <button
              type="button"
              className="panel-browser-tab-close"
              aria-label={t("关闭标签")}
              data-tip={t("关闭标签")}
              onClick={() => onClose(active.id)}
            >
              <X size={11} />
            </button>
          )}
        </div>
      )}
      {others.map((tab) => (
        <TabPill
          key={tab.id}
          tab={tab}
          closable={tabs.length > 1}
          onSelect={() => onSelect(tab.id)}
          onClose={() => onClose(tab.id)}
        />
      ))}
      <button
        type="button"
        className="panel-browser-tab-new"
        aria-label={t("新建标签")}
        data-tip={t("新建标签")}
        onClick={onNew}
      >
        <Plus size={13} />
      </button>
      <div className="panel-browser-chrome-end">{trailing}</div>
    </div>
  );
}
