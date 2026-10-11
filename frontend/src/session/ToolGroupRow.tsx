// 工具组行（工具执行合并的呈现，分组规则见 session/toolGroups.ts）：
// 图标 + 分隔点 + 摘要 + 折叠箭头，与单条工具行同一观感（用户定稿 2026-10-11：
// 一律 icon·摘要，组名不摆——类别由图标承载；运行中由摘要文字脉冲表示）。
// 展开体是缩进的子行并带一条左分隔线（他们 `ml-2 border-l pl-3.5` 的同款）。
import { useState, type ReactNode } from "react";
import { ChevronDown, Pencil, Search } from "lucide-react";
import { tt } from "../i18n";
import { formatGroupSummary, type ToolGroupKind } from "./toolGroups";
import { IconApiOutline14 } from "../components/Icons";
import type { RenderItem } from "./renderModel";

const GROUP_ICON: Record<ToolGroupKind, ReactNode> = {
  explore: <Search size={14} />,
  // 终端组与单条终端行同一个 glyph（此前组行用 lucide SquareTerminal，与单条行不一致）
  execute: <IconApiOutline14 size={14} />,
  changes: <Pencil size={14} />,
};

export function ToolGroupRow({ groupKind, members, children }: {
  groupKind: ToolGroupKind;
  members: RenderItem[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const summary = formatGroupSummary(groupKind, members, (zh, en, vars) => tt(zh, en, vars));
  // 组在跑 = 末位成员还没落结果（与单条行 data-state 同一判据；流式期间最新的
  // 那条永远在末位，摘要随它更新）。
  const last = members[members.length - 1];
  const running = last ? last.output === undefined : false;
  return (
    <div className="tool-group" data-state={running ? "running" : undefined}>
      <button type="button" className="tool-group-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {GROUP_ICON[groupKind]}
        <span className="tool-group-sep" aria-hidden="true">·</span>
        <span className="tool-group-summary">{summary}</span>
        <ChevronDown size={14} className="tool-group-chevron" style={open ? undefined : { transform: "rotate(-90deg)" }} />
      </button>
      {open && <div className="tool-group-body">{children}</div>}
    </div>
  );
}
