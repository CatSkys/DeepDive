// 「查阅」组行（工具执行合并的呈现，分组规则见 session/toolGroups.ts）。
// 照 ZCode explore.tsx：一行摘要 = 组标签 + 分隔点 + 按桶计数（N 搜索, M 文件），
// 右侧折叠箭头；展开体是**缩进的子行**（他们的子行不带前导图标、并带一条左分隔线，
// 这里同样只给一条左线，子行自己的呈现交给调用方传进来的 children）。
import { useState, type ReactNode } from "react";
import { ChevronDown, Search } from "lucide-react";
import { tt } from "../i18n";
import { EXPLORE_LABEL, formatExploreSummary } from "./toolGroups";
import type { RenderItem } from "./renderModel";

export function ExploreGroupRow({ members, children }: { members: RenderItem[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const summary = formatExploreSummary(members, (zh, en) => tt(zh, en));
  return (
    <div className="explore-group">
      <button type="button" className="explore-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Search size={14} />
        <span className="explore-label">{tt(...EXPLORE_LABEL)}</span>
        <span className="explore-sep" aria-hidden="true">·</span>
        <span className="explore-summary">{summary}</span>
        <ChevronDown size={13} className="explore-chevron" style={open ? undefined : { transform: "rotate(-90deg)" }} />
      </button>
      {open && <div className="explore-body">{children}</div>}
    </div>
  );
}
