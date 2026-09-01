# NOTIFICATIONS-FLOATING-BALL — 通知与悬浮球 spec（P2 · v2.1 复审收口）

> 工程流 C。重点参考 `luochenw/deepseek-harness-macos`：`NativeAlerts.swift`（`UNUserNotificationCenter` + `NSStatusItem`）、`FloatingBubble.swift`（`NSPanel` 悬浮球）。这些是 **WebView 标签页做不到的 OS 级能力**，必须落在原生 Swift 层。
> 视觉纪律（`UI-SPEC`）：黑白灰阶、无强调色（彩色仅 diff 内容层语义色）；状态用符号+亮度，**不用红点/彩色海景**——参考项目的红点与海景需按 spec 转 monochrome。
> v2 变更：①通知按 `SPEC-SEMANTICS §5` 分级静默（回合完成不带 sound）②补引擎失败通知③新增 **§3.1 外壳↔前端通道**（通知点击"转入会话"/悬浮球聚焦会话/主题联动的落地前提，现状为零通道）④授权时机定为首次派发任务⑤菜单对现状的两处取舍写明。
> v2.1 变更：①点击指令 **pending 暂存**（冷启动/页面加载中不丢转入意图，§3.1）②悬浮球显隐**不占全局热键**（§2.4，与 SETTINGS"全局热键仅 1 个"对齐，撤销 v1 `⌥⌘Y` 设想）③授权异步期间由状态图标兜底的说明。

---

## 1. 通知（`UNUserNotificationCenter`）

### 1.1 授权与投递
- `UNUserNotificationCenter.current().delegate = self`；**授权时机：首次派发任务时** `requestAuthorization(options: [.alert, .sound])`，App 启动不弹（避免启动即打扰；用户拒绝后静默降级为仅菜单栏/悬浮球状态提示）。授权请求是异步弹窗，**完成前的首次通知由菜单栏/悬浮球状态兜底**。
- `post(id, title, body, silent)`：`UNMutableNotificationContent`（title/body）+ `UNNotificationRequest(trigger: nil)` 立即投递。**sound 按 `SPEC-SEMANTICS §5` 打扰分级**：待审批/待提问（高打扰）带 sound；**回合完成静默（`silent = true`，中打扰=静默通知）**；引擎失败带 sound。
- 点击通知 → 激活 App + 主窗口到前 + **转入对应会话**：原生层记录触发通知的 `sessionId`，经 **§3.1 外壳→前端通道** 下发 `navigateToSession(sessionId)`（参考项目只有"点击走 `FloatingBubbleManager.shared.bubbleClicked()`"，"转入会话"为本项目新增，依赖桥通道）。
- `willPresent`：App 前台也显示 banner（可选，按产品取舍；前台时本来就被 §1.2 前台抑制覆盖，此条仅作 API 兜底）。

### 1.2 触发（事件来源见 §3）
- 待审批：`notifyApprovalNeeded(toolName)` → `NSApp.requestUserAttention(.informationalRequest)`（dock 弹跳）+ 通知"DSH 需要你的许可 — 请求执行：<tool>"（带 sound）。
- 待提问：`notifyQuestionNeeded()` → 同上，"DSH 有问题要问你"（带 sound）。
- 回合完成：`notifyTurnFinished(summary)` → 通知"DSH 已完成 — <summary>"（**静默**，对齐 SEMANTICS §5）。
- 引擎失败：`EngineSupervisor` 进入 `.failed`（连续重启失败）→ 通知"引擎异常 — <reason 摘要>"（带 sound；对齐 SEMANTICS §5"失败/引擎异常"，状态点同时变）。
- 前台抑制：仅当 `!NSApp.isActive` 才弹通知与弹跳；菜单栏/悬浮球状态图标始终反映实时状态，不受开关影响。
> 范围外声明：SEMANTICS §5 的「专注模式（通知时间窗）」为 P2 后续项，不在本 spec 实现；本阶段只做前台抑制。

### 1.3 开关（默认开，对齐参考 `DSHAppPrefs`）
- `notifyTurnEndKey = "dsh.alerts.notifyTurnEnd"`（默认 true）——回合完成横幅。
- `notifyAttentionKey = "dsh.alerts.notifyAttention"`（默认 true）——待审批/待提问横幅 + dock 弹跳。
- 存储 `UserDefaults`；设置窗口「通知」分区对应这两个开关。

### 1.4 菜单栏状态条（`NSStatusItem`，沿用 `StatusItemController` 增强）
- 图标按状态：空闲 `sparkles` / 运行 `circle.fill` / 需注意 `exclamationmark.circle.fill`（需注意态优先，直到审批/提问被应答）。
- 菜单：显示主窗、设置…、重启引擎、切换工作区、退出。**对现状菜单的两处取舍**：「黑白主题」**删除**（明/暗移入设置-外观分区，避免双入口）；「刷新界面」**保留**（调试用）。

## 2. 悬浮球（`NSPanel`，常驻置顶）

### 2.1 窗口
- `NSPanel`：`[.borderless, .nonactivatingPanel]`，`level = .floating`，透明 `backgroundColor = .clear`，`hasShadow = false`（阴影由 SwiftUI 自画，避免透明窗阴影首帧冻结）。
- `collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]`；`isMovableByWindowBackground = true`（拖动靠 NSWindow 截获 mouseDown）。
- 画布 84pt：中央 44pt 圆 + 四周声呐涟漪区。
- 内容：`NSHostingView(rootView:)` 承载 SwiftUI 视图；autosave 位置（默认主屏右上避开菜单栏）。

### 2.2 状态（自持推导，不给外部加字段）
- `FloatingBubbleManager`（单例 ObservableObject）：
  - `enabled` 存 `UserDefaults`（默认开）。
  - `unseenCompletion`：由"会话运行中 → 完成且 App 非前台"点亮；运行开始、App becomeActive、点击悬浮球都清。
  - `toggle()` 显隐；`bubbleClicked()` 清红点 + 激活 App + 主窗到前（+ 经 §3.1 桥通道 `navigateToSession` 打开最近需注意/刚完成的会话，钩子不存在则只做前两步）。

### 2.3 交互
- 单击：激活 App + 主窗到前。**拖**：用 `isMovableByWindowBackground`，**不得加 SwiftUI 手势**（会吃 mouseDown，拖不动）。**hover**：用 `onHover`（不消费事件），缩放到 1.06；光标处理按 `UI-SPEC` 无 `pointer` 纪律（可不用 pointingHand，或仅悬浮球保留）。
- **中央图形 = dsh 官方 logo（鲸鱼）**：资产取自**本仓库 vendored 的 dsh 源码副本**（与 runtime 引脚同版，勿取 `DSH-SOURCE-MAP` 指向的 `~/Downloads/` 副本）——`deepseek-harness-master/apps/web/public/favicon.svg` 的鲸鱼 path（viewBox 0 0 50 50），或 `deepseek-harness-master/packages/client/ui-primitives/src/FishLogo.tsx`（`FISH_LOGO_PATH`，viewBox 23.16×17.04，`fill="currentColor"`）。渲染 `currentColor` 单色，融入黑白。
- 状态表达（**monochrome 移植**，不用红点/彩色海景）：在鲸鱼上做**环绕状态环/点**——运行=亮环（呼吸）、后台完成未读=白点（呼吸）/灰✓；语音/听写涟漪按需（P2）。中央鲸鱼本体保持黑白剪影。

### 2.4 入口
- 开关：设置窗口「通知」分区 + 菜单栏菜单项（对齐 §1.4 菜单）。**悬浮球显隐不占全局热键**——全局键是稀缺资源，仅保留唤起面板一个（与 `SPEC-SETTINGS-WINDOW` 快捷键分区"全局热键 1 个"一致；v1 的 `⌥⌘Y` 设想撤销）。

## 3. 事件来源（原生侧感知会话状态）

通知/悬浮球要在**原生侧**知道"运行中 / 回合完成 / 待审批 / 待提问"。两种方案：
- **A（推荐，对齐参考）**：原生侧**直接订阅引擎事件流**（DSHmini shell 读 `ws://…/api/events.mux`，解析 `server-request` 交 `session/event`、`approval/requested`、`approval/resolved` 等），在原生层派生 running/turn-finish/approval 状态。原生层自持有业务状态，不依赖前端。
- **B**：前端（React，已订阅 mux）经 **前端→外壳桥**上报状态给原生层。
- 选用 **A**：外壳自读引擎事件，通知/悬浮球/菜单栏徽标全部原生实时，逻辑集中、可靠。可在现有 `BridgeServer`/`EngineSupervisor` 增加一个轻量事件监听器。

### 3.1 外壳↔前端通道（v2 新增；§1.1 转入会话、§2.2 聚焦会话、SETTINGS 外观联动的共同前提）
**现状事实**：外壳与前端之间没有任何直接通道——前端仅 same-origin RPC 经 `BridgeServer` 转发（无 `messageHandlers`/`postMessage`，外壳也不注入 JS）。方案 A 让原生状态自持，但"原生 → 前端下发动作"必须有通道：
- **外壳→前端（必须，本 spec 落地范围）**：`MainWindowController` 的 WKWebView 经 `evaluateJavaScript` 调用前端暴露的全局钩子 `window.__dshminiHost.<command>(payload)`。**最小指令集：`navigateToSession(sessionId)`**；预留 `themeChanged(dark)`、`engineStateChanged(state)`。前端启动时幂等挂载该钩子（防重复注入）。
- **前端→外壳（按需，可后置）**：`WKScriptMessageHandler`（`window.webkit.messageHandlers.dshminiHost`）。方案 A 下原生状态自持，P2 若无前端主动上报需求可不实现，仅留扩展位。
- **降级纪律**：前端钩子不存在（旧前端/未挂载）时，外壳只做"激活 App + 主窗到前"，不报错、不无限重试——桥是增强，不是依赖。**例外——WebView 尚未就绪**（App 冷启动、页面加载/重载中）：指令**暂存 pending（单条，后到覆盖）**，页面导航完成且钩子就绪后投递一次，避免点击通知的转入意图被静默丢弃；投递仍失败才回落"仅激活+到前"。

## 4. 文件变更（实现起参考）

| 文件 | 变更 |
|---|---|
| `apps/macos/Sources/DSHminiApp/NativeAlerts.swift` | 新增（通知 + 状态条徽标） |
| `apps/macos/Sources/DSHminiApp/FloatingBubbleManager.swift` / `FloatingBubbleView.swift` | 新增（悬浮球） |
| `apps/macos/Sources/DSHminiApp/StatusItemController.swift` | 扩展徽标 + 设置入口 |
| `apps/macos/Sources/DSHminiApp/EngineEventObserver.swift` | 新增（读引擎 mux，派生状态） |
| `apps/macos/Sources/DSHminiApp/MainWindowController.swift` | `__dshminiHost` 钩子注入 + `evaluateJavaScript` 下发（§3.1；SETTINGS 外观联动复用） |
| `apps/macos/Sources/DSHminiApp/DSHAppPrefs.swift` | 新增（notifyTurnEnd/notifyAttention 开关） |
| 设置窗口「通知」分区 | 接两个通知开关与悬浮球开关 |

> 视觉：悬浮球与通知按 `UI-SPEC` 黑白；彩色仅保留于 diff 内容层语义色。若需在"后台完成"做差异提示，用**亮度/符号**（白点呼吸）而非红点。
