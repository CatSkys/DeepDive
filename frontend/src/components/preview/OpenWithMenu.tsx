// 「打开方式」选择器（全屏预览页右上）：分离按钮——主钮（当前 App 图标）直接用
// 它打开文件，右侧箭头开候选菜单；两者各自可点、发丝线分隔（形态照官方
// ui-open-in-app 的 OpenInAppAction：主钮=launch、箭头=menu）。
// 下拉右缘与箭头右缘对齐；行 = 图标 + 名称 + 当前项打勾；名称超限走本仓超限规范
// （ellipsis + HoverScrollText hover 滚动，滚动中两侧渐隐）。
// 菜单铬件复用全局 .ctx-menu / .ctx-item（与右键菜单同一材质），不另写一套。
// 数据源是壳桥（OpenWithCatalog）；纯浏览器/无候选时整个入口隐藏。

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { HoverScrollText } from "../HoverScrollText";
import { openWith, openWithList, type OpenWithApp } from "../../host";
import { t, tt } from "../../i18n";
import { Popover } from "../Popover";

/** 菜单与胶囊的间距、宽度上限（超限即截断走 HoverScrollText）。 */
const MENU_GAP = 6;
const MENU_MAX_W = 300;

export function OpenWithMenu({ path }: { path: string }) {
  const [apps, setApps] = useState<OpenWithApp[]>([]);
  /** 用户在本页选过的 App；未选过时跟壳给的默认项。 */
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    setApps([]);
    setPicked(null);
    void openWithList(path).then((listing) => {
      if (!alive) return;
      setApps(listing.apps);
      setPicked(listing.defaultId || listing.apps[0]?.id || null);
    });
    return () => { alive = false; };
  }, [path]);

  if (apps.length === 0 || picked === null) return null;
  const current = apps.find((a) => a.id === picked) ?? apps[0];
  /** 主钮文案（tip 与无障碍名同一句）：点它就用当前 App 打开，不开菜单。 */
  const openLabel = tt("用 {app} 打开", "Open in {app}", { app: current.name });

  const toggle = () => setOpen((o) => !o);

  return (
    <span className="open-with">
      <span className="open-with-split">
        <button
          type="button"
          className="open-with-main"
          data-tip={openLabel}
          aria-label={openLabel}
          onClick={() => openWith(path, current.id)}
        >
          <img src={current.icon} alt="" width={16} height={16} />
        </button>
        <button
          ref={triggerRef}
          type="button"
          className="open-with-chevron"
          data-tip={t("打开方式")}
          aria-label={t("打开方式")}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={toggle}
        >
          <ChevronDown size={12} />
        </button>
      </span>
      {/* 右缘与箭头右缘对齐（align="end"） */}
      <Popover
        open={open}
        anchor={triggerRef}
        onClose={() => setOpen(false)}
        sideOffset={MENU_GAP}
        align="end"
        className="ctx-menu open-with-menu"
        role="listbox"
        aria-label={t("打开方式")}
        contentRef={menuRef}
        style={{ maxWidth: MENU_MAX_W }}
      >
          {apps.map((app) => (
            <button
              key={app.id}
              type="button"
              role="option"
              aria-selected={app.id === picked}
              className="ctx-item open-with-item"
              onClick={() => {
                setOpen(false);
                setPicked(app.id);
                openWith(path, app.id);
              }}
            >
              <img src={app.icon} alt="" width={15} height={15} />
              <HoverScrollText className="open-with-name">{app.name}</HoverScrollText>
              {app.id === picked && <Check size={14} className="open-with-check" />}
            </button>
          ))}
      </Popover>
    </span>
  );
}
