// 状态面板收起态的 pill（对应 ZCode ConversationStatusPanel 的 StatusSummaryRow +
// StatusSummaryMetric）：显示什么由 capsuleModel 的回落链算好，这里只按 kind 画图标与文案。
// 前导图标是**两层叠放**（他们 StatusSummaryMetric 的原样）：常态图标 absolute inset-0、
// hover/focus 淡出，Maximize2（"展开"）同位淡入——pill 是"点开面板"的入口，hover 时
// 用那枚图标把这件事说清楚。aria-label 与 tooltip 都是"展开状态"（他们的 zh 值）。
import { useState, type ReactNode } from "react";
import { AlarmClock, ArrowRight, Bot, CircleCheck, FileDiff, Flag, History, Maximize2 } from "lucide-react";
import { t, tt } from "../i18n";
import { IconGlobeOutline14 } from "./Icons";
import type { CapsulePill } from "./capsuleModel";

/** 各级的前导图标（常态那一层）。`iconUrl` 是站点自己声明的图标地址（壳问来的），
 *  有就画它——**与浏览器 tab 同一个来源**，所以胶囊与 tab 永远指向同一个站点；
 *  没有、或取回来加载失败，就退回本级自己的记号。图标地址由壳决定（页面声明的
 *  `link[rel~=icon]`，页面没声明则退到站点根的 `/favicon.ico`），这里只负责画。 */
function PillIcon({ pill, iconUrl }: { pill: CapsulePill; iconUrl?: string }) {
  if (iconUrl) return <SiteFavicon url={iconUrl} fallback={<PillGlyph pill={pill} />} />;
  return <PillGlyph pill={pill} />;
}

/** 站点图标本体。两个细节都不是可选项：
 *  · `referrerPolicy="no-referrer"`——不少站点的图标 CDN 做防盗链，带 Referer 直接
 *    403（实测小红书 xhscdn.com：带 Referer 403、不带 200），图标就永远取不到；
 *  · `onError` 回退——加载失败时渲染一颗碎图，不回退就成了胶囊前面一个空槽
 *    （这正是"没拿到 icon 时显示不对"的成因）。 */
function SiteFavicon({ url, fallback }: { url: string; fallback: ReactNode }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <>{fallback}</>;
  return (
    <img className="capsule-pill-favicon" src={url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
  );
}

/** 本级自己的记号（站点图标缺省/取不到时用）。 */
function PillGlyph({ pill }: { pill: CapsulePill }) {
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

/** 图标右侧的正文（各级不同）。`live` 那一级不摆状态点，**由文字自己脉冲**——
 *  与运行中的工具行、思考行同一手法（用户 2026-10-09 定稿，见 UI-SPEC §2.1）。 */
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
  if (pill.kind === "running") return <span className="capsule-live-text">{tt("{n} 运行中", "{n} running", { n: pill.count })}</span>;
  if (pill.kind === "schedule") return <>
    <span className="capsule-pill-text">{pill.prompt}</span>
    <span className="capsule-pill-meta">{pill.when}</span>
  </>;
  if (pill.kind === "browser") return <span className={`capsule-pill-text${pill.live ? " capsule-live-text" : ""}`}>{pill.title || t("浏览器")}</span>;
  return <span className="capsule-pill-meta">{tt("{n} 项已结束", "{n} ended", { n: pill.count })}</span>;
}

export function CapsuleStatusPill({ pill, open, onToggle, iconUrl }: {
  pill: CapsulePill;
  open: boolean;
  onToggle: () => void;
  /** 站点图标地址（浏览器那一级用；与浏览器 tab 同一来源）。其余级别忽略。 */
  iconUrl?: string;
}) {
  const label = tt("展开状态", "Expand status");
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
        <span><PillIcon pill={pill} iconUrl={pill.kind === "browser" ? iconUrl : undefined} /></span>
        <Maximize2 size={14} className="capsule-pill-expand" />
      </span>
      <PillBody pill={pill} />
    </button>
  );
}
