// 工具名 → 语义族（命令 / 编辑 / 读取 / 搜索 / 代码 / 技能 / 提问 / 子智能体 /
// 目标 / 提醒 / 后台任务 / 其他）。
// 只有这一份映射：ToolIcon 按族选 glyph（族表骨架来自官方 tool-call-model 的
// TOOL_VARIANTS；agent/goal/schedule/job 是本仓应用级工具，官方表没有——图标
// 跟右侧面板同语义区对齐：Bot/Flag/CalendarClock/SquareTerminal。表里没有的
// 名字回 other）。

export type ToolVariant =
  | "read" | "edit" | "shell" | "search" | "code" | "skill" | "question"
  | "agent" | "goal" | "schedule" | "job" | "other";

export function toolVariant(name: string): ToolVariant {
  switch (name) {
    case "bash":
    case "terminal-bash":
    case "pwsh":
      return "shell";
    case "write":
    case "edit":
    case "str_replace_editor":
    case "patch":
    case "multiedit":
    case "apply_patch":
      return "edit";
    case "read":
    case "read_file":
    case "file_read":
    case "read_image":
    case "web_fetch":
    case "fetch":
    case "cordis_package_inspect":
    case "cordis_runtime_inspect":
      return "read";
    case "web_search":
    case "grep":
    case "glob":
    case "search":
      return "search";
    case "run_code":
    case "code":
    case "code_execute":
    case "code_interpreter":
      return "code";
    case "skill":
      return "skill";
    case "ask_user_question":
    case "ask_user":
      return "question";
    case "subagent":
    case "send_message":
    case "interrupt_agent":
    case "list_agents":
    case "wait_agent":
      return "agent";
    case "get_goal":
    case "create_goal":
    case "update_goal":
      return "goal";
    case "schedule_create":
    case "schedule_list":
    case "schedule_delete":
      return "schedule";
    case "job_list":
    case "job_output":
    case "job_kill":
      return "job";
    default:
      return "other";
  }
}
