// 工具名 → 语义族（命令 / 编辑 / 读取 / 搜索 / 代码 / 技能 / 提问 / 子智能体 /
// 目标 / 提醒 / 后台任务 / MCP / 其他）。
// 只有这一份映射：ToolIcon 按族选 glyph（族表骨架来自官方 tool-call-model 的
// TOOL_VARIANTS；agent/goal/schedule/job/mcp 是本仓应用级工具，官方表没有
// ——图标与右侧面板同语义区对齐：Bot/Flag/CalendarClock/SquareTerminal/MCP 插头）。
// 表里没有的名字回 other。

export type ToolVariant =
  | "read" | "edit" | "shell" | "search" | "code" | "skill" | "question"
  | "agent" | "goal" | "schedule" | "job" | "mcp" | "browser" | "other";

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
      // MCP 工具：官方也归 others，本仓给独立族（用户定稿）——本仓自带的浏览器
      // 控制另立一族（图标=官方地球，与应用里「浏览器」这件东西同一个记号）
      if (name.startsWith("mcp__deepdive-browser__")) return "browser";
      return name.startsWith("mcp__") ? "mcp" : "other";
  }
}

/* ── 工具对外名（正式产品名）──
   引擎只给内名（write / subagent / mcp__deepdive-browser__js…），对外一律说人话。
   名字逐个对照引擎工具注册源核实（tool-goal / tool-jobs / schedule /
   tool-subagent / tool-subagent-control 与通用工具族）；英文经 i18n 词典。
   入口只有这一个：工具行（ToolRow）与审批卡（ApprovalCard）共用，避免两处各说一套。 */
const TOOL_TITLE_ZH: Record<string, string> = {
  ask_user_question: "提问",
  todo_write: "任务",
  todos: "任务",
  bash: "终端",
  "terminal-bash": "终端",
  pwsh: "终端",
  read: "读取文件",
  read_file: "读取文件",
  file_read: "读取文件",
  read_image: "读取图片",
  write: "写入文件",
  edit: "编辑文件",
  str_replace_editor: "编辑",
  multiedit: "批量编辑",
  apply_patch: "应用补丁",
  patch: "应用补丁",
  glob: "查找文件",
  grep: "搜索内容",
  web_search: "联网搜索",
  web_fetch: "抓取网页",
  fetch: "抓取网页",
  list_files: "列出文件",
  run_code: "运行代码",
  skill: "技能",
  compact: "压缩上下文",
  present: "交付",
  subagent: "子智能体",
  send_message: "子智能体消息",
  interrupt_agent: "中断子智能体",
  list_agents: "列出子智能体",
  wait_agent: "等待子智能体",
  get_goal: "查看目标",
  create_goal: "创建目标",
  update_goal: "更新目标",
  schedule_create: "新建提醒",
  schedule_list: "查看提醒",
  schedule_delete: "删除提醒",
  job_list: "查看后台任务",
  job_output: "后台任务输出",
  job_kill: "终止后台任务",
};

/** 本仓自带的浏览器控制 MCP（随包安装的 browser-use server）——对外一个产品名，
    不摆 `deepdive-browser · js` 这种半截内名（用户定稿）。 */
const BROWSER_MCP = "mcp__deepdive-browser__";

/** 这条工具调用是不是"agent 在操控浏览器"。前缀只此一份（toolKind 的 browser 族、
 *  工具行产品名、状态胶囊的浏览器入口都引它）：模型手里只有这一个 `js` 工具，
 *  命中它就是 agent 动了浏览器。 */
export function isBrowserTool(toolName: string | undefined): boolean {
  return toolName !== undefined && toolName.startsWith(BROWSER_MCP);
}

export function toolDisplayName(toolName: string, t: (s: string) => string): string {
  const known = TOOL_TITLE_ZH[toolName];
  if (known) return t(known);
  if (toolName.startsWith(BROWSER_MCP)) return t("浏览器控制");
  if (toolName.startsWith("mcp__")) {
    // 其他 MCP 服务器：服务器是专有名词不翻，工具段拼在后面
    const m = /^mcp__(.+?)__(.+)$/.exec(toolName);
    return m ? `${m[1]} · ${m[2]}` : toolName;
  }
  return toolName;
}
