// 插件页（设置 → 插件）：页内 tab 容器 —— 插件 / MCP / 技能各一个 tab。
//
// 分 tab 的理由：三块的数据来源与写路径完全不同（插件走引擎只读投影 + 壳写 patch 落账；
// MCP 走壳写 patch 的 insert 行；技能走壳读盘），混在一屏里几张卡片会让人分不清
// "这个开关归谁管"。

import { useState } from "react";
import { Search } from "lucide-react";
import { useT } from "../i18n";
import css from "./Plugins.module.css";
import { McpTab } from "./McpTab";
import { PluginsTab } from "./PluginsTab";
import { SkillsTab } from "./SkillsTab";

type TabId = "plugins" | "mcp" | "skills";

const TABS: ReadonlyArray<{ id: TabId; label: string; placeholder: string }> = [
  { id: "plugins", label: "插件", placeholder: "搜索插件" },
  { id: "mcp", label: "MCP", placeholder: "搜索 MCP 服务器" },
  { id: "skills", label: "技能", placeholder: "搜索技能" },
];

export function PluginsSection({ onTryPlugin }: { onTryPlugin: (moduleName: string) => void }) {
  const { t } = useT();
  const [tab, setTab] = useState<TabId>("plugins");
  const [query, setQuery] = useState("");

  const switchTab = (next: TabId) => {
    setTab(next);
    // 三个 tab 搜的是完全不同的东西，留着上一个 tab 的词只会得到空列表
    setQuery("");
  };

  const active = TABS.find((item) => item.id === tab) ?? TABS[0];

  return (
    <>
      <div className={css.pageSubtitle}>{t("管理插件、技能和 MCP")}</div>
      <div className={css.tabs} role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            className={`${css.tab}${tab === item.id ? ` ${css.tabActive}` : ""}`}
            onClick={() => switchTab(item.id)}
          >
            {t(item.label)}
          </button>
        ))}
      </div>

      <div className={css.search}>
        <Search size={14} className={css.searchIcon} />
        <input
          className={css.searchInput}
          value={query}
          placeholder={t(active.placeholder)}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {tab === "plugins" && <PluginsTab query={query} onTryPlugin={onTryPlugin} />}
      {tab === "mcp" && <McpTab query={query} />}
      {tab === "skills" && <SkillsTab query={query} />}
    </>
  );
}
