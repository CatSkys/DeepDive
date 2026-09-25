// 状态面板「子智能体」区的区体。结构照 ZCode 的 agents 区：**在跑的行直接列，
// 已结束的折成一行**——他们给已结束的另配一个目录页（侧栏），本仓没有那个页，
// 等价的落点就是就地展开（与后台任务区同一套处理）。
import { useState } from "react";
import { ChevronDown, Square, SquareTerminal } from "lucide-react";
import { t, tt } from "../i18n";
import type { SubagentListEntry } from "../types";

type ChildEntry = Extract<SubagentListEntry, { kind: "child" }>;

export function CapsuleSubagentSection({ children, runningIds, diag, busy, onOpen, onInterrupt }: {
  children: ChildEntry[];
  /** 在跑的子会话 id 集合（宿主现算：会话 running 或 activity === 'running'）。 */
  runningIds: ReadonlySet<string>;
  diag: boolean;
  busy: boolean;
  onOpen: (childId: string) => void;
  onInterrupt: (childId: string) => void;
}) {
  const [showEnded, setShowEnded] = useState(false);
  const live = children.filter((c) => runningIds.has(c.id));
  const ended = children.filter((c) => !runningIds.has(c.id));

  const renderRow = (c: ChildEntry, isLive: boolean) => (
    <div key={c.id} className="capsule-row">
      <button type="button" className="capsule-row-click" onClick={() => onOpen(c.id)}>
        <SquareTerminal size={16} className="capsule-row-icon" aria-hidden="true" />
        <span className="capsule-row-text">{c.label ?? c.id.slice(0, 8)}</span>
        <span className="capsule-row-meta">
          {c.mode === "continuable" ? t("可续") : t("一次性")}
          {isLive ? ` · ${t("运行中")}` : ""}
        </span>
      </button>
      {/* Stop 只在"还在跑且可续"时给（ZCode 对子智能体同样带 guard） */}
      {isLive && c.mode === "continuable" && (
        <button type="button" className="capsule-stop" data-tip={t("中断子智能体")} disabled={busy} onClick={() => onInterrupt(c.id)}>
          <Square size={11} />
        </button>
      )}
    </div>
  );

  return (
    <>
      {live.map((c) => renderRow(c, true))}
      {ended.length > 0 && (
        <>
          <button type="button" className="capsule-sec-toggle" onClick={() => setShowEnded((v) => !v)}>
            <ChevronDown size={12} style={showEnded ? undefined : { transform: "rotate(-90deg)" }} />
            {tt("已结束 {n} 项", "Ended {n}", { n: ended.length })}
          </button>
          {showEnded && ended.map((c) => renderRow(c, false))}
        </>
      )}
      {diag && <div className="capsule-note">{t("部分子会话状态不可读")}</div>}
    </>
  );
}
