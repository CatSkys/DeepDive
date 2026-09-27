// 工具组行（工具执行合并的呈现，分组规则见 session/toolGroups.ts）：
// 图标 + 组标签 + 分隔点 + 摘要 + 折叠箭头，**三类共用这一行**，只有图标与文案不同
// （查阅 Search / 终端 SquareTerminal / 更改 Pencil，照他们的口径）。展开体是缩进的
// 子行并带一条左分隔线（他们 `ml-2 border-l pl-3.5` 的同款）。
import { useState, type ReactNode } from "react";
import { ChevronDown, Pencil, Search, SquareTerminal } from "lucide-react";
import { tt } from "../i18n";
import { GROUP_LABEL, formatGroupSummary, type ToolGroupKind } from "./toolGroups";
import type { RenderItem } from "./renderModel";

const GROUP_ICON: Record<ToolGroupKind, ReactNode> = {
  explore: <Search size={14} />,
  execute: <SquareTerminal size={14} />,
  changes: <Pencil size={14} />,
};

export function ToolGroupRow({ groupKind, members, children }: {
  groupKind: ToolGroupKind;
  members: RenderItem[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const summary = formatGroupSummary(groupKind, members, (zh, en, vars) => tt(zh, en, vars));
  return (
    <div className="tool-group">
      <button type="button" className="tool-group-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {GROUP_ICON[groupKind]}
        <span className="tool-group-label">{tt(...GROUP_LABEL[groupKind])}</span>
        <span className="tool-group-sep" aria-hidden="true">·</span>
        <span className="tool-group-summary">{summary}</span>
        <ChevronDown size={14} className="tool-group-chevron" style={open ? undefined : { transform: "rotate(-90deg)" }} />
      </button>
      {open && <div className="tool-group-body">{children}</div>}
    </div>
  );
}
