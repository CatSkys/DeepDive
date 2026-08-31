# NOTIFICATIONS-FLOATING-BALL — 通知与悬浮球 spec（P2 · 待确认）

> 工程流 C。重点参考 `luochenw/deepseek-harness-macos`：`NativeAlerts.swift`（`UNUserNotificationCenter` + `NSStatusItem`）、`FloatingBubble.swift`（`NSPanel` 悬浮球）。这些是 **WebView 标签页做不到的 OS 级能力**，必须落在原生 Swift 层。
> 视觉纪律（`UI-SPEC`）：黑白灰阶、无强调色（彩色仅 diff 内容层语义色）；状态用符号+亮度，**不用红点/彩色海景**——参考项目的红点与海景需按 spec 转 monochrome。

---

## 1. 通知（`UNUserNotificationCenter`）

### 1.1 授权与投递
- `UNUserNotificationCenter.current().delegate = self`；`requestAuthorization(options: [.alert, .sound])`。
- `post(id, title, body)`：`UNMutableNotificationContent`（title/body/sound）+ `UNNotificationRequest(trigger: nil)` 立即投递。
- 点击通知 → 激活 App + 主窗口到前 + 转入对应会话（对齐参考：点击走 `FloatingBubbleManager.shared.bubbleClicked()`）。
- `willPresent`：App 前台也显示 banner + sound（可选，按产品取舍）。

### 1.2 触发（事件来源见 §3）
- 待审批：`notifyApprovalNeeded(toolName)` → `NSApp.requestUserAttention(.informationalRequest)`（dock 弹跳）+ 通知"DSH 需要你的许可 — 请求执行：<tool>"。
- 待提问：`notifyQuestionNeeded()` → 同上，"DSH 有问题要问你"。
- 回合完成：`notifyTurnFinished(summary)` → 通知"DSH 已完成 — <summary>"。
- 前台抑制：仅当 `!NSApp.isActive` 才弹通知与弹跳；菜单栏/悬浮球状态图标始终反映实时状态，不受开关影响。

### 1.3 开关（默认开，对齐参考 `DSHAppPrefs`）
- `notifyTurnEndKey = "dsh.alerts.notifyTurnEnd"`（默认 true）——回合完成横幅。
- `notifyAttentionKey = "dsh.alerts.notifyAttention"`（默认 true）——待审批/待提问横幅 + dock 弹跳。
- 存储 `UserDefaults`；设置窗口「通知」分区对应这两个开关。

### 1.4 菜单栏状态条（`NSStatusItem`，沿用 `StatusItemController` 增强）
- 图标按状态：空闲 `sparkles` / 运行 `circle.fill` / 需注意 `exclamationmark.circle.fill`（需注意态优先，直到审批/提问被应答）。
- 菜单：显示主窗、设置…、重启引擎、切换工作区、退出。

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
  - `toggle()` 显隐；`bubbleClicked()` 清红点 + 激活 App + 主窗到前（+ 可选打开刚派发语音/目标会话）。

### 2.3 交互
- 单击：激活 App + 主窗到前。**拖**：用 `isMovableByWindowBackground`，**不得加 SwiftUI 手势**（会吃 mouseDown，拖不动）。**hover**：用 `onHover`（不消费事件），缩放到 1.06；光标处理按 `UI-SPEC` 无 `pointer` 纪律（可不用 pointingHand，或仅悬浮球保留）。
- **中央图形 = dsh 官方 logo（鲸鱼）**：用官方资产——`apps/web/public/favicon.svg` 的鲸鱼 path（viewBox 0 0 50 50），或 `dsh-client-ui-primitives` 的 `FishLogo`（`FISH_LOGO_PATH`，viewBox 23.16×17.04，`fill="currentColor"`）。渲染 `currentColor` 单色，融入黑白。
- 状态表达（**monochrome 移植**，不用红点/彩色海景）：在鲸鱼上做**环绕状态环/点**——运行=亮环（呼吸）、后台完成未读=白点（呼吸）/灰✓；语音/听写涟漪按需（P2）。中央鲸鱼本体保持黑白剪影。

### 2.4 入口
- 开关：设置窗口「通知」（或「外观」）分区 + 悬浮球自身右键/长按菜单；`⌥⌘Y`（或沿用快捷键映射）显隐。

## 3. 事件来源（原生侧感知会话状态）

通知/悬浮球要在**原生侧**知道"运行中 / 回合完成 / 待审批 / 待提问"。两种方案：
- **A（推荐，对齐参考）**：原生侧**直接订阅引擎事件流**（DSHmini shell 读 `ws://…/api/events.mux`，解析 `server-request` 交 `session/event`、`approval/requested`、`approval/resolved` 等），在原生层派生 running/turn-finish/approval 状态。原生层自持有业务状态，不依赖前端。
- **B**：前端（React，已订阅 mux）经 **前端→外壳桥**上报状态给原生层。
- 选用 **A**：外壳自读引擎事件，通知/悬浮球/菜单栏徽标全部原生实时，逻辑集中、可靠。可在现有 `BridgeServer`/`EngineSupervisor` 增加一个轻量事件监听器。

## 4. 文件变更（实现起参考）

| 文件 | 变更 |
|---|---|
| `apps/macos/Sources/DSHminiApp/NativeAlerts.swift` | 新增（通知 + 状态条徽标） |
| `apps/macos/Sources/DSHminiApp/FloatingBubbleManager.swift` / `FloatingBubbleView.swift` | 新增（悬浮球） |
| `apps/macos/Sources/DSHminiApp/StatusItemController.swift` | 扩展徽标 + 设置入口 |
| `apps/macos/Sources/DSHminiApp/EngineEventObserver.swift` | 新增（读引擎 mux，派生状态） |
| `apps/macos/Sources/DSHminiApp/DSHAppPrefs.swift` | 新增（notifyTurnEnd/notifyAttention 开关） |
| 设置窗口「通知/外观」分区 | 接开关与悬浮球开关 |

> 视觉：悬浮球与通知按 `UI-SPEC` 黑白；彩色仅保留于 diff 内容层语义色。若需在"后台完成"做差异提示，用**亮度/符号**（白点呼吸）而非红点。
