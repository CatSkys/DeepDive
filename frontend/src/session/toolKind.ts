// 工具名 → 语义族（命令 / 编辑 / 读取 / 搜索 / 代码 / 技能 / 提问 / 其他）。
// 只有这一份映射：ToolIcon 按族选 glyph（官方 tool-call-model 的 TOOL_VARIANTS 口径，
// 表里没有的名字回 other）。

export type ToolVariant = "read" | "edit" | "shell" | "search" | "code" | "skill" | "question" | "other";

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
    default:
      return "other";
  }
}
