# NOTIFICATIONS — 通知与迷你面板状态面 spec（v3）

> **状态**：通知（§1）与事件源（§3）**已实现**；§2 悬浮球 **v3 退役**——状态面并入迷你面板药丸（产品语义的家 = `SPEC-SEMANTICS §6.1`）。落地文件：`NativeAlerts.swift`、`FloatingBubble.swift`（v3 起由迷你面板承接后撤除）、`EngineEventObserver.swift`（方案 A：壳自读 mux）。工程改名后标识符已变：桥钩子 `__dshminiHost` → **`__deepDiveHost`**、messageHandler `dshminiHost` → **`deepdiveHost`**、偏好键 `dsh.alerts.*` → **`deepdive.alerts.*`**（见 BRANDING §5）。
> 工程流 C。重点参考 `luochenw/deepseek-harness-macos`：`NativeAlerts.swift`（`UNUserNotificationCenter` + `NSStatusItem`）、`FloatingBubble.swift`（`NSPanel` 悬浮球）。这些是 **WebView 标签页做不到的 OS 级能力**，必须落在原生 Swift 层。
> 视觉纪律（`UI-SPEC`）：黑白灰阶、无强调色（彩色仅 diff 内容层语义色）；状态用符号+亮度，**不用红点/彩色海景**——参考项目的红点与海景需按 spec 转 monochrome。
> v2 变更：①通知按 `SPEC-SEMANTICS §5` 分级静默（回合完成不带 sound）②补引擎失败通知③新增 **§3.1 外壳↔前端通道**（通知点击"转入会话"/悬浮球聚焦会话/主题联动的落地前提，现状为零通道）④授权时机定为首次派发任务⑤菜单对现状的两处取舍写明。
> v2.1 变更：①点击指令 **pending 暂存**（冷启动/页面加载中不丢转入意图，§3.1）②悬浮球显隐**不占全局热键**（§2.4，与 SETTINGS"全局热键仅 1 个"对齐，撤销 v1 `⌥⌘Y` 设想）③授权异步期间由状态图标兜底的说明。
> v2.2 变更（2026-09-04）：①通知文案**按任务类型区分**（title=类型短语 / subtitle=会话标题 / body=该类型真实内容，去掉 "DSH" 前缀——品牌归属交给通知图标，§1.2）②新增**菜单栏图标 / Dock 栏图标显隐开关**（§1.3、§1.4），撤销"菜单栏始终显示不受开关影响"的旧约定。
> v3 变更（2026-10-12）：**悬浮球退役，状态面并入迷你面板药丸**（§2 重写；窗口机制沿用药丸所在的 nonactivating panel，观察者 feed 与点击聚焦语义不变）；「悬浮球」开关由「迷你面板」开关接管；本文随内容改名（悬浮球不复存在）。

---

## 1. 通知（`UNUserNotificationCenter`）

### 1.1 授权与投递
- `UNUserNotificationCenter.current().delegate = self`；**授权时机：用户在设置里打开任一通知开关时，或首次派发任务时**（两处都调，谁先到算谁）`requestAuthorization(options: [.alert, .sound])`，App 启动不弹（避免启动即打扰；用户拒绝后静默降级为仅菜单栏/悬浮球状态提示）。授权请求是异步弹窗，**完成前的首次通知由菜单栏/悬浮球状态兜底**。
- `post(id, title, body, silent)`：`UNMutableNotificationContent`（title/body）+ `UNNotificationRequest(trigger: nil)` 立即投递。**sound 按 `SPEC-SEMANTICS §5` 打扰分级**：待审批/待提问（高打扰）带 sound；**回合完成静默（`silent = true`，中打扰=静默通知）**。引擎失败**不发通知**（报错面一律在应用内，见 `SPEC-SEMANTICS §5`）。
- 点击通知 → 激活 App + 主窗口到前 + **转入对应会话**：原生层记录触发通知的 `sessionId`，经 **§3.1 外壳→前端通道** 下发 `navigateToSession(sessionId)`（参考项目只有"点击走 `FloatingBubbleManager.shared.bubbleClicked()`"，"转入会话"为本项目新增，依赖桥通道）。
- `willPresent`：App 前台也显示 banner（可选，按产品取舍；前台时本来就被 §1.2 前台抑制覆盖，此条仅作 API 兜底）。

### 1.2 触发（事件来源见 §3）
文案**按任务类型区分**：`title` = 任务类型短语（加粗首行），`subtitle` = 会话标题（哪个任务），`body` = 该类型携带的真实内容。品牌不再进标题（通知左侧的 App 图标即归属）。
- 待审批：`approval/requested` → `notifyApprovalNeeded(toolName, sessionTitle, sessionId)` → **"需要你的许可 / <会话标题> / 请求执行：<tool>"**（带 sound）+ `NSApp.requestUserAttention(.informationalRequest)`（dock 弹跳）。
- 待提问：`question/requested` → `notifyQuestionNeeded(questionText, sessionTitle, sessionId)` → **"有问题要问你 / <会话标题> / <首条提问文本，截断 120 字>"**（带 sound；载荷契约见引擎 `askUserQuestionItemSchema`）+ dock 弹跳。
- 回合完成：`turn/end(completed)` → `notifyTurnFinished(sessionTitle, sessionId)` → **"回合已完成 / <会话标题>"**（**静默**，对齐 SEMANTICS §5）。
- 引擎失败：**不发通知**——`EngineSupervisor` 进入 `.failed` 后由壳推 `engineState`（含原因与日志尾部），SPA 的引擎横幅给出原因 + 重试 + 详情（对齐 SEMANTICS §5"失败/引擎异常"），菜单栏状态点同时变红。系统通知与原生窗口都不是应用报错的地方。
- 前台抑制：仅当 `!NSApp.isActive` 才弹通知与弹跳；悬浮球状态始终实时反映；菜单栏图标也可经 §1.3 开关整体隐藏（隐藏后状态面只剩悬浮球/通知本身）。
> 范围外声明：SEMANTICS §5 的「专注模式（通知时间窗）」为 P2 后续项，不在本 spec 实现；本阶段只做前台抑制。

### 1.3 开关（默认开，对齐参考 `DSHAppPrefs`）
- `notifyTurnEndKey = "deepdive.alerts.notifyTurnEnd"`（默认 true）——回合完成横幅。
- `notifyAttentionKey = "deepdive.alerts.notifyAttention"`（默认 true）——待审批/待提问横幅 + dock 弹跳。
- `menuBarKey = "deepdive.alerts.menuBar"`（默认 true）——菜单栏图标整体显隐（`NSStatusItem.isVisible`，菜单/回调保持持有，重开即恢复）。
- `dockIconKey = "deepdive.alerts.dockIcon"`（默认 true）——Dock 图标显隐（`NSApp.setActivationPolicy` regular⇄accessory；隐藏后不经 Dock/Cmd⌘-Tab，窗口、全局热键、通知点击不受影响；dock 弹跳随隐藏自然失效）。
- 存储 `UserDefaults`；设置「通用→通知」分区对应这些开关（回合完成 / 待审批待提问 / 菜单栏图标 / Dock 栏图标 / 悬浮球）。

### 1.4 菜单栏状态条（`NSStatusItem`，沿用 `StatusItemController` 增强）
- 图标按状态：空闲=品牌标记（`BrandMark.statusIcon`，与悬浮球同一 logo）；运行=标记+环；需注意=标记+点（需注意态优先，直到审批/提问被应答）；引擎失败/启动期用系统符号。
- 图标整体显隐由 §1.3 `menuBar` 控制；`StatusItemController.setVisible` 只动 `isVisible`。
- 菜单：显示主窗、设置…、刷新界面、重启引擎、切换工作区、退出。**对现状菜单的两处取舍**：「黑白主题」**删除**（明/暗移入设置-外观分区，避免双入口）；「刷新界面」**保留**（调试用）。

## 2. 迷你面板状态面（v3：悬浮球退役，状态并入药丸）

产品语义（条目、快捷空间、显隐、技术路线）的家 = `SPEC-SEMANTICS §6.1`；本节只拥有「会话状态如何在药丸上原生表达」。

### 2.1 状态源（不变）
- 观察者 feed 沿用方案 A（§3）：`running` / `attention` / `unseenCompletion`（后台完成未读）/ `focusSessionId`（下次点击聚焦的会话）。自持推导，不给外部加字段；运行开始与 App becomeActive 清未读的规则不变。

### 2.2 药丸上的表达（monochrome 纪律不变）
- 状态画在药丸上：运行=呼吸环、需注意=点、后台完成未读=白点呼吸/灰✓——符号+亮度，不用红点/彩色。
- 点击 = 原 `bubbleClicked()` 语义不变：清未读 + 聚焦最近需注意/刚完成的会话（经 §3.1 `navigateToSession`，钩子缺失时降级只激活，不重试）。

### 2.3 显隐与开关
- 状态面显隐随「迷你面板」开关（接管原「悬浮球」开关的偏好位，读旧键迁移）；面板隐藏期间屏缘没有状态点，状态由菜单栏图标兜底（§1.4 不变）。
- 通知横幅（§1）、菜单栏徽标（§1.4）与本节状态面互不依赖：关掉迷你面板只失去屏缘状态点，不失去通知与菜单栏。

### 2.4 前身（悬浮球）的窗口机制存档
- 原 `FloatingBubblePanel` 的窗口配方（`[.borderless, .nonactivatingPanel]`、`level = .floating`、透明底、`canJoinAllSpaces + fullScreenAuxiliary`、`isMovableByWindowBackground`、拖动不加 SwiftUI 手势）是迷你面板窗口的直接前例；品牌剪影路径在 `BrandMark.markPath`（源 `design/logo/`）继续供菜单栏/药丸共用。

## 3. 事件来源（原生侧感知会话状态）

通知/悬浮球要在**原生侧**知道"运行中 / 回合完成 / 待审批 / 待提问"。两种方案：
- **A（推荐，对齐参考）**：原生侧**直接订阅引擎事件流**（DSHmini shell 读 `ws://…/api/events.mux`，解析 `server-request` 交 `session/event`、`approval/requested`、`approval/resolved` 等），在原生层派生 running/turn-finish/approval 状态。原生层自持有业务状态，不依赖前端。
- **B**：前端（React，已订阅 mux）经 **前端→外壳桥**上报状态给原生层。
- 选用 **A**：外壳自读引擎事件，通知/悬浮球/菜单栏徽标全部原生实时，逻辑集中、可靠。可在现有 `BridgeServer`/`EngineSupervisor` 增加一个轻量事件监听器。

### 3.1 外壳↔前端通道（v2 新增；§1.1 转入会话、§2.2 聚焦会话、SETTINGS 外观联动的共同前提）
**现状事实**：外壳与前端之间没有任何直接通道——前端仅 same-origin RPC 经 `BridgeServer` 转发（无 `messageHandlers`/`postMessage`，外壳也不注入 JS）。方案 A 让原生状态自持，但"原生 → 前端下发动作"必须有通道：
- **外壳→前端（必须，本 spec 落地范围）**：`MainWindowController` 的 WKWebView 经 `evaluateJavaScript` 调用前端暴露的全局钩子 `window.__deepDiveHost.dispatch(cmd, payload)`（单钩子分发；前端 `host.ts` 幂等挂载，挂载完成回发 `host-ready`）。指令集：`navigateToSession(sessionId)`、`navigateToSettings()`、`themeChanged(dark)`、`workspacePicked(path)`。
- **前端→外壳**：`WKScriptMessageHandler`（`window.webkit.messageHandlers.deepdiveHost`）：`host-ready` 与设置/引擎/听写等前端→壳消息经此上报，壳侧 `AppDelegate.handleHostMessage` 统一分发。
- **降级纪律**：前端钩子不存在（旧前端/未挂载）时，外壳只做"激活 App + 主窗到前"，不报错、不无限重试——桥是增强，不是依赖。**例外——WebView 尚未就绪**（App 冷启动、页面加载/重载中）：指令**暂存 pending（单条，后到覆盖）**，页面导航完成且钩子就绪后投递一次，避免点击通知的转入意图被静默丢弃；投递仍失败才回落"仅激活+到前"。

## 4. 文件变更（实现起参考）

| 文件 | 变更 |
|---|---|
| `apps/macos/Sources/DSHminiApp/NativeAlerts.swift` | 新增（通知 + 状态条徽标） |
| `apps/macos/Sources/DSHminiApp/FloatingBubble.swift`（Manager+View 合一） | 新增（悬浮球） |
| `apps/macos/Sources/DSHminiApp/StatusItemController.swift` | 扩展徽标 + 设置入口 |
| `apps/macos/Sources/DSHminiApp/EngineEventObserver.swift` | 新增（读引擎 mux，派生状态） |
| `apps/macos/Sources/DSHminiApp/MainWindowController.swift` | `__deepDiveHost` 钩子注入 + `evaluateJavaScript` 下发（§3.1；SETTINGS 外观联动复用） |
| `apps/macos/Sources/DSHminiApp/DSHAppPrefs.swift` | 新增（notifyTurnEnd/notifyAttention 开关） |
| 设置「通用」分区 | 接两个通知开关与悬浮球开关 |

> v3：`FloatingBubble.swift` 随迷你面板落地撤除，其观察者 feed 与点击聚焦语义由药丸承接（§2）；上表保留为 §1/§3 的实现记录。

> 视觉：悬浮球与通知按 `UI-SPEC` 黑白；彩色仅保留于 diff 内容层语义色。若需在"后台完成"做差异提示，用**亮度/符号**（白点呼吸）而非红点。
