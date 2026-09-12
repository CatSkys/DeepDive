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
| 壳 → 引擎 | stdio（`dsh web:` URL 行、日志尾巴）+ 进程信号 | 只关心 UP/BOOT_FAILED/EXITED 与端口 |
| 壳 ↔ SPA | `WKScriptMessageHandler`（`deepdive` 标题栏 rect 表 / `deepdiveHost` 前端指令）；壳→前端 `evaluateJavaScript` 调 `window.__deepDiveHost.dispatch`（pending 单条暂存） | 指令集与降级纪律见 `SPEC-NOTIFICATIONS-FLOATING-BALL §3.1`；标题栏拖拽契约见 `PITFALLS §4.3` |
| 壳 → 引擎事件 | `EngineEventObserver` 自读 `$events` 流派生 running/完成/待审批状态（waterfall 恒回 `next`，不决策） | 通知/悬浮球/菜单栏徽标原生实时，不依赖前端 |

## 3. 原生外壳（apps/macos/Sources/DSHminiApp/）

| 文件 | 职责 |
|---|---|
| `AppDelegate.swift` | 生命周期、host 指令路由、设置/外观/通知接线 |
| `MainWindowController.swift` | 玻璃主窗 + 透明 WKWebView + 显隐防闪烁 + 标题栏拖拽 rect 表 + 空 NSToolbar（Tahoe 大圆角档，勿删，`PITFALLS §4.7`） |
| `BridgeServer.swift` + `MiniHTTPServer.swift` | 同源托管：SPA 静态文件 + `/api` 反代 + WS 盲中继（Origin 全等校验）。**监听端口固定**（`DSHAppPrefs.bridgePort` 记住，被占才退回内核分配）：端口即网页 origin，换了 origin 前端的 localStorage（会话覆盖集/用量缓存/自动化任务）就等于清零（PITFALLS §4.17） |
| `EngineSupervisor.swift` / `EngineVersion.swift` / `EngineGateway.swift` / `EngineAuth.swift` / `EngineEventObserver.swift` / `EngineLog.swift` | 引擎子进程监督/自愈、入口版本门（随包引脚 vs 外部 dsh）、网关调用、token→cookie 交换、事件观察、日志 |
| `NativeAlerts.swift` / `FloatingBubble.swift` | 原生通知（分级静默）+ 常驻悬浮球（`SPEC-NOTIFICATIONS-FLOATING-BALL`） |
| `HotKeyManager.swift` / `HotkeyRecorderWindow.swift` / `DictationController.swift` | 全局热键 ⌥Space（可改）、录制窗、语音听写 |
| `SessionAdmin.swift` | 会话数据维护：取消归档 / 删除（引擎无对应 RPC 且把会话列表缓存在内存 → ①立即删 `sessions/<bucket>/<id>/`；②覆盖集登记到 UserDefaults，下次启动空窗期落账 `storages/workspace.json` 归档集 + `storages/session_projcache.json`；纯函数 + 原子写，结构不符拒绝落盘） |
| `StatusItemController.swift` / `RecoveryWindowController.swift` | 菜单栏状态点与菜单、引擎失败恢复屏（诊断复制/凭据冷启动） |
| `WebViewTheme.swift` / `DSHAppPrefs.swift` / `AppPaths.swift` / `JSONValue.swift` | html/body 透明注入（勿加样式）、偏好、数据目录、设置面动态 JSON 树 |
| `KeepAwake.swift` | 空闲休眠断言：自动化分区「运行会话时保持电脑唤醒」按下时 `ProcessInfo.beginActivity(.idleSystemSleepDisabled)`，停跑/关开关即释放（幂等；合盖与手动休眠不拦） |
| `OpenWithCatalog.swift` / `WorkspaceIcon.swift` | 壳侧事实目录（预览页「打开方式」候选/图标、空间图标探测），只出数据不做决策 |

## 4. 自建 SPA（frontend/src/）

| 模块 | 职责 |
|---|---|
| `App.tsx` / `main.tsx` | Shell 骨架：侧栏 + 主区路由（欢迎 hero / SessionView / 设置浮层） |
| `components/SessionView.tsx` + `session/` | 会话流：SessionView 为编排（~300 行），摄取与呈现拆在 `session/`——renderModel（RenderItem/ingest/finalizeTurns，O(1) 索引）、useSessionEvents/useSessionModels、Item/MessageRow/ToolRow/ToolIcon/Cards/QueueDock 组件群、eventText/format 纯函数 |
| `components/Composer.tsx`（编排）+ `components/composer/`（draft/dictation/attachments/menu hooks + 菜单子组件） / `ModelMenu.tsx`（思考强度滑杆） / `Sidebar.tsx`（多工作区+会话列表） / `WsSwitcher.tsx`（底行空间切换条：溢出渐隐+滚轮就地消费） / `SettingsPage.tsx` + `settings/`（含 `useSettingNamespace` 围栏 hook；`useModelCatalog` 模型目录+密钥态数据源，设置页「模型」与 `FirstRunGate` 首启欢迎页共用；`ImportSection`/`ImportDialog` 设置「导入」分区（dsh-chat-import 插件面板路由），见 `SPEC-ENGINE-RUNTIME §4.4`） | 输入框（@附件 //命令/听写）、模型与推理档位、侧栏、设置浮层、首启欢迎页（开始使用→设置配模型 / ~/.dsh 导入） |
| `stats/` | 设置→使用统计：会话历史用量折叠（usageStats）+ 热力图/趋势图/圆环卡；引擎无 usage RPC，全部前端聚合。**数据模型（用户定稿）**：用量按会话记录在本地（`deepdive.usageFold`，localStorage）并与归档/删除解耦——页面第一帧就折缓存的账直接展示（含已归档/已删除会话），引擎侧只在后台补"变过的会话"（逐会话 follow+page 读历史很贵，159 会话十几秒，故只补差不全量读） |
| `components/Markdown.tsx` / `ThinkingState.tsx` / `LoadingState.tsx` / `Icons.tsx` / `ProviderIcon.tsx` / `HoverScrollText.tsx` / `HeroBrand.tsx` | 呈现组件 |
| `automation/` | 自动化（定时任务）：`model`（计划类型 + 次回触发/文案纯函数）、`templates`（四张模板卡）、`storage`（localStorage 持久化，读取即边界校验）、`runner`（到点执行：建会话→选模型→`/permission`→发指令）、`useAutomation`（App 级 Provider：任务/历史状态 + 30s 调度 tick + 运行对账 + 保持唤醒信号）、`AutomationSection`（设置页「自动化」分区：列表↔编辑器两态路由）+ `TaskListPage`/`TaskCard`/`TaskEditorPage`/`ScheduleRow`/`RunHistory`（视图）。**调度在客户端**：引擎没有定时任务 RPC（`dsh-schedule` 只是会话内提醒工具），代价与应用语义见 `SPEC-AUTOMATION.md` |
| `components/preview/` | 产物/文件预览：`useFilePreview`（标签+全屏+每标签视图偏好）、`FilePreviewWindow`（little 浮窗 + 全屏页头 + 内容装配 + 渲染器/折行控件）、`PreviewBody`（按渲染器分流）、`PdfPreview`（pdf.js 逐页 canvas 自绘，按需 import）、`OpenWithMenu`（右上「打开方式」）、`previewModel`（渲染器候选/语言/换行 纯函数）+ `components/CodeLines.tsx`（行号高亮体，与消息流代码卡共用）。pdfjs 的 worker 走 `?url` 资产、cMaps/标准字体/wasm 由 `frontend/scripts/copy-pdfjs-assets.mjs` 在 build 末尾拷进 `dist/pdfjs/`（同源、离线可用，不走 CDN） |
| `store.tsx`（列表/审批/排队等业务状态） + `prefs.ts`（壳偏好 hook） / `api.ts` / `types.ts` / `host.ts`（壳桥请求统一超时包装） / `titlebar.ts` / `i18n.ts` + `i18n-en.ts`（词典数据） / `events.ts`（应用内事件名） / `useEdgeFade.ts`（溢出渐隐边缘信号，UI-SPEC「FadeEdge」标准） | React Context 手写 store（轮询签名去抖）、same-origin RPC 客户端、事件可辨识联合、壳桥挂载、标题栏 rect 推送、中英词典 |
| `theme.css` | 全部样式（唯一事实源，含亮/暗语义变量）；tokens 变量来自 `packages/design/generated/tokens.css` |

## 5. 引擎运行时（SPEC-ENGINE-RUNTIME）

- **入口优先级**：`DSHMINI_DSH_ENTRY`（开发对照，最强覆盖）→ bundled（`Resources/Runtime/node` + `Runtime/dsh/lib/bin.js`）→ 系统路径探测 → `PATH` 的 `dsh`；bundled 残缺或外部入口版本与随包引脚不符一律拒启（版本门，`SPEC-ENGINE-RUNTIME §3.4`）。
- **版本引脚唯一事实源**：`scripts/dsh-runtime-version.txt`（XcodeGen 把原文件拷进 bundle 作 `Resources/dsh-runtime-version.txt`，版本门据此判外部入口）+ `scripts/node-version.txt`（构建机校验 fail-loud）。
- **构建链**：`prepare-dsh-runtime.sh`（闭包准备 + 原生/FFI 冒烟，`DSH_SOURCE` 可复用同版本源）→ `embed-engine.sh`（拷入 .app + 自检）→ `build-release.sh` / `package-macos.sh`（Developer ID 深签 DMG，可选公证装钉）/ `dev.sh`（`DSHMINI_DEV_ENGINE=1` 时嵌入）。
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

- **未做**：Raycast 式 Launcher NSPanel（现为主窗 ⌥Space 显隐）、Windows 外壳、Keychain 凭证插件（凭据走引擎 `credentials.*` + 设置页）、Sparkle 自动更新、dsh 插件形态定制（主题/听写等全部实现在壳与 SPA 内，未走 Cordis 插件行）。
- **改道**：设置从"独立原生窗口"改为 **WebView 内浮层**（`SPEC-SETTINGS-WINDOW v3`）；审批用 WebView 内卡片而非原生弹窗；模型菜单/工作区侧栏为自建呈现，不挂官方 Slots。
- **已知限制**：工作区切换需重启引擎（sandbox 根=cwd）；自动更新未做。路线待办见 `docs/TODO.md`。

## 9. 沿革

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0/P1（2026-08-30） | 套壳 v1：壳 + 官方 web UI + 黑白主题覆盖（PLAN-P1/REVIEW-P1，已删） | ✅ 完成 |
| 自建 SPA（2026-08-31） | 按官方 UI 对齐移植自建前端（REVIEW-P2 驱动的渲染模型收敛） | ✅ 完成（P2-6 snapshot store 评估仍开放，见 REVIEW-P2） |
| P2 桌面增强（2026-08-31~09-02） | bundled 引擎运行时 + 设置浮层 + 原生通知/悬浮球 + 听写 + 品牌改名 DeepDive（PLAN-P2-DESKTOP，已删） | ✅ 完成 |
| 2026-09 起 | 性能（增量摄取/memo/轮询去抖）、思考强度滑杆、多工作区、i18n、亮色主题等迭代 | 进行中（见 git log） |
