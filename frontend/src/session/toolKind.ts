// 工具名 → 语义族（命令 / 编辑 / 读取 / 搜索 / 代码 / 技能 / 提问 / 其他）。
// 只有这一份映射：ToolIcon 按族选 glyph，轮内过程折叠的摘要按族分组计数
// （官方 TOOL_VARIANTS 的口径，缺族回 other）。

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

/** 摘要里的族名与固定出现顺序（先读后写、命令居中，读起来像一次工作的骨架）。 */
export const TOOL_VARIANT_ORDER: readonly ToolVariant[] = ["read", "edit", "shell", "search", "code", "skill", "question", "other"];

export const TOOL_VARIANT_LABEL: Record<ToolVariant, readonly [string, string]> = {
  read: ["读取", "read"],
  edit: ["编辑", "edit"],
  shell: ["命令", "command"],
  search: ["搜索", "search"],
  code: ["代码", "code"],
  skill: ["技能", "skill"],
  question: ["提问", "ask"],
  other: ["其他", "other"],
};
