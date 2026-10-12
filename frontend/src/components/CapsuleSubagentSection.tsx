// 状态面板「子智能体」区的区体。结构照 ZCode 的 agents 区：**在跑的行与已结束的行
// 同区列**（已结束默认就展开，用户 2026-10-08 定："不要默认收起了"）。
// 行 = 两行（ZCode 同款）：标题行（前导图标 + 标签 + 右侧「状态 · 时长」）+ 副行
// （子会话自己的标题）。
//
// 副行为什么是标题不是"结果摘要"：那要翻子会话的历史（一面板 N 个 RPC），官方 UI
// 也只拿得到会话标题（`summaries[entry.id]?.title`）。同样只用标题，与标签重复时不显示。
// 时长照官方的 `activityDuration` 算法取投影 subagentTiming（settledMs + 进行中那一段），
// 取不到就不显示——不编数字。
import { useState } from "react";
import { ChevronDown, CircleCheck, Square } from "lucide-react";
import { t, tt } from "../i18n";
import { useStore } from "../store";
import { AgentOrb } from "./AgentOrb";
import { compactElapsed } from "../session/format";
import type { SessionSummary, SubagentListEntry } from "../types";

type ChildEntry = Extract<SubagentListEntry, { kind: "child" }>;

/** 子智能体时长（官方 `activityDuration` 的同一算法）：投影 `subagentTiming` 的 settledMs，
 *  加上「还在进行的那一段」（跑着取 now，已结束取 active.through）。投影缺字段返回
 *  undefined——宁可不显示，也不编一个数出来。 */
function subagentDurationMs(child: SessionSummary | undefined, live: boolean): number | undefined {
  const timing = (child?.projections?.values as {
    subagentTiming?: { settledMs?: number; active?: { since: number; through?: number } };
  } | undefined)?.subagentTiming;
  if (typeof timing?.settledMs !== "number") return undefined;
  if (!timing.active) return timing.settledMs;
  const end = live ? Date.now() : (timing.active.through ?? timing.active.since);
  return timing.settledMs + Math.max(0, end - timing.active.since);
}

export function CapsuleSubagentSection({ children, runningIds, diag, busy, onOpen, onInterrupt }: {
  children: ChildEntry[];
  /** 在跑的子会话 id 集合（宿主现算：会话 running 或 activity === 'running'）。 */
  runningIds: ReadonlySet<string>;
  diag: boolean;
  busy: boolean;
  onOpen: (childId: string) => void;
  onInterrupt: (childId: string) => void;
}) {
  // 默认展开（用户定稿）：已结束那几项就是要一眼看到的，折起来等于白列。
  const [showEnded, setShowEnded] = useState(true);
  const store = useStore();
  const live = children.filter((c) => runningIds.has(c.id));
  const ended = children.filter((c) => !runningIds.has(c.id));

  const renderRow = (c: ChildEntry, isLive: boolean) => {
    const child = store.sessions.find((s) => s.sessionId === c.id);
    const label = c.label ?? c.id.slice(0, 8);
    // 副行只在子会话**有自己的标题**（投影 title）时给：sessionTitle 的回退文案
    //（新会话 / 任务 xxxxxx）摆在标签下面只是噪音，不算标题；与标签同一句也不重复。
    const projected = (child?.projections?.values as { title?: string } | undefined)?.title;
    const sub = projected && projected.trim() && projected !== label ? projected : "";
    const ms = subagentDurationMs(child, isLive);
    return (
      <div key={c.id} className="capsule-row">
        <button type="button" className="capsule-row-click capsule-sub-click" onClick={() => onOpen(c.id)}>
          {/* 在跑用委派身份（label=引擎登记的 args.description，与会话流工具行/
              胶囊堆叠同一 seed——用户 2026-10-12 定稿三处同形同色；无 label 回落
              子会话 id）；已结束用**对勾**——ZCode 的 agents 行就是勾，用户
              2026-10-08 指出"已完成前面应该是勾"。对勾描边色随行继承 --ink-3
              （勾本身即状态，不带色彩语义）。 */}
          {isLive
            ? <AgentOrb seed={c.label ?? c.id} size={16} className="capsule-row-icon" />
            : <CircleCheck size={15} className="capsule-row-icon" aria-hidden="true" />}
          <span className="capsule-sub-main">
            {/* 在跑时标签自己脉冲（capsule-live-text，与胶囊 live 文本同一手法，
                用户 2026-10-12 定稿：子智能体行也要表现运行态）；已结束不脉冲 */}
            <span className={`capsule-sub-label${isLive ? " capsule-live-text" : ""}`}>{label}</span>
            {sub && <span className="capsule-sub-line">{sub}</span>}
          </span>
          <span className="capsule-row-meta">
            {isLive ? t("运行中") : t("已结束")}
            {ms !== undefined && ` · ${compactElapsed(ms)}`}
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
  };

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
