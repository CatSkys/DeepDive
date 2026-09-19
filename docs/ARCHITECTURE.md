# DeepDive（DSHmini）架构 — as-built

> 本文描述**已落地的实际架构**（2026-09 收口）。规划期文档（v0.3 蓝图、P1/P2 计划）已完成历史使命并删除，沿革见文末；如需原文查 git 历史。
> 品牌：对外名 **DeepDive · 深潜**（`docs/BRANDING.md`）；内部代号（scheme `DSHmini`、源码目录 `DSHminiApp`、包名 `@dshmini/frontend`）有意保留以减少 diff。

---

## 1. 总览：三层混合架构

```
┌──────────────────────────────────────────────────────────────┐
│ 原生外壳  Swift + AppKit（apps/macos，XcodeGen 生成工程）      │
│  玻璃主窗(WKWebView) · 全局热键 · 菜单栏 · 原生通知 · 悬浮球   │
│  听写 · 引擎监督(自愈重启/恢复屏) · BridgeServer(同源托管)     │
├──────────────────────────────────────────────────────────────┤
│ 自建 SPA  React + TS + Vite（frontend/）                       │
│  会话流/工具行/审批卡/提问卡/排队 · 模型菜单(思考强度) ·        │
│  多工作区侧栏 · 设置浮层 · 黑白主题(外观三态) · 中英双语        │
├──────────────────────────────────────────────────────────────┤
│ 引擎  dsh 子进程（被监督；Node runtime 闭包随 App 分发）       │
│  agent loop / session log / 工具管线 / 模型适配 / 持久化       │
└──────────────────────────────────────────────────────────────┘
```

职责边界：**壳**只做 OS 级能力、进程监督，外加**会话数据的受控维护**（仅「取消归档 / 删除会话」两处——引擎 wire 面没有这两个方法，实现见 `SessionAdmin.swift`：立即删日志目录 + 覆盖集登记，引擎状态文件在**下次启动的空窗期**落账，全程不重启引擎）；**SPA** 只做渲染与交互，把用户动作路由为引擎 RPC；**引擎**持有全部业务状态，其余业务数据不经过壳。

## 2. 通信矩阵（现实现）

| 边 | 通道 | 要点 |
|---|---|---|
| SPA → 引擎 | same-origin `POST /api/<ns>/<method>`（client-request 信封、`{args}` 具名包裹）+ 单条 `ws /api/remote.mux` 多路流（`$events`/`session/follow`/`session/control`/`workspace/follow`） | 经壳内 BridgeServer 反代（token+cookie 注入）；wire 契约实测见 `DSH-WIRE.md` |
| 手机浏览器 → 引擎 | 同一个 SPA 与同一套 `/api` 转发，但走**远程面**（独立局域网监听） | 用户显式开启才起（默认关）；一次性配对令牌 + 设备 cookie 台账，见 `SPEC-MOBILE-REMOTE.md` |
| 壳 → 引擎 | stdio（`dsh web:` URL 行、日志尾巴）+ 进程信号 | 只关心 UP/BOOT_FAILED/EXITED 与端口 |
| 壳 ↔ SPA | `WKScriptMessageHandler`（`deepdive` 标题栏 rect 表 / `deepdiveHost` 前端指令）；壳→前端 `evaluateJavaScript` 调 `window.__deepDiveHost.dispatch`（pending 单条暂存） | 指令集与降级纪律见 `SPEC-NOTIFICATIONS-FLOATING-BALL §3.1`；标题栏拖拽契约见 `PITFALLS §4.3` |
| 壳 → 引擎事件 | `EngineEventObserver` 自读 `$events` 流派生 running/完成/待审批状态（waterfall 恒回 `next`，不决策） | 通知/悬浮球/菜单栏徽标原生实时，不依赖前端 |

## 3. 原生外壳（apps/macos/Sources/DSHminiApp/）

| 文件 | 职责 |
|---|---|
| `AppDelegate.swift` | 生命周期、host 指令路由、设置/外观/通知接线 |
| `MainWindowController.swift` | 玻璃主窗 + 透明 WKWebView + 显隐防闪烁 + 标题栏拖拽 rect 表 + 空 NSToolbar（Tahoe 大圆角档，勿删，`PITFALLS §4.7`） |
| `BridgeServer.swift` + `MiniHTTPServer.swift` | 同源托管：SPA 静态文件 + `/api` 反代 + WS 盲中继（Origin 全等校验）。**监听端口固定**（`DSHAppPrefs.bridgePort` 记住，被占才退回内核分配）：端口即网页 origin，换了 origin 前端的 localStorage（会话覆盖集/用量缓存/自动化任务）就等于清零（PITFALLS §4.17）。移动端远程面复用同一套分发与中继，只是监听在 `0.0.0.0` 且先过配对闸 |
| `RemoteAccess.swift` + `QRCode.swift` | 移动端远程访问：配对令牌（落地即轮换）、设备台账（逐台解绑）、局域网地址探测、CoreImage 生成二维码。只管「谁被允许进来」，HTTP 面复用 BridgeServer；安全边界见 `SPEC-MOBILE-REMOTE.md` |
| `BotChannelPlugin.swift` | IM 渠道插件（`@xmanrui/dsh-im`，社区包 MIT，引脚 `scripts/dsh-im-version.txt`）安装器：把随包的整棵依赖闭包铺进 `profiles/web` 并登记 profile bundles，引擎启动后挂上 `POST /api/dsh-im/<渠道>`（Bot Channel 与机器人管理走这条）。幂等 + 失败不阻塞引擎（与 `ChatImportPlugin` 同款纪律） |
| `EngineSupervisor.swift` / `EngineVersion.swift` / `EngineGateway.swift` / `EngineAuth.swift` / `EngineEventObserver.swift` / `EngineLog.swift` | 引擎子进程监督/自愈、入口版本门（随包引脚 vs 外部 dsh）、网关调用、token→cookie 交换、事件观察、日志 |
| `NativeAlerts.swift` / `FloatingBubble.swift` | 原生通知（分级静默）+ 常驻悬浮球（`SPEC-NOTIFICATIONS-FLOATING-BALL`） |
| `HotKeyManager.swift` / `HotkeyRecorderWindow.swift` / `DictationController.swift` | 全局热键 ⌥Space（可改）、录制窗、语音听写 |
| `ProcessRunner.swift` | 通用子进程执行器（唯一实现）：起进程 + 两侧管道各自排空 + 可选超时 + 回收输出。纪律照 PITFALLS §4.11（顺序读有互锁面）；四个调用点：`runGit`/`gitRun`（状态胶囊与 git 动作）、`worktreeRun`、`agentRun` |
| `WorktreeAdmin.swift` | 工作树管理：解析 `git worktree list --porcelain`、组装 add/remove 参数（删除**不带 --force**，有未提交改动时让 git 拒绝）。只做生命周期，不做隔离 |
| `SkillAdmin.swift` | 技能管理面（设置→插件→技能）：读 `<DSH_HOME>/skills/<id>/SKILL.md` 的清单（frontmatter 解析、缺键标注、随应用发布的三个技能标 managed）、新建（写骨架 SKILL.md）、删除一层技能目录（拒穿越）。技能没有 wire 面，读盘/写盘/删盘只能由壳做 |
| `ManagedPatchBlock.swift` | home 级 patch 层（`<DSH_HOME>/cordis.patch.yml`）里「托管块」的读写原语：按标记对切/换/取行，段外内容逐字保留、不解析 YAML。两个消费者：`PluginPatchAdmin`、`McpServerAdmin` |
| `PluginPatchAdmin.swift` | 插件启停的落账：写 home 级 patch 层的托管块（`- id: <行id>` + `disabled:`）。profile 是 `patchReload: live` → **热生效、不重启**（实测 ≤4s 翻转，PITFALLS §7.6） |
| `ProfilePluginAdmin.swift` | 插件卸载：从 web profile 的 `dependencies` 与 `dsh.profile.bundles` 摘掉该插件（bundle 成员有启动边界 → 调用方负责重启引擎）。随应用发布的插件拒卸 |
| `McpServerAdmin.swift` | MCP server 行：`- insert:` 一行一 server（`@deepseek-ai/dsh-mcp-client` + `config` 用 JSON 写进 YAML），同一份 home patch 层的第二块托管段；行上的 `disabled` 管启停，同样热生效 |
| `SessionAdmin.swift` | 会话数据维护：取消归档 / 删除（引擎无对应 RPC 且把会话列表缓存在内存 → ①立即删 `sessions/<bucket>/<id>/`；②覆盖集登记到 UserDefaults，下次启动空窗期落账 `storages/workspace.json` 归档集 + `storages/session_projcache.json`；纯函数 + 原子写，结构不符拒绝落盘） |
| `StatusItemController.swift` / `RecoveryWindowController.swift` | 菜单栏状态点与菜单、引擎失败恢复屏（诊断复制/凭据冷启动） |
| `WebViewTheme.swift` / `DSHAppPrefs.swift` / `AppPaths.swift` / `JSONValue.swift` | html/body 透明注入（勿加样式）、偏好、数据目录、设置面动态 JSON 树 |
| `EngineSupervisor.ensureLesson{Verify,Gate,Land}Script` | 自进化三份固化脚本：每次启动铺到 `<DSH_HOME>/deepdive/` 并置可执行位（shebang 指向随包 node、写死随包 fzstd 路径）。verify 数签名在落地前后两窗的命中（steps=匹配会话均值口径）；gate 机械门（证据逐字=解码后事件字段值包含摘录 + 锚点存在）；land 落地确认（git 提交 --grep 提案id + 触碰文件 ⊆ 允许清单 + 文件回读；plugin 家 node --check + 挂载块带戳）。壳经 `lesson-tool` 桥直跑，模型不在环内 |
| `EngineSupervisor.quarantineDeepDivePluginMounts` | 自愈：引擎连续启动失败且用户层 patch（profiles/web/cordis.patch.yml）里有 lesson- 挂载块时整块摘除（全文进日志）再重启一次——坏挂载不许让引擎永远起不来 |
| `EngineSupervisor.ensureSessionMemoryPlugin / sessionMemorySkill` | 会话记忆（Session 层）：`deepdive-session-memory` 插件（每轮 pre-step 注入 <session_memory> 围栏笔记 + memory_note_read/write/new_context 三工具，fail-open）与同名技能随启动铺盘；挂载随 `sessionMemoryEnabled` 开关写进 engine-patch insert（本地文件插件，热装） |
| `EngineSupervisor.ensure*Skill` | 启动时把两个「随应用发的技能」铺进引擎用户技能根（`<DSH_HOME>/skills/<name>/SKILL.md`）：`deepdive-automation`（会话里提议定时任务）与 `deepdive-evolution`（会话里提议沉淀经验）；`system-prompt` 前缀只剩各自一行指路 |
| `KeepAwake.swift` | 空闲休眠断言：自动化分区「运行会话时保持电脑唤醒」按下时 `ProcessInfo.beginActivity(.idleSystemSleepDisabled)`，停跑/关开关即释放（幂等；合盖与手动休眠不拦） |
| `OpenWithCatalog.swift` / `WorkspaceIcon.swift` | 壳侧事实目录（预览页「打开方式」候选/图标、空间图标探测），只出数据不做决策 |

## 4. 自建 SPA（frontend/src/）

| 模块 | 职责 |
|---|---|
| `App.tsx` / `main.tsx` | Shell 骨架：侧栏 + 主区路由（欢迎 hero / SessionView / 设置浮层） |
| `components/SessionView.tsx` + `session/` | 会话流：SessionView 为编排（~300 行），摄取与呈现拆在 `session/`——renderModel（RenderItem/ingest/finalizeTurns，O(1) 索引）、useSessionEvents/useSessionModels、Item/MessageRow/ToolRow/ToolIcon/Cards/QueueDock 组件群、eventText/format 纯函数、toolKind（工具名→语义族的唯一映射：图标与轮内折叠摘要共用）、turnProcess（整轮过程折叠的边界与摘要文案） |
| `components/Composer.tsx`（编排）+ `components/composer/`（draft/dictation/attachments/menu hooks + 菜单子组件） / `ModelMenu.tsx`（思考强度滑杆） / `Sidebar.tsx`（多工作区+会话列表） / `WsSwitcher.tsx`（底行空间切换条：溢出渐隐+滚轮就地消费） / `SettingsPage.tsx` + `settings/`（含 `useSettingNamespace` 围栏 hook；`useModelCatalog` 模型目录+密钥态数据源，设置页「模型」与 `FirstRunGate` 首启欢迎页共用；`ImportSection`/`ImportDialog` 设置「导入」分区（dsh-chat-import 插件面板路由），见 `SPEC-ENGINE-RUNTIME §4.4`） | 输入框（@附件 //命令/听写）、模型与推理档位、侧栏、设置浮层、首启欢迎页（开始使用→设置配模型 / ~/.dsh 导入） |
| `stats/` | 设置→使用统计：会话历史用量折叠（usageStats）+ 热力图/趋势图/圆环卡；引擎无 usage RPC，全部前端聚合。**数据模型（用户定稿）**：用量按会话记录在本地（`deepdive.usageFold`，localStorage）并与归档/删除解耦——页面第一帧就折缓存的账直接展示（含已归档/已删除会话），引擎侧只在后台补"变过的会话"（逐会话 follow+page 读历史很贵，159 会话十几秒，故只补差不全量读） |
| `components/Markdown.tsx` / `ThinkingState.tsx` / `LoadingState.tsx` / `Icons.tsx` / `ProviderIcon.tsx` / `HoverScrollText.tsx` / `HeroBrand.tsx` | 呈现组件（`Markdown` 见下行 `rich/` 的围栏分流） |
| `rich/` | 正文富输出围栏（`mermaid` / `svg` / `widget`，词表在 `fences.ts`）：`mermaidRender` 按需 import mermaid（独立分块）并从 CSS 语义变量读色烘图、明暗切换靠块自订阅（**不赌父组件重渲**，误诊后果=图示配色停在上一个主题）；`sanitizeSvg` 用 DOMPurify 的 svg profile 内联 SVG，禁 `script`/`foreignObject`，并把作者自带的 `<style>` 用 `@scope (#id)` 圈进这张图（剥掉会让手写 SVG 一片纯黑，`PITFALLS §3.8`）；`WidgetBlock` 用 `sandbox="allow-scripts"`（无 same-origin）跑交互组件；围栏未闭合（流式）显示「正在读取…」且不发起渲染；渲染不出来（语法错/超限）一律退回代码块显示源码（`PITFALLS §3.7`） |
| `evolution/` | 自进化（零人审，SPEC-SELF-EVOLUTION v3）：`protocol`（lesson 块与壳侧回执解析、形状边界、七家允许清单）、`pipeline`（自动管线选择器纯函数：revoke→gate→apply→land→verify→review→consolidate）、`prompts`（落库/复盘/撤销/整理提示词，纯函数）、`store`（台账 + 运行历史 + 限速计数持久化）、`useEvolution`（App 级 Provider：采集跟随当前/交办/运行会话，执行管线——机械门/落地/确认/校验走壳桥 lesson-tool 直跑，落库/撤销/复盘/整理交办会话按落点作用域创建）、`chartData`+`Charts`（环图/柱状）、`EvolutionSection`（设置→自进化：开关 + 台账审计视图 + 运行历史；**无采纳按钮**）。标准与红线在 `docs/EVOLUTION-POLICY.md`（§0 自治模型） |
| `session/backgroundSession.ts` | 后台会话的判据与命名（唯一事实源）：读投影标题而非应用侧 id 台账（MiMo 形态），`badge`（整理类：复盘/整理，留列表加「自动」标识）/ `hidden`（执行类：落库会话、自动化运行，不进列表）；fail-open——读不到标题当用户会话。生产者（自进化交办、自动化运行）建会话时按同一份常量命名 |
| `worktree/` | 工作树（设置→工作树）：`model`（默认分支/同级目录、主工作树判据、标签纯函数）、`WorktreeSection`（列/建/删 + 注册为工作区）。生命周期交给 git 本体；**并行会话隔离做不到**（会话 cwd 不可变、沙箱根 = 引擎进程 cwd），卡片里如实写明 |
| `plugins/` | 插件页（设置→插件）：`model`（插件行状态/排序/汇总/短名/行 id 纯函数：`enabled:false` 分「用户关掉」与「本层未挂载」两态，见 `PITFALLS §7.6`）、`PluginsSection`（tab 容器：插件/MCP/技能 + 搜索）、`PluginsTab`（已安装的插件与引擎模块两组 + 逐行启停开关 + 行菜单「立即试用/卸载」）、`McpTab`（MCP server 列表/启停/增删改）、`SkillsTab`（技能清单/新建/删除）。开关写壳的 patch 托管块，热生效 |
| `memory/` | 会话记忆（Session 层）：`MemorySection`（设置→记忆：开关 + 笔记查看/忘记/全清审计面，经壳桥 memory-list/delete/clear）；插件与技能由壳铺盘 |
| `mobile/` | 移动端远程控制（设置→移动端远程控制）：`RemoteControlSection`（扫码连接卡片 + 二维码 + 已配对设备台账）；远程状态与配对全在壳侧，前端只渲染快照（`host.ts` 的 remoteStatus/remoteStart/remoteStop/remoteRefresh/remoteRevoke/remoteCopyLink/qrEncode）。语义与安全边界见 `SPEC-MOBILE-REMOTE.md` |
| `bots/` | Bot Channel（设置→移动端远程控制 右栏）：`BotChannelCard`（渠道列表 + 真实状态）、`BotManageDialog`（机器人台账 + 扫码新建 + 移除）、`im.ts`（渠道目录与状态纯函数）。wire 走 `api.ts` 的 `api.im`（插件的 `POST /api/dsh-im/<渠道>`，不是引擎 typert 网关）；契约见 `SPEC-MOBILE-REMOTE.md §5` |
| `automation/` | 自动化（定时任务）：`model`（计划类型 + 次回触发/文案纯函数）、`templates`（四张模板卡）、`storage`（localStorage 持久化，读取即边界校验）、`runner`（到点执行：建会话→选模型→`/permission`→发指令）、`useAutomation`（App 级 Provider：任务/历史状态 + 30s 调度 tick + 运行对账 + 保持唤醒信号）、`protocol`（会话里创建自动化的围栏块协议：解析 + 形状校验）、`AutomationProposalCard`（消息流里的建议卡，点创建→预填表单）、`AutomationSection`（设置页「自动化」分区：列表↔编辑器两态路由）+ `TaskListPage`/`TaskCard`/`TaskEditorPage`/`ScheduleRow`/`RunHistory`（视图）。**调度在客户端**：引擎没有定时任务 RPC（`dsh-schedule` 只是会话内提醒工具），代价与应用语义见 `SPEC-AUTOMATION.md` |
| `components/preview/` | 产物/文件预览：`useFilePreview`（标签+全屏+每标签视图偏好）、`FilePreviewWindow`（little 浮窗 + 全屏页头 + 内容装配 + 渲染器/折行控件）、`PreviewBody`（按渲染器分流）、`PdfPreview`（pdf.js 逐页 canvas 自绘，按需 import）、`OpenWithMenu`（右上「打开方式」）、`previewModel`（渲染器候选/语言/换行 纯函数）+ `components/CodeLines.tsx`（行号高亮体，与消息流代码卡共用）。pdfjs 的 worker 走 `?url` 资产、cMaps/标准字体/wasm 由 `frontend/scripts/copy-pdfjs-assets.mjs` 在 build 末尾拷进 `dist/pdfjs/`（同源、离线可用，不走 CDN） |
| `store.tsx`（列表/审批/排队等业务状态） + `prefs.ts`（壳偏好 hook） / `api.ts` / `types.ts` / `host.ts`（壳桥请求统一超时包装） / `titlebar.ts` / `i18n.ts` + `i18n-en.ts`（词典数据） / `events.ts`（应用内事件名） / `useEdgeFade.ts`（溢出渐隐边缘信号，UI-SPEC「FadeEdge」标准） | React Context 手写 store（轮询签名去抖）、same-origin RPC 客户端、事件可辨识联合、壳桥挂载、标题栏 rect 推送、中英词典 |
| `theme.css` | 全部样式（唯一事实源，含亮/暗语义变量）；tokens 变量来自 `packages/design/generated/tokens.css` |

## 5. 引擎运行时（SPEC-ENGINE-RUNTIME）

- **入口优先级**：`DSHMINI_DSH_ENTRY`（开发对照，最强覆盖）→ bundled（`Resources/Runtime/node` + `Runtime/dsh/lib/bin.js`）→ 系统路径探测 → `PATH` 的 `dsh`；bundled 残缺或外部入口版本与随包引脚不符一律拒启（版本门，`SPEC-ENGINE-RUNTIME §3.4`）。
- **版本引脚唯一事实源**：`scripts/dsh-runtime-version.txt`（XcodeGen 把原文件拷进 bundle 作 `Resources/dsh-runtime-version.txt`，版本门据此判外部入口）+ `scripts/node-version.txt`（构建机校验 fail-loud）。
- **构建链**：`prepare-dsh-runtime.sh`（闭包准备 + 原生/FFI 冒烟，`DSH_SOURCE` 可复用同版本源）+ `prepare-chat-import.sh` / `prepare-dsh-im.sh`（两个随包社区插件的闭包，各自版本引脚在 `scripts/dsh-*-version.txt`）→ `embed-engine.sh`（拷入 .app + `sign-app.sh` 重封 + 自检）→ `build-release.sh` / `package-macos.sh`（最终 `sign-app.sh` 深签 + 可选公证装钉）/ `dev.sh`（`DSHMINI_DEV_ENGINE=1` 时嵌入）。
- **签名身份统一走 `sign-app.sh`**（两条链共用一份）：Developer ID 固定身份 → TCC 授权绑 (bundle id + 团队)、跨构建持久；ad-hoc 无 Team ID，授权只能按 cdhash 记，每次重建都重置（PITFALLS §4.8）。无证书环境回退 adhoc 并明说会丢授权。
- **模型目录新鲜度**：模型目录随引脚走（引擎自带 pi-ai，`prepare-dsh-runtime.sh` 校验其版本与引脚一致）；旧的 `engine-model-data` 数据层覆盖已删。
- **版本韧性**：稳定面直接用；版本敏感面（provider 管理等）`probeMethod` 能力探测，缺则降级/隐藏。
- 启动参数 `--profile web --no-open --port 0`；`DSH_HOME` = `~/Library/Application Support/DeepDive/harness`（完整独立 dsh 安装，首启动自 DSHmini 旧目录迁移）。

## 6. 设计 token 管线

`frontend/packages/design/tokens.json`（唯一事实源）→ `gen-tokens.mjs` → `generated/tokens.css`（CSS 变量）。`make tokens` / `npm run gen` 再生成；**手写数值即违规**（`UI-SPEC`）。

## 7. 仓库布局

```
apps/macos/                Swift 壳（XcodeGen project.yml；xcodeproj/Info.plist 生成物已 ignore）
frontend/                  自建 SPA（Vite 单入口）；packages/design = token 源 + 生成器
design/logo/               DeepDive 黑底反白鲸鱼 logo 种子工程与导出（BRANDING.md）
scripts/                   构建/打包/嵌入/运行时准备脚本 + 版本引脚
docs/                      本架构 + 规范（UI/SEMANTICS/三个 P2 SPEC）+ PITFALLS + WORKING-AGREEMENTS
deepseek-harness/          官方 DSH 源码 vendored 副本（版本=引擎引脚，embed 时 check-dsh-source.sh 强校验）——资产/移植对照，勿当运行时
```

## 8. 与原蓝图（v0.3）的偏差（有意为之）

- **未做**：Raycast 式 Launcher NSPanel（现为主窗 ⌥Space 显隐）、Windows 外壳（方案见 `PLAN-WINDOWS.md`，暂缓）、Keychain 凭证插件（凭据走引擎 `credentials.*` + 设置页）、Sparkle 自动更新、dsh 插件形态定制（主题/听写等全部实现在壳与 SPA 内，未走 Cordis 插件行）。
- **改道**：设置从"独立原生窗口"改为 **WebView 内浮层**（`SPEC-SETTINGS-WINDOW v3`）；审批用 WebView 内卡片而非原生弹窗；模型菜单/工作区侧栏为自建呈现，不挂官方 Slots。
- **已知限制**：工作区切换需重启引擎（sandbox 根=cwd）；自动更新未做。路线待办见 `docs/TODO.md`。

## 9. 沿革

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0/P1（2026-08-30） | 套壳 v1：壳 + 官方 web UI + 黑白主题覆盖（PLAN-P1/REVIEW-P1，已删） | ✅ 完成 |
| 自建 SPA（2026-08-31） | 按官方 UI 对齐移植自建前端（REVIEW-P2 驱动的渲染模型收敛） | ✅ 完成（P2-6 snapshot store 评估仍开放，见 REVIEW-P2） |
| P2 桌面增强（2026-08-31~09-02） | bundled 引擎运行时 + 设置浮层 + 原生通知/悬浮球 + 听写 + 品牌改名 DeepDive（PLAN-P2-DESKTOP，已删） | ✅ 完成 |
| 2026-09 起 | 性能（增量摄取/memo/轮询去抖）、思考强度滑杆、多工作区、i18n、亮色主题等迭代 | 进行中（见 git log） |
