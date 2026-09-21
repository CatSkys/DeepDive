// 工具行的语义族前导 glyph（R-007 从 SessionView 搬出）。文件语言/类型图标
// 另立 session/FileIcon.tsx（那边带 46 份素材，职责不同）。
/// 族 → 前导 glyph：对齐官方 tool-call-model 的 TOOL_VARIANTS 与 GenericToolCard 的
/// VARIANT_ICONS（figma 表，所有 glyph 在 16px 前导盒内按 14 渲染）：bash/pwsh →
/// api；read 家族（含 web_fetch、read_image、cordis inspect）→ browse；search 家族
/// （web_search/grep/glob）→ search；write/edit → edit；run_code → code；skill → 专用
/// 图标；未分类（含 mcp__*、jobs/goal/subagent 等）→ sparkle。ask_user_question 保留
/// 问号：与等待回答行语义直接对应。
/// 表按族穷举（与官方同形）：新增族漏写是类型错误，不会静默落到别的分支。

import type { ReactNode } from "react";
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
  other: <IconSparkle16 size={14} />,
};

export function ToolIcon({ name }: { name: string }) {
  return <>{VARIANT_ICONS[toolVariant(name)]}</>;
}
