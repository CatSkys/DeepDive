// 会话头部的右侧边栏座位（移植官方 ui-sidebar-right 的 client/shell/ExpandButton.tsx）。
//
// 官方规则：**面板隐藏时这里放一枚按钮**（图标是左栏收起图标的镜像），面板展开时这个座位
// 渲染空。本仓按用户定稿加了一条：**胶囊有内容就渲染胶囊、没内容才渲染那枚按钮**——
// 两者是同一个座位、同一个动作（开合面板），所以胶囊不再自带下拉面板，它的内容搬进了面板。
//
// 浏览器那级的直达特例已撤销（2026-10-09 给过「点胶囊直达面板浏览器页」，2026-10-11
// 用户定稿收回：胶囊一律开状态面板——浏览器从面板里的屏幕缩略图进，那个入口才是
// 全屏呈现）。所有各级同一路：开合状态面板。
//
// 没有会话就没有这个座位（官方：Without a session there is no button and no panel）。

import { PanelRight } from "lucide-react";
import { t } from "../i18n";
import { CapsuleStatusPill } from "../components/CapsuleStatusPill";
import { panelActions, usePanelSurface } from "./panelStore";
import { useCapsuleData } from "./useCapsuleData";
import { useBrowserFace } from "./browserFace";
import type { ScheduleRecord } from "../types";

export function PanelTrigger({ sessionId, scheduleRecords, browser }: {
  sessionId: string;
  scheduleRecords: ScheduleRecord[];
  /** 本会话 agent 与浏览器的关系（SessionView 从事件流算出来，见 useSessionEvents）。 */
  browser: { used: boolean; live: boolean };
}) {
  const surface = usePanelSurface(sessionId);
  // 窗口级浏览器镜像：浏览器入口显示"agent 在看哪一页"（面板没开过时壳不会主动推，
  // 这个 hook 首次订阅时会要一次现状），前导图标也用同一份里的站点图标——与浏览器
  // tab 同源，胶囊和 tab 永远指着同一个站点
  const face = useBrowserFace();
  const data = useCapsuleData(sessionId, scheduleRecords, surface.open, { ...browser, title: face.title });
  // 面板展开时座位让空（官方如此）：收起入口在面板自己的控件行里
  if (surface.open) return null;
  const toggle = () => panelActions.setOpen(sessionId, true);
  if (data.pill !== null) {
    return (
      <div className="capsule-wrap">
        <CapsuleStatusPill pill={data.pill} open={false} onToggle={toggle} iconUrl={face.icon} />
      </div>
    );
  }
  return (
    <button
      type="button"
      className="panel-expand-btn"
      aria-label={t("展开边栏")}
      data-tip={t("展开边栏")}
      onClick={toggle}
    >
      <PanelRight size={15} />
    </button>
  );
}
