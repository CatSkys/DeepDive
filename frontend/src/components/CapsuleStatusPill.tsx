// 状态面板收起态的 pill（对应 ZCode ConversationStatusPanel 的 StatusSummaryRow）：
// 显示什么由 capsuleModel 的回落链算好，这里只按 kind 画图标与文案。
// 七种形态对应链上各级：当前任务 / 活动中的目标 / 改动 / 已完成的目标 /
// 最后一条已完成任务 / 运行中计数 / 提醒 / 已结束计数。
import { AlarmClock, ArrowRight, Bot, CircleCheck, FileDiff, Flag, History } from "lucide-react";
import { t, tt } from "../i18n";
import type { CapsulePill } from "./capsuleModel";

export function CapsuleStatusPill({ pill, open, onToggle }: {
  pill: CapsulePill;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" className="capsule-trigger" data-tip={t("摘要")} data-open={open ? "true" : "false"} onClick={onToggle}>
      {pill.kind === "todo" && <>
        <ArrowRight size={13} />
        <span className="capsule-pill-text">{pill.text}</span>
        <span className="capsule-pill-meta">{pill.done}/{pill.total}</span>
      </>}
      {pill.kind === "goal" && <>
        {pill.done ? <CircleCheck size={13} className="capsule-check" /> : <Flag size={13} />}
        <span className="capsule-pill-text">{pill.title}</span>
      </>}
      {pill.kind === "git" && <>
        <FileDiff size={13} />
        <span className="capsule-pill-meta"><b className="capsule-add">+{pill.additions}</b> <b className="capsule-del">−{pill.deletions}</b></span>
      </>}
      {pill.kind === "todoDone" && <>
        <CircleCheck size={13} className="capsule-check" />
        <span className="capsule-pill-text">{pill.text}</span>
      </>}
      {pill.kind === "running" && <>
        <Bot size={13} />
        <span>{tt("{n} 运行中", "{n} running", { n: pill.count })}</span>
        <span className="capsule-live" aria-hidden="true" />
      </>}
      {pill.kind === "schedule" && <>
        <AlarmClock size={13} />
        <span className="capsule-pill-text">{pill.prompt}</span>
        <span className="capsule-pill-meta">{pill.when}</span>
      </>}
      {pill.kind === "ended" && <>
        <History size={13} />
        <span className="capsule-pill-meta">{tt("{n} 项已结束", "{n} ended", { n: pill.count })}</span>
      </>}
    </button>
  );
}
