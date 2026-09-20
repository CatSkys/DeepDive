// 前端侧内建命令表：项目里唯一一份「内建命令元数据」。两个消费面——
// ① 会话内：引擎 commands/list 出事实（哪些命令在列、参数提示），本表只补
//    中文说明与行图标（引擎内建命令返回英文原文，中文化在 UI 层，与官方
//    ui-commands 同一分工）；
// ② 草稿页：没有 agent，引擎目录不可达（commands/list 的 agentId 必填），
//    用本表合成一份兜底车道的目录（draftCommands），草稿页才能发现并执行
//    内建命令。
// 事实源仍是引擎：本表的 name/hint 抄自引脚版本（scripts/dsh-runtime-version.txt）
// 的 commands/list，升引擎时对照复核。边界：插件注册的命令只出现在会话车道，
// 草稿页车道列不出来。/export 不在表内——引擎在列但官方面按下载流呈现，
// SPA 无承接（DSH-WIRE §6）。

import {
  ClipboardList, Route, ShieldCheck, Shrink, TerminalSquare, type LucideIcon,
} from "lucide-react";
import type { CommandDescriptor } from "../../types";

export interface BuiltinCommand {
  /** 无斜杠小写命令名（引擎同名，parseCommand 口径）。 */
  name: string;
  /** 中文说明（菜单行的主文案）。 */
  zh: string;
  /** 引擎 input.hint 原文。有 input 即表示命令吃自由输入：菜单点击是 claim
   *  （插 /name 续输）而非直发——这一位是菜单行为的开关，勿当纯文案。 */
  hint?: string;
  /** 行图标；缺省（插件命令）走通用终端图标。 */
  icon?: LucideIcon;
}

const BUILTINS: BuiltinCommand[] = [
  { name: "attach-workspaces", zh: "把已导入会话重新挂到匹配的工作区", hint: "[--mode auto|dedicated|per-project] [--dir <path>]" },
  { name: "compact", zh: "压缩更早的会话历史", icon: Shrink },
  { name: "doctor", zh: "只读健康检查（导入注册表/会话/技能）", hint: "无需参数" },
  { name: "feedback", zh: "记录本会话的反馈", hint: "<text>", icon: ClipboardList },
  { name: "goal", zh: "设定或查看长任务的 Goal", hint: "[<objective>|clear|edit <objective>|pause|resume]" },
  { name: "import", zh: "从外部聊天记录导入历史会话", hint: "<source> <path>" },
  { name: "import-all", zh: "批导入选定来源的全部历史会话", hint: "[source] [path]" },
  { name: "import-reset", zh: "清空导入扫描缓存", hint: "无需参数" },
  { name: "mcp-status", zh: "查看 MCP 配置扫描结果", hint: "无需参数" },
  { name: "permission", zh: "切换权限预设（沙箱模式 + 审批策略）", hint: "<preset>", icon: ShieldCheck },
  { name: "plan", zh: "进入或退出计划模式", hint: "[off|message]", icon: Route },
  { name: "resume-claude", zh: "从 Claude Code 历史会话生成交接摘要", hint: "[id:<会话id> | 标题关键词]" },
  { name: "resume-codex", zh: "从 Codex 历史会话生成交接摘要", hint: "[id:<会话id> | 标题关键词]" },
  { name: "settings-suggest", zh: "解析 Claude/Codex 配置给出迁移建议" },
];

const BY_NAME = new Map(BUILTINS.map((c) => [c.name, c]));

/** 查表：会话车道补中文说明用；插件命令查不到（行回落到引擎原文）。 */
export function builtinCommand(name: string): BuiltinCommand | undefined {
  return BY_NAME.get(name);
}

/** 行图标：表里没配图标的一律通用终端图标。 */
export function builtinIcon(name: string): LucideIcon {
  return BY_NAME.get(name)?.icon ?? TerminalSquare;
}

/** 草稿页兜底车道的目录。description 取本表中文说明——它就是菜单要显示的主
 *  文案（会话车道那侧同样由本表中文覆盖引擎原文，两个车道显示一致）。 */
export const DRAFT_COMMANDS: CommandDescriptor[] = BUILTINS.map((c) => (
  c.hint ? { name: c.name, description: c.zh, input: { hint: c.hint } } : { name: c.name, description: c.zh }
));
