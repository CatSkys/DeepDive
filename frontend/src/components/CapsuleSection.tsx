// 状态面板的一个分区，照 ZCode ConversationStatusPanel 的 StatusSection /
// StatusSectionHeader 搬：
//  - 区头是一个可折叠触发器（标题 + 箭头），**箭头平时不显**（opacity 0），
//    hover 或键盘聚焦才出现——它只作可折叠的提示，不占视觉；
//  - 标题右侧是 trailing 槽（计数、时长、刷新钮之类的附属信息）；
//  - 区体限高内滚：滚动视口放在折叠内容**内部**，标题与控制因此始终固定，
//    折叠动画也不被破坏；
//  - 区头不带图标（他们如此；行的前导图标仍在各行上）。
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function CapsuleSection({ title, trailing, defaultOpen = true, scroll = "normal", children }: {
  title: string;
  /** 标题右侧的附属信息（计数/时长/刷新钮）。 */
  trailing?: ReactNode;
  defaultOpen?: boolean;
  /** 区体限高档：none 不限高（Git 区行少且含输入框）；tall 给计划类两倍高度
   *  （同 ZCode STATUS_SECTION_SCROLL_POLICY 的 plan=max-h-80，其余 max-h-48）。 */
  scroll?: "none" | "normal" | "tall";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="capsule-sec">
      <div className="capsule-sec-head">
        <button type="button" className="capsule-sec-trigger" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="capsule-sec-title">{title}</span>
          {open
            ? <ChevronDown size={14} className="capsule-sec-chevron" />
            : <ChevronRight size={14} className="capsule-sec-chevron" />}
        </button>
        {trailing ? <span className="capsule-sec-trail">{trailing}</span> : null}
      </div>
      {open && (
        <div
          className={scroll === "none" ? "capsule-sec-body" : "capsule-sec-body capsule-sec-scroll"}
          data-tall={scroll === "tall" ? "" : undefined}
        >
          {children}
        </div>
      )}
    </div>
  );
}
