// 静态斜杠命令目录：引擎无 commands.list RPC，目录按 docs/DSH-WIRE.md §4
// 的引擎注册处静态内置（command-compact / command-goal / permission-presets /
// plan-mode / command-feedback）；升引擎时对照该表复核。执行一律走
// session.prompt 文本透传，引擎自行解析 /name 并发 command/run·done 事件。

export interface SlashCommand {
  /** 无斜杠小写命令名（引擎 parseCommand 同名）。 */
  name: string;
  zh: string;
  en: string;
  /** 输入参数提示（展示在菜单行）；选中一律填 `/name ` 由用户补参后回车。 */
  hint?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "compact", zh: "压缩更早的会话历史", en: "Compact older conversation history" },
  { name: "plan", zh: "进入/退出计划模式", en: "Enter or leave plan mode", hint: "[off|message]" },
  { name: "permission", zh: "切换权限预设（沙箱模式 + 审批策略）", en: "Switch the permission preset (sandbox mode + approval policy)", hint: "<preset>" },
  { name: "goal", zh: "设定/查看长任务的 Goal", en: "Set or view the goal for a long-running task", hint: "[<objective>|clear|edit <objective>|pause|resume]" },
  { name: "feedback", zh: "记录本会话的反馈", en: "Record feedback about this session", hint: "<text>" },
];

