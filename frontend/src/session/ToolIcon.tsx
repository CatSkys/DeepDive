// 工具行的语义族前导 glyph（R-007 从 SessionView 搬出）。文件语言/类型图标
// 另立 session/FileIcon.tsx（那边带 46 份素材，职责不同）。
/// 族 → 前导 glyph：骨架对齐官方 GenericToolCard 的 VARIANT_ICONS（figma 表，
/// 所有 glyph 在 16px 前导盒内按 14 渲染）：bash/pwsh → api；read 家族（含
/// web_fetch、read_image、cordis inspect）→ browse；search 家族
///（web_search/grep/glob）→ search；write/edit → edit；run_code → code；skill → 专用
/// 图标；ask_user_question → 问号（与等待回答行语义直接对应）。
/// agent/goal/schedule/job/mcp 是本仓应用级工具（官方表没有，原落 sparkle）——图标
/// 与右侧面板同语义区对齐（用户定稿「icon 取 zcode 或官方」：官方表无此族、
/// zcode 是终端无图标体系，故取面板已定稿的视觉语言 + MCP 的插头语义）：
/// Flag / CalendarClock / SquareTerminal / Plug（浏览器控制走官方地球图标）。
/// agent 族例外（2026-10-12 定稿）：前导是子智能体的雾感盘（AgentOrb），表里的
/// Bot 只是 callId 缺席时的回落记号。
/// 表按族穷举（与官方同形）：新增族漏写是类型错误，不会静默落到别的分支。

import type { ReactNode } from "react";
import { Bot, CalendarClock, Flag, Plug, SquareTerminal } from "lucide-react";
import {
  IconApiOutline14, IconBrowseOutline16, IconCodeOutline16, IconEditOutline16,
  IconGlobeOutline14, IconQuestionOutline14, IconSearchOutline16, IconSkillOutline16,
  IconSparkle16,
} from "../components/Icons";
import { AgentOrb } from "../components/AgentOrb";
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
  mcp: <Plug size={14} />,
  browser: <IconGlobeOutline14 size={14} />,
  other: <IconSparkle16 size={14} />,
};

export function ToolIcon({ name, seed }: { name: string; seed?: string }) {
  const variant = toolVariant(name);
  // agent 族的前导 = 子智能体的渐变形状头像（AgentOrb），与面板行/胶囊堆叠同一
  // 视觉语言（用户 2026-10-12 定稿：会话流里也不用机器人图标）。委派行（subagent）
  // 的 seed=委派身份串（args.description，与面板行同一身份，三处同形同色）；
  // 其余 agent 族工具行用工具调用 id。seed 缺席才回落 Bot——这档只防半成品。
  if (variant === "agent") return seed ? <AgentOrb seed={seed} size={14} /> : VARIANT_ICONS.agent;
  return <>{VARIANT_ICONS[variant]}</>;
}
