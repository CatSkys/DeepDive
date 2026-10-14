# Atd 截图与划词 · 专文（移植施工图）

> 本文拥有「Atd 截图（采集+标注）与选区工具条（划词）」两块的解剖与移植方案，是 HANDOVER 登记的单块深挖专文；线级总纲、血统结论与背景见 `HANDOVER.md`，本文不重复。
> 时点：源码克隆 `/Users/hanbyking/Documents/Atd-src`（本地 HEAD = **v0.7.12** `b6f8bfc`，已 fetch 到 origin/main = v0.8.1+2 `1cc03af`）；实机 `/Applications/Atd.app` 0.8.0。上游代码 **MIT**（其 `LICENSE` 覆盖），用户已获作者本人许可直接移植（2026-10-13）。
> **状态（2026-10-13）：两块已按提案①②落地**——截图整块、划词核心（含 main 的读词复制兜底链）逐字移植进 `apps/macos/Sources/DSHminiApp/{Capture,Selection}`，接线见 `ScreenshotController` / `SelectionController` 与 `Support/` 的接缝；前端设置分区与输入框截图钮已上。
> **命令目录已落地（2026-10-13 追加）**：starter 那批**提示词模板**（翻译 / 润色文字 / 总结 / 解释 / 提取待办事项 / 审查代码）做成「划词命令」放在前端 `frontend/src/settings/selectionCommands.ts`（名字照 starter，提示词取英文原文，参数取默认值），胶囊点一条 = 亮迷你面板 + 把渲染好的提示词当一条消息发进会话。这没有引入第二套命令系统：引擎的 `commands/list` 一字未动，胶囊从此只放划词命令，引擎那几条仍在迷你面板命令卡与输入框 `/` 菜单。Atd 另外两条 starter（总结文件 / 就截图提问）的输入是附件与截图，划词喂不了，未收。
> **仍未搬（提案③余下部分）**：命令进度岛、选项级联「命令 ∨」（带参数命令的二级菜单）、把答案写回原 App 的 AX 写回链（约 4.5k 行岛 + 1.4k 行写回）——它们整套挂在 Atd 自己的「带参数命令」子系统上（`CommandLaunch` / `CommandArguments` / `CommandOptionsCatalog`）。要上写回得先决定：把命令模型换成 Atd 的，还是把写回链接到我们自己命令的运行结果上。
> **§5 风险 1 的实况**：两项 TCC 授权在**交付链**上不会掉——`sign-app.sh` 默认用 Developer ID 重签，授权按 bundle id + 身份记、跨构建保留（实测 TeamIdentifier `49LSZKN27V`）；只有 adhoc 构建（测试宿主 / 证书不可用回退）才每次失效。
> **两处接缝降级**（功能等价、实现更简）：① 权限引导窗（Atd 384 行的自绘「拖滑块允许」）→ 直接深链系统设置的对应面板；② 附件导入（Atd 经服务导入成资源 id）→ 落到 `<support>/screenshots/` 后由页面按既有 `upload-path` 通道上传。
>
> 分级：§1-§5 是**实证**（`file:line` 均指 Atd 仓，本文件所在目录的行号即该版本）；§6-§7 是**提案**——拍板前不动任何规范文件、不写任何代码（`PROMPT.md` 同款纪律）。

---

## 0. 基线结论：0.7.12 与最新 main 的差异（决定按哪个版本搬）

`git diff --stat HEAD origin/main` 逐树对照：

| 块 | 0.7.12 → main | 结论 |
|---|---|---|
| 截图采集+标注（`AIShell/Capture` + `AICore/Capture` + `ScreenshotRules`） | 仅 `Annotation/AnnotationGlassBar.swift` 6 行 | **两版等同**。按本地 0.7.12 克隆搬，即等于实机 0.8.0/0.8.1 里的截图 |
| 划词（`AIShell/Selection`） | **+3367/−400**，新增约 20 个文件 | 0.7.12 是纯「选中→工具条→动作」核心；main 多出三件大东西：**结果写回链**（AXField/WriteTargets/ClipboardPaste/TextWriter/PasteHandshake…，把命令输出写回原 App 的输入框）、**工具条选项级联**（ToolbarOptions*，用户截图里「Explain ∨」的下拉就是它）、**进度/毛玻璃 HUD**（CommandProgressController/GlassHUD/ShimmerLabel/InsertionTrace） |

用户 2026-10-13 的截图（带 ∨ 下拉）是 main 的形态；本仓调研素材（`assets/atd-ui-selection-toolbar.png`）是 0.7.12 形态。**拍板点见提案③。**

---

## 1. 划词工具条（Selection toolbar）

### 1.1 文件清单（v0.7.12；AIShell=壳层 AppKit，AICore=纯模型/几何）

| 文件 | 行数 | 职责（管什么/不管什么） |
|---|---|---|
| `AIShell/Selection/SelectionToolbarController.swift` | 295 | 编排器：装/卸全局监视、调 AX 探测、显示/消失；不管 AX 细节与 UI |
| `AIShell/Selection/SelectionPresence.swift` | 140 | 有没有选区+在哪（只问 range/bounds，**从不问文字**）；Electron 唤醒 |
| `AIShell/Selection/SelectionReader.swift` | 137 | 读选中**文字**（仅动作点下后）；250ms 消息超时，750ms 总限 |
| `AIShell/Selection/SelectionToolbarPanel.swift` | 249 | 工具条窗口与内容（玻璃胶囊+按钮+More）；窗口永不取键 |
| `AIShell/Selection/SelectionToolbarMenu.swift` | 157 | More 溢出菜单（同为不取键面板） |
| `AIShell/Selection/SelectionToolbarHUD.swift` | 279 | toggle 模式「监听中」的屏底状态条 |
| `AIShell/Selection/SelectionToolbarListening.swift` | 103 | toggle 模式：双按修饰键开/关监听（全局+本地 flagsChanged） |
| `AIShell/Selection/SelectionToolbarHover.swift` | 138 | 胶囊/菜单的悬停跟踪（暂停-恢复模型） |
| `AIShell/Selection/SelectionToolbarEntrance.swift` | 66 | 出场动画 |
| `AIShell/Selection/AccessibilityTrust.swift` | 96 | 辅助功能授权：检测/轮询/三类时机各自的提问策略 |
| `AIShell/Selection/ExcludedAppPicker.swift` | 31 | `apps.pick`：系统选 App 面板 → bundleId 列表（≤上限） |
| `AIShell/Selection/BackgroundCursor.swift` | 34 | ——（悬停期光标辅助） |
| `AICore/Selection/SelectionToolbarRules.swift` | 118 | `toolbar.set` 参数结构 + 该不该探测/显示的规则（排除 App、安全输入、自家 App） |
| `AICore/Selection/SelectionActivation.swift` | 82 | 激活方式模型（always/hold/toggle）+ ModifierDoublePress 状态机 |
| `AICore/Selection/SelectionToolbarGeometry.swift` | 116 | 工具条相对选区的摆放几何（多屏 workArea 内夹逼） |
| `AICore/Selection/SelectionToolbarMenuGeometry.swift` | 69 | 菜单摆放几何 |
| `Tests/AICoreTests/SelectionToolbarTests.swift` | — | 规则/几何/激活的纯函数测试 |

### 1.2 触发链（完整时序）

1. 设置开着且已授权时才装监视（`SelectionToolbarController.update`，:109-118）：一个**全局** `NSEvent.addGlobalMonitorForEvents([.leftMouseDown, .leftMouseUp])`（:154）+ `NSWorkspace.didActivateApplicationNotification`（:158）。**没有常驻轮询、没有 AXObserver**——纯鼠标抬起启发式。
2. `leftMouseDown`：先撤工具条、记按下点与修饰键态（:201-204）。
3. `leftMouseUp`：`SelectionGesture.mayHaveSelected`（拖拽位移、双击、shift 点击，`SelectionToolbarRules.swift:49-63`）判定“可能刚选完”；激活方式放行（always / hold=按下或抬起时修饰键按着 / toggle=双按修饰键进入监听态）（:205-213）。
4. 节流：拖拽/shift 点击**立即查一次**，150ms 后再补一次（web 内容选区更新晚）；双击**先等 150ms**（三击只问一次）（`debounce` :46，`schedule` :224-235）。generation 计数丢弃过期检查（:67, :254）。
5. 规则先行（`check` :253-268）：前台 App 非 `excludedBundleIds`、非自家、非安全输入（`IsSecureEventInputEnabled()`）才探测。
6. AX 探测**离主线程**（专用串行队列 + busy 互斥，同一时刻最多一个探测；总限 300ms，`SelectionPresence.check` :122-139）：`AXUIElementCreateApplication(pid)` → 每消息 100ms 超时（:22）→ 先问 `AXRole` **唤醒 Electron/Chromium 的 web 可访问性树**（:62-65；故意不设 `AXManualAccessibility`，否则 VS Code/Cursor 会进读屏模式并弹询问，:55-61 注释）；Electron App 激活时就预唤醒（`prepare` :108-118，按存在 `Electron Framework.framework` 判定）→ `kAXFocusedUIElementAttribute` → 安全输入子角色直接拒（:37）→ `AXSelectedTextRange` + `AXBoundsForRange`（:39-45）；**WebKit/Chromium 的 web 选区答的是 text-marker range**（`AXSelectedTextMarkerRange` + `AXLengthForTextMarkerRange` + `AXBoundsForTextMarkerRange`，:47-51）。
7. 有选区 → `panel.show(selection:bounds, pointer:)`；无选区且还有挂起检查则继续等。
8. 消失条件（:22-28 段注释 + `dismiss` :283-294）：任意按键/滚轮/其他鼠标键（挂起或显示期才装的 interrupt 监视）、点别处、别的 App 激活；**指针移开不消失**（菜单可以伸很远）。

### 1.3 取文字（只在动作点下后）

`SelectionReader.read`（:31-62）：系统级 focused element 失败（Electron 常见）改从前台 pid 起；逐元素试 `AXSelectedText` → `AXSelectedTextRange`+`AXStringForRange` → `AXValue` 切片 → text-marker（:69-99，WebKit/Chromium 路径）；候选 = focused 元素 → 前 20 个子元素 → 至多 10 层祖先。每消息 250ms 超时，整体 750ms 兜底（`readBounded` :128-137）。**没有模拟 ⌘C 的兜底**（:16-17 明说，读不到就是读不到）。

**隐私设计值得照搬**：探测阶段只问 range/bounds 不碰文字（`SelectionPresence` 头注释 :6-9）；文字只在用户点了动作、且由暂存机制统一取（见 1.5）。

### 1.4 工具条 UI

- 窗口（`SelectionToolbarPanel.makeWindow` :49-64）：`NSPanel`，`[.borderless, .nonactivatingPanel]`，`canBecomeKey/canBecomeMain = false`（:242-245）——**选区所在 App 全程保住键盘与选区**；`level = .popUpMenu`；`hidesOnDeactivate = false`；`canJoinAllSpaces + .fullScreenAuxiliary + .transient + .ignoresCycle`（全 Space、全屏 App 旁也显示）。
- 窗口比胶囊四周大 24pt 透明边（`inset` :21），玻璃的投影与入场动画不被裁；透明区点击穿透到下层 App（:7-9）。
- 内容复用截图块的玻璃胶囊 `AnnotationGlassBar`（抓手 + Ask + 命令按钮 + More）；命令超宽走 More 菜单（`SelectionToolbarLayout.visibleCommandCount`）；**命令名是用户数据不翻译**，壳文案按当前语言（:13-15 注释）。
- 摆放（AICore `SelectionToolbarGeometry`）：贴选区上/下、多屏 workArea 内夹逼；AX 的 Quartz 坐标经 `CaptureCoordinates.flip` 翻成 Cocoa 全局坐标（主屏高翻转，`show` :81-90）。拿不到 bounds 时贴指针。
- 可拖动（抓手/胶囊面），松手停在 workArea 内直到隐藏；双击回原位（:173-189）。

### 1.5 动作语义（点击后发生什么）

- `onAsk` → `ShellController.swift:160` `summon(.ask, selectedText:)`；`onCommand(id)` → :161 `summon(.toolbarCommand(id:))`。
- `Summoner`（`App/Summoner.swift`） owns **选区暂存**：`SummonPolicy.steps`（`AICore/Summon/SummonPolicy.swift:80-88`）——`ask` = `[captureSelection, showPanel, deliverAsk]`；`toolbarCommand` = `[captureSelection, deliverCommand(id:)]`。`captureSelection` 在面板获得焦点**之前**用 `SelectionReader.readBounded` 取词入暂存（:47-52, :92-98，未授权则每 launch 提问一次）。
- `deliverAsk` → `panelHost.send(.selectionAsk)` → 渲染层 `use-selection-ask.ts`：调 `agentApi().capture('selection')` **从暂存取词**（壳侧 `captureSelection()` :272-274 只答暂存、绝不现读），把文字**引用进草稿**（Quote chip）并聚焦输入框——**不发送**（`use-selection-ask.ts:9-17` 注释）。
- `deliverCommand` → 渲染层命令启动链：`command-prepare.ts:38-64` 把 `capture('selection')` 的文字填进 `TaskInput`（`input.selection`/`input.text`+`capturedAt`）跑已存命令。
- 命名陷阱：`agent-service/src/tasks/run-selection.ts` 是**模型选择**工具函数，与划词无关——真正的取词链全在壳与渲染层（勿被文件名带偏）。

### 1.6 权限（辅助功能）

`AccessibilityTrust`：每 2s 轮询 + App 激活时重读（**不依赖**系统通知——实测授权开关经 `com.apple.accessibility.api` 不可靠，:12-16 注释）；三类提问时机互不重复：①首启且工具条开（defaults 键记一次-ever）②召唤需要选区时（每 launch 一次）③设置页权限行 → 打开「拖滑块允许」引导窗 `PermissionGuide`（:84-87）。

### 1.7 设置

渲染层经桥 `toolbar.set` 推送（`ShellBridge.swift:163` → `ShellController.applyToolbar` :262-269，首次推送若开启则触发首启提问）：`SelectionToolbarSettings` = enabled + activation(mode+keys) + showHud + excludedBundleIds + commands[id,name]（`SelectionToolbarRules.swift:7-40`）。默认：**开启、hold+Option、HUD 开**（`settings-contract.ts:36-42`）。排除 App 走系统选 App 面板按 bundleId 记（`ExcludedAppPicker`）。命令目录 = 「已启用且输入吃选区的命令」，按命令表顺序。

---

## 2. 截图（采集 + 标注）

### 2.1 文件清单（v0.7.12）

| 层 | 文件（行数） | 一句话 |
|---|---|---|
| 桥入口 | `App/ShellController+Screenshots.swift`(31) | `screenshot.capture` / `screenshot.edit` 两入口；召唤中/文件面板开着/确认框在 → 拒绝 |
| 编排 | `Capabilities/ScreenshotTaker.swift`(225) | 会话编排：撤面板→冻结→overlay→恢复焦点归属→导入；单会话互斥；剪贴板路径 |
| 会话 | `AIShell/Capture/CaptureSession.swift`(331) | 状态机 idle/pressing/creating/selected/adjusting；候选链；一次性 Outcome |
| | `CaptureSession+Input.swift`(238) | 指针/拖拽/键盘/右键/光标；选区提交与编辑器接管 |
| | `CaptureSession+Idle.swift`(74) | 提示文案、R 复用上次区域、W 只认窗口 |
| | `CaptureOverlayView.swift`(241)/`CaptureChromeView.swift`(129) | 冻结图绘制 + 选区描边手柄 + 尺寸标签 |
| | `CaptureOverlayPanel.swift`(37)/`CaptureOverlayHost.swift`(39) | 每屏一个 overlay 面板（`.screenSaver` 层、可取键不激活） |
| | `SelectionModel`(AICore,234) | 8 手柄+边带命中、移动/缩放/方形、像素吸附、方向键微调 |
| 采集 | `DisplayFreezer.swift`(71) | ScreenCaptureKit 逐屏冻结（排自家窗口，保桌面 Pin） |
| | `WindowSnapshot.swift`(67) | overlay 出现前的 CGWindowList 快照（元素检测与上下文都要用） |
| | `Loupe.swift`(124) | 放大镜：指针处像素采样 + hex 读色（`render(around:)` :93） |
| | `CaptureCursors.swift`(70) | 十字/开合手/方向光标 |
| 元素 | `ElementResolver.swift`(165)+`ElementResolver+Probe.swift`(225) | AX 元素检测 actor（专用串行队列）+ AX 探针（预算制） |
| | `AICore/Capture/ElementChain.swift`(145) | 命中链→候选矩形（元素→窗口→显示器） |
| 标注 | `Annotation/` 14 文件 + `AICore/Capture/Annotation*` 8 文件 | 见 2.5 |
| 产出 | `CaptureExport.swift`(150) | 裁剪+合成+缩放+编码（PNG→JPEG 降级循环） |
| | `CaptureLibrary.swift`(124) | 导入为附件 + 重开底图归档（RecentValues 10 条） |
| | `ScreenText.swift`(65) | Vision OCR（准确级、纠错、中简/中繁/英自动检测、3s 超时） |
| | `AICore/Capture/ScreenContext.swift`(120) | 上下文 Markdown（App/窗口/元素/识别文本，12k 字符帽） |
| | `AICore/Resources/ScreenshotRules.swift`(151) | 尺寸/格式/文件名规则（长边 2560、8MiB、JPEG 逐级降） |
| | `CaptureReopen.swift`(85)+`AICore/Capture/ReopenPlacement.swift`(72) | 重开编辑（底图上屏+文档还原） |
| 权限 | `ScreenRecordingTrust.swift`(63) | 屏幕录制授权：2s 轮询、每 launch 一次系统提问、引导窗 |

### 2.2 入口与触发

- 桥方法 `screenshot.capture` / `screenshot.edit(resourceId)`（`ShellBridge.swift:125-128`）。
- 全局快捷键 ⌘⇧2 走**同一渲染层路径**：壳热键回调 `summon(.screenshot)` → `[selection?, deliverScreenshot]`（`SummonPolicy.swift:80-81`）→ `panelHost.send(.shortcutScreenshot)` → 页面 `use-screenshot-shortcut.ts` 调 `desktop.screenshot()`（即 `screenshot.capture`），成功后把图 chip 进草稿、展开面板（`use-screenshot-shortcut.ts:33-60`）。迷你面板的相机按钮同样走 `summon(.screenshot)`（`ShellController+MiniPanel.swift:16`）。
- 热键基础设施：`CarbonHotKeys`（`RegisterEventHotKey` 最薄封装，签名 `'AIKY'`；**注册是非独占的**，系统保留组合不抢报错）+ `HotKeyRegistrar.apply`（差量重注册）+ `HotKeyPlan`（失败四态：invalid/系统保留(`CopySymbolicHotKeys` 查)/同组重复/OSStatus）→ `ShortcutResult` 回渲染层措辞报错。设置页实机见过的「无法注册此快捷键…」红字就是这个链。

### 2.3 采集与冻结（核心机制）

`ScreenshotTaker.present`（:178-215）：
1. **每次截图前** `CGPreflightScreenCaptureAccess()`（:97-100）——授权被吊销的构建只会截到壁纸，不能信任缓存态；失败走 `.notPermitted` + 每 launch 一次系统提问。
2. 记住此前前台 App（结束后还给它，:104-106, :146-148）→ `panel.withdrawForCapture()` 撤面板。
3. `WindowSnapshot.take()`（**任何 overlay 出现之前**）：`CGWindowListCopyWindowInfo` 层 0…popUpMenu、排除自家 pid、排除 Dock 层、alpha>0、最小边 5pt（`WindowSnapshot.swift:29-53`）——元素检测靠它判“指针下是哪个 App”（AX 全局 hit-test 会答 overlay 自己，:5-8 注释）。
4. `DisplayFreezer.prepare`：`SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)`；过滤条件 = 排除**自家 App** 的 `SCRunningApplication`（面板/设置/overlay 永不入图），但保留自家桌面 Pin（:26-45）。逐屏冻结、**光标所在屏先冻**（`replayd` 串行化并按排队计费，顺序跑让光标屏最早可交互，:8-10 注释）。
5. 每屏 `SCContentFilter(display:excludingApplications:exceptingWindows:)` + `SCScreenshotConfiguration`（原生像素标度 `pointPixelScale`、无光标、SDR、`displayIntent .local`）（`freeze` :49-65）→ `FrozenDisplay(displayID, quartzFrame, image)`。
6. 每屏一个 `CaptureOverlayPanel`：borderless+nonactivating、`level = .screenSaver`（压菜单栏/Dock/打开的菜单）、**canBecomeKey=true**（会话另行 `NSApp.activate()` 拿键盘与输入法）、`constrainFrameRect` 覆写以盖住菜单栏、关动画（防减动效下错位）（`CaptureOverlayPanel.swift:7-37`）。

**为什么要冻结**：截图交互期间屏幕是一张静态大图，overlay 全屏铺在冻结图上——既保证“所见即所截”（自家窗口已从图里排除），又让 AX 元素检测对着快照而非活屏（不被 overlay 污染）。

### 2.4 选区交互（CaptureSession）

- hover 探测异步注入（`ElementTargeting` 协议，`CaptureContracts.swift:60-73`）：最多一个在飞、最新指针位置接着问；慢 App 的过期答案只要其最小候选仍含指针就先用着（`apply` :243-265）——指针快于 AX 时是“滞后跟随”而非“永不显示”。
- 候选链 = 指针下元素矩形从小到大，止于窗口，末位显示器；**滚轮/Tab 沿链升降**（`walkChain` :293-297），`W` 切“只认窗口”，`R` 复用该屏上次确认的区域（`CaptureRegionMemory`）；单击提交候选，拖拽自由选。
- `SelectionModel`：4pt 点击容差、8 手柄（中心 6pt 触达 + 边带内外）、Shift 方形、像素吸附、最小 1px、方向键微调/⌥方向键缩放（:57-176）。
- 选区提交后**仍可随时移动/缩放**（D14），标注锚定屏幕不动，选区只决定导出范围；选区内部默认归会话（移动），选中工具后归编辑器（`interiorClaimed`，`ownsPress` :203-207）；双击确认、右键重来（有标注时不清）、Esc 取消。
- 放大镜在拖拽/缩放中跟随被调的角/边（`loupePoint` :143-149）。

### 2.5 标注

- **模型**（AICore，无 AppKit）：`AnnotationColor` 六色（系统强调色 sRGB）+ `AnnotationStroke` 0…1 连续尺寸（线宽 1-11pt、荧光笔 8-48、字号 13-43、序号徽章 19-49、马赛克块 3-33、模糊半径 1-31；滚轮与 `[ ] - =` 每 1/20 一档）（`AnnotationModel.swift:40-82`）+ `AnnotationRedaction` **pixelate/blur/solid**（注释明说：均值块可被 Depix 类还原、CleanShot 式加噪在平色区呈棋盘，**solid 是唯一保证遮死的**，:84-96）+ `AnnotationShape`：矩形/椭圆/箭头/直线/画笔/荧光笔/文本（存排版后 frame，命中不排版）/马赛克/**序号步骤徽章**（可带小尾巴箭头；序号=文档内位次，删一个全体重排）/**聚光灯**（一存在则图外全部压暗）。
- **工具**（:193-221，工具条顺序）：select(v) rect(r) ellipse(o) arrow(a) line(l) pen(p) highlighter(h) text(t) mosaic(m) spotlight(s) step(n)——单字母快捷键。
- **工具条布局**（`AnnotationToolbarLayout`）：工具条+样式条成块贴选区下（右对齐），下面没地上移（让开 30pt 尺寸标签带），再没地塞进选区内下缘；用户拖动后整场记住位置；全程 8pt 出屏边。
- **撤销**（`AnnotationStore`）：`UndoManager` 每次提交整文档回滚一档；尺寸滑杆/滚轮连动并成**一档 burst**；手势中的 preview 文档不算档。
- **马赛克**（`AnnotationMosaic`）：pixelate 是自研 `BlockGrid`——逐块**均值**（特意不用 `CIPixellate`：它每块只采一个像素，网格挪动时块在文字/背景间翻转，:10-13 注释）；网格钉在**显示器**左上角而非区域上，区域拖动缩放块不重排（:6-8）；blur 是整屏 `CIFilter.gaussianBlur`（clampedToExtent）只渲染区域部分，按 (x,y,w,h,r) 缓存 ≤64；solid 由渲染器直接填黑不读图。
- **实时预览与导出同一条绘制路径**（移植量关键）：画布与导出都走 `AnnotationRenderer`；导出 = `CaptureExport.render`（:32-52）裁冻结像素 → 画底图 → 翻转坐标系 → `editor.render(into:scale:)`（与屏幕同一渲染器）→ 合成图 + 无标注 raw 各一份（raw 供重开与 OCR）。

### 2.6 产出：怎么变成任务输入

1. 确认 → `CaptureConfirmation`（合成图+raw+pixelScale+标注文档+displayID/Frame+selection+元素描述，`CaptureSession.swift:315-331`）。
2. `CaptureLibrary.importCapture`（:34-82）：临时目录 → `CaptureExport.store`（规则：**长边 2560px**、PNG 优先、>8MiB 转 JPEG q0.9 同尺寸、JPEG 仍超则长边 ×¾ 递减到 640 为止否则拒（`ScreenshotRules.swift:9-43`）；文件名 `Screenshot YYYY-MM-DD at HH.mm.ss.png`，en_US_POSIX 24h 制）→ **并行**跑 `ScreenText.lines`（Vision 准确级 OCR，中简/中繁/英，纠错+自动语言，3s 超时即弃）→ `WindowSnapshot.describe(at:)`（选中中心落的 App+窗口名）+ 元素描述（AX role/title/value/help）→ `ScreenContext.markdown`（`# Screen context` + App/Window/Picked element + `## Recognized text` 阅读序行，12k 字符帽）→ 写成 `Screenshot …. context.md` **与图成对导入**（`attachments.importPaths` → FileRef/资源 id）。
3. 返回渲染层 `{file, context, capturedAt}` → `withScreenshot`（`screenshot-input.ts:49-59`）把图+上下文塞进任务输入（context 靠**文件名后缀 ` context.md`** 识别，:15-20）。
4. `screenshot.edit`：归档（RecentValues 10 条，键=资源 id，存 raw+scale+选区局部标注文档）能按原尺寸开就重开**可再编辑**（`preselect` 恢复文档，`CaptureSession.swift:189-203`）；否则下载字节解码（标注已焊进图，无文档）。
5. 「复制」路径：PNG+TIFF 进剪贴板、按 point 尺寸贴出（`ScreenshotTaker.copy` :162-176），附件通道返回 cancelled。

### 2.7 元素检测（识别窗口/控件）

`ElementResolver` 是 actor，AX 全部走**自己的串行 Dispatch 队列**（挂死的 App 不能冻住 overlay；打进自家进程的调用主线程等时根本没人答，:7-12 注释）；「指针下是哪个 App」由快照判（`ElementChain.topmostWindow`），AX 只做元素级 hit-test 与上溯链；预算制（hover 精化 35ms/96 调 + 上溯 250ms/160 调；describe 加倍）（:128-131, :75-77）；对 Electron/Chromium 每会话开一次 `AXManualAccessibility`（**元素检测要完整树**，与划词的“只戳 AXRole”刻意不同），会话结束恢复（:143-156）。

### 2.8 权限（屏幕录制）

`ScreenRecordingTrust`：`CGPreflightScreenCaptureAccess` 初始态 + 2s 轮询 + 激活重读；`prompt()` 每 launch 一次；设置行走 `PermissionGuide` 引导窗。**关键运维事实**（Atd `AGENTS.md:50` 原文）：*macOS 把屏幕录制与辅助功能授权绑在 adhoc 构建的 cdhash 上，每次重构建都掉授权，固定证书签名则保得住*；它有 `StaleGrantRecovery` 处理换签名后的陈旧授权。

---

## 3. 共享底座（两块都踩的件）

| 件 | 行数 | 说明 |
|---|---|---|
| `AICore/Capture/CaptureCoordinates.swift` | 125 | Quartz↔Cocoa↔view 三坐标系换算 + 像素吸附（两块的命脉，多屏/翻转 Y 全在这） |
| `AICore/Capture/ElementChain.swift` | 145 | 窗口命中 + 候选链纯函数 |
| `AIShell/Support/Deadline.swift` | 44 | `Deadline.value(within:fallback:)` 异步限时兜底 |
| `AIShell/PermissionGuide/`(3 文件) | 384 | 「去系统设置拖滑块」引导窗（授权 UX 的重要一环） |
| `AICore/Summon/TextCapture.swift`+`CaptureMemory.swift` | ~100 | 选区暂存结构 + 区域记忆 |
| `ShellStrings` + 资产目录 `Selection/`、`Capture/` 图标 | — | lucide 24×24 模板图（我们仓 `Assets.xcassets/Selection` 已有一批，迷你面板移植时带过来的） |

---

## 4. 移植盘：落在 DeepDive 哪里

**我们壳里已有的对应设施**（实证）：

| Atd 件 | 我们的 | 差距 |
|---|---|---|
| `PanelWindow` nonactivating NSPanel 实践 | `QuickPanelWindow`（QuickPanelController.swift:12，nonactivatingPanel+常驻隐身）、`MiniPanelWindow`（MiniPanelWindow.swift:53-101，borderless+nonactivating+floating+1 层） | 形态同族，overlay/HUD 窗口照 Atd 参数新开即可 |
| Carbon 热键 | `HotKeyManager`（Carbon、单条、spec 字符串） | 需扩成**多命名槽位**+冲突四态上报（Atd `HotKeyPlan` 逻辑值得整搬） |
| 桥 | `AppDelegate.handleHostMessage` + `window.__deepDiveHost.dispatch` | 新增方法/事件按 `deepdive.*` 语义对齐（`toolbar.set`→推送配置、`capture`、`screenshot.capture/edit`、事件 `selectionAsk`/`shortcutScreenshot`/`shortcutCommand` 的等价物） |
| 附件导入 | SPEC-SEMANTICS §82 附件三入口（图片 ≤32MB 内联直传/文件按路径） | 截图 PNG ≤8MiB 直传无压力；Atd 的 importPaths 等价于我们既有附件上传链。**Atd 那份 `context.md` 不搬**：它的 OCR 挂在截图交付链上（PITFALLS §11.9），我们改成工具条上按需提取文字 |
| 设置 | `DSHAppPrefs`（UserDefaults `deepdive.*`）+ 前端设置浮层 | 划词/截图的开关与排除表存哪（UserDefaults vs 推送模型）= 提案④ |
| 玻璃胶囊/工具条按钮 | `MiniPanelGlassPieces`、`WindowGlassView`（NSGlassEffectView 门） | Atd 的 `AnnotationGlassBar` 可参照其风格自写或对照移植 |
| i18n | 前端 `t()/tt()`；壳侧文案尚无统一表 | 工具条壳侧文案需一处置放 |

**规模**（v0.7.12，净搬 Swift）：

| 块 | 行数 |
|---|---|
| 截图采集+标注（AIShell/Capture 4981 + AICore/Capture+Rules 2117） | **≈7.1k** |
| 划词核心（AIShell/Selection 1828 + AICore/Selection 385） | **≈2.2k** |
| 共享底座（§3，扣除重合） | ≈0.7k |
| 划词 main 增量（写回链+选项级联+进度 HUD，18-20 新文件） | ≈+3.4k（分期另议，提案③） |
| 合计（0.7.12 基线，不含接缝改写与测试） | **≈10k** |
| 随搬 XCTest（Annotation×5、CaptureGeometry、CaptureExtras、SelectionToolbar 等） | ≈1.5k |

---

## 5. 风险与不确定

1. **adhoc 签名 × TCC（最高风险）**：我们 `make package` adhoc 深签、`make deliver` 也是 adhoc——按 Atd 实证，**每次重构建屏幕录制+辅助功能授权都会掉**，用户每次交付都要去系统设置重开两次。这是日常交付链的真摩擦，必须随提案给方案（Atd：真证书或 `StaleGrantRecovery` 式引导重授）。
2. 两个授权都**不需要** Info.plist usage 键（Atd 仅声明了文件夹三键；已核对其 project.yml）——我们 Info.plist 无需新增。
3. ScreenCaptureKit/Vision/AX 预算这些只能**真机验证**（PITFALLS §5.3 配方）；Atd 的预算数值（100/250ms、96/160 调）是它实测调出来的起点，照搬后按我们机器复测。
4. Electron AX 行为有两套刻意不同的策略（划词戳 AXRole 防读屏模式 vs 检测开 ManualAccessibility 要全树），移植时不可混用（§1.2-6 / §2.7）。
5. 我们 `LSUIElement=false`（Atd true）：overlay/activate 流程不受影响，但「还焦点给前台 App」的实测要带上 Dock 态。
6. 冻结图每 Retina 屏几十 MB（`CaptureSession.finish` :213 注释），会话结束即释放——内存峰值照它设计走，别自作主张缓存。

---

## 6. 提案（全部“提案”态，拍板前不动规范、不写代码）

| # | 提案 | 说明 |
|---|---|---|
| ① | **截图整块移植**（P3 提前立项）：Atd 的 7.1k 行 + 底座，入口=桥两方法+快捷键+迷你面板相机 | 0.7.12=main，按本地克隆搬即实机同款；含标注编辑器与上下文 Markdown |
| ② | **划词核心移植**（P2）：0.7.12 基线 2.2k 行 | 触发/探测/工具条/暂存全链；激活方式先出 always+hold（默认 hold+⌥），toggle 可后补 |
| ③ | **划词 main 增量分期**：写回链（把命令结果写回原 App 输入框）、选项级联（命令 ∨ 下拉）、进度 HUD（+≈3.4k） | 建议核心落地验证后再议；用户截图里的 ∨ 下拉属于这批 |
| ④ | 设置存放与热键：划词/截图开关+排除表放 `DSHAppPrefs`（UserDefaults），热键扩多槽位+冲突上报（搬 `HotKeyPlan` 逻辑） | 默认值照 Atd（hold+⌥、⌘⇧2），键名 `deepdive.*` |
| ⑤ | `PermissionGuide` 引导窗（384 行）随权限一起搬 | 授权 UX 关键件；不搬则退化成「打开系统设置」按钮 |
| ⑥ | 入口接线：迷你面板「就所选文字询问」（P2）与「截图」（P3）两条目按 `SPEC-SEMANTICS §162` 从“未上不显示”转正；主界面截图按钮（§82 P1 态） | 与既有拍板完全咬合 |
| ⑦ | 测试随搬（XCTest 腿），几何/规则纯函数直接跑 `make test` | Atd 的测试即契约文档 |

**明确不建议照搬**：剪贴板兜底取词（Atd 明确不做，模拟 ⌘C 侵入性强）；`run-selection.ts`（与划词无关）；Atd 的 croner/服务端设置模型（与我们客户端调度定稿冲突）。

## 7. 施工顺序建议（拍板后）

1. 提案①截图（价值大、与划词无耦合，先独立成树 `feat/capture`）：底座 → 采集冻结 → 选区交互 → 标注 → 导入/上下文 → 快捷键/迷你面板入口；每步跑随搬 XCTest。
2. 提案②划词（树 `feat/selection-toolbar`）：复用①的底座与玻璃件 → 监听/探测 → 面板 → 暂存/动作 → 设置与排除表。
3. 提案③另立项。全程铁律 6：范围只含拍板项；两授权的用户引导文案进 i18n 词典。
