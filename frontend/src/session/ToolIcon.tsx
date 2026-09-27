// 工具行的语义族前导 glyph（R-007 从 SessionView 搬出）。文件语言/类型图标
// 另立 session/FileIcon.tsx（那边带 46 份素材，职责不同）。
/// 族 → 前导 glyph：骨架对齐官方 GenericToolCard 的 VARIANT_ICONS（figma 表，
/// 所有 glyph 在 16px 前导盒内按 14 渲染）：bash/pwsh → api；read 家族（含
/// web_fetch、read_image、cordis inspect）→ browse；search 家族
///（web_search/grep/glob）→ search；write/edit → edit；run_code → code；skill → 专用
/// 图标；ask_user_question → 问号（与等待回答行语义直接对应）。
/// agent/goal/schedule/job 是本仓应用级工具（官方表没有，原落 sparkle）——图标
/// 与右侧面板同语义区对齐（用户定稿：子智能体就是机器人）：Bot / Flag /
/// CalendarClock / SquareTerminal，取 lucide 同款。
/// 表按族穷举（与官方同形）：新增族漏写是类型错误，不会静默落到别的分支。

import type { ReactNode } from "react";
import { Bot, CalendarClock, Flag, SquareTerminal } from "lucide-react";
import {
  IconApiOutline14, IconBrowseOutline16, IconCodeOutline16, IconEditOutline16,
  IconQuestionOutline14, IconSearchOutline16, IconSkillOutline16, IconSparkle16,
} from "../components/Icons";
import { toolVariant, type ToolVariant } from "./toolKind";

const VARIANT_ICONS: Record<ToolVariant, ReactNode> = {
  shell: <IconApiOutline14 size={14} />,
  edit: <IconEditOutline16 size={14} />,
  read: <IconBrowseOutline16 size={14} />,
  search: <IconSearchOutline16 size={14} />,
  code: <IconCodeOutline16 size={14} />,
  skill: <IconSkillOutline16 size={14} />,
  question: <IconQuestionOutline14 size={14} />,
  agent: <Bot size={14} />,
  goal: <Flag size={14} />,
  schedule: <CalendarClock size={14} />,
  job: <SquareTerminal size={14} />,
  other: <IconSparkle16 size={14} />,
};

export function ToolIcon({ name }: { name: string }) {
  return <>{VARIANT_ICONS[toolVariant(name)]}</>;
}
