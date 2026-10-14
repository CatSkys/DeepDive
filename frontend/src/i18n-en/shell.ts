// EN 词典 · shell 域（从 i18n-en.ts 按注释段切分，2026-10-12）：中文源串为键、英文为值；
// 只放数据不放逻辑。键的纪律与缺键扫描见 i18n.ts 头注释。
export const ENShell: Record<string, string> = {
  // shell / window
  "新会话": "New Chat",
  "失败": "Failed",
  "返回工作区": "Back to workspace",
  "已复制": "Copied",
  "收起侧栏": "Collapse Sidebar",
  "更换模型": "Change model",
  "模型与推理": "Model & Reasoning",
  "设置 ⌘,": "Settings ⌘,",
  "新建项目空间": "New project workspace",
  "输入要添加为工作空间的文件夹绝对路径：": "Enter the absolute folder path to add as a workspace:",
  "添加工作空间失败：{m}": "Add workspace failed: {m}",
  "展开会话": "Expand Sessions",
  "收起会话": "Collapse Sessions",
  "快捷会话": "Quick session",
  "工作空间操作": "Workspace Actions",
  "调整侧栏宽度": "Resize sidebar",
  "调整大小": "Resize",
  "搜索": "Search",
  "搜索项目": "Search projects",
  "新建项目": "New project",
  "没有匹配的项目": "No matching projects",
  "无结果": "No results",

  // 命令面板的分组标签（⌘K）
  "操作": "Actions",
  "当前会话": "Current Session",
  "项目": "Projects",

  // sidebar rows / ctx menu
  "删除工作区": "Delete Workspace",
  "重命名任务": "Rename Session",
  "归档任务": "Archive Session",
  "归档": "Archive",
  "标记为未读": "Mark as Unread",
  "在 Finder 中打开": "Reveal in Finder",
  "复制路径": "Copy Path",
  "复制日志路径": "Copy Log Path",
  "复制会话 ID": "Copy Session ID",
  "前往配置": "Open Configuration",
  "当前空间": "Current workspace",

  // time buckets (Sidebar.fmtTime / bucketLabel)
  "刚刚": "now",
  " 分": "m",
  " 小时": "h",
  " 天": "d",
  " 周": "w",
  "今天": "Today",
  "昨天": "Yesterday",
  "上周": "This week",
  " 月": " ",

  // hero / composer
  "做点什么？": "What should we do?",
  "用 DeepSeek 智能体开始任何工作。": "Start anything with your DeepSeek agent.",
  "输入任务，@ 引用 · / 命令": "Ask anything · @ to reference · / for commands",
  "继续输入以排队后续修改": "Keep typing to queue follow-up edits",
  "正在听写…": "Listening…",
  "停止": "Stop",
  "发送": "Send",
  "停止听写": "Stop Dictation",
  "听写": "Dictate",
  "上传附件": "Attach Files",
  "附件": "Attachments",
  "命令": "Commands",
  "打开本体": "Open DeepDive",
  "暂无命令": "No commands yet",
  "图片…": "Image…",
  "听写失败": "Dictation failed",
  "没有匹配「{q}」": "No matches for “{q}”",

  // 编辑项目弹窗（项目 ⋯ 菜单唤出，复用新建项目表单）
  "编辑项目": "Edit Project",
  "保存后写入项目的 AGENTS.md，覆盖原内容。": "On save, written to the project's AGENTS.md, replacing its content.",
  "保存项目指令失败。": "Failed to save project instructions.",
  "退出码 非 0": "exit ≠ 0",
  "{n} 行": "{n} lines",
  "… 其余 {n} 行": "… {n} more lines",
  "收起": "Collapse",

  // 会话状态胶囊（StatusCapsule）
  "摘要": "Summary",
  "任务与计划": "Tasks & plan",
  "已完成 {n} 项": "Completed {n}",
  "{n} 运行中": "{n} running",
  "切换分支": "Switch branch",
  "变更": "Changes",
  "提交或推送": "Commit or push",
  "提交并推送": "Commit & push",
  "已提交": "Committed",
  "已提交并推送": "Committed & pushed",
  "提交改动": "Commit changes",
  "推送": "Push",
  "提交中…": "Committing…",
  "推送中…": "Pushing…",
  "切换中…": "Switching…",
  "已切换到 {b}": "Switched to {b}",
  "已提交：{m}": "Committed: {m}",
  "已推送": "Pushed",
  "输入提交信息…": "Commit message…",
  "提交信息": "Commit message",
  "提醒与自动化": "Reminders & automation",
  "Git 工具": "Git tools",

  // 启动骨架屏（读屏用；视觉是形状占位，没有文字）
  "正在启动引擎…": "Starting the engine…",

  // phase 2 commands & input
  "控制新会话的文件写入与审批策略；运行中的会话保持开始时的预设。": "Controls file access and approval policy for new sessions; running sessions keep their starting preset.",
  "本引擎未提供权限预设。": "This engine exposes no permission presets.",

  // permission preset labels（引擎键 → 本地化，未知预设回退引擎原文）
  "只读": "Read-only",
  "只读取与分析，不改文件。": "Read and analyze; no file changes.",
  "工作区写入": "Workspace writes",
  "工作区内自动改文件，越界先确认。": "Edits inside the workspace run automatically; anything beyond asks first.",
  "完全访问": "Full access",
  "全部可写，不再逐步确认。": "Everything writable, without step-by-step approvals.",

  // 通用动作词（多处共用）
  "投递": "Deliver",
  "运行": "Run",
  "名称": "Name",
  "执行失败": "Failed",

  // 新建项目弹窗（NewProjectDialog）
  "图标": "Icon",
  "审批模式": "Approval preset",
  "写入项目指令需要桌面应用。": "Writing project instructions requires the desktop app.",
  "修改图标": "Change icon",

  // 搜索面板（CommandPalette）
  "搜索操作、项目、会话、设置…": "Search actions, projects, sessions, settings…",
  "添加附件": "Add attachment…",
  "重命名当前会话": "Rename current chat",
  "归档当前会话": "Archive current chat",
  "收起 / 展开侧栏": "Toggle sidebar",
  "目录": "Directory",
  "项目指令": "Instructions",
  "项目名称": "Project name",
  "选择目录…": "Choose directory…",
  "为这个项目下的会话输入指令…": "Enter instructions for sessions in this project…",
  "创建中…": "Creating…",
  "默认（首字母）": "Default (initial)",
  "创建项目失败：{m}": "Create project failed: {m}",
  "创建项目失败：壳未响应。": "Create project failed: the shell did not respond.",
  "创建": "Create",
  "创建失败": "Create failed",
  "删除失败": "Delete failed",

  // composer
  "上传中": "Uploading",
  "待发送": "Pending",
  "上传失败": "Upload failed",
  "指令会在创建时写入项目 AGENTS.md，文件已存在则不改动。": "Instructions are written to the project's AGENTS.md on create — an existing file is left untouched.",
  "解码速度": "Decode speed",
  "平均首 token": "Avg. first token",
  "发送中…": "Sending…",

  // DeepDiving（深潜）小游戏：流末 loader「Deep diving...」即入口（名字沿用品牌双关，
  // 不入词典——zh 同串）。「关闭」「继续」「已暂停」已有词条，不重复收。
  "打开 DeepDiving": "Open DeepDiving",
  "再来": "Retry",
  "最佳 {m} 米": "Best {m} m",
  "提示音": "Sound",
  "按住上浮，松开下潜": "Hold to rise, release to dive",

  // 2048（经典黑白，命令面板入口）：名字即数字，不入词典。
  "分数": "Score",
  "最佳": "Best",
  "新的一局": "New game",
  "本局 {s} 分": "Score {s}",
  "成 2048 了，还能继续": "Made 2048 — keep going",
  "方向键或 WASD 滑动，同数相合，凑出 2048": "Arrow keys / WASD to slide — equal numbers merge. Reach 2048",
  "游戏": "Games",

  // 崩溃边界（ErrorBoundary）：页面级错误兜底那张脸
  "界面出了点问题，已自动记录": "Something went wrong — the details were logged",
  "重载界面": "Reload",
};
