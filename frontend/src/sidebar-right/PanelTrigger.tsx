// 会话头部的右侧边栏座位（移植官方 ui-sidebar-right 的 client/shell/ExpandButton.tsx）。
//
// 官方规则：**面板隐藏时这里放一枚按钮**（图标是左栏收起图标的镜像），面板展开时这个座位
// 渲染空。本仓按用户定稿加了一条：**胶囊有内容就渲染胶囊、没内容才渲染那枚按钮**——
// 两者是同一个座位、同一个动作（开合面板），所以胶囊不再自带下拉面板，它的内容搬进了面板。
//
// 没有会话就没有这个座位（官方：Without a session there is no button and no panel）。

import { PanelRight } from "lucide-react";
import { t } from "../i18n";
import { CapsuleStatusPill } from "../components/CapsuleStatusPill";
import { panelActions, usePanelSurface } from "./panelStore";
import { useCapsuleData } from "./useCapsuleData";
import type { ScheduleRecord } from "../types";

export function PanelTrigger({ sessionId, scheduleRecords }: {
  sessionId: string;
  scheduleRecords: ScheduleRecord[];
}) {
  const surface = usePanelSurface(sessionId);
  const data = useCapsuleData(sessionId, scheduleRecords, surface.open);
  // 面板展开时座位让空（官方如此）：收起入口在面板自己的控件行里
  if (surface.open) return null;
  const toggle = () => panelActions.setOpen(sessionId, true);
  if (data.pill !== null) {
    return (
      <div className="capsule-wrap">
        <CapsuleStatusPill pill={data.pill} open={false} onToggle={toggle} />
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
