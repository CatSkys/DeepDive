// 工具组行（工具执行合并的呈现，分组规则见 session/toolGroups.ts）：
// 图标 + 摘要 + 折叠箭头，与单条工具行同一观感（用户定稿 2026-10-11：
// 一律 icon·摘要，组名与分隔点不摆；2026-10-12 定稿：组头 glyph 与单条行
// 同一素材，摘要同走「动词+徽标+宾语」三段式——与单条行共用 VerbPath，
// 分段口径见 toolGroups 的 groupSummarySplit）。
// 展开体是缩进的子行并带一条左分隔线（他们 `ml-2 border-l pl-3.5` 的同款）。
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { t, tt } from "../i18n";
import { groupSummarySplit, type ToolGroupKind } from "./toolGroups";
import { IconApiOutline14, IconEditOutline16, IconSearchOutline16 } from "../components/Icons";
import { VerbPath } from "./VerbPath";
import type { RenderItem } from "./renderModel";

const GROUP_ICON: Record<ToolGroupKind, ReactNode> = {
  explore: <IconSearchOutline16 size={14} />,
  // 终端组与单条终端行同一个 glyph（此前组行用 lucide SquareTerminal，与单条行不一致）
  execute: <IconApiOutline14 size={14} />,
  changes: <IconEditOutline16 size={14} />,
};

export function ToolGroupRow({ groupKind, members, cwd, children }: {
  groupKind: ToolGroupKind;
  members: RenderItem[];
  /** 会话工作目录：组头摘要里的路径按它相对化（与单条行同一口径）。 */
  cwd?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const parts = groupSummarySplit(groupKind, members, (zh, en, vars) => tt(zh, en, vars), cwd, t);
  // 组在跑 = 末位成员还没落结果（与单条行 data-state 同一判据；流式期间最新的
  // 那条永远在末位，摘要随它更新）。
  const last = members[members.length - 1];
  const running = last ? last.output === undefined : false;
  return (
    <div className="tool-group" data-state={running ? "running" : undefined}>
      <button type="button" className="tool-group-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {GROUP_ICON[groupKind]}
        <VerbPath verb={parts.verb} text={parts.text} badgePath={parts.iconPath} cwd={cwd} summaryClass="tool-group-summary" />
        <ChevronDown size={14} className="tool-group-chevron" style={open ? undefined : { transform: "rotate(-90deg)" }} />
      </button>
      {open && <div className="tool-group-body">{children}</div>}
    </div>
  );
}
