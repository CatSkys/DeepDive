# 会话右侧边栏与浏览器使用

状态：已实现（2026-09-25）。这份文档是「右侧边栏 + 侧栏浏览器 + agent 驱动」的唯一家；
面板的视觉细节归 `UI-SPEC.md`，移植对照归 `DSH-SOURCE-MAP.md`，踩坑归 `PITFALLS.md`。

## 1. 它是什么

会话页右侧的边栏：**会话状态与产物的集合，加上会话自己的设置**。头部角落座位是入口——
胶囊有内容就显示胶囊，没内容就显示一枚展开按钮；两者都开合这张面板卡。

官方 DSH 的对应物是 `ui-sidebar-right`（它叫 right Sidebar，展开按钮也在会话头部）。
本仓按用户定稿做了两处产品裁剪，其余规则逐条照抄：

| 规则 | 出处 |
|---|---|
| 展开按钮在会话头部的角落座位；面板展开时该座位渲染空 | 官方 `ui-sidebar-right` |
| 两种呈现：push（会话让位）与 fullscreen（盖住整卡） | 官方同上 |
| 每个会话一份状态、**内存态**（重载回默认收起、切会话各记各的） | 官方同上 |
| 没有会话就没有按钮也没有面板（草稿页没有） | 官方同上 |
| 面板是页面的一列（用会话的底色与字号），不是浮起来的卡片 | 官方同上 —— **本仓不照抄**：用户定稿改成"会话列与面板两张并列的悬浮卡"，视觉规则归 `UI-SPEC.md` |
| 面板没有标题行，控件骑在顶条最右端 | 官方同上 |

本仓的两处裁剪（有意，别再当成缺陷）：

- **不做官方的 tab 体系**：官方面板是「tab 型注册表 + dockkit 分栏/浮动」，因为它的组合里
  装着文件树、文档预览、终端、浏览器四个 tab 型。本仓只装两页——**默认页**（屏幕缩略图 +
  能力分区）与**浏览器页**（工具栏 + 整页），所以没有注册表、没有页签条、没有分栏/浮动
  （参考图与用户定稿都是这个形状）。
- **不做状态持久化与撤销**：官方那份 `SurfaceState` 带操作序列以便重放，本仓只保留
  「每会话的 open/fullscreen/mode」。

## 2. 面板里的两页

- **默认页**——上方是**屏幕缩略图**（10:7 圆角块 + 一行居中说明 `<会话名>的屏幕`），
  点它展开到浏览器页；下方是能力分区：产物 / 目标 / 任务与计划 / 子智能体 / Git 工具 /
  提醒 / 后台任务。前六区原样来自状态胶囊（组件未改，只换了宿主），**产物区是这一版新增的**：
  把消息流里逐轮挂在 turn-tail 上的 `presented` + `produced` 收成一份会话级清单，跨轮按
  绝对路径去重（`sessionArtifacts.ts`；正文里的产物行 `ArtifactsRow` 与它共用同一份合并口径）。
- **浏览器页**——顶条多一枚返回箭头，正文是工具栏 + 占满面板的页面。见下节。

## 3. 侧栏浏览器

浏览器只有一个实例，两种尺寸共用它：**缩略图**（默认页里的那块"屏幕"，点它展开）与
**展开态**（工具栏 + 占满面板的页面）。同一个组件实例意味着切尺寸不会重挂载体、不丢页面状态
（官方对应的是 Electron 载体的 `keepMounted`）。

载体有两支，由 `inShell()` 选，不在运行期切换：

| 载体 | 何时用 | 实现 |
|---|---|---|
| 原生 | 壳里（桌面） | 壳摆第二个 `WKWebView`（`BrowserHost.swift`），SPA 只挖洞并推 rect（`nativeSlot.ts`） |
| iframe | 纯浏览器（手机远程 / 开发） | `BrowserCarrier.tsx`，沙箱常量照官方 `WEB_BROWSER_SANDBOX` |

从官方 `@deepseek-ai/dsh-client-ui-sidebar-browser` 照抄的规则：

- **协议白名单**：只收 `http`/`https`/`about:blank`；`file:`/`data:`/`blob:`/`javascript:`、
  带内嵌凭据的地址、以及本应用自己的 origin 一律拒。本地文件预览归文档预览，不归浏览器。
- **导航状态机**（iframe 载体）：跨域读不到地址，所以历史由应用自己记（上限 100 条）；
  **首帧对某个请求保持地址权威，再一次 load 就标记为未知**——那时后退/前进/外部打开置灰、
  刷新回到最后已知地址。原生载体有真历史，不走这套，直接镜像壳的观察。
- **工具栏**：后退 / 前进 / 刷新 / 地址栏 / 「…」 / 「对话」；iframe 载体另有一枚**沙箱开关**
  （官方 Web 载体的同一枚，非持久化、按 tab）。地址栏没有提交钮（Enter 提交），输入既可能是
  地址也可能是搜索词：补全项 = 本机访问记录（`browserRecents.ts`，上限 20、取 6）加一条
  "搜索 …"（`browserUrl.ts` 的 `looksLikeSearch` 分辨地址与搜索词，模板由设置页选）；地址未知
  时显示"页面已跳转，地址未知"标记。
- **「…」菜单**：放大 / 缩小 / 重置缩放（带当前百分比）/ 页内查找 / 在默认浏览器打开。
  一项都没有时整枚不渲染（纯浏览器里的空白页就是这种情形）。
- **缩放**是 `pageZoom`（按新尺寸重新排版，不是放大镜）：档位、上下限、按站点记忆、默认值
  与桥消息解析都归 `apps/macos/Sources/DSHminiApp/BrowserZoom.swift`；壳在 `didCommit`
  （第一帧之前）应用该站点的记忆值，写入发生在人真的改了缩放那一刻。
- **页内查找**走 `WKFindConfiguration`：⌘F 开、⌘G / ⇧⌘G 上下、Esc 关、空串即取消并清选区。
  查找词每次都显式交给壳——同一帧里读 state 会查到"少一个字"的串。
- **「对话」**占地址栏右侧那一格，唤出浮在网页之上的那座对话卡（`ComposerOverlay.tsx` +
  壳侧 `ComposerOverlayHost.swift`）；面板标题栏不放它。
- **浏览器设置归设置页**：「设置 → 浏览器」（`frontend/src/settings/BrowserSection.tsx`），四节：
  缩放 / 标签页 / 登录态 / 地址栏（外加一节快捷键说明）。默认缩放、按站点记忆、标签休眠门槛落壳侧
  UserDefaults（壳在 `didCommit`、看门计时器里要读，留在 SPA 里就晚了）；搜索引擎与"把普通输入当
  搜索词"是纯交互偏好，落客户端 localStorage（`browserPrefs.ts`）；登录态那一节的来源清单与导入结果
  来自壳（`browser-cookies` ↔ `browserCookieSources` / `browserCookieResult`）。
- **标签**：标签的事实源在壳里（`BrowserTabs.swift` + `BrowserTab.swift`），SPA 只画一条横向的
  **site icon 式**标签栏（`BrowserTabStrip.tsx`：站点图标 + 关闭，没图标退回主机名首字母）与末尾那枚
  new tab；不做竖向标签栏、不堆长标题（标题走提示与无障碍名）。**永远至少留一个空白标签**——关掉最后一个
  是回到空白页，不是没有浏览器。标签不跨启动保留。
- **站点图标**是页面自己声明的那个（`link[rel~=icon]`，在页面里解析成绝对地址），一次导航问一次；
  不替站点猜 `/favicon.ico`（多数站点没有，只会打一堆 404），也不下载缓存——SPA 直接按这个地址取图。
- **标签休眠**（`BrowserTabs+Sleep.swift`）：没人看的标签把宿主还给系统，只留三样东西——回去的路
  （`interactionState`：历史 + 滚动位置 + 表单状态，唤醒时由 WebKit 放回原处）、一张停帧图（base64 PNG，
  唤醒时铺在面板上，页面一有像素就被原生视图盖住，4s 后无论如何撤掉）、以及"页面里有没有没发出去的
  输入"这一问（任何输入框的值与默认值不同即不睡）。当前标签永远不睡；空白页、正在加载的、已经睡着的
  不睡。门槛 `deepdive.browser.tabs.sleepMinutes`（0 = 关，默认 30 分钟）由设置页写；内存压力来时压到
  5 分钟、critical 立即扫。**唤醒是按需的**：人在标签栏点它、agent 按 tabId 找它，都会先把它叫醒——
  休眠因此不会把 agent 的 screenshot/wait_for 打死。睡与醒各留一条 `[browser] sleep/wake` 诊断日志。
- **拦截与按站权限**：广告/跟踪拦截走 `WKContentRuleList`（`BrowserShield.swift`）——WebKit 在它自己的
  网络层执行，请求还没发出去就被挡掉，不跑脚本；规则表照参考实现那份**故意短**的清单（第三方跟踪/
  广告域名 + 几处一定是广告位），启动时编译一次，每个标签的 controller 在**导航那一刻**按站点加减。
  全局开关 `deepdive.browser.shield.enabled`（默认开）+ **按站暂停**（`deepdive.browser.shield.paused`，
  给"被拦坏了的站点"留的退路）：面板「…」菜单里那枚"本站暂停/恢复拦截"改的就是它，暂停后**重载当前
  标签**（规则只在导航那一刻算数）。规则没编译成功时设置页会说出来（开关写着"开"而实际什么都没挡）。
- **按站权限记忆**（`BrowserPermissions.swift`）：网页申请摄像头/麦克风时 WebKit 把决定权交给壳
  （`requestMediaCapturePermissionFor`），壳按"站点 + 种类"记住；没记过就用应用自己的弹窗问一次
  （桥推给 SPA，走 `DialogHost`，壳不弹系统框），30s 没人答就拒绝（页面被 WebKit 挂着等这个决定）。
  一次只问一个：上一个没答完，新的直接拒（排队会让第二个页面莫名其妙地等）。
- **阅读模式**（`BrowserReader.swift`，面板「…」菜单）：把页面**就地**换成只有正文的那一版——
  判断正文用的是老办法（参考实现同一套）：谁的散文最多谁就是正文，且为里面的每个链接扣分
  （导航条、相关阅读、评论区都是链接堆的）。图片在**原页面还站着的时候**解析成普通 `src`
  （`currentSrc`，否则只会拿到懒加载占位图），正文里带链接的 `h1` 退回 `document.title`
  （维基那种"标题 + 编辑"）。**退出 = 重新加载**：身体已经被换过，没有"原来的 DOM"可回；
  找不到正文时弹窗说出来，不假装换好了。
- **按站隐藏**（`BrowserHidden.swift`）：在面板「…」菜单里点"隐藏页面上的元素…"，页面上悬停高亮、
  点一下就把那块从**这个站点**拿走，下次来还在。三部分：记忆（按 host 一组选择器，
  `deepdive.browser.hidden` 里一份 JSON，键按参考实现那把尺子归一化——小写去 `www.`）；生效
  （导航**开始之前**把 CSS 挂成 `WKUserScript`，文档一开始就注入，所以不会"先看见再消失"；改完
  记忆也立刻对当前页面再注入一次）；拾取（见下条）。恢复：面板菜单里整站恢复，设置页「隐私」
  里全局恢复（没有逐条列表——那是另一件事）。
- **拾取回话是页面 → 壳的唯一一条通道**（`BrowserHost+Hidden.swift`）：页面上没有桥，要知道
  "人点中了什么"只能靠一条 `WKScriptMessageHandler`。边界写在那个文件头上：只在拾取模式开着时认，
  只接受 `{selector,label}` / `{cancel}` 两种形状，壳只能"记一条选择器"；handler 挂在**弱代理**上
  （`WKUserContentController` 强持有 handler，挂宿主自己会成环，睡着的标签就回收不掉了）。
- **标签栏与网页的层序**：当前标签的 `WKWebView` 挂在舞台上（`MainWindowController.browserStage`），
  舞台在 SPA webView 之后、对话叠加层之前——换标签只换舞台里的视图，层序不动。
- **数据存储是持久且独立的**（`BrowserDataStore.swift`）：`WKWebsiteDataStore(forIdentifier:)` 给浏览器
  自己一份带固定标识的 store——cookie 与站点存储留在这台机器上（重启仍在），又与主 SPA 的 `default`
  各一份（浏览器的登录态不会漏进应用自身会话）。**一个窗口的标签共用这一个 store**（各标签一个 store
  就是各登各的）。会话 cookie（没有到期时间的那种）重启仍然不留——这是浏览器本来的规矩，
  别把它当 store 的毛病。设置页的「清除浏览数据」把 cookie 与站点存储一起清掉，清完重载当前标签——页面上
  那份已经过期的登录态才看得出来退了。
- **登录态可以从别的浏览器导进来**（「设置 → 浏览器 → 登录态」；`BrowserCookieSource` 发现来源、
  `BrowserCookieFiles` 解析三种格式、`BrowserCookieImport` 写进 store）：Chromium 系
  （Chrome / Edge / Arc / Brave / Dia / Vivaldi / Chromium）的 `Cookies` 是 SQLite + `v10` AES，
  密钥在各自 keychain 的“<名字> Safe Storage”项里——macOS 会先问用户一次（要输登录密码），
  这是导入唯一必须人点头的地方；Firefox 的 `cookies.sqlite` 是明文；Safari 的
  `Cookies.binarycookies` 在它自己的容器里，要「完全磁盘访问权限」。读文件一律**先拷一份再读**
  （浏览器多半正开着），`HttpOnly` 靠 `NSHTTPCookie` 的自定义属性键保住。结果只回**码**给 SPA
  （ok / no-key / permission / missing / empty），文案在词典里。清单里的 `blocked` 表示"数据目录
  列不出来"（macOS 14 起"别的应用的数据"是独立一道 TCC 闸，实测 Chrome / Edge / Brave 就是这样，
  而 Arc / Dia 能读）——先说清楚，别等人点了导入才报错。控制面另有 `list_cookie_sources` /
  `import_cookies` + `import_cookies_status`（agent 被登录墙拦下时可以自己拉一次；起活与取状态
  分成两条，理由见 PITFALLS §4.25），SDK 侧是 `browser.cookies.sources()/import(source)`。
- 弹窗不开原生窗口：白名单内的交给标签集合开成**新标签**（`target=_blank` 的链接不该把手上
  这一页顶掉），下载不落地。

## 3.5 这一格要变成"人和 agent 都用"的浏览器（2026-09-26 与用户定稿）

这一格按参考（第三方 Search 浏览器，见 [REF-BROWSER-SEARCH.md](REF-BROWSER-SEARCH.md) 的
A–R 块清单）逐块做成一个真浏览器——因为 agent 在用，人也在用。地址栏/缩放/页内查找（§3）
与标签页（§3 的标签条目）已经落地，还在路上的是下面这份清单。

定稿四条：

1. **标签页**：横向、**site icon 式**（标签本体是站点图标那一路极简样式，不堆长标题）、
   带 **new tab**；**不做竖向标签栏**。标签栏 UI 用 React 重画（参考那份是 SwiftUI，搬不过来），
   模型语义参考 `Tab.swift`。**标签状态的事实源定在壳里**（agent 控制面与 WKWebView 都在壳侧，
   SPA 只渲染与发命令）——这条是先定的，标签栏才照着画。
2. **导入 cookie 与密码**（用户点名"很重要"）：agent 常被登录墙拦下——没有登录态，同一个站点
   反复要重新登。所以要么导入浏览器的 cookie/密码，要么人手工登一次并留住。cookie 那半与
   "持久且独立"的存储都落在这块（见 §3）；密码那半见下面的清单。
3. **设置项统一进设置页**：新增「浏览器」设置页，浏览器相关的开关/值都放那儿（缩放与按站记忆、
   拦截与按站权限、地址栏行为、标签页行为、导入、清数据），不散落在面板里。
4. **不做**：竖向标签栏、多空间（Spaces）、Passkeys、扩展引擎、自建更新器——理由见参考文档。
5. **性能与内存照它这几条做**（参考那份是同类 WebKit 应用里少见的、每条都带实测数字的）：
   - **进程池**：这条在 macOS 12+ 上**不用做**——`WKProcessPool` 自 macOS 12 起标记废弃
     （"Creating and using multiple instances of WKProcessPool no longer has any effect."），
     WebKit 自己按应用共享内容进程。标签之间真正要共享的是**数据存储**（cookie 跨标签可见）。
   - **惰性 WebView**：标签对象先建、`WKWebView` 首次访问才建——恢复 N 个标签只花 N 个对象。
   - **标签休眠三件套**（已落地，见 §3 的休眠条目）：`interactionState`（实测唤醒后回到同一页、
     同一滚动位置、连历史一条不少）+ 快照封面 + 「未保存输入」询问；闲置或内存压力触发，
     唤醒时先铺封面再加载。**这是我们"面板关着仍 `alpha 0` 保活"的替代方案**（保活是为了 agent
     能截图），而 agent 要图/要脚本时按 tabId 取宿主会先唤醒它。
   - **首帧前隐藏**：等到真有像素再淡入（0.12s），消除暗色窗口里的白闪。
   - **崩溃自愈**：进程终止后按"回读 url + 探 `document.readyState`"判定是否真的白了再重载。
   - **按站缩放写在 `didCommit`**：第一帧前生效；值为 1.0 时删键，不留脏数据。
   - **实测数字当判据**：浮窗去阴影让 WindowServer GPU 从 28% 降到 16–20%；滚动进度每 1% 才重绘。
   - **测试世界彻底隔离**：我们已有 `DSHMINI_SUPPORT_DIR` 走同一思路——它的注释记着隔离失败
     曾导致真实用户数据丢失，别省这一步。

还没做的块（逐块做，每块自带它需要的设置项，不做空壳设置页；「浏览器」设置页已在，
新块往里加分节）：

1. **密码库与自动填充**（定稿第 2 条里"密码"那一半）：cookie 与持久 store 已落地（§3），
   密码没有顺着它做——`WKWebView` 的自动填充只吃系统钥匙串里 Safari 的那一份（要 Apple 的
   entitlement），要把浏览器里的密码用起来得先有自己的 vault（keychain）+ 填表 + 面板，规模是
   独立一块（参考实现也是这么分的：`Vault.swift` + `Passwords.swift`）。
2. 历史与书签；以后：视频浮窗、密码面板细化、隐藏项的逐条列表


## 4. agent 驱动（browser use）

形状照 ZCode 的 `browser-use-plugin`：**模型手里只有一个 `js` 工具**，浏览器 SDK 由内核预装。

```
模型 ──js 工具──▶ MCP server（随包 BrowserUse/，stdio）
                    │  node:vm 新内核 + browser-client SDK
                    ▼
              POST /browser-control（桥的回环端点，boot token 鉴权）
                    ▼
              BrowserTabs（壳里的标签集合；当前标签那个 WKWebView 就是面板里人看的那个）
```

分层与 ZCode 一致：**高层语义在 JS 侧**（快照/ref/定位器/坐标逃生口由 SDK 拼页面脚本），
壳只提供原语——`navigate` / `back` / `forward` / `reload` / `get_state` / `screenshot` /
`evaluate` / `wait_for`，外加标签的 `list_tabs` / `new_tab` / `select_tab` / `close_tab`，
登录态的 `list_cookie_sources` / `import_cookies` / `import_cookies_status`，
拦截的 `get_shield` / `set_shield`（`enabled` 或 `host`+`paused`，改完重载当前标签），
以及页面改造的 `reader {on}` 与 `hidden` / `hide_element` / `restore_hidden`。
所以壳不认识 ref、不认识选择器，SDK 换代不必改壳。

**命令一律按 `tabId` 寻址**（缺省当前标签；指名了却找不到就报错，不悄悄换一个标签干活），
`new_tab` 会切过去（人看得见 agent 开的新页），`select_tab`/`close_tab` 只在指名时动标签。
SDK 侧的 `browser.tabs.list/new/get/selected` 与 `tab.close()` 就是这几条原语的包装
（`get` 不切标签——命令自带 id，后台标签也能干活）。

- **注册**：`EngineSupervisor.enginePatchBody()` 每次启动写一行 `mcp-browser`
  （`@deepseek-ai/dsh-mcp-client`、stdio、`command` 是随包 Node、`args` 是装到
  `<support>/browser-use/` 的 server 入口）。用户不可删改——那是 app 自有 overlay 层。
- **鉴权**：`BrowserControl.token` 是 boot 级随机值，经环境变量交给 MCP server；
  桥的 Origin 全等闸不动。
- **skill**：`deepdive-browser` 随包铺到 `<DSH_HOME>/skills/`（`EngineSupervisor.ensureSkills`），
  移植 ZCode `control-browser/SKILL.md` 的纪律。
- **截图**：MCP 的 image content block → 引擎 attachment store → 会话工具结果里的
  `{type:'image', attachment}`，前端已有渲染面（`AttachmentThumb`），零新代码。
  ⚠️ **只有声明 `image` 输入的模型路由能让模型看见截图**（`deepseek-flash` 声明了，
  `deepseek-v4-pro` 没有）；UI 不受影响，截图照常显示。

## 5. 会话设置（面板右上角齿轮）

四项都复用现成通道，没有新契约：

| 项 | 读 | 写 |
|---|---|---|
| 模型 | `useSessionModels` 的 face | `session/selectModel`（同一份 face） |
| 权限 | 会话投影 `permissions`——引擎已按 wire view 发 `{options, currentValue}` | `/permission <preset>` 命令（引擎注释原话：the one write path a web client uses）。**不写** `permission.defaultPreset`（那是新会话默认值） |
| 插件 | `pluginInventory/list` + 壳的 patch 台账 | 复用 `plugins/PluginsTab`（同一个组件） |
| 发送方式 | 引擎 `ui-conversation.busyEnter` | `settings/update`（`useSettingNamespace`） |

⚠️ **发送方式是全局设置**（引擎没有会话级开关），面板只是它的第二个入口，与设置→通用
同源同义；要会话级得先有新的持久化落点，另行立项。

## 6. 已知边界（不藏）

- **MCP 工具不受 DSH 权限预设约束**：引擎里没有任何按 MCP 身份分类的规则，`annotations`
  也不被消费。闸门只能做在壳侧——协议白名单、标签集合、独立的数据存储、boot token。
- **子智能体也能调 `js` 工具**：引擎没有按 scope 过滤 MCP 工具的面。
- **没有录制、没有响应式视口**（ZCode 有，本仓明确砍掉）。
- **阅读模式是启发式，不是可配置的抽取器**：没有字号/主题/按站开关（那是另一件事），
  也救不了以图/视频为主的页面；正文判定失败时只有一句"没找到可读的正文"。
- **按站隐藏没有逐条列表**：只能"恢复本站全部"或"全局恢复"（面板菜单 / 设置页各一条路）。
- **拦截是 WebKit 的规则表，不是插件式广告拦截器**：没有元素级规则编辑、没有拦截计数、没有自定义
  清单；清单故意短（一张大方的 cosmetic 清单就是拦截器开始吃页面的开始）。**能按站记住的权限只有
  摄像头/麦克风**——定位/通知那几项 WebKit 在 macOS 上不由宿主应用决定（要 Apple 的 entitlement），
  所以这里没有"按站权限"的通用表。
- **导入的三道系统门槛是别人的规矩**：① Chromium 系的 cookie 要用户批准一次 keychain 访问（要输
  登录密码，壳只能发起、不能代答）；② Safari 的 cookie 库要「完全磁盘访问权限」；③ 别的浏览器的
  数据目录本身可能被 macOS 的"App 数据"闸挡住（实测 Chrome / Edge / Brave 列不出来，Arc / Dia 能）。
  三者都不通时导入给的是一个码（`no-key` / `permission`），设置页照码说话、清单里先标 `blocked`。
- **标签不跨启动保留**（没做会话恢复）；标签的键盘快捷键（⌘T/⌘W/⌘1-9）也还没绑——
  新建/切换/关闭目前只在标签栏上。
- 浏览器工具定义进每次请求（token 成本）；`js` 一个工具，可接受。
- iframe 载体的固有边界（官方同样如此）：很多站点拒绝被 iframe 嵌入；HTTPS 页面会拦公网
  http（mixed content）；关掉沙箱会换来兼容性，代价是页面能导航顶层。
