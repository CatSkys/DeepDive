# DeepDive Windows 客户端 — 方案与施工计划

> **状态（2026-10-10）：壳主体已按本方案施工完成——C# 壳仓 `DeepDive-win`（用户指定独立目录）三层全落地（基础层+引擎链+桥 / 主窗+HostCommands+壳能力 / 构建车道+CI+测试钉子），SPA 平台化落在 DSHmini `feat/windows` 分支；macOS 端已跨编译验证（运行与 P0 出口判据待 Windows 真机）。** 本期不含浏览器套件等，见 §9/§11.2 的能力清单降级。
> 运行时偏差：实际用 **.NET 10 LTS**（本文各处写的 .NET 8 于 2026-11 EOL，已升档；WPF/WebView2 选型不变）。
> 本文仍是 Windows 端决策与施工图的唯一事实源；macOS 端 as-built 归 `ARCHITECTURE.md`，路线归 `TODO.md`。
> 依据：Raycast 2.0 技术复盘（`raycast.com/blog/a-technical-deep-dive-into-the-new-raycast`）
> + 本仓现状 + 引擎（`engine/` 自研 fork，引脚见 `scripts/dsh-runtime-version.txt`）实查。

---

## 1. 结论

**壳换平台，SPA 与引擎不动。** 新增一个 C#/.NET 8 + WPF + WebView2 的 Windows 原生壳，
`frontend/` 与 bundled 引擎按现状共享；桥（同源托管 + 反代 + WS 中继）在 Windows 侧重写一份。

不引入 Electron、Tauri、Flutter、Qt、React Native for Desktop。

理由一句话：Raycast 2.0 复盘的结论就是这条路，而我们的 mac 端**已经是这条路的形状**——
本仓的三层（原生壳 / 自建 SPA / 被监督引擎）+ 系统 WebView 就是文章 §"How it's built" 的
四层去掉 Rust 层。Windows 端要补的是第二个壳，不是第二个架构。

## 2. 从文章取到的四条判断

| 文章结论 | 对我们的直接含义 |
|---|---|
| 双原生 UI 栈 = 两倍工作量、且大部分代码是 UI，所以 UI 必须走 Web | 我们已满足：SPA 是共享的，Windows 只补壳 |
| Electron 在深 OS 集成处"web/native 边界会疼"，且 macOS 上不想捆 Chromium 而要用系统 WebKit | 我们已满足：用系统 WebView（WKWebView / WebView2），壳拿到完整平台 API |
| 自建壳要自己造 Electron 那套 IPC 与托管管道，**且 per platform、没有社区替你解决** | 桥是"每平台各一份"的托管活，不是业务逻辑——这是 §6 决定 Windows 桥重写的依据 |
| 混合栈的代价：内存基线抬高、四运行时调试链长、Windows 碎片化、原生细节（IME/无障碍/拖放）要自己补 | 我们的预期成本清单，见 §10 |

文章里一个容易读反的细节值得记住：他们否掉的是**用 WPF/WinUI 3 写应用 UI**（"两张原生 UI
栈"），而不是用 WPF 当**宿主壳**——Windows host app 最终就是 C#/.NET 8 + WPF。这个分工
与我们的壳/SPA 分工完全一致。

## 3. 为什么不是别的路

- **Electron**：上游官方桌面端即 Electron（`deepseek-harness/apps/desktop`），有完整先例可抄；
  但它与我们已建成的壳能力（原生通知/悬浮球/热键/标题栏契约/引擎失败面）和打包链全不兼容，
  且 Chromium 基线内存换不来我们需要的东西。文章对 Electron 的排除理由（深集成、系统 WebView）
  在我们这里同样成立。
- **Tauri / WinUI 3 / Flutter / Qt / RN for Desktop**：文章的排除理由（原生控制力不足、
  成熟度不够）逐条成立，不重复论证。
- **复用上游 desktop profile（不开端口，走管道 + `dsh-app://`）**：否决。该 profile 会
  `disabled: [web-startup, webserver, web-runtime, ...]`（`apps/desktop-host/config/desktop.cordis.patch.yml`），
  而我们的桥**必须能在引擎不在时托管 SPA**——凭据冷启动与引擎故障的内置错误面正是"引擎没起来"
  的窗口（PITFALLS §5.6，静态资源被 503 挡住会把新装机器焊成黑窗）。端口形态的本机回环桥
  是维持这条的最简办法，且保住"浏览器打开 bridge URL 做 DOM 调试"（PITFALLS §6.2）。
  上游那套管道传输留作远期选项，不进本期。

## 4. 目标架构（Windows 侧）

```
┌──────────────────────────────────────────────────────────────┐
│ Windows 壳  C# / .NET 8 / WPF                                 │
│  主窗(WebView2, 同源 http://127.0.0.1:<固定端口>) · 托盘 ·      │
│  全局热键 · 原生通知 · 悬浮球 · 单实例 · 保持唤醒 · 文件选择 ·  │
│  打开方式/在资源管理器中显示 · 引擎监督 · Bridge(托管/反代/中继)│
├──────────────────────────────────────────────────────────────┤
│ 自建 SPA  React + TS + Vite（frontend/，一份，两端共用）        │
├──────────────────────────────────────────────────────────────┤
│ 引擎  node.exe + dsh 闭包（被监督；显式关机协议，见 §6）        │
└──────────────────────────────────────────────────────────────┘
```

桥的契约与 macOS 侧**逐条对齐**（这是我们唯一允许"两份实现"的地方，理由见 §2 第三行）：
同源 Origin 全等门（PITFALLS §4.5）、固定端口（PITFALLS §4.17）、引擎 token→cookie 注入、
静态资源不受引擎状态门控（PITFALLS §5.6）、`/__deepdive_error` 诊断通道、
大 body 直通、`/assets/*` 长缓存 + 其余 `no-cache`。

## 5. 壳能力对照（macOS 实现 → Windows 方案）

| 能力 | macOS 现状 | Windows 方案 | 风险 |
|---|---|---|---|
| 主窗 + 玻璃 | NSWindow + 透明 WKWebView + html 透明注入 | WPF 无边框窗 + DWM 丙烯/云母 + WebView2 透明默认背景 | **高**：文章的"丙烯 + 自绘标题栏需原生与 WebView2 协同"就是我们这里 |
| 标题栏拖拽 | 穿透 hitTest + JS rect 表（PITFALLS §4.3） | 同契约重做（WebView2 区域 + `SendMessage` 非客户区） | 中：双端契约要重验 |
| 全局热键 | Carbon `RegisterEventHotKey` | `RegisterHotKey`（Win32） | 低 |
| 托盘 / 菜单栏 | `NSStatusItem` | `NotifyIcon` + 上下文菜单 | 低 |
| 原生通知 | `UNUserNotificationCenter` | Windows toast（未打包应用需注册 AUMID / 开始菜单快捷方式） | **中**：AUMID 与静默分级语义需实测 |
| 悬浮球 | 常驻 `NSPanel` | WPF 无边框 `Topmost` 窗 | 中：点击穿透需 Win32 扩展样式 |
| 听写 | `SFSpeechRecognizer` | WinRT `Windows.Media.SpeechRecognition` | **可延后**（P4，建议不进第一期） |
| 文件 / 目录选择 | `NSOpenPanel` | 通用项对话框（`IFileOpenDialog`） | 低 |
| 打开方式 / 定位 | `NSWorkspace` | `ShellExecuteEx` / `SHOpenFolderAndSelectItems` | 低（上游已有 PowerShell `Invoke-Item` 先例） |
| 保持唤醒 | `ProcessInfo.beginActivity` | `SetThreadExecutionState` | 低 |
| 单实例锁 | 支撑目录 flock | 命名 Mutex | 低 |
| git 摘要 / 动作 | `Process` 调 `git` | 同（依赖用户机器有 `git.exe`） | 低：与 mac 现状同性质 |
| 偏好持久化 | `UserDefaults`（**端口必须记住**） | HKCU 注册表或本地 JSON | 中：端口丢 = SPA localStorage 清零（PITFALLS §4.17） |
| 数据目录 | `~/Library/Application Support/DeepDive` | `%LOCALAPPDATA%\DeepDive`（**不用 Roaming**） | 低 |

### 5.5 浏览器套件（2026-10-10 复核新增——方案此前未覆盖的最大单项）

macOS 壳里**侧栏浏览器是一整套子系统**（`Browser*.swift` + `ChromiumCookieCrypto.swift`，
共 ~3.3k 行，占壳的 11.4k 行约三成）：标签宿主与舞台、`WKWebsiteDataStore` 持久 store、
三家浏览器 cookie 导入、阅读模式、按站隐藏、`WKContentRuleList` 广告拦截、按站权限、
历史/书签、缩略图与 hitTest 让位；另有浏览器控制面 `POST /browser-control`（browser-use
MCP server 的宿主，SPEC-BROWSER-USE §4）。SPA 侧（`frontend/src/sidebar-right/`）是共享的，
但它按 `inShell()` 二值选载体（`browserCarrierKind`，BrowserCarrier.tsx）：壳里给原生槽位
（壳摆第二个 WKWebView 进去），纯浏览器里给 iframe。

Windows 侧的含义：

- **WebView2 换底座是可行的**（同为系统级 Chromium 内核，槽位契约 `native-slot` 原样沿用），
  但 BrowserHost/Tabs/Control 等宿主逻辑要在 C# 逐文件对等重写，量级 **4-5k 行**——
  与"主窗+桥+引擎监督"的剩余部分相当，是全项目最大的单项。
- **cookie 导入在 Windows 形状不同**：Chromium 系 cookie 密钥走 DPAPI（v10/AES-GCM 同构），
  Safari `binarycookies` 无 Windows 对应物（直接不列），Firefox `cookies.sqlite` 明文可照搬。
- **`WKContentRuleList` 没有 WebView2 直接等价物**：拦截要走 `WebResourceRequested` 事件
  自实现过滤（或不做，见 §11 范围决策）。
- 阅读模式/按站隐藏是注入 JS/CSS，平台无关度高，可随套件一起移植。

## 6. 引擎监督：Windows 的三个硬差异

1. **SIGTERM 不跨进程边界**——Windows 上 `child.kill('SIGTERM')` 是 `TerminateProcess`，
   引擎的 JS 处理器不会跑。优雅停必须走**显式消息**，上游 `apps/desktop/src/host-process.ts`
   的 `stop()` 是现成范式：发 shutdown → 关父端管道（释放子进程挂起的管道读）→ 等 10s →
   `taskkill` → 等 5s → 强杀。我们的 `EngineSupervisor`（macOS 侧 518 行）需按此改造，不能照搬 POSIX 信号路径。
2. **进程树**：引擎会拉子进程（子代理 / PTY / 工具）。硬杀用 `taskkill /PID <pid> /T /F`；
   要保证子孙不逃逸需 Job Object（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）。上游用 koffi 建 Job，
   我们在 C# 用 P/Invoke 建一次即可。
3. **入口形状不变但解析不同**：bundled 仍是 `node.exe + lib/bin.js`，子命令与
   `dsh web:` URL 行的解析逻辑照旧（`apps/cli` 的就绪行输出，纯 stdout，无平台依赖）。
   `DSHMINI_DSH_ENTRY` 开发对照面保留。

引擎本身的 Windows 可行性（2026-10-10 对 `engine/` fork 实查，非推测）：

- fork 继承了上游的 win32 专用实现：会话锁走 `packages/session/session-persistence-jsonl/src/win32.ts`
  （`lease.ts` 按 `process.platform === 'win32'` 分支到锁句柄，不走 POSIX flock）；Windows 沙箱
  走 `sandbox-windows-acl`；`.cmd` 解析与 `windowsHide` 在 `subprocess-local`；`pwsh` 工具行替代
  `bash`（组合层 `!!js process.platform` 门）。上游有原生 Windows CI 车道（`windows-build` /
  `windows-native-tests`），fork 同步自上游，这些分支都在。
- 原生依赖 `koffi` / `node-pty` / `sharp` / `@vscode/ripgrep` 均发布 win32-x64 预编译产物，
  **Windows 上不需要编译器**。
- **一个新查明的缺口**：fork 自己的原生 flock addon（`engine/native/system`，
  `@deepseek-ai/node-addon-system`）目前只带 darwin-arm64 / darwin-x64 / linux-arm64 / linux-x64
  平台包，**没有 win32**；其契约是"绑定缺失时 acquire 直接 reject、不做安装期编译"。会话锁
  （最关键消费者）在 win32 走 `win32.ts` 分支不受影响，但 `sandbox-local` / `bash-sandbox` /
  `webworker-runtime` 这些消费者的 Windows 行为（走 ACL 沙箱还是 reject 降级）需在 P0 实测启动
  路径后定——不阻塞立项，阻塞 P0 出口判据。

## 7. 前端改动（唯一真改 SPA 的地方）

1. **壳桥抽象（必做）**：源码里直接摸 `window.webkit.messageHandlers` 的有四处——
   `host.ts`（`deepdive`/`deepdiveHost` 双 handler）、`titlebar.ts`（rect 表）、
   `Composer.tsx` 与 `composer/useComposerAttachments.ts`（`hasShell` 判定），
   另有 `__tests__` 里 5 个文件直接造 webkit 桩。WebView2 的通道是
   `window.chrome.webview.postMessage` + `addEventListener("message")`。
   抽一个平台入口（如 `frontend/src/platform.ts`），其余模块只依赖它。
   **不做的后果**：Windows 上全部桥功能静默降级——正是"开关看着生效、刷新即丢"那类事故
   （WORKING-AGREEMENTS §2）。
2. **桥抽象必须带能力清单，不能只做通道切换**：SPA 的浏览器载体由 `inShell()` 二值判定
   （`browserCarrierKind`），按"在不在壳里"切原生槽位/iframe。Windows 壳 P0-P3 若不含
   浏览器栈，"在壳里但没有浏览器"会让原生槽位后面什么都没有（面板变黑洞）。能力清单
   （browser / dictation / remote / …）由壳在握手时声明，`browserCarrierKind` 等判定点改为
   读能力而不是读"是否在壳里"；mac 端声明全量能力，行为不变。
3. **键位与控制键**：`⌘` → `Ctrl`（`keybinds.ts` 默认键位 + 显示串规范化 + Tooltip 键帽 + 词典）。
4. **平台文案**：`i18n-en.ts` 的 Finder / Dock / Cmd-Tab 等条目需按平台取值。
5. **字体 token**：字体栈（内置 Inter / JetBrains Mono ＋ 系统兜底，含 Windows 的
   Segoe UI Variable / 微软雅黑 / Cascadia Mono 段）的唯一事实源是
   `frontend/packages/design/tokens.json` 的 `font.ui.family` / `font.mono.family`——值不在本文
   复述。改 token 源后必须 `make tokens`（手写数值违规）。
6. **"桌面感"视觉决策已收敛，不再是开放项**：`theme.css` 现在是全局
   `* { cursor: default !important; }`（input/textarea 另行 `cursor: text`），源码里已无
   `cursor: pointer`——桌面惯例形态已经落地，Windows 直接共享同一份 `theme.css`，无需分叉决策。

## 8. 构建与分发：新增一条 Windows 车道

- **运行时闭包必须在 Windows 构建机准备。** 现有链是 bash 侧（`build-engine.sh` →
  `collect-engine-closure.mjs` → `prepare-dsh-runtime.sh` 校验 + `prune-dsh-runtime.sh` 裁剪 →
  `embed-engine.sh` → `smoke-engine-boot.sh`），且 macOS 上的安装只会取到 darwin 的
  `koffi` / `node-pty` / `sharp` / ripgrep 预编译产物。→ 新增 PowerShell 对等脚本
  （`build-engine.ps1`、`prepare-dsh-runtime.ps1`、`embed-engine.ps1`、`smoke-engine-boot.ps1`、
  `package-windows.ps1`）；`collect-engine-closure.mjs` 是纯 Node 脚本，预计可直接复用。
  裁剪与组合闸门（`check-engine-composition.sh`、`--dump-config` 自检、boot 冒烟）逐条保留，
  平台差异只在"拷文件与签名"。
- **node 引脚不变**：`scripts/node-version.txt` 仍为唯一事实源，Windows 取官方 win-x64 zip。
- **架构先只做 win-x64。** 上游打包工具显式断言 x64-only（"Windows supports x64 only"），
  arm64 无 CI 覆盖，且 koffi 的 `__stdcall` 绑定在 ARM64 下无任何测试。arm64 待 x64 稳定后专项立项。
- **fork 的 native addon 需要补 win32 平台包或确认可缺省**（§6 第四条）：若 P0 实测其消费者
  在 Windows 必须 reject-fail，则需在 Windows 构建机补一次 `system.node` 编译（node-addon-system
  的 release 流程自带 prebuild 组装脚本）；若实测全部走 JS/ACL 分支则记录豁免即可。
- **分发形态待定**（MSIX vs NSIS/Inno，上游用 NSIS）+ 代码签名（EV）+ 自动更新通道。
  与 macOS 侧的 Sparkle（`TODO.md §3`）分开定。
- **CI**：新增 `windows-latest` job（前端 job 不变；`dotnet test` 对位现有 XCTest job）。

## 9. 分期（施工计划）

| 期 | 内容 | 出口判据 | 量级 |
|---|---|---|---|
| **P0 可行性冒烟** | C# 壳骨架：无边框主窗 + WebView2 装 SPA + 透明/丙烯；桥最小集（静态托管 + `/api` 反代 + WS 盲中继 + Origin 门 + 固定端口 + token→cookie）；引擎 spawn 与 `dsh web:` 解析 + 显式关机 + Job Object；Windows 闭包轨（`build-engine.ps1` 等）+ native addon 缺口实测 | 在 Windows 上完成一次完整对话（含审批卡、事件流不断）；引擎不在时静态资源仍可托管（PITFALLS §5.6）；关机后不留进程 | ~2k 行 C# + ~300 行 ps1 |
| **P1 SPA 平台化** | §7 全部：`platform.ts` 桥抽象 + 能力清单、⌘→Ctrl、字体 token、平台文案；mac 端切到抽象后全量回归（行为不变） | 同一份 SPA 产物在 WKWebView 与 WebView2 真机各过一遍桥功能清单 | ~500 行，前端专属 |
| **P2 壳能力补齐** | §5 表逐条：托盘 / 全局热键 / 通知（AUMID 实测）/ 悬浮球 / 单实例 / 保持唤醒 / 文件选择 / 打开方式 / 偏好（注册表）；移动远程面与 browser-use 宿主是否进本期见 §11 | 与 mac 端功能对齐清单逐条勾掉（浏览器套件除外） | ~2-3k 行 C# |
| **P3 分发** | 安装器（NSIS/MSIX 定稿）/ EV 签名 / 更新通道 / CI `windows-latest` job（`dotnet test` 对位 XCTest） | 干净 Windows 机器安装即用 | 脚本 + CI |
| **P4 决策项** | 浏览器套件移植（§5.5，WebView2 版 BrowserHost 族 + cookie DPAPI + 拦截替代 + browser-use 控制面）、听写（WinRT）、arm64 | 另立项 | 浏览器套件 ~4-5k 行 C# |

顺序理由：可行性未知全部集中在 P0（WebView2 透明与丙烯、桥保真、关机协议、native addon 缺口），
P0 过了再谈补齐；P1 必须在 P2 之前或同期完成，否则 P2 的能力在 WebView2 里点不动
（SPA 还在摸 `window.webkit`，一切壳功能静默降级）。浏览器套件单独成 P4：它是量级最大的
单项且独立成块，不阻塞主产品的 Windows 可用性。

## 10. 难度清单与已知代价

**难度在哪里（2026-10-10 复核，按险度排序）：**

1. **桥保真**——~1.0k 行 Swift 的桥对等重写（`BridgeServer` 418 + `MiniHTTPServer` 289 +
   `RemoteAccess` 334），难在不是"写出来"而是"契约逐条不漂"：Origin 全等、固定端口持久化、
   token→cookie 注入、WS 盲中继、`/__deepdive_error`、缓存策略，每条都有对应的踩坑记录
   （PITFALLS §4）。缓解：两端共用的 wire 级一致性测试，同一组断言跑两个实现，漂移在 CI
   暴露而不是在用户机器上。
2. **视觉协同**——透明 WebView2 + DWM 丙烯 + 非客户区拖拽 + 原生槽位 hitTest 契约
   （PITFALLS §4.3）都要在 WebView2 上重验，文章点名的"原生与 WebView2 协同"正是这里。
3. **浏览器套件**——方案此前漏掉的最大单项（§5.5，~3.3k 行对等 + cookie DPAPI + 拦截自实现）；
   好在独立成块、可整体延后，不阻塞主产品。
4. **引擎监督三差异**（§6）——已知且有上游范式（显式关机 + Job Object），属"照做即可"但不可省。
5. **构建车道**——bash 链 PowerShell 化 + Windows 构建机 + fork native addon 无 win32 预编译的
   缺口（§8）；机械但必须一条条过闸门，不能裁剪验证步骤。
6. **SPA 平台化**——小而关键（§7，四文件耦合点 + 能力清单设计点），它是 P2 的前置。
7. **分发长尾**——安装器/签名/更新通道是首次涉猎，一次性的建链成本。

**已收敛、不再是难度的：** 引擎 Windows 可行性（上游 CI + fork 内 win32 分支背书）；大多数
Win32 原语替换（热键/托盘/保持唤醒/单实例/文件对话框，机械活）；桌面光标惯例（全局 default
已落地，§7.6）。

**已知代价（文章同款）：** 内存基线抬高——全原生 200–300 MB → 混合栈 350–450 MB
（WebView 120–200 + Node 150–200 + 原生壳 ~40 MB；引擎本身就是 Node，这部分 mac 端已付过，
Windows 新增的是 WebView2 与第二个壳进程）。WebView2 版本碎片化：随机器不同，渲染行为与
API 可用性有差异，需版本探测与降级。两份壳 = 每个 OS 能力写两遍，桥的安全守卫各一份。
原生细节长尾：IME、无障碍、拖放、候选框定位在 WebView 里都要显式处理——排期里留出预算，
不要按"壳写完就完事"估。

## 11. 开工前置

推动 Windows 前需先定稿这三项（现状：均未定稿，本文不擅自替用户决定）：

1. **壳技术栈批准**（铁律 7：引入新技术栈须先问）。推荐 C#/.NET 8 + WPF + WebView2，
   对齐文章与上游官方桌面端的 Windows host 选型。
2. **浏览器套件范围**：Windows 端要不要侧栏浏览器（决定 P4 是否立项、§5.5 那 ~4-5k 行
   是否进入总盘子）；第一期（P0-P3）默认不含，只影响"功能缺口要在产品上明说"。
3. **第一期范围**：P0 冒烟后是否直接补齐到 mac 端功能对齐，还是先只交主窗 + 桥 + 引擎。

排期决策归用户：三项定稿后本文 §9 的 P0 即可开工。
