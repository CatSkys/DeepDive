# DeepDive（DSHmini）架构 — as-built

> 本文描述**已落地的实际架构**（2026-09 收口）。规划期文档（v0.3 蓝图、P1/P2 计划）已完成历史使命并删除，沿革见文末；如需原文查 git 历史。
> 品牌：对外名 **DeepDive · 深潜**（`docs/BRANDING.md`）；内部代号（scheme `DSHmini`、源码目录 `DSHminiApp`、包名 `@dshmini/frontend`）有意保留以减少 diff。

---

> 侧栏浏览器的功能块参考梳理（第三方 Search 浏览器取/不取哪块）见
> [REF-BROWSER-SEARCH.md](REF-BROWSER-SEARCH.md)。

## 1. 总览：三层混合架构

```
┌──────────────────────────────────────────────────────────────┐
│ 原生外壳  Swift + AppKit（apps/macos，XcodeGen 生成工程）      │
│  玻璃主窗(WKWebView) · 全局热键 · 菜单栏 · 原生通知 · 悬浮球   │
│  听写 · 引擎监督(自愈重启/失败面在 SPA 内) · BridgeServer(同源托管) │
├──────────────────────────────────────────────────────────────┤
│ 自建 SPA  React + TS + Vite（frontend/）                       │
│  会话流/工具行/审批卡/提问卡/排队 · 模型菜单(思考强度) ·        │
│  多工作区侧栏 · 设置浮层 · 黑白主题(外观三态) · 中英双语        │
├──────────────────────────────────────────────────────────────┤
│ 引擎  dsh 子进程（被监督；Node runtime 闭包随 App 分发）       │
│  agent loop / session log / 工具管线 / 模型适配 / 持久化       │
└──────────────────────────────────────────────────────────────┘
```

职责边界：**壳**只做 OS 级能力（窗口/热键/通知/选目录 sheet…）、进程监督，与**应用分发**（把随包的 profile、AGENTS.md 托管块、随应用发布的插件装进 harness home；随应用发布的技能不落文件——由引擎自己的 `@deepdive/engine-host` 运行时注册）；**SPA** 只做渲染与交互，把用户动作路由为引擎 RPC；**引擎**持有全部业务状态——设置面（技能清单/新建/删除/从目录安装走 `skills/admin*`，插件启停落账走 `pluginInventory/patch*`）与会话数据（取消归档走 `workspace/unarchiveSessions`，删除走 `session/deleteSessions`）都在引擎侧，壳不再替引擎写任何状态文件。

## 2. 通信矩阵（现实现）

| 边 | 通道 | 要点 |
|---|---|---|
| SPA → 引擎 | same-origin `POST /api/<ns>/<method>`（client-request 信封、`{args}` 具名包裹）+ 单条 `ws /api/remote.mux` 多路流（`$events`/`session/follow`/`session/control`/`workspace/follow`） | 经壳内 BridgeServer 反代（token+cookie 注入）；wire 契约实测见 `DSH-WIRE.md` |
| 手机浏览器 → 引擎 | 同一个 SPA 与同一套 `/api` 转发，但走**远程面**（独立局域网监听） | 用户显式开启才起（默认关）；一次性配对令牌 + 设备 cookie 台账，见 `SPEC-MOBILE-REMOTE.md` |
| 壳 → 引擎 | stdio（`dsh web:` URL 行、日志尾巴）+ 进程信号 | 只关心 UP/BOOT_FAILED/EXITED 与端口 |
| 壳 ↔ SPA | `WKScriptMessageHandler`（`deepdive` 标题栏 rect 表 / `deepdiveHost` 前端指令）；壳→前端 `evaluateJavaScript` 调 `window.__deepDiveHost.dispatch`（pending 单条暂存） | 指令集与降级纪律见 `SPEC-NOTIFICATIONS-FLOATING-BALL §3.1`；标题栏拖拽契约见 `PITFALLS §4.3`；**原生视图槽位**（`native-slot` 消息：rect + visible + interactive）见 `SPEC-BROWSER-USE §3` |
| MCP server → 壳 | `POST /browser-control`（回环、`Authorization: Bearer <boot token>`） | 浏览器 agent 控制面；token 经引擎环境变量注入，见 `SPEC-BROWSER-USE §4` |
| 引擎 → MCP server | stdio（引擎按组合行 spawn 随包 Node 跑 `browser-use-server.mjs`） | 工具面只有一个 `js`；协议要点见该文件头注 |
| 壳 → 引擎事件 | `EngineEventObserver` 自读 `$events` 流派生 running/完成/待审批状态（waterfall 恒回 `next`，不决策） | 通知/悬浮球/菜单栏徽标原生实时，不依赖前端 |

## 3. 原生外壳（apps/macos/Sources/DSHminiApp/）

| 文件 | 职责 |
|---|---|
| `AppDelegate.swift` | 生命周期、host 指令路由、设置/外观/通知接线 |
| `BrowserHost.swift`（+`+Navigation`/`+ZoomFind`） | 一个标签的壳侧宿主：一个 WKWebView（导航/UI delegate、协议白名单、截图/执行 JS/导航/唤醒原语）。当前标签的那个挂在舞台上；缩略图态由 `hitTest` 让位（见 `SPEC-BROWSER-USE.md §3`） |
| `BrowserTab.swift` | 一个标签：身份 + 壳侧镜像（标题/地址/站点图标）+ **惰性**宿主 + 睡着时留的三样（`interactionState` 回去的路、停帧封面、镜像） |
| `BrowserTabs.swift`（+`+Sleep`） | 标签集合：增删选与"永远留一个空白标签"、舞台换视图、观察扇出（`browserState`/`browserTabs`）、槽位；休眠策略与内存压力在 `+Sleep`。一个窗口一个 `WKWebsiteDataStore`（cookie 跨标签共享） |
| `BrowserDataStore.swift` | 浏览器的数据存储：`WKWebsiteDataStore(forIdentifier:)` 一份**持久且独立**的 store（与主 SPA 的 default 各一份），以及"清除浏览数据" |
| `BrowserCookieSource.swift` + `BrowserCookieFiles.swift` + `ChromiumCookieCrypto.swift` + `BrowserCookieImport.swift` | cookie 导入：发现装了哪些浏览器、解析三种 cookie 库（Chromium 的 SQLite+`v10` AES / Firefox 明文 / Safari binarycookies）、写进浏览器 store 并回报结果码 |
| `BrowserCookies.swift` | cookie 导入的桥契约（`browser-cookies` ↔ `browserCookieSources` / `browserCookieResult`）与来源清单 |
| `BrowserHistory.swift` + `BrowserBookmarks.swift` | 浏览历史与书签：落 UserDefaults 的一份 JSON + 进程内缓存（历史按 url 去重、上限 500；书签按 url 去重），地址栏补全与设置页都读它 |
| `BrowserReader.swift` | 阅读模式：把页面就地换成只有正文的那一版（散文打分 + 链接扣分找正文，图片先解析成普通 src） |
| `BrowserHidden.swift` + `BrowserHost+Hidden.swift` | 按站隐藏：按 host 记一组选择器、导航前挂 CSS（`WKUserScript`）、页面上的拾取脚本与回话弱代理 |
| `BrowserShield.swift` | 广告/跟踪拦截：`WKContentRuleList` 的规则表（故意短的域名清单 + 几处广告位）、全局开关、按站暂停；导航那一刻按站点加减规则 |
| `BrowserPermissions.swift` | 按站权限记忆：摄像头/麦克风的决定按"站点 + 种类"记住，没记过就推给 SPA 弹窗问（30s 超时拒绝、一次只问一个） |
| `BrowserControl.swift` | 浏览器控制面：桥的 `POST /browser-control`（boot token 鉴权）→ 落到 `BrowserTabs` 里的某个标签（命令带 `tabId`，缺省当前标签）。只提供原语（导航/观察/截图/执行 JS/轮询等待（页面脚本或壳里的状态）/标签增删选），高层语义在 JS 侧 SDK 里 |
| `BrowserUseInstaller.swift` | 把随包的 `BrowserUse/`（MCP server + 浏览器 SDK）装进 `<support>/browser-use/`（幂等），并给出引擎 spawn 要注入的控制面 URL 与 token；组合行由 `EngineSupervisor.enginePatchBody` 写 |
| `MainWindowController.swift` | 玻璃主窗 + 透明 WKWebView + 显隐防闪烁 + 标题栏拖拽 rect 表 + 空 NSToolbar（Tahoe 大圆角档，勿删，`PITFALLS §4.7`）+ 视图菜单的页面缩放 |
| `MainMenu.swift` | 主菜单结构（文件/编辑/视图/窗口/帮助）：只连选择器，动作实现在 AppDelegate/MainWindowController。**可改键位不写死**——应用内快捷键（⌘N/⌘K/⌘B/⌘D/⇧⌘E/⌘,）的事实源是前端键位注册表 `keybinds.ts`，菜单项不占这些键，否则改键失效（文件头有完整说明）。**菜单占用的组合是注册表保留清单的镜像**：改菜单要同步 `RESERVED_COMBOS`，否则用户能绑到一个永远不响的键（PITFALLS §4.36） |
| `BridgeServer.swift` + `MiniHTTPServer.swift` | 同源托管：SPA 静态文件 + `/api` 反代 + WS 盲中继（Origin 全等校验）。**监听端口固定**（`DSHAppPrefs.bridgePort` 记住，被占才退回内核分配）：端口即网页 origin，换了 origin 前端的 localStorage（用量缓存/自动化任务/置顶未读）就等于清零（PITFALLS §4.17）。移动端远程面复用同一套分发与中继，只是监听在 `0.0.0.0` 且先过配对闸 |
| `RemoteAccess.swift` + `QRCode.swift` | 移动端远程访问：配对令牌（落地即轮换）、设备台账（逐台解绑）、局域网地址探测、CoreImage 生成二维码。只管「谁被允许进来」，HTTP 面复用 BridgeServer；安全边界见 `SPEC-MOBILE-REMOTE.md` |
| `BotChannelPlugin.swift` | IM 渠道插件（`@xmanrui/dsh-im`，社区包 MIT，引脚 `scripts/dsh-im-version.txt`）安装器：把随包的整棵依赖闭包铺进 `profiles/web` 并登记 profile bundles，引擎启动后挂上 `POST /api/dsh-im/<渠道>`（Bot Channel 与机器人管理走这条）。幂等 + 失败不阻塞引擎（与 `ChatImportPlugin` 同款纪律） |
| `EngineSupervisor.swift` / `EngineVersion.swift` / `EngineGateway.swift` / `EngineAuth.swift` / `EngineEventObserver.swift` / `EngineLog.swift` | 引擎子进程监督/自愈、入口版本门（随包引脚 vs 外部 dsh）、网关调用、token→cookie 交换、事件观察、日志 |
| `ProfileComposer.swift` | 引擎组合的部署器：把随包的 `engine/profile` 装进 harness home 的 web profile，并把 `dsh.profile.bundles` 收敛到它（摘掉退役的上游两层、保留社区与用户自加的、迁移既有安装）。幂等 + 失败不阻塞启动，纪律同 `ChatImportPlugin` |
| `DeploymentPrompt.swift` | 部署提示词（自动化协议 + 富输出围栏词表）及其落点：`<DSH_HOME>/AGENTS.md` 的托管块。**不走** `system-prompt` 的 personaPrefix——那条路被 agent preset 遮蔽（`PITFALLS §7.7`） |
| `NativeAlerts.swift` / `FloatingBubble.swift` | 原生通知（分级静默）+ 常驻悬浮球（`SPEC-NOTIFICATIONS-FLOATING-BALL`） |
| `HotKeyManager.swift` / `HotkeyRecorderWindow.swift` / `DictationController.swift` | 全局热键 ⌥Space（可改）、录制窗、语音听写 |
| `ProcessRunner.swift` | 通用子进程执行器（唯一实现）：起进程 + 两侧管道各自排空 + 可选超时 + 回收输出。纪律照 PITFALLS §4.11（顺序读有互锁面）；调用点：`runGit`/`gitRun`（状态胶囊与 git 动作）、`GitChanges`（审查面板的未暂存改动与单文件 diff）、`agentRun` |
| `ProfilePluginAdmin.swift` | 插件卸载：从 web profile 的 `dependencies` 与 `dsh.profile.bundles` 摘掉该插件（bundle 成员有启动边界 → 调用方负责重启引擎）。随应用发布的插件拒卸 |
| `McpServerAdmin.swift` | MCP server 行：`- insert:` 一行一 server（`@deepseek-ai/dsh-mcp-client` + `config` 用 JSON 写进 YAML），同一份 home patch 层的第二块托管段；行上的 `disabled` 管启停，同样热生效 |
| `StatusItemController.swift` | 菜单栏状态点与菜单（引擎状态以图标呈现；失败的具体原因在 SPA 的引擎横幅里，见 §3 事件表） |
| `WebViewTheme.swift` / `DSHAppPrefs.swift` / `AppPaths.swift` / `JSONValue.swift` | html/body 透明注入（勿加样式）、偏好、数据目录、设置面动态 JSON 树 |
| `EngineSupervisor.ensureAutomationSkill` | 启动时把随应用发的技能铺进引擎用户技能根（`<DSH_HOME>/skills/deepdive-automation/SKILL.md`）：会话里提议定时任务；`system-prompt` 前缀只剩一行指路 |
| `KeepAwake.swift` | 空闲休眠断言：自动化分区「运行会话时保持电脑唤醒」按下时 `ProcessInfo.beginActivity(.idleSystemSleepDisabled)`，停跑/关开关即释放（幂等；合盖与手动休眠不拦） |
| `OpenWithCatalog.swift` / `WorkspaceIcon.swift` | 壳侧事实目录（预览页「打开方式」候选/图标、空间图标探测），只出数据不做决策 |

## 4. 自建 SPA（frontend/src/）

| 模块 | 职责 |
|---|---|
| `App.tsx` / `main.tsx` | Shell 骨架：侧栏 + 主区路由（欢迎 hero / SessionView / 设置浮层） |
| `components/SessionView.tsx` + `session/` | 会话流：SessionView 为编排（~300 行），摄取与呈现拆在 `session/`——renderModel（RenderItem/ingest/finalizeTurns，O(1) 索引）、useSessionEvents/useSessionModels、Item/MessageRow/ToolRow/ToolIcon/Cards/QueueDock 组件群、eventText/format 纯函数、toolKind（工具名→语义族的唯一映射：图标与轮内折叠摘要共用）、turnProcess（整轮过程折叠的边界与摘要文案） |
| `components/NewProjectDialog.tsx`（+ `IconPicker.tsx` / `wsIcons.ts` / `workspacePicker.ts`） | 新建项目表单弹窗（名称+图标/目录/项目指令；`openNewProjectDialog()` 入口 + App 根部 `NewProjectDialogHost` 消费）：目录由壳 `prepare-workspace` 自动创建（引擎 workspace/create 要求目录已存在）、名称走 workspace/rename、指令由壳写入项目 AGENTS.md；图标=lucide 精选集搜索选择（`IconPicker`），按 workspaceId 存 localStorage（`wsIcons.ts`，端口已固定），侧栏项目行/底部切换条统一 glyph>约定文件>首字母 |
| `components/Composer.tsx`（编排）+ `components/composer/`（draft/dictation/attachments/menu hooks + 菜单子组件） / `ModelMenu.tsx`（思考强度档位菜单） / `Sidebar.tsx`（多工作区+会话列表） / `WsSwitcher.tsx`（底行空间切换条：溢出渐隐+滚轮就地消费；`⌥1-9` 切空间，判据认物理键位） / `SettingsPage.tsx` + `settings/`（含 `useSettingNamespace` 围栏 hook；`useModelCatalog` 模型目录+密钥态数据源、`providerProbe` 密钥/连通探测，设置页「模型」与新手引导卡共用；`ImportSection`/`ImportDialog` 设置「导入」分区（dsh-chat-import 插件面板路由），见 `SPEC-ENGINE-RUNTIME §4.4`） | 输入框（@附件 //命令/听写）、模型与推理档位、侧栏、设置浮层（`useAppKeybinds` 派发 window 级快捷键；`FindInConversation` 是 ⌘F 页内查找胶囊）、新手引导卡（`onboarding/`：迁移→模型→项目→结尾，能力复用设置页与插件面板路由） |
| `stats/` | 设置→使用统计：会话历史用量折叠（usageStats）+ 热力图/趋势图/圆环卡；用量**优先读引擎的 `usage` 投影**（随 `session/list` 一起来，见 `PLAN-NATIVE-ENGINE.md §5`），拿不到该键的会话回落前端重放聚合。**数据模型（用户定稿）**：用量按会话记录在本地（`deepdive.usageFold`，localStorage）并与归档/删除解耦——页面第一帧就折缓存的账直接展示（含已归档/已删除会话）；引擎侧的**新鲜账**优先取 `usage` 投影（`session/list` 随行带来，零额外 IO），只有拿不到该键的会话才回落逐会话 follow+page 重放（159 会话十几秒，故只补差不全量读） |
| `components/Markdown.tsx` / `ThinkingState.tsx` / `LoadingState.tsx` / `Icons.tsx` / `ProviderIcon.tsx` / `HoverScrollText.tsx` / `HeroBrand.tsx` | 呈现组件（`Markdown` 见下行 `rich/` 的围栏分流） |
| `rich/` | 正文富输出围栏（`mermaid` / `svg` / `widget`，词表在 `fences.ts`）：`mermaidRender` 按需 import mermaid（独立分块）并从 CSS 语义变量读色烘图、明暗切换靠块自订阅（**不赌父组件重渲**，误诊后果=图示配色停在上一个主题）；`sanitizeSvg` 用 DOMPurify 的 svg profile 消毒内联 SVG（禁 `script`/`foreignObject`），成品图连带作者自带的 `<style>` 一起进 shadow root（`ScopedSvg`；`@scope (#id)` 会静默废掉 `#<svg-id> …` 这类选择器让整张图变黑，`PITFALLS §3.8`）；`WidgetBlock` 用 `sandbox="allow-scripts"`（无 same-origin）跑交互组件；围栏未闭合（流式）显示「正在读取…」且不发起渲染；渲染不出来（语法错/超限）一律退回代码块显示源码（`PITFALLS §3.7`） |
| `session/backgroundSession.ts` | 后台会话的判据与命名（唯一事实源）：读投影标题而非应用侧 id 台账（MiMo 形态）——自动化运行会话不进用户列表（该任务的运行历史仍可打开；已删的「自进化」留下的 `自进化·` 机器会话按同一条规则继续隐藏）；fail-open：读不到标题当用户会话。生产者（自动化运行）建会话时按同一份常量命名 |
| `plugins/` | 插件页（设置→插件）：`model`（插件行状态/排序/汇总/短名/行 id 纯函数：`enabled:false` 分「用户关掉」与「本层未挂载」两态，见 `PITFALLS §7.6`）、`PluginsSection`（tab 容器：插件/MCP/技能 + 搜索）、`PluginsTab`（只列用户装进来的插件：引擎自带的内部模块根本不出现；逐行启停开关 + 行菜单「立即试用/卸载」）、`McpTab`（MCP server 列表/启停/增删改）、`SkillsTab`（技能清单/新建/删除/从目录安装）。清单与开关落账都直读引擎（`skills/admin*`、`pluginInventory/patch*`），只有选目录 sheet 与「随应用发布的技能名」走壳 |
| `mobile/` | 移动端远程控制（设置→移动端远程控制）：`RemoteControlSection`（扫码连接卡片 + 二维码 + 已配对设备台账）；远程状态与配对全在壳侧，前端只渲染快照（`host.ts` 的 remoteStatus/remoteStart/remoteStop/remoteRefresh/remoteRevoke/remoteCopyLink/qrEncode）。语义与安全边界见 `SPEC-MOBILE-REMOTE.md` |
| `bots/` | Bot Channel（设置→移动端远程控制 右栏）：`BotChannelCard`（渠道列表 + 真实状态）、`BotManageDialog`（机器人台账 + 扫码新建 + 移除）、`im.ts`（渠道目录与状态纯函数）。wire 走 `api.ts` 的 `api.im`（插件的 `POST /api/dsh-im/<渠道>`，不是引擎 typert 网关）；契约见 `SPEC-MOBILE-REMOTE.md §5` |
| `automation/` | 自动化（定时任务）：`model`（计划类型 + 次回触发/文案纯函数）、`templates`（四张模板卡）、`storage`（localStorage 持久化，读取即边界校验）、`runner`（到点执行：建会话→选模型→`/permission`→发指令）、`useAutomation`（App 级 Provider：任务/历史状态 + 30s 调度 tick + 运行对账 + 保持唤醒信号）、`protocol`（会话里创建自动化的围栏块协议：解析 + 形状校验）、`AutomationProposalCard`（消息流里的建议卡，点创建→预填表单）、`AutomationSection`（设置页「自动化」分区：列表↔编辑器两态路由）+ `TaskListPage`/`TaskCard`/`TaskEditorPage`/`ScheduleRow`/`RunHistory`（视图）。**调度在客户端**：引擎没有定时任务 RPC（`dsh-schedule` 只是会话内提醒工具），代价与应用语义见 `SPEC-AUTOMATION.md` |
| `components/preview/` | 产物/文件预览：`useFilePreview`（标签+全屏+每标签视图偏好+面板模式 file/review）、`FilePreviewWindow`（little 浮窗 + 全屏页头 + 内容装配 + 渲染器/折行控件）、`PreviewBody`（按渲染器分流）、`PdfPreview`（pdf.js 逐页 canvas 自绘，按需 import）、`OpenWithMenu`（右上「打开方式」）、`previewModel`（渲染器候选/语言/换行 纯函数）+ `components/CodeLines.tsx`（行号高亮体，与消息流代码卡共用）。pdfjs 的 worker 走 `?url` 资产、cMaps/标准字体/wasm 由 `frontend/scripts/copy-pdfjs-assets.mjs` 在 build 末尾拷进 `dist/pdfjs/`（同源、离线可用，不走 CDN） |
| `review/` | 审查面板（预览面板的审查面，工作区未暂存改动，只读）：`patchModel`（unified patch 解析 + 折叠段计算，纯函数）、`gitChangesModel`（wire 边界收窄）、`useReviewChanges`（清单一次拉全 + 单文件 diff 懒取，刷新按 revision 整份换缓存）、`ReviewBody`/`ReviewFileRow`/`DiffRow`（呈现）。git 在壳侧（`GitChanges.swift`，桥消息 `git-changes`/`git-diff`），引擎不参与 |
| `store.tsx`（列表/审批/排队等业务状态） + `prefs.ts`（壳偏好 hook） / `api.ts` / `types.ts` / `host.ts`（壳桥请求统一超时包装） / `titlebar.ts` / `i18n.ts` + `i18n-en.ts`（词典数据） / `events.ts`（应用内事件名） / `useEdgeFade.ts`（溢出渐隐边缘信号，UI-SPEC「FadeEdge」标准） | React Context 手写 store（轮询签名去抖）、same-origin RPC 客户端、事件可辨识联合、壳桥挂载、标题栏 rect 推送、中英词典 |
| `theme.css` | 全部样式（唯一事实源，含亮/暗语义变量）；tokens 变量来自 `packages/design/generated/tokens.css` |

## 5. 引擎运行时（SPEC-ENGINE-RUNTIME）

- **引擎来源**：默认嵌**本仓构建的自有引擎**——`engine/` 下的 dsh 内核 fork（MIT，逐字复制
  未改名，`scripts/sync-engine-fork.mjs` 物化）经 `scripts/build-engine.sh` 双面构建出与 npm
  闭包同形状的产物；`DEEPDIVE_ENGINE_SOURCE=npm` 回退到上游 npm 闭包轨（对照/回退用，产品面
  的部分 RPC 不在那条轨上，见 `PLAN-NATIVE-ENGINE.md §2`）。两条轨过同一道 `validate_runtime`
  与启动/组合闸门；fork 的范围、偏差与纪律见 `engine/README.md`。
- **组合归本仓**：引擎装载哪些插件由 `engine/profile/` 定义（`cordis.patch.yml` 是唯一事实源），
  上游的 `@deepseek-ai/dsh-base` / `dsh-web-app` **不作为层参与组合**；壳在引擎启动前经
  `ProfileComposer` 把它装进 harness home 的 web profile 并收敛 `dsh.profile.bundles`
  （含既有安装的迁移：摘掉退役的上游两层）。改法与**升引脚的漂移流程**见该目录 README；
  `scripts/check-engine-composition.sh` 每次 `make test` 拿实际组合对比入库的期望快照，不一致即失败。
- **闭包裁剪**：`scripts/prune-dsh-runtime.sh` 把自有组合不装载的包从分发里摘掉
  （官方 GUI 客户端、反馈通道与遥测、webhook 等；移除清单与 `cordis.patch.yml` 的
  "有意移除清单"是同一个决定的两种形态）。判据是**真实启动**——
  `scripts/smoke-engine-boot.sh` 在构建链里用随包 node 把引擎起一次等就绪行。
- **外向数据流**：这台机器往外发什么（模型调用、联网工具、IM 渠道、听写、正文里的远程图片、
  `widget` 围栏……）逐条记在 **`docs/DATA-FLOW.md`**——组合归本仓之后"我们发了什么"是我们的
  责任，那份文档同时写明**未审计项**，别把它读成完整清单。
- **入口优先级**：`DSHMINI_DSH_ENTRY`（开发对照，最强覆盖）→ bundled（`Resources/Runtime/node` + `Runtime/dsh/lib/bin.js`）→ 系统路径探测 → `PATH` 的 `dsh`；bundled 残缺或外部入口版本与随包引脚不符一律拒启（版本门，`SPEC-ENGINE-RUNTIME §3.4`）。
- **版本引脚唯一事实源**：`scripts/dsh-runtime-version.txt`（XcodeGen 把原文件拷进 bundle 作 `Resources/dsh-runtime-version.txt`，版本门据此判外部入口）+ `scripts/node-version.txt`（构建机校验 fail-loud）；上游新 rc 的升级裁决（当前：0.1.7-rc.1 暂不升）见 `SPEC-ENGINE-RUNTIME §5.1`。
- **构建链**：`prepare-dsh-runtime.sh`（闭包准备 + 原生/FFI 冒烟，`DSH_SOURCE` 可复用同版本源）+ `prepare-chat-import.sh` / `prepare-dsh-im.sh`（两个随包社区插件的闭包，各自版本引脚在 `scripts/dsh-*-version.txt`）→ `embed-engine.sh`，其步骤有序且不得乱调：拷 node/闭包 → `patch-engine-model-data.sh`（模型目录）→ `prune-dsh-runtime.sh`（裁剪）→ 拷 `engine/profile` 进 `Resources/EngineProfile/` + 组合自检（`--dump-config`，挡补丁写坏）→ **`sign-app.sh` 重封**（所有文件改动之后）→ 许可 → `bin.js --version` → `smoke-engine-boot.sh`（用随包 node 真起一次等就绪行——`--version` 不装载插件、`--dump-config` 只解析补丁层，两者都发现不了"包被裁掉但某行还依赖它"）→ `build-release.sh` / `package-macos.sh`（最终 `sign-app.sh` 深签 + 可选公证装钉）/ `dev.sh`（`DSHMINI_DEV_ENGINE=1` 时嵌入）。
- **签名身份统一走 `sign-app.sh`**（两条链共用一份）：Developer ID 固定身份 → TCC 授权绑 (bundle id + 团队)、跨构建持久；ad-hoc 无 Team ID，授权只能按 cdhash 记，每次重建都重置（PITFALLS §4.8）。无证书环境回退 adhoc 并明说会丢授权。
- **模型目录新鲜度**：pi-ai 的模型目录只在**它自己发版时**刷新（引擎自带发布当天的快照），所以引脚不动期间目录会过时。嵌入时由 `scripts/patch-engine-model-data.sh` 把 `scripts/engine-model-data/` 的**生成数据层**（纯数据、无代码改动）覆盖进 bundle 内的 pi-ai dist；脚本带版本闸（运行时 pi-ai ≥ 快照版次即跳过），引脚升过该版次后删掉覆盖目录（来源、更新步骤与快照语义变化见该目录 README）。`prepare-dsh-runtime.sh` 仍校验引擎自带 pi-ai 版本与引脚一致。
- **版本韧性**：稳定面直接用；版本敏感面（provider 管理等）`probeMethod` 能力探测，缺则降级/隐藏。
- **部署提示词落 AGENTS.md，不走 `system-prompt` 的 personaPrefix**：后者被随包 agent preset 的
  `@deepseek-ai/dsh-persona` 按同名 section 遮蔽、到不了模型（实测与修法见 `PITFALLS §7.7`），
  而现在落在 `<DSH_HOME>/AGENTS.md` 的托管块里（`DeploymentPrompt`，段外内容逐字保留——
  用户自己也会写这个文件）。内容 = 自动化协议指路 + 富输出围栏词表。
- 启动参数 `--profile web --patch <support>/engine-patch.yml --no-open --port 0`；
  overlay 只放"装配"（schedule 一条 insert）；`DSH_HOME` = `~/Library/Application Support/DeepDive/harness`（完整独立 dsh 安装，首启动自 DSHmini 旧目录迁移）。

## 6. 设计 token 管线

`frontend/packages/design/tokens.json`（唯一事实源）→ `gen-tokens.mjs` → `generated/tokens.css`（CSS 变量）。`make tokens` / `npm run gen` 再生成；**手写数值即违规**（`UI-SPEC`）。

## 7. 仓库布局

```
apps/macos/                Swift 壳（XcodeGen project.yml；xcodeproj/Info.plist 生成物已 ignore）
frontend/                  自建 SPA（Vite 单入口）；packages/design = token 源 + 生成器
engine/profile/            引擎组合：装载哪些插件的唯一事实源（bundle 包 + 期望快照 + README）
design/logo/               DeepDive logo 种子工程与导出（白底实心 D + 右侧渐变模糊；BRANDING.md）
scripts/                   构建/打包/嵌入/运行时准备/裁剪/组合门脚本 + 版本引脚
docs/                      本架构 + 规范（UI/SEMANTICS/三个 P2 SPEC）+ PITFALLS + WORKING-AGREEMENTS
deepseek-harness/          官方 DSH 源码 vendored 副本（版本=引擎引脚，embed 时 check-dsh-source.sh 强校验）——资产/移植对照，勿当运行时
```

## 8. 与原蓝图（v0.3）的偏差（有意为之）

- **未做**：Raycast 式 Launcher NSPanel（现为主窗 ⌥Space 显隐）、Windows 外壳（方案见 `PLAN-WINDOWS.md`，暂缓）、Keychain 凭证插件（凭据走引擎 `credentials.*` + 设置页）、Sparkle 自动更新、dsh 插件形态定制（主题/听写等全部实现在壳与 SPA 内，未走 Cordis 插件行）。
- **改道**：设置从"独立原生窗口"改为 **WebView 内浮层**（`SPEC-SETTINGS-WINDOW v3`）；审批用 WebView 内卡片而非原生弹窗；模型菜单/工作区侧栏为自建呈现，不挂官方 Slots。
- **已知限制**：自动更新未做；会话 cwd 创建即定死（工作树并行隔离据此受限，见 `docs/TODO.md` §12）。侧栏切空间只是换视图，不重启引擎——引擎进程的 cwd 只当**没有会话上下文**时的兜底根（agentless 调用）与 `@` 文件索引的扫描根，改它由菜单栏「选择引擎启动工作区」负责（那条路径会重启引擎）。路线待办见 `docs/TODO.md`。

## 9. 沿革

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0/P1（2026-08-30） | 套壳 v1：壳 + 官方 web UI + 黑白主题覆盖（PLAN-P1/REVIEW-P1，已删） | ✅ 完成 |
| 自建 SPA（2026-08-31） | 按官方 UI 对齐移植自建前端（REVIEW-P2 驱动的渲染模型收敛） | ✅ 完成（P2-6 snapshot store 评估仍开放，见 REVIEW-P2） |
| P2 桌面增强（2026-08-31~09-02） | bundled 引擎运行时 + 设置浮层 + 原生通知/悬浮球 + 听写 + 品牌改名 DeepDive（PLAN-P2-DESKTOP，已删） | ✅ 完成 |
| 2026-09 起 | 性能（增量摄取/memo/轮询去抖）、思考强度档位、多工作区、i18n、亮色主题等迭代 | 进行中（见 git log） |
