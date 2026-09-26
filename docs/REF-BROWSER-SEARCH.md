# 参考：Search（Office Commun）浏览器功能块梳理与我们取/不取

参考对象：[driceroland/Search](https://github.com/driceroland/Search) —— macOS 原生 WebKit 浏览器，
MIT，Swift Package **单 `executableTarget`**（`Sources/Search`，62 个 Swift 文件 / 26,808 行，
VERSION 1.0.3）。本文只做**参考梳理**：它分成哪些块、每块假设自己拥有什么、我们取哪块不取哪块、
取的话落在我们三层（壳 / SPA / agent 控制面）的哪一层。

## 0. 两条前提（决定了"不可能整体复制"）

1. **它拥有整个 App**：唯一窗口（`App.swift:14`，注释「One window. Tabs are the only kind of
   "new" there is.」）、自己的菜单栏与全局键盘监视（`App.swift:754-765`）、自己的红绿灯布局、
   自己的更新源与签名链（`Updater.swift:38`）、自己的钥匙串命名空间（`Vault.swift:31`）。
2. **我们的浏览器是"聊天窗口里的一格"**：位置由 SPA 推槽位 rect 决定，UI 是 React，且多一层
   它没有的东西——**agent 控制面**（`/browser-control`：navigate / evaluate / screenshot /
   wait_for）。所以能搬的是**块里的逻辑**，不是它的 App 形状。

## 1. 块清单（A–R）与我们的取舍

「我们」列：**要** = 人用的浏览器该有 / **以后** = 记着但排在后面 / **不要** = 与我们的产品形态无关。
「落点」列：壳（Swift）· SPA（React）· agent（控制面）· 不动。

| 块 | 是什么（文件 / 行数 / 主入口） | 我们 | 落点与理由 |
|---|---|---|---|
| **A 应用壳、窗口与外观** | `App.swift` 1028、`Stage.swift` 384、`Lights.swift` 101、`Design.swift` 247、`FrameRate.swift` 80。单窗口 scene、`.commands` 菜单、`NSEvent` 全局键、红绿灯手工摆放 | **不要** | 我们有自己的窗口/菜单/`titlebar.ts` rect 契约；`Design.swift` 的 Palette/Metrics 思路已有 tokens.json 对应 |
| **B 标签页模型与 WebKit 宿主** | `Browser.swift` 2304、`Tab.swift` 1670。窗口级 tabs 真源、`WKWebViewConfiguration` 工厂、每标签 `PageView`、user script 装配、睡眠/唤醒/崩溃恢复、下载、JS↔原生 relay | **要**（但先切分） | **壳**。这是我们最缺的一块；`Tab.swift:80 Web.configuration`、`905 recoverFromCrash`、`1326 holdForFirstFrame`、`255 applyRememberedZoom` 可直接借；`Browser.swift` 把窗口/空间/浮窗/下载/bench 全塞一起，必须按块拆开再搬 |
| **C 标签栏与导航控件** | `TabBar.swift` 965、`Side.swift` 785、`BookmarksBar.swift` 75。顶部标签条、左侧栏 pin 网格、书签条 | **要**（重写 UI） | **SPA**。模型语义照它，UI 用 React 重画（它是纯 SwiftUI，搬不过来）；导航三键我们已有 |
| **D 地址栏、补全与地址语义** | `Omnibox.swift` 390、`Address.swift` 75、`Engine.swift` 75、`History.swift` 356、`Icons.swift` 291、`SiteCard.swift` 493、`Little.swift` 133、`StatusLine.swift` 149。scheme 猜测、搜索模板、frecency 补全、站点图标缓存、站点卡、悬停链接 | **要** | **SPA + 壳**。`Address.url(from:)`、`Engine.template/url(for:)`、`History.suggestions` 是纯函数，直接借；我们的 `browserUrl.ts` 目前很薄 |
| **E 页内查找** | `Find.swift` 58 + `Browser.swift:143 openFind` / `159 look`。`WKFindConfiguration(wraps:true)` | **要** | **壳 + SPA**：逻辑 20 行照搬，UI 用 React 做（我们在面板里已有位置） |
| **F 隐私、拦截与权限** | `Shield.swift` 146、`Dialogs.swift` 256、`StoreRelay.swift` 193、`Sharing.swift` 23 + `Browser.swift:2087` 摄像头麦克风。`WKContentRuleList` 拦截（可整站暂停）、JS 对话框/文件选择/HTTP 认证/证书信任、按站记忆摄像头麦克风 | **要** | **壳**。`Shield.compile/tune`、`Dialogs` 的四个 delegate 都是标准 WebKit API、无宿主依赖；按站权限记忆（`capture.<host>|<type>`）与我们的 per-session 存储可对齐 |
| **G 阅读与页面清理** | `Reader.swift` 146、`Curtain.swift` 379、`Hidden.swift` 87、`Fold.swift` 358。启发式阅读模式（`prose/1+links*14` 打分）、按站隐藏元素（选择器持久化 + 文档开头注入样式表）、侧栏折叠 | **要** | **壳**（JS + 持久化自足）；`Fold` 的折叠手势属宿主 UI，不要。对 agent 读页面也直接有用（去掉 cookie 弹层） |
| **H 视频浮窗** | `Float.swift` 788 + `Browser.swift:1497-1552`。把整页 web view 搬进 `.floating` NSPanel，JS 把 `<video>` 铺满，自绘控件与弹簧 | **以后** | **壳**。`Isolate` 的 JS（约 150 行）可借；窗口搬运要按我们的窗口体系重做，收益偏"人看视频"，排在后面 |
| **I 多空间标签（Spaces）** | `Spaces.swift` 484、`SpaceSwipe.swift` 335。独立 cookie 空间的 `WKWebsiteDataStore(forIdentifier:)` 隔离、⌃1–⌃9 与滑动切换 | **不要** | 我们按应用/窗口就给一份独立 store（`WKWebsiteDataStore(forIdentifier:)`）；再叠一层空间是重复概念 |
| **J 密码、导入与钥匙串** | `Vault.swift` 290、`Import.swift` 366、`Passwords.swift` 284、`Forms.swift` 341、`Accounts.swift` 77、`Registrable.swift` 15。keychain 互联网密码、Chromium 导入（Safe Storage + PBKDF2 + AES-CBC）、表单探测/填充、Touch ID | **以后** | **壳**。逻辑自足（`Vault` 只依赖自身 label），约 1,250 行是模型；人用浏览器会期望它，但优先级低于标签页/地址栏 |
| **K Passkeys / WebAuthn** | `Passkeys.swift` 840。绕开 WebKit conditional mediation，自做 CBOR + `ASAuthorization` 平台/安全密钥凭据 | **不要** | 强依赖 Apple 浏览器 entitlement（`Prefs.swift:102`）与自有签名；我们没有那个资格 |
| **L 书签、历史与清理** | `Bookmarks.swift` 657、`Recall.swift` 327、`Loot.swift` 74。树形书签（拖拽/右键/菜单镜像）、历史按天分组、下载记录 | **要**（历史先行） | **SPA + 壳**。树模型与 JSON 可借，AppKit 菜单/大纲视图要重写；下载记录自然接上 agent 的下载 |
| **M 会话与标签休眠** | `Session.swift` 63、`Sleep.swift` 112。每空间 session JSON、闲置 30 分钟或内存压力时睡眠（先快照） | **要** | **壳**。63+112 行纯逻辑、零 UI；我们多标签后必然需要它（`takeSnapshot` 封面我们已经在用） |
| **N 设置、偏好与更新** | `Settings.swift` 656、`Prefs.swift` 313、`Updater.swift` 458、`Inspector.swift` 59。7 页设置、`@Published` 偏好、自更新 | **部分要** | **SPA**：设置项照我们的设置页风格接（缩放、拦截、权限、快捷键）；**更新不要**（我们有自己的分发链） |
| **O 扩展引擎** | `Extensions.swift` 1407、`ExtensionShims.swift` 3291、`ExtensionNative.swift` 242、`ExtensionPopup.swift` 348、`ExtensionSocket.swift` 164、`ExtensionsUI.swift` 234、`Crx.swift` 204。WKWebExtension 宿主契约 + Chrome 缺失 API shim + CRX3 验签 | **不要** | 它的前提是"自己是浏览器"（自有 tab/window/书签/历史/下载/钥匙串/进程宿主）；5,990 行成本极高，与"agent 用的面板"无关 |
| **P 宿主持久化与杂项** | `Store.swift` 141、`Links.swift` 246。数据目录、测试世界隔离（`SEARCH_PROBE`）、跨 App 链接、默认浏览器注册 | **部分要** | **壳**：测试世界隔离的思路值得照抄（我们已有 `DSHMINI_SUPPORT_DIR`）；默认浏览器注册/Apple Event 不要 |
| **Q 共享 UI 原语与浮层** | `Plate.swift` 222、`Peek.swift` 116、`Welcome.swift` 425。面板共用盘子/卡片/行/胶囊、shift 预览层、首启导览 | **不要**（我们已有等价物） | SwiftUI 设计系统；我们的等价物是 `theme.css` 与现成组件 |
| **R 内部测试与自动化** | `Bench.swift` 1626（Unix socket 驱动 open/wait/text/click/key/screenshot） | **要**（思路） | **agent**：我们的 `/browser-control` 就是它的对应物；它的命令表（click/key/wait/screenshot）可以当我们的**能力清单对照**，看还缺什么 |

**一句话总结**：要的是 **B/C/D/E/F/G/L/M**（浏览器该有的骨架与人用的基本功能）+ R 的思路；
不要 **A/I/K/O/Q**（自建 App 形状、与"会话"重复的空间、需要浏览器 entitlement 的 Passkeys、
扩展引擎、SwiftUI 设计系统）；**H/J/N/P 部分以后**。

## 2. 每块假设自己拥有什么（搬之前必须先拆掉的耦合）

| 块 | 宿主假设（证据） |
|---|---|
| A | 唯一窗口 + 自建菜单栏 + 全局键盘监视（`App.swift:14`、`20-197`、`754-765`） |
| B | 自己的 tabs 真源（`Browser.swift:11`）；**独占 WKWebView 的 superview**（`Stage.swift:5`「One stage, always.」）；每标签 `PageView` 可易主（`Tab.swift:160`、`Float.swift:124`） |
| C | 拥有标题栏区域（`window.isMovable = false`，`App.swift:717`）；红绿灯位置可测量（`Lights.swift`） |
| D | 地址栏属于窗口而非网页（⌘L 抬浮层 `App.swift:409-421`）；可再开 `NSWindow`（`Little.swift:54`） |
| E | 独占页面查找状态（`Browser.swift:159`） |
| F | 自己编译并持有全局规则表（`Shield.shared`，`Shield.swift:12`）；证书 sheet 挂在自家窗口（`Dialogs.swift:230`） |
| G | 自己拥有"下一次导航前"的注入时机（`Browser.swift:1963-1968`） |
| H | 拥有窗口层级（`Float.swift:83-84`）；可跨窗口搬同一个 WKWebView（`Float.swift:124`） |
| I | 只有一个 window 对象（`SpaceSwipe.swift:56`、`Links.swift:16`） |
| J | 自己的 keychain label（`Vault.swift:31`）；可读 Chromium Safe Storage（`Import.swift:257`） |
| K | 拥有 Apple 浏览器 entitlement（`Prefs.swift:102`） |
| L | 自己的 JSON 文件；菜单栏可被自己改写（`App.swift:155`） |
| M | 退出有明确回调可同步写盘（`Session.swift:45-47`） |
| N | 自己的更新源与验签团队（`Updater.swift:38`、`320`） |
| O | 显式实现 `WKWebExtensionControllerDelegate` 并回答"打开新窗口/新标签"（`Extensions.swift:892-920`）——即"本 App 永远一个窗口" |
| P | 自己的 bundle id 与数据目录（`Store.swift:61`）；默认浏览器可注册（`Links.swift:223-245`） |
| Q | 拥有整个窗口绘制层（`App.swift:427-462`） |
| R | 自己是唯一监听者且拥有进程内全部状态（`Prefs.swift:216-222` 的 Consent 闸门） |

## 3. 值得学的实现技巧（都带实测数字，可作判据）

- **进程池预热**：全局共享 `WKProcessPool` 把新标签从 41–59ms 压到 9–10ms（`Tab.swift:66-74`）。
- **惰性 WebView**：`Tab.web` 首次访问才 build，恢复 20 个标签只是 20 个对象（`Tab.swift:160-165`）。
- **睡眠三件套**：`interactionState` + JPEG 快照封面 + `unsaved` 询问；唤醒先铺封面再加载（`Tab.swift:811-847`、`995-1001`）。
- **崩溃自愈**：`recoverFromCrash → loadAndVerify`，1.5s 后回读 url、探 `document.readyState`，只在 `webContentProcessTerminated` 时走；且等 `view.window != nil`（`Tab.swift:905-947`）。
- **首帧前隐藏**：私有 `_setObservedRenderingProgressEvents` 等到真有像素才 0.12s 淡入，消除白闪（`Tab.swift:1326-1348`）。
- **按站缩放写在 `didCommit`**：第一帧前设好，1.0 时删键避免脏数据（`Browser.swift:2157-2159`、`Tab.swift:255-262`）。
- **单事实舞台**：`StageView` 只存"想显示谁"、每次 layout 收敛；注释写明"曾维护两套状态，方向各异地退化成白页"（`Stage.swift:139-198`）——防状态分叉的范式，我们壳里那条"只推 rect、由 SPA 说了算"是同一个道理。
- **按站权限记忆**：摄像头/麦克风决定写 `capture.<host>|<type>`，并处理"同一时刻只问一个"（`Browser.swift:2095-2109`）。
- **CRX3 离线验签**：手写 protobuf varint + `SecItemImport` + `SecKeyVerifySignature`，用 id = SHA-256(pubkey) 前 16 字节映射自证归属，拒绝符号链接包（`Crx.swift:75-141`）。
- **worker WebSocket 走原生代理**：WebKit 会把扩展 worker 的 WS 阻塞主线程，改为 shim 经 native port + `URLSessionWebSocketTask`，连 Origin/UA 都按 Chrome 发（`ExtensionSocket.swift:1-15`）。
- **性能判据实例**：浮窗去阴影让 WindowServer GPU 28%→16-20%（`Float.swift:88-93`）；滚动进度每 1% 才重绘（`Tab.swift:726-732`）。
- **测试世界彻底隔离**：`SEARCH_PROBE` 下独立数据目录 + UserDefaults suite + `WKWebsiteDataStore` UUID；注释说明隔离失败曾导致真实用户 pin 丢失（`Store.swift:17-77`）——与我们的 `DSHMINI_SUPPORT_DIR` 同源思路。
- **键盘让渡（Chrome 风格）**：`pageFirst` 把 ⌘K/⌘F/⌘S 先给页面、未被消费再回落，并用 handed 去重消掉系统提示音（`App.swift:782-793`、`Tab.swift:1285-1313`）——我们面板的快捷键将来会遇到同一个问题。

## 4. 与我们现状的差距（按块看我们还缺什么）

- **B 标签页**：已落地（`BrowserTabs`/`BrowserTab`）；标签状态的事实在壳里，SPA 只渲染与发命令。
- **C 标签栏**：已落地（`BrowserTabStrip.tsx`：site icon + 关闭 + new tab）。
- **D 地址栏**：已落地（补全 + "搜索 xxx" + 站点图标）。
- **E 查找**：已落地（`WKFindConfiguration`，⌘F/⌘G/⇧⌘G/Esc）。
- **F 隐私**：已落地——拦截走 `WKContentRuleList`（清单照它那份、故意短），按站暂停 + 摄像头/麦克风
  按站记忆（`BrowserShield` / `BrowserPermissions`）。
- **G 阅读/清理**：已落地——阅读模式（`BrowserReader`，正文打分那套照它）、按站隐藏（`BrowserHidden`
  的按站选择器 + 拾取）、清理走「设置 → 浏览器 → 登录态」的清除浏览数据。
- **L 书签/历史**：无（我们有会话产物列表，与"浏览历史"是两件事）。
- **M 休眠**：已落地（闲置/内存压力触发，`interactionState` + 停帧封面 + "未保存输入"询问；
  面板关着时仍靠 `alpha 0` 保活供 agent 截图，两者并存）。
- **R 自动化**：有 `/browser-control`（navigate/back/forward/reload/get_state/screenshot/evaluate/wait_for
  + list_tabs/new_tab/select_tab/close_tab，命令按 `tabId` 寻址）；
  对照它的命令表，我们缺 **click / key / 等待条件的种类**（我们只有 wait_for 一种）。

## 5. 落地顺序（2026-09-26 用户确认，定稿条文在 `SPEC-BROWSER-USE.md §3.5`）

用户确认按下面顺序逐块做，并补了三条定稿：标签栏**横向 + site icon 式 + new tab、不做竖向**；
**cookie / 密码导入很重要**（agent 被登录墙拦）；**浏览器设置项统一进设置页，新增「浏览器」设置页**。

1. **地址栏与补全 + 按站缩放记忆 + 查找**（D/E）——已落地
2. **标签页模型 + 标签栏 + 休眠**（B/C/M）——已落地
3. **隐私与拦截 + 按站权限**（F）——已落地
4. **阅读模式与按站隐藏**（G）——已落地
5. **历史与书签**（L）
6. 以后：视频浮窗（H）、密码/钥匙串（J）、设置项补全（N 的部分）

**没有搬、也不要搬**：A 应用壳形状、I 空间、K Passkeys、O 扩展、Q SwiftUI 设计系统、N 的更新器。
