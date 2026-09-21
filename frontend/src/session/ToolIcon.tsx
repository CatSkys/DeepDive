// 工具图标与语言徽标（R-007 从 SessionView 搬出）：ToolIcon 分流、
// LANG_BADGES 配色表、React/文件语言标。
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


/// 文件语言徽标 — 文件工具行按扩展名显示彩色语言图标（DSH 编辑行同款）：
/// tsx/jsx 画 React 原子标，其余用 VS Code 风格的彩色缩写徽标。
const LANG_BADGES: Record<string, { bg: string; fg?: string; label: string }> = {
  ts: { bg: "#3178C6", label: "TS" },
  js: { bg: "#F7DF1E", fg: "#323330", label: "JS" },
  mjs: { bg: "#F7DF1E", fg: "#323330", label: "JS" },
  cjs: { bg: "#F7DF1E", fg: "#323330", label: "JS" },
  css: { bg: "#663399", label: "CSS" },
  scss: { bg: "#CF649A", label: "SCS" },
  less: { bg: "#2B5E91", label: "LES" },
  json: { bg: "#E8A33D", fg: "#26221E", label: "{}" },
  md: { bg: "#519ABA", label: "MD" },
  txt: { bg: "#6E7681", label: "TXT" },
  py: { bg: "#3572A5", label: "PY" },
  rs: { bg: "#CE4A2F", label: "RS" },
  go: { bg: "#00ADD8", label: "GO" },
  rb: { bg: "#CC342D", label: "RB" },
  php: { bg: "#777BB4", label: "PHP" },
  java: { bg: "#B07219", label: "JAVA" },
  swift: { bg: "#F05138", label: "SW" },
  vue: { bg: "#41B883", label: "VUE" },
  html: { bg: "#E34C26", label: "<>" },
  sh: { bg: "#89E051", fg: "#243018", label: "$" },
  bash: { bg: "#89E051", fg: "#243018", label: "$" },
  zsh: { bg: "#89E051", fg: "#243018", label: "$" },
  yml: { bg: "#CB171E", label: "YML" },
  yaml: { bg: "#CB171E", label: "YML" },
  toml: { bg: "#9C4221", label: "TML" },
  sql: { bg: "#DD6B20", label: "SQL" },
};


export function ReactLangIcon() {
  return (
    <svg className="lang-badge" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#61DAFB" strokeWidth="1.4" aria-hidden="true">
      <circle cx="12" cy="12" r="2.1" fill="#61DAFB" stroke="none" />
      <ellipse cx="12" cy="12" rx="10" ry="4.2" />
      <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(120 12 12)" />
    </svg>
  );
}


export function FileLangIcon({ file }: { file: string }) {
  const name = file.split(/[/\\]/).pop() ?? file;
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (ext === "tsx" || ext === "jsx") return <ReactLangIcon />;
  const badge = LANG_BADGES[ext];
  if (!badge) return null;
  return (
    <span className="lang-badge" style={{ background: badge.bg, color: badge.fg ?? "#FFFFFF" }} aria-hidden="true">
      {badge.label}
    </span>
  );
}


