// 状态面板收起态的 pill（对应 ZCode ConversationStatusPanel 的 StatusSummaryRow +
// StatusSummaryMetric）：显示什么由 capsuleModel 的回落链算好，这里只按 kind 画图标与文案。
// 前导图标是**两层叠放**（他们 StatusSummaryMetric 的原样）：常态图标 absolute inset-0、
// hover/focus 淡出，Maximize2（"展开"）同位淡入——pill 是"点开面板"的入口，hover 时
// 用那枚图标把这件事说清楚。aria-label 与 tooltip 都是"展开状态"（他们的 zh 值）；
// **浏览器那一级例外**：它点开的是面板的浏览器页（去看 agent 在看的那个页面），
// 所以它自己的 tip 说的是这件事。
import { AlarmClock, ArrowRight, Bot, CircleCheck, FileDiff, Flag, History, Maximize2 } from "lucide-react";
import { t, tt } from "../i18n";
import { IconGlobeOutline14 } from "./Icons";
import type { CapsulePill } from "./capsuleModel";

/** 各级的前导图标（常态那一层）。 */
function PillIcon({ pill }: { pill: CapsulePill }) {
  if (pill.kind === "todo") return <ArrowRight size={13} />;
  if (pill.kind === "goal") return pill.done ? <CircleCheck size={13} className="capsule-check" /> : <Flag size={13} />;
  if (pill.kind === "git") return <FileDiff size={13} />;
  if (pill.kind === "todoDone") return <CircleCheck size={13} className="capsule-check" />;
  if (pill.kind === "running") return <Bot size={13} />;
  if (pill.kind === "schedule") return <AlarmClock size={13} />;
  // 浏览器用官方那枚地球——与工具行、设置页导航里「浏览器」同一个记号
  if (pill.kind === "browser") return <IconGlobeOutline14 size={13} />;
  return <History size={13} />;
}

/** 图标右侧的正文（各级不同）。 */
function PillBody({ pill }: { pill: CapsulePill }) {
  if (pill.kind === "todo") return <>
    <span className="capsule-pill-text">{pill.text}</span>
    <span className="capsule-pill-meta">{pill.done}/{pill.total}</span>
  </>;
  if (pill.kind === "goal") return <span className="capsule-pill-text">{pill.title}</span>;
  if (pill.kind === "git") return (
    <span className="capsule-pill-meta"><b className="capsule-add">+{pill.additions}</b> <b className="capsule-del">−{pill.deletions}</b></span>
  );
  if (pill.kind === "todoDone") return <span className="capsule-pill-text">{pill.text}</span>;
  if (pill.kind === "running") return <>
    <span>{tt("{n} 运行中", "{n} running", { n: pill.count })}</span>
    <span className="capsule-live" aria-hidden="true" />
  </>;
  if (pill.kind === "schedule") return <>
    <span className="capsule-pill-text">{pill.prompt}</span>
    <span className="capsule-pill-meta">{pill.when}</span>
  </>;
  if (pill.kind === "browser") return <>
    {/* 页面标题拿不到（空白标签/还没解析出来）时只给"浏览器"这个词 */}
    <span className="capsule-pill-text">{pill.title || t("浏览器")}</span>
    {pill.live && <span className="capsule-live" aria-hidden="true" />}
  </>;
  return <span className="capsule-pill-meta">{tt("{n} 项已结束", "{n} ended", { n: pill.count })}</span>;
}

export function CapsuleStatusPill({ pill, open, onToggle }: {
  pill: CapsulePill;
  open: boolean;
  onToggle: () => void;
}) {
  // 浏览器那一级点开的是浏览器页（不是状态面板），tip 跟着说清楚去哪儿
  const label = pill.kind === "browser" ? tt("查看浏览器", "View browser") : tt("展开状态", "Expand status");
  return (
    <button
      type="button"
      className="capsule-trigger"
      data-tip={label}
      aria-label={label}
      data-open={open ? "true" : "false"}
      onClick={onToggle}
    >
      <span className="capsule-pill-icon" aria-hidden="true">
        <span><PillIcon pill={pill} /></span>
        <Maximize2 size={14} className="capsule-pill-expand" />
      </span>
      <PillBody pill={pill} />
    </button>
  );
}
