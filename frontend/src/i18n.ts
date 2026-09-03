// Lightweight i18n: Chinese source strings are the keys (identity in zh),
// English translations live in EN. Missing keys fall back to the Chinese
// source — a sweep can ship incrementally without blanking the UI.
// English terms follow the official dsh web frontend (New Chat / Search /
// Reasoning / Queue / Archive …) so the two surfaces read alike.
//
// Usage: const { t, tt } = useT();  t("搜索") · tt(`保存失败：${m}`, `Save failed: ${m}`)
import { useStore } from "./store";

export type Lang = "zh" | "en";

const EN: Record<string, string> = {
  // shell / window
  "新会话": "New Chat",
  "收起侧栏": "Collapse Sidebar",
  "更换模型": "Change Model",
  "模型与推理": "Model & Reasoning",
  "设置 ⌘,": "Settings ⌘,",
  "新建空间（选择项目文件夹）": "Add Workspace (Choose Folder)",
  "输入要添加为工作空间的文件夹绝对路径：": "Enter the absolute folder path to add as a workspace:",
  "展开会话": "Expand Sessions",
  "收起会话": "Collapse Sessions",
  "工作空间操作": "Workspace Actions",
  "调整侧栏宽度": "Resize sidebar",
  "搜索": "Search",
  "无结果": "No results",
  "暂无会话": "No sessions yet",
  // sidebar rows / ctx menu
  "重命名": "Rename",
  "删除工作区": "Delete Workspace",
  "重命名任务": "Rename Session",
  "归档任务": "Archive Session",
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
  "添加附件（输入 @）": "Add attachment (type @)",
  "附件": "Attachments",
  "命令": "Commands",
  "图片…": "Image…",
  "剪贴板图片…": "Clipboard Image…",
  "剪贴板": "Clipboard",
  "听写失败": "Dictation failed",
  "没有匹配「{q}」": "No matches for “{q}”",
  // session view
  "会话": "Session",
  "加载中…": "Loading…",
  "载入更早": "Load earlier",
  "回到最新": "Back to latest",
  "退出计划模式": "Exit Plan Mode",
  "产物": "Files",
  "+ {n} 个文件": "+{n} files",
  "输入": "Input",
  "输出": "Output",
  "复制": "Copy",
  "复制成功": "Copied",
  "分支": "Branch",
  "退出码 非 0": "exit ≠ 0",
  "{n} 行": "{n} lines",
  "… 其余 {n} 行": "… {n} more lines",
  "收起": "Collapse",
  "用时": "Ran for",
  "首 token": "first token",
  // tool titles (DSH 同款英文)
  "提问": "Ask",
  "任务": "Todos",
  "编辑": "Edit",
  "批量编辑": "Multi-Edit",
  "应用补丁": "Apply Patch",
  "查找文件": "Find Files",
  "搜索内容": "Search Content",
  "联网搜索": "Web Search",
  "抓取网页": "Web Fetch",
  "列出文件": "List Files",
  "等待回答": "Waiting for answer",
  "正在执行": "Running",
  "已完成": "Done",
  "进行中": "In progress",
  "待处理": "Pending",
  "{done}/{total} 已完成 · {active} 进行中 · {pending} 待处理": "{done}/{total} done · {active} in progress · {pending} pending",
  "{first} 等 {n} 题": "{first} +{n} more",
  "请求授权": "Approval required",
  "拒绝": "Deny",
  "允许一次": "Allow once",
  // thinking
  "思考中": "Thinking",
  "已思考": "Thought for a bit",
  "思考中，点击收起推理": "Thinking — click to collapse",
  "已思考，点击展开推理": "Thought — click to expand",
  // question card
  "澄清一下": "Quick question",
  "取消提问": "Cancel question",
  "自定义回答…": "Custom answer…",
  "跳过此题": "Skip",
  "提交": "Submit",
  "下一题": "Next",
  // queue dock
  "保存排队消息": "Save queued message",
  "取消编辑": "Cancel editing",
  "立即插队执行": "Run immediately",
  "立即": "Now",
  "编辑排队消息": "Edit queued message",
  "删除排队消息": "Delete queued message",
  "排队消息操作失败：{m}": "Queue update failed: {m}",
  // phase 1 closures
  "置顶": "Pinned",
  "取消置顶": "Unpin",
  "计划审查": "Plan review",
  "继续讨论": "Discuss instead",
  "与引擎的连接已断开，正在重试…": "Engine connection lost — retrying…",
  // phase 2 commands & input
  "权限预设": "Permission preset",
  // phase 3 usage / info surface
  "上下文占用": "Context usage",
  "上下文": "Context",
  "输入（未缓存）": "Input (uncached)",
  "缓存读取": "Cache read",
  "推理": "Reasoning",
  "本轮达到 max tokens 上限，输出被截断": "Turn hit the max-tokens cap; output was truncated",
  "继续": "Continue",
  "本轮失败": "Turn failed",
  "请在设置中配置 API Key 后重试": "Configure an API key in Settings and retry",
  "模型请求重试": "Model request retrying",
  "上下文注入": "Context injected",
  "已压缩更早的上下文": "Earlier context compacted",
  "（约 {n} tokens）": "(~{n} tokens)",
  // phase 5 long-running & parallel surface
  "目标": "Goal",
  "暂停目标": "Pause goal",
  "恢复目标": "Resume goal",
  "编辑目标": "Edit goal",
  "清除目标": "Clear goal",
  "保存": "Save",
  "子代理谱系": "Subagent lineage",
  "子代理": "Subagents",
  "刷新": "Refresh",
  "可续": "resumable",
  "一次性": "one-shot",
  "运行中": "Running",
  "中断子代理": "Interrupt subagent",
  "部分子会话状态不可读": "Some children unreadable",
  "这是子代理会话": "This is a subagent session",
  "目录寻址的子会话在此只读；继续对话请回到父会话。": "Catalog-addressed child sessions are read-only here; continue in the parent session.",
  "打开父会话": "Open parent session",
  "后台任务": "Background jobs",
  "会话提醒": "Session reminders",
  "会话本地 · 到点经会话内续跑投递": "Session-local · delivered in-session when due",
  "每 {n} 分钟": "every {n} min",
  "{n} 分钟后": "in {n} min",
  "工作流": "Workflow",
  "{done}/{total} 成员": "{done}/{total} members",
  "{n} 失败": "{n} failed",
  "完成": "done",
  "已取消": "cancelled",
  "DeepSeek 模型目录": "DeepSeek model catalog",
  "名称": "Name",
  "添加模型": "Add model",
  "自定义提供方": "Custom providers",
  "OpenAI 兼容路由：填 baseURL 与 API 协议，发现模型后保存即生效。": "OpenAI-compatible routes: set baseURL and wire API, discover models, save to activate.",
  "显示名": "Display name",
  "协议（openai 等）": "API (openai, …)",
  "发现模型": "Discover models",
  "发现模型失败：{m}": "Model discovery failed: {m}",
  "未配置模型清单（可发现后并入）": "No model list yet (discover to fill)",
  "路由 ID（如 openrouter）": "Route id (e.g. openrouter)",
  "添加提供方": "Add provider",
  "已保存": "Saved",
  "本引擎未提供插件配置面。": "This engine exposes no plugin configuration.",
  "Bash 终端": "Bash terminal",
  "Agent 循环": "Agent loop",
  "默认超时（毫秒）": "Default timeout (ms)",
  "最大超时（毫秒）": "Max timeout (ms)",
  "输出上限（字节）": "Output cap (bytes)",
  "宽限期（毫秒）": "Grace (ms)",
  "工具最大并行数": "Max parallel tool calls",
  "API 版本": "API version",
  "每轮调用上限": "Max uses per turn",
  "API Key": "API Key",
  "（已配置）": " (configured)",
  // turn folding
  "已折叠早前 {n} 轮 · 点击展开": "Folded {n} earlier turns · click to expand",
  "当前权限预设（当前引擎版本不支持会话内切换）": "Current permission preset (this engine build cannot switch in-session)",
  "设定/查看长任务的 Goal": "Set or view the goal for a long-running task",
  "（输入目标后回车）": "(type an objective then Enter)",
  // model menu
  "搜索模型…": "Search models…",
  "推理等级": "Reasoning",
  "无匹配模型": "No matching models",
  "Default": "Default",
  "通用": "General",
  "已归档的聊天": "Archived Chats",
  "关闭": "Close",
  "亮色下侧栏偏灰、会话卡偏白。": "In light mode the sidebar is gray and the session card white.",
  "填入各提供方的 API 密钥即可使用其模型。切换模型在会话头部的选择器进行。": "Enter provider API keys to use their models. Switch models from the in-session picker.",
  "密钥已配置": "Key configured",
  "未配置密钥": "No API key",
  "清除": "Clear",
  "搜索插件": "Search plugins",
  "暂无归档会话": "No archived sessions",
  "已归档的会话（当前引擎版本不支持取消归档，仅可查看）。": "Archived sessions (this engine build cannot unarchive — view only).",
  "已归档的会话。可在此恢复到工作空间。": "Archived sessions. Restore them to your workspace here.",
  "点击卡片即设为新会话的默认预设；运行中的会话保持它开始时的预设。": "Click a card to set the default for new sessions; running sessions keep their starting preset.",
  "预设即一个会话的 Agent 所运行的插件组装 —— 它的工具、提示词与能力。点击卡片设为新会话的默认。": "A preset is the plugin assembly a session's agent runs with — its tools, prompts and abilities. Click a card to set the default.",
  "恢复": "Restore",
  "思考强度": "Effort",
  // settings — sections
  "设置": "Settings",
  "模型": "Models",
  "预设": "Presets",
  "插件": "Plugins",
  "审批": "Approvals",
  "快捷键": "Shortcuts",
  "外观": "Appearance",
  "通知": "Notifications",
  "数据": "Data",
  "语言": "Language",
  "中文（简体）": "中文（简体）",
  "English": "English",
  // settings — appearance
  "外观设置": "Appearance",
  "跟随系统明暗，切换时实时跟随。": "Follow the system light/dark setting live.",
  "跟随系统": "Follow System",
  "亮色": "Light",
  "暗色": "Dark",
  "亮色下主窗口偏白、会话卡偏灰。": "Light keeps the sidebar white and the session card gray.",
  // settings — notifications
  "提醒": "Alerts",
  "回合完成提醒": "Notify when a turn completes",
  "静默通知，不打扰": "Silent notification",
  "待审批 / 待提问提醒": "Pending approval / question alerts",
  "通知 + Dock 弹跳": "Notification + Dock bounce",
  "悬浮球": "Floating bubble",
  "常驻置顶，单击回主窗": "Always on top; click to reopen",
  "菜单栏状态图标始终实时反映状态，不受以上开关影响。": "The menu-bar status item always reflects live state, regardless of these switches.",
  // settings — approvals
  "默认权限预设": "Default permission preset",
  "新建会话的初始权限。": "Initial permission for new sessions.",
  "read-only（只读）": "read-only",
  "workspace-write（默认）": "workspace-write (default)",
  "danger-full-access（完整访问）": "danger-full-access",
  "启用完整访问？将不再逐步审批命令与文件写入。": "Enable full access? Commands and file writes will no longer be step-by-step approved.",
  "完整访问（danger-full-access）需要逐次确认；当前会话权限由会话内原生审批弹窗分别管理。": "Full access still confirms each run; in-session approvals are managed by the native approval prompts.",
  // settings — hotkeys
  "全局热键": "Global hotkey",
  "任意应用下生效。": "Works from any app.",
  "唤起面板": "Toggle panel",
  "按下新的组合键…": "Press a new key combination…",
  "录制中…": "Recording…",
  "修改": "Change",
  "当前：{k}": "Current: {k}",
  "应用内快捷键": "In-app shortcuts",
  "固定映射，不可自定义。": "Fixed mappings; not customizable.",
  "引用": "Reference",
  "补全": "Autocomplete",
  "收起菜单 / 取消": "Dismiss menu / cancel",
  // settings — data
  "数据与存储": "Data & Storage",
  "存储位置（DSH_HOME）": "Storage location (DSH_HOME)",
  "在访达中打开": "Reveal in Finder",
  "引擎配置文档": "Engine configuration doc",
  "打开": "Open",
  "高级（命名空间原始 JSON 编辑）": "Advanced (raw namespace JSON editor)",
  "diff 后只提交改到的路径；revision 围栏防串写。": "Only changed paths are submitted; revision fencing prevents clobbering.",
  "命名空间": "Namespace",
  "编辑 JSON…": "Edit JSON…",
  "会话管理": "Session management",
  "删除需确认且不可撤销。": "Deletion asks for confirmation and cannot be undone.",
  "本引擎版本不支持会话删除": "This engine build does not support session deletion",
  "删除": "Delete",
  "删除会话？该操作不可撤销：{t}": "Delete session? This cannot be undone: {t}",
  "载入中…": "Loading…",
  "取消": "Cancel",
  "保存（diff → ops）": "Save (diff → ops)",
  "JSON 解析失败": "JSON parse failed",
  "版本已前进——请取消后重新打开(将载入最新)": "Revision moved on — cancel and reopen to load the latest",
  "保存失败：{m}": "Save failed: {m}",
  "读取失败：{m}": "Read failed: {m}",
  "删除失败：{m}": "Delete failed: {m}",
  "重试失败：{m}": "Retry failed: {m}",
  "重命名失败：{m}": "Rename failed: {m}",
  "归档失败：{m}": "Archive failed: {m}",
  "引擎未返回「{ns}」": "Engine did not return “{ns}”",
  "引擎未返回该命名空间": "Engine did not return that namespace",
  "编辑 {ns}（原始 JSON）": "Edit {ns} (raw JSON)",
  "冲突": "Conflict",
  "设置已在其他位置被修改": "Settings were modified elsewhere",
  "「{ns}」的版本已前进。载入最新版本，或基于最新版本重试你的修改？": "“{ns}” has moved on. Load the latest version, or retry your change on top of it?",
  "载入最新": "Load latest",
  "基于最新重试": "Retry on latest",
  // settings — presets/plugins
  "Agent 预设": "Agent presets",
  "新建任务时可选的角色;当前默认已标记。": "Roles offered when creating a task; the current default is marked.",
  "默认": "Default",
  "设为默认": "Set default",
  "本引擎未提供预设。": "This engine exposes no presets.",
  "预设的复制/删除依赖 agentPreset 端点的浏览器面(当前引擎未暴露,仅可切换默认)。": "Preset copy/delete needs the agentPreset browser endpoint (not exposed by this engine; only the default is switchable).",
  "本引擎装载的扩展模块。": "Extension modules loaded by this engine.",
  "已启用": "Enabled",
  "已停用": "Disabled",
  "本引擎未提供插件清单。": "This engine exposes no plugin inventory.",
  // settings — appearance(旧引擎行)
  "界面设置": "Interface",
  "引擎界面明暗": "Engine UI theme",
  "繁忙时 Enter 键行为": "Enter while the agent is busy",
  "仅在智能体运行时生效;Cmd/Ctrl+Enter 使用另一行为": "Only applies while the agent is running; Cmd/Ctrl+Enter does the other action",
  "插话发送": "Send as steer",
  "排队": "Queue",
  "任务 {id}": "Task {id}",
  "设置已在其他位置被修改。": "Settings were modified elsewhere.",
};

// Module-level current language: plain helpers (formatters, tool-row
// summaries) can call t()/tt() without hook plumbing. Components still use
// useT() so a language switch re-renders them and re-runs those helpers.
let currentLang: Lang = "zh";

export function setI18nLang(lang: Lang): void {
  currentLang = lang;
}

/** zh 源串 → en；未收录回退源串（清扫可增量落地）。 */
export function translate(s: string, lang: Lang = currentLang): string {
  if (lang !== "en") return s;
  return EN[s] ?? s;
}

function render(zh: string, en: string, lang: Lang, vars?: Record<string, string | number>): string {
  let out = lang === "zh" ? zh : en;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

export function tt(zh: string, en: string, vars?: Record<string, string | number>): string {
  return render(zh, en, currentLang, vars);
}

export function t(s: string): string {
  return translate(s);
}

export type TFunc = {
  t: (s: string) => string;
  tt: (zh: string, en: string, vars?: Record<string, string | number>) => string;
  lang: Lang;
};

export function useT(): TFunc {
  const { lang } = useStore();
  currentLang = lang;
  return { t: (s: string) => translate(s, lang), tt: (zh, en, vars) => render(zh, en, lang, vars), lang };
}
