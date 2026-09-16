// 「打开方式」选择器（全屏预览页右上）：分离按钮——主钮（当前 App 图标）直接用
// 它打开文件，右侧箭头开候选菜单；两者各自可点、发丝线分隔（形态照官方
// ui-open-in-app 的 OpenInAppAction：主钮=launch、箭头=menu）。
// 下拉右缘与箭头右缘对齐；行 = 图标 + 名称 + 当前项打勾；名称超限走本仓超限规范
// （ellipsis + HoverScrollText hover 滚动，滚动中两侧渐隐）。
// 菜单铬件复用全局 .ctx-menu / .ctx-item（与右键菜单同一材质），不另写一套。
// 数据源是壳桥（OpenWithCatalog）；纯浏览器/无候选时整个入口隐藏。

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { HoverScrollText } from "../HoverScrollText";
import { openWith, openWithList, type OpenWithApp } from "../../host";
import { t, tt } from "../../i18n";

/** 菜单与胶囊的间距、宽度上限（超限即截断走 HoverScrollText）。 */
const MENU_GAP = 6;
const MENU_MAX_W = 300;

export function OpenWithMenu({ path }: { path: string }) {
  const [apps, setApps] = useState<OpenWithApp[]>([]);
  /** 用户在本页选过的 App；未选过时跟壳给的默认项。 */
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const splitRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open) return;
    // 菜单自身的点击算"内部"：否则 mousedown 先判外部点击卸载菜单，click 到不了行
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!splitRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (apps.length === 0 || picked === null) return null;
  const current = apps.find((a) => a.id === picked) ?? apps[0];
  /** 主钮文案（tip 与无障碍名同一句）：点它就用当前 App 打开，不开菜单。 */
  const openLabel = tt("用 {app} 打开", "Open in {app}", { app: current.name });

  const toggle = () => {
    if (!open) {
      const r = triggerRef.current?.getBoundingClientRect();
      // 右缘对齐：菜单右边界 = 视口右 - 箭头右边界
      if (r) setPos({ top: r.bottom + MENU_GAP, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen((o) => !o);
  };

  return (
    <span className="open-with">
      <span ref={splitRef} className="open-with-split">
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
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="ctx-menu open-with-menu"
          role="listbox"
          aria-label={t("打开方式")}
          style={{ position: "fixed", top: pos.top, right: pos.right, maxWidth: MENU_MAX_W }}
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
        </div>,
        document.body,
      )}
    </span>
  );
}
