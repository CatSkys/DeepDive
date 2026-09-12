# DeepDive Windows 客户端 — 方案

> **状态（2026-09-12）：暂缓，不排期——先把 macOS 端做完善，之后再推动 Windows。** 未动代码；
> 开工前需先过 §11 的三项定稿。本文是 Windows 端的决策与施工图，唯一事实源；
> macOS 端 as-built 归 `ARCHITECTURE.md`，路线归 `TODO.md`。
> 依据：Raycast 2.0 技术复盘（`raycast.com/blog/a-technical-deep-dive-into-the-new-raycast`）
> + 本仓现状 + 引擎（vendored `deepseek-harness/`，引脚见 `scripts/dsh-runtime-version.txt`）实查。

---

## 1. 结论

**壳换平台，SPA 与引擎不动。** 新增一个 C#/.NET + WPF + WebView2 的 Windows 原生壳，
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
  但它与我们已建成的壳能力（原生通知/悬浮球/热键/标题栏契约/恢复屏）和打包链全不兼容，
  且 Chromium 基线内存换不来我们需要的东西。文章对 Electron 的排除理由（深集成、系统 WebView）
  在我们这里同样成立。
- **Tauri / WinUI 3 / Flutter / Qt / RN for Desktop**：文章的排除理由（原生控制力不足、
  成熟度不够）逐条成立，不重复论证。
- **复用上游 desktop profile（不开端口，走管道 + `dsh-app://`）**：否决。该 profile 会
  `disabled: [web-startup, webserver, web-runtime, ...]`（`apps/desktop-host/config/desktop.cordis.patch.yml`），
  而我们的桥**必须能在引擎不在时托管 SPA**——凭据冷启动与引擎故障恢复屏正是"引擎没起来"
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
| 听写 | `SFSpeechRecognizer` | WinRT `Windows.Media.SpeechRecognition` | **可延后**（P2+，建议不进第一期） |
| 文件 / 目录选择 | `NSOpenPanel` | 通用项对话框（`IFileOpenDialog`） | 低 |
| 打开方式 / 定位 | `NSWorkspace` | `ShellExecuteEx` / `SHOpenFolderAndSelectItems` | 低（上游已有 PowerShell `Invoke-Item` 先例） |
| 保持唤醒 | `ProcessInfo.beginActivity` | `SetThreadExecutionState` | 低 |
| 单实例锁 | 支撑目录 flock | 命名 Mutex | 低 |
| git 摘要 / 动作 | `Process` 调 `git` | 同（依赖用户机器有 `git.exe`） | 低：与 mac 现状同性质 |
| 偏好持久化 | `UserDefaults`（**端口必须记住**） | HKCU 注册表或本地 JSON | 中：端口丢 = SPA localStorage 清零（PITFALLS §4.17） |
| 数据目录 | `~/Library/Application Support/DeepDive` | `%LOCALAPPDATA%\DeepDive`（**不用 Roaming**） | 低 |

## 6. 引擎监督：Windows 的三个硬差异

1. **SIGTERM 不跨进程边界**——Windows 上 `child.kill('SIGTERM')` 是 `TerminateProcess`，
   引擎的 JS 处理器不会跑。优雅停必须走**显式消息**，上游 `apps/desktop/src/host-process.ts`
   的 `stop()` 是现成范式：发 shutdown → 关父端管道（释放子进程挂起的管道读）→ 等 10s →
   `taskkill` → 等 5s → 强杀。我们的 `EngineSupervisor` 需按此改造，不能照搬 POSIX 信号路径。
2. **进程树**：引擎会拉子进程（子代理 / PTY / 工具）。硬杀用 `taskkill /PID <pid> /T /F`；
   要保证子孙不逃逸需 Job Object（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）。上游用 koffi 建 Job，
   我们在 C# 用 P/Invoke 建一次即可。
3. **入口形状不变但解析不同**：bundled 仍是 `node.exe + lib/bin.js`，子命令与
   `dsh web:` URL 行的解析逻辑照旧（`packages/bundle/web-app/src/index.ts` 的
   `console.log` 输出，纯 stdout，无平台依赖）。`DSHMINI_DSH_ENTRY` 开发对照面保留。

引擎本身的 Windows 可行性已实查，不是推测：上游有原生 Windows CI 车道
（`.github/workflows/ci.yml` 的 `windows-build` / `windows-native-tests`）、
Windows 专用沙箱（`packages/sandbox/sandbox-windows-acl`）、
`.cmd` 解析与 `windowsHide`（`packages/subprocess/subprocess-local/src/index.ts`）、
会话锁的命名信号量分支与 `MoveFileExW` 持久化（`session-persistence-jsonl/src/win32.ts`）、
`pwsh` 工具行替代 `bash`（`packages/bundle/base/cordis.patch.yml` 的 `!!js process.platform` 门）。
原生依赖 `koffi` / `node-pty` / `sharp` / `@vscode/ripgrep` 均发布 win32 预编译产物，
**不需要编译器**。

## 7. 前端改动（唯一真改 SPA 的地方）

1. **壳桥抽象（必做）**：现在各处直接摸 `window.webkit.messageHandlers`（`host.ts`、
   `titlebar.ts`，以及 `Composer` / `Sidebar` / `ProjectMenu` 的 `hasShell` 判定）。
   WebView2 的通道是 `window.chrome.webview.postMessage` + `addEventListener("message")`。
   抽一个平台入口（如 `frontend/src/platform.ts`），其余模块只依赖它。
   **不做的后果**：Windows 上全部桥功能静默降级——正是"开关看着生效、刷新即丢"那类事故
   （WORKING-AGREEMENTS §2）。
2. **键位与控制键**：`⌘` → `Ctrl`（`keybinds.ts` 默认键位 + 显示串规范化 + Tooltip 键帽 + 词典）。
3. **平台文案**：`i18n-en.ts` 的 Finder / Dock / Cmd-Tab 等条目需按平台取值。
4. **字体 token**：`packages/design/tokens.json` 的 `font.ui.family` 是 Apple 栈
   （`-apple-system, "PingFang SC", …`）、`font.mono.family` 是 `SF Mono` 栈——Windows 需
   Segoe UI Variable / 微软雅黑 / Cascadia Mono。改 token 源后必须 `make tokens`（手写数值违规）。
5. **"桌面感"视觉决策（待定稿，见 §11）**：文章明确点出 `cursor: pointer` 是"立刻暴露这是
   网站"的信号，并列出桌面与 Web 的惯例差异。我们 `theme.css` 现有 22 处 `cursor: pointer`。
   跟不跟是一次面向用户的视觉取舍，不由实现方单方面决定。

## 8. 构建与分发：新增一条 Windows 车道

- **运行时闭包必须在 Windows 构建机准备。** 现有 `prepare-dsh-runtime.sh` 是 bash + `lipo` /
  `otool` / `codesign` / `ditto`，不可跨用；且在 macOS 上 `npm install` 只会取到 darwin 的
  `koffi` / `node-pty` / `sharp` / ripgrep 预编译产物。→ 新增 PowerShell 对等脚本
  （`scripts/prepare-dsh-runtime.ps1`、`embed-engine.ps1` 等）。
- **node 引脚不变**：`scripts/node-version.txt` 仍为唯一事实源，Windows 取官方 win-x64 zip。
- **架构先只做 win-x64。** 上游自己的打包工具显式断言 x64-only
  （`scripts/build-exe-for-python-sdk.ts`："Windows supports x64 only"），arm64 无 CI 覆盖，
  且 koffi 的 `__stdcall` 绑定在 ARM64 下无任何测试。arm64 待 x64 稳定后专项立项。
- **分发形态待定**（MSIX vs NSIS/Inno，上游用 NSIS）+ 代码签名（EV）+ 自动更新通道。
  与 macOS 侧的 Sparkle（`TODO.md §3`）分开定。
- **CI**：新增 `windows-latest` job（前端 job 不变；`dotnet test` 对位现有 XCTest job）。

## 9. 分期

| 期 | 内容 | 出口判据 |
|---|---|---|
| **P0 可行性冒烟** | WebView2 加载 SPA + C# 桥反代/中继 + 引擎 spawn 与 URL 解析 + 显式关机 + 主窗 | 在 Windows 上完成一次完整对话（含审批卡、事件流不断） |
| **P1 壳能力补齐** | 托盘 / 全局热键 / 通知 / 悬浮球 / 单实例 / 保持唤醒 / 文件选择 / 打开方式 / 偏好 | 与 mac 端功能对齐清单逐条勾掉 |
| **P2 前端平台化** | §7 的 1–4（桥抽象、键位、文案、字体 token）+ §11 视觉决策落地 | 两端同一份 SPA 产物，桥功能在 WebView2 真机可用 |
| **P3 分发** | 安装器 / 签名 / 更新 / CI 车道 | 干净 Windows 机器安装即用 |
| **P4 可选** | 听写、arm64 | 另立项 |

顺序理由：可行性未知全部集中在 P0（WebView2 透明与丙烯 + §6 的三个差异），P0 过了再谈补齐；
P2 的桥抽象必须在 P1 之前或同期完成，否则 P1 的能力在 WebView2 里点不动。

## 10. 风险与已知代价

- **内存基线抬高**。文章的实测区间可直接当作我们的预期：同类场景全原生 200–300 MB →
  混合栈 350–450 MB；分解为 WebView 120–200 MB + Node 150–200 MB + 原生壳 ~40 MB
  （空 WebView 基线 ~50 MB、裸 Node ~12 MB）。我们的引擎本身就是 Node 进程，
  这部分 mac 端已经付过；Windows 侧新增的是 WebView2 与第二个壳进程。
- **WebView2 版本碎片化**：系统 WebView 版本随机器不同，渲染行为与 API 可用性有差异
  （文章点名的 Windows 多样性风险）。需要版本探测与降级，而不是假设某个版本。
- **两份壳 = 每个 OS 能力要写两遍**，桥的 Origin 门 / 路径遍历守卫 / cookie 注入各一份。
  缓解：把桥的行为写成**两端共用的 wire 级一致性测试**（同一组断言跑两个实现），
  让漂移在 CI 暴露而不是在用户机器上。
- **原生细节长尾**：IME、无障碍、拖放、输入法候选框定位在 WebView 里都要显式处理
  （文章同款警告）。请在排期里留出这笔预算，不要按"壳写完就完事"估。

## 11. 开工前置（暂缓期间不改）

推动 Windows 前需先定稿这三项：

1. **壳技术栈批准**（铁律 7：引入新技术栈须先问）。推荐 C#/.NET 8 + WPF + WebView2，
   对齐文章与上游官方桌面端的 Windows host 选型。
2. **视觉决策**：`cursor: pointer`（22 处）与 hover 高亮等桌面惯例，跟不跟；
   macOS 端是否同步改，还是只 Windows 分叉。
3. **第一期范围**：P0 冒烟后是否直接补齐到 mac 端功能对齐，还是先只交主窗 + 桥 + 引擎。

排期：**暂缓，排在 macOS 端完善之后。**
