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
- **工具栏**：后退 / 前进 / 刷新 / 地址栏（带"页面已跳转，地址未知"标记）/ 在系统浏览器打开；
  iframe 载体另有一枚**沙箱开关**（官方 Web 载体的同一枚，非持久化、按 tab）。
- **独立数据存储**：原生载体的 `WKWebsiteDataStore` 是 `nonPersistent()`——cookie 与 Web 存储
  不落盘、不与应用自身会话共享，重启即清。
- 弹窗不开原生窗口：白名单内的在同一个视图里就地加载（官方 Desktop 是开成侧栏新页；
  本仓只有一个浏览器视图，等价做法是就地导航）。下载不落地。

## 3.5 这一格要变成"人和 agent 都用"的浏览器（2026-09-26 与用户定稿）

现状是**单页**：一个 WKWebView、一个槽位、一个地址栏 + 前进后退刷新。用户确认要按参考
（第三方 Search 浏览器，见 [REF-BROWSER-SEARCH.md](REF-BROWSER-SEARCH.md) 的 A–R 块清单）
把它补成一个真浏览器——因为 agent 在用，人也在用。

定稿四条：

1. **标签页**：横向、**site icon 式**（标签本体是站点图标那一路极简样式，不堆长标题）、
   带 **new tab**；**不做竖向标签栏**。标签栏 UI 用 React 重画（参考那份是 SwiftUI，搬不过来），
   模型语义参考 `Tab.swift`。
2. **导入 cookie 与密码**（用户点名"很重要"）：agent 现在常被登录墙拦下——没有登录态，
   同一个站点反复要重新登。所以要么导入浏览器的 cookie/密码，要么人手工登一次并留住。
   **前置改动**：浏览器视图现在用 `nonPersistent` 数据存储（重启即清），必须换成**持久且独立**
   的 store，否则导进来的登录态留不住。
3. **设置项统一进设置页**：新增「浏览器」设置页，浏览器相关的开关/值都放那儿（缩放与按站记忆、
   拦截与按站权限、地址栏行为、标签页行为、导入、清数据），不散落在面板里。
4. **不做**：竖向标签栏、多空间（Spaces）、Passkeys、扩展引擎、自建更新器——理由见参考文档。

落地顺序（据此逐块做，每块自带它需要的设置项，不做空壳设置页）：

1. 地址栏与补全 + 按站缩放记忆 + 页内查找
2. 标签页模型 + 标签栏 + 标签休眠
3. cookie / 密码导入（含持久 store 切换）
4. 隐私与拦截 + 按站权限记忆
5. 阅读模式与按站隐藏
6. 历史与书签；以后：视频浮窗、密码面板细化


## 4. agent 驱动（browser use）

形状照 ZCode 的 `browser-use-plugin`：**模型手里只有一个 `js` 工具**，浏览器 SDK 由内核预装。

```
模型 ──js 工具──▶ MCP server（随包 BrowserUse/，stdio）
                    │  node:vm 新内核 + browser-client SDK
                    ▼
              POST /browser-control（桥的回环端点，boot token 鉴权）
                    ▼
              BrowserHost（壳里的 WKWebView，与面板里人看的那个是同一个）
```

分层与 ZCode 一致：**高层语义在 JS 侧**（快照/ref/定位器/坐标逃生口由 SDK 拼页面脚本），
壳只提供原语——`navigate` / `back` / `forward` / `reload` / `get_state` / `screenshot` /
`evaluate` / `wait_for`。所以壳不认识 ref、不认识选择器，SDK 换代不必改壳。

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
  也不被消费。闸门只能做在壳侧——协议白名单、单页、独立 nonPersistent 存储、boot token。
- **子智能体也能调 `js` 工具**：引擎没有按 scope 过滤 MCP 工具的面。
- **单页**：没有多标签、没有录制、没有响应式视口、没有网络拦截（ZCode 有，本仓明确砍掉）。
- 浏览器工具定义进每次请求（token 成本）；`js` 一个工具，可接受。
- iframe 载体的固有边界（官方同样如此）：很多站点拒绝被 iframe 嵌入；HTTPS 页面会拦公网
  http（mixed content）；关掉沙箱会换来兼容性，代价是页面能导航顶层。
