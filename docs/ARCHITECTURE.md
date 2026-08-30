# DSHmini 客户端架构设计

> 状态：v0.3（已确认，2026-08-30）——外壳=自研混合（Swift+AppKit+WKWebView / Windows: C#+WPF+WebView2）；前端=自建极简 React（P0 先用官方 UI 验证外壳）；引擎=DSH 子进程。
> **v0.3 阶段口径修订**：P1 = **套壳 v1**——客户端功能面 = DSH 官方 web UI 全量能力，客户端零新功能（外壳只做窗口/热键/托盘/引擎监督/主题覆盖）；自建极简前端与语义层蓝图（`SPEC-SEMANTICS.md`）后置为 P2+。
> 产品语义层见 [`SPEC-SEMANTICS.md`](SPEC-SEMANTICS.md)（**P2+ 蓝图**；P1 不实现其中的客户端自有功能）。
> 目标平台：macOS 优先，Windows 第二期
> 参考基准：[Raycast v2 技术深潜](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast) + GitHub 上成熟的 DeepSeek Harness（dsh）客户端

---

## 1. 目标与非目标

### 目标

1. **极简、类 Raycast 的 macOS 客户端**：全局快捷键唤起输入面板（Launcher），会话窗口、面板、弹层都遵循桌面平台惯例；没有任何"网页感"。
2. **原生 + Web 混合**：原生外壳承担所有 OS 级能力（窗口、热键、托盘、通知、弹层、文件对话框、密钥链），Web 前端承担 UI；Windows 上只替换外壳，前端与引擎零改动。
3. **复用 DSH 引擎，不重造轮子**：agent loop、会话日志、工具管线、模型适配器、持久化全部来自 DeepSeek Harness 本体（Node + Cordis 插件树），客户端只是"驾驶舱"。
4. **插件优先**：客户端的一切定制（主题、密钥链、通知、面板行为）尽量以 dsh 插件（Cordis 行）形态存在，与官方架构一致（参考 pilot-harness 的经验）。

### 非目标（第一二期）

- 不做文件索引器（Raycast 用 Rust 做 Spotlight 替代；DSH 已有 workspace/fs 工具，quick-open 后续按需再评估）。
- 不做云端同步、多端远程（社区已有 [deepseek-harness-remote](https://github.com/liguobao/deepseek-harness-remote) 等方案，日后可接）。
- 不改 DSH 引擎的 agent loop / session log / 工具管线（只通过插件与 patch 层扩展）。
- 不要求 OS 预装 Node.js（引擎运行时随应用分发）。

---

## 2. 背景：DSH 本身是什么（决定了我们的集成面）

DeepSeek Harness 是 **一切皆插件的 Cordis 应用**：一个运行中的 `dsh` 就是一棵编译时由 profile + bundle + `cordis.patch.yml` 按序叠出的插件树（[architecture.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)）。

关键事实（来自官方文档）：

| 事实 | 含义 |
|---|---|
| 配置文件：`web` / `headless` / `sdk` / `sdk-minimal` / `acp` | `dsh web` = 浏览器 GUI；`dsh --profile sdk` = JSON-RPC over stdio 的 SDK；`acp` = 自动化协议 |
| `dsh web` 在 `127.0.0.1` 起一个 `node:http` 服务（[web-server.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-server.md)） | 引擎自带 HTTP 载体，含 `/api` Host 桥、SSE、SPA 静态托管 |
| API Gateway：Typert 生成的 Remote 方法 + WebSocket 逻辑流（`/api/remote.mux`） | **引擎↔前端通信已经是"一处声明、类型化生成"的**——我们直接复用，不必自建 RPC |
| 浏览器信任模型：进程级随机 token → `?token=` 根交换 → 绑定 hostname+port 的签名 HttpOnly cookie；Host/Origin 检查（[connection README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/connection/README.md)） | 安全模型现成且可靠，客户端外壳只需把 WebView 指向带 token 的根 URL |
| Web 前端 = 浏览器侧 Cordis 应用，由 `window.__DSH_BOOT__` 注入图加载插件 bundle；UI 通过 Slots 组合（[web-client.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-client.md)） | 官方扩展路径：任何前端定制都应以 `dsh.client` 客户端插件形态挂进 web 组合 —— **自建 UI 与"用官方 UI"是同一套机制的两端** |
| "Add UI or editor integration：drive `ctx.agents` and render from `session/event`" | 官方对第三方 UI 的定位就是"渲染 session/event 流" |
| 官方文档明确提到："Electron loads the built files over `file://` and sends fetch requests through an IPC bridge instead of this server" | 引擎的前端已经预置了 Electron 宿主能力（这也是 pilot-harness 选 Electron 的原因之一） |

**结论**：DSH 已经替我们完成了 Raycast 架构中的"Node 后端"（引擎）与"类型化 IPC"（Typert API Gateway）两件事。我们负责的是：**原生外壳 + (可选)自建极简前端 + 壳与 WebView 之间的桥**。这是整个架构能保持小规模的根因。

---

## 3. 参考：GitHub 上流行的 dsh 客户端

按 star 与相关性梳理（数据截至调研时）：

| 项目 | Star | 技术 | 做法 | 启发性 |
|---|---|---|---|---|
| [desktop-cc-gui](https://github.com/zhukunpenglinyutong/desktop-cc-gui) | ~4.1k | Tauri 2 | 多引擎（Claude Code/Codex/Gemini/OpenCode/DSH）统一 GUI，可接管本地 Harness host | 多引擎抽象；DSH 以"宿主进程"形态被托管 |
| [dsh_desktop](https://github.com/myYangyunfan/dsh_desktop) | ~600 | **Tauri 2**（v0.5 从 Electron 迁移） | 内嵌 Node 运行时 + 全套官方插件，双击即 `dsh web`；"守护瀑布"自愈（坏插件修复/坏配置重建/崩溃原地重启）；托盘、桌面宠物、侧边会话浮窗、余额组件、双源自动更新 | ① 引擎作为**被监督的子进程**管理的成熟模式；② 无 Node 依赖的分发方式；③ 更新与自愈工程 |
| [pilot-harness](https://github.com/op7418/pilot-harness) | ~260 | **Electron** | 起 `dsh` CLI（OS 分配端口）→ 等 `dsh web:` URL → 沙箱 BrowserWindow 加载；`DSH_HOME` 私有化到 userData；桌面主题以"样式表 + 设计 token"插件形式实现，**不改引擎**；原生目录选择走 preload IPC；插件优先（主题=DSH 插件行） | ① 与我们的"外壳监督引擎"最接近；② 证明"桌面定制 = dsh 插件 + patch 层"是官方生态认可路径；③ macOS 安装包签名/公证的坑位清单 |
| [deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) | ~240 | 桌面壳 | 官方 Web UI 打包为 macOS/Windows 托管应用 + 系统托盘 | 印证"包官方 Web UI"是最省力路线 |
| [dsh-starter](https://github.com/sryimnoob123/dsh-starter) | ~65 | Electron | 官方 Web GUI 的最小 Electron 客户端 | 最小可行参考 |

**观察**：
- 两条主流路线都是"**包 `dsh web`**"（Electron 或 Tauri 2 + 系统 WebView），无人做"自定义混合外壳 + 自有极简前端"。
- 理由充分：省力、引擎前端本来就支持 Electron/IPC、官方 UI 已覆盖会话/轨迹/工具/设置全部功能。
- **我们的差异化机会**：Raycast 式交互（全局面板、compact↔expand、原生弹层）与"极简"审美，正是包办官方 UI 给不了的——官方 Web UI 是功能密度很高的产品 UI，而用户要的是"像 Raycast 一样克制"。

---

## 4. Raycast v2 的启示（映射到我们的决策）

Raycast 在 Electron / Tauri / 自研混合里选了**自研混合**，理由（原文要点）：
1. 需要深度 OS 集成：全局热键、剪贴板管理、无障碍 API、窗口管理、**面板浮于其他应用之上且不抢焦点**、内层面板半透明——Electron 的 web/native 边界痛苦，且不愿在 macOS 上捆绑 Chromium（可用系统 WebKit）。
2. Tauri：原生侧控制力不足，当时太年轻，不敢押注。
3. 代价自负：IPC（WebView↔shell↔Node）要自己建、调试、按平台优化，没有社区帮你。

四条分层（Host app / Web frontend / Node backend / Rust core）中，对我们的映射：

| Raycast | DSHmini | 说明 |
|---|---|---|
| Host app（Swift+AppKit / C#+.NET8+WPF） | **同样的原生外壳**（Swift+AppKit；Windows 用 C#/.NET 8 + WPF + WebView2） | 我们同样需要"不抢焦点的面板"，这是 AppKit 的强项 |
| Web frontend（一套 React+TS，按窗口多入口） | **一套 React+TS 前端，Launcher / Chat / Settings 多入口** | 详见 §6 UI 策略 |
| Node backend（长驻业务进程） | **DSH 引擎子进程**（`dsh --profile dshmini`） | 现成，我们只做监督 |
| Rust core（文件索引、与 iOS 共享数据层） | **暂不需要**（quick-open 后续评估） | 我们不写索引器 |
| 接口一处声明、四端生成类型化客户端 | **Typert 管引擎↔前端**（已有）；**bridge schema 管 WebView↔外壳**（TS 声明 → Swift 代码生成） | 两套桥都走"一处声明、生成客户端"纪律 |

**"原生应用用 Web 做 UI"的体验准则**（直接采纳为验收标准）：
- 交互控件不用 pointer 光标、无 hover 高亮（macOS 惯例）；
- 设置页在**独立原生窗口**，不是 modal/侧栏；
- Popover 与 tooltip 用**原生窗口**实现（可越过窗口边缘），不是 WebView 内 DOM；
- 无任何闪烁/白帧；窗口出现前用 `_doAfterNextPresentationUpdate` 等 WebView 画完；
- 面板半透明（NSVisualEffectView + 透明 WKWebView），扩展到全尺寸图形时内容已渲染（WKWebView 始终按展开尺寸摆放，用 `alphaValue=0` + `windowOcclusionDetectionEnabled=false` 反节流）。

**内存心智**（公开数字，直接引用）：空 WebView 基线 ~50MB、裸 Node ~12MB；Raycast v2 稳态 350-450MB（WebView 120-200 + Node 150-200 + 壳 40）。我们预期同量级（引擎 Node 因插件更多可能偏上），**接受并持续优化**，但不在架构上为了省内存牺牲架构清晰度。

---

## 5. 推荐架构

### 5.1 总览

```
┌────────────────────────────────────────────────────────────────────┐
│  Native Shell（每平台一个）                                          │
│  macOS: Swift + AppKit / Cocoa (Xcode 工程)                          │
│  Windows(Phase 3): C# + .NET 8 + WPF + WebView2                     │
│                                                                      │
│  · 窗口：Launcher 面板(NSPanel, nonactivating) / 会话窗口 / 设置窗口   │
│  · 全局热键 · 状态栏(menu bar) · 通知 · Dock/无 Dock 策略             │
│  · 原生 Popover/Tooltip（越过窗口边界、独立原生窗口）                  │
│  · 半透明面板 + vibrancy；窗口显示/隐藏/扩展的 WebKit 反节流技巧       │
│  · 引擎监督：spawn / 健康探活 / 崩溃重启(指数退避) / 恢复界面          │
│  · 系统能力：文件对话框、Keychain、截图/附件、打开 URL、供电/休眠      │
│  └───────────── WKWebView / WebView2（系统 WebView）─────────────┐   │
│                                                                   │   │
│  Web Frontend（一套 React + TypeScript，多窗口入口，跨平台一致）     │   │
│  · app-launcher  全局面板：会话搜索/新建/继续、工作区切换、命令        │  │
│  · app-chat      极简会话窗口：对话、工具卡片、轨迹                  │  │
│  · app-settings  设置窗口                                            │  │
│  · @dshmini/design  设计 token（light/dark，原生质感，无 web 感）     │  │
│  · @dshmini/bridge  JSBridge 客户端（原生弹层/对话框/快捷键/通知封装） │  │
│   │                                                               │  │
│   │ ① DSH API Gateway（现成）：HTTP POST /api + WS /api/remote.mux    │  │
│   │    Typert 生成类型、session 事件流、$events generation 语义        │  │
│   │ ② cookie 信任链：?token= → 签名 cookie → 干净 URL（现成安全模型）  │  │
│   ▼                                                               │  │
│  DSH Engine（Node 子进程，最重的一层，90% 不改）                      │  │
│  · dsh --profile dshmini（= web 模板 + 客户端 bundle/patch 层）      │  │
│  · Cordis 插件树：agent loop / session log / tools / llm / 审批 /     │  │
│    sandbox / persistence / 工作区 / 事件流                           │  │
│  · 可插客户端插件：dshmini-keychain · dshmini-notify · dshmini-theme  │  │
└────────────────────────────────────────────────────────────────────┘
```

### 5.2 组件职责

| 层 | 职责 | 不负责 |
|---|---|---|
| **外壳** | 窗口/热键/托盘/通知/原生弹层/文件对话框/Keychain 存取/引擎生命周期/恢复界面/自动更新/签名公证 | 业务状态（会话、工具、模型）——一切业务状态都在引擎 |
| **前端** | 渲染与交互；把"用户动作"路由为 Remote 调用或引擎注入；极简视觉语言 | 权威状态、持久化、流的生产；Presentation 组件绝不接触 Cordis `ctx`（沿用 DSH 分层纪律） |
| **引擎** | 全部业务逻辑 + `/api` 网关 + 事件流 + 持久化 | 无 UI 概念（载体的 HTTP 服务不为前端外的任何东西设计） |

### 5.3 通信矩阵

| 边 | 协议 | 设计要点 |
|---|---|---|
| 引擎 ↔ 前端 | 现成 `/api`（POST unary）+ `/api/remote.mux`（WS 逻辑流）+ 精确 Fetch 路由 | 完全复用 DSH 的 Typert 类型化 Remote + generation/reconnect 语义；前端拿到 `ready` 帧（含 Host home）后才开始 baseline 读取 |
| 前端 ↔ 外壳 | `WKScriptMessageHandler` / WebView2 `postMessage`，JSON schema 单一声明 | schema 用 TS+JSDoc 写一份，**生成** Swift 协议与 TS 客户端（对齐 Raycast"接口一处声明、生成所有端类型化客户端"）；只暴露白名单能力：`native.dialog` `native.popover` `native.tooltip` `native.hotkey.register` `native.notification` `native.keychain.get/set` `native.app.restart` |
| 外壳 ↔ 引擎 | 仅生命周期：stdio（启动日志、`dsh web:` URL 行）+ 进程信号 | 外壳只关心 UP/BOOT_FAILED/EXITED 三态与 URL；业务数据一概不经过外壳，避免双层胶水 |
| 引擎 ↔ 安全 | `?token=` 根交换 → HttpOnly SameSite=Strict cookie，Host/Origin 校验 | 外壳以 `dsh web:` 打印的登录 URL 启动 WebView，安全模型零改动 |

### 5.4 引擎管理：profile `dshmini`

- **Profile**：`$DSH_HOME/profiles/dshmini`，模板继承自带 `web`（`dsh.profile.bundles` 顺序 + 用户 `cordis.patch.yml`），相当于"web + 客户端专属插件/补丁"的独立命名组合。引擎演进时前端只依赖公开 Slots 与 Remote 面。
- **DSH_HOME**：`~/Library/Application Support/DSHmini/harness`（macOS）——与应用数据同域，独立于用户其他 dsh 安装（参考 pilot-harness 的 userData 私有化）。
- **运行时**：随应用分发独立 Node LTS 二进制 + dsh 依赖闭包（参考 dsh_desktop 的"零依赖"与 pilot-harness 的"依赖闭包收集"），启动时禁止复用系统 Node，保证版本钉死。
- **监督**：外壳是唯一父进程；崩溃指数退避重启；启动失败出"恢复界面"（含诊断尾巴复制）；引擎升级随应用整体发布（版本对齐，无独立更新链——与 dsh_desktop 同策略）。

### 5.5 安全

- 复用引擎既有浏览器信任模型（§5.3）；不开放 `--host 0.0.0.0`。
- WebView 保持 context isolation、禁 Node 注入；bridge 面最小化。
- **Keychain 凭证提供器插件**（`ctx.credentials` 的 provider 为 file-backed 时改为登录密钥链；此为 pilot-harness 明示的已知缺口，我们一期就做）。

---

## 6. UI 策略（本期最关键的产品决策）

两个选项：

| | A. 重用心 web UI（换皮） | B. 自建极简前端（推荐） |
|---|---|---|
| 做法 | 加载官方 `dsh web` 页面，用主题插件改 token/几何（pilot-harness 路线） | 自建 React 前端，以 `dsh.client` 客户端插件 + Slots 挂进组合；复用 DSH 的 client models / conversation / session-controller 客户端包，**只换 presentation 与设计 token** |
| 速度 | 快（2-4 周可交付） | 慢（6-10 周第一版） |
| 极简/质感 | 受限：官方 UI 功能密度高，换皮推不动信息架构 | 完全可控：真正的"像 Raycast" |
| 风险 | 上游 DOM/token 变动需持续跟进 | 需要先验证 Slots 可替换性（Phase 0 spike） |
| 引擎改动 | 无 | 无（两者都走同一挂载机制，只是替换的面大小不同） |

**推荐 B，但以 A 起步守底**：
- Phase 0 先证明"外壳技术"（面板窗口、反节流、热键、信任链）——用 A 的 stock UI 即可验证，避免自建前端与外壳耦合地同时冒险；
- 随后按 `renderSlot` / conversation 包的官方扩展路径逐步把 Launcher、Chat 替换为自有呈现（DSH 的浏览器客户端包、会话模型全部可复用，我们写的是"外壳 + 呈现 + 布局"，不是"重写会话模型"）；
- 若 B 在某处被 slot 契约卡死，回退到 A + 深度主题化（pilot-harness 已证明可行），引擎与外壳都不变。

> 注：自建前端必须挂在与引擎同源的路径下（Host/Origin 信任要求 Origin==Host）：以客户端插件形式进 web 组合，或注册自己的静态前缀路由——切勿起另一个源。

---

## 7. 窗口模型（类 Raycast 的交互骨架）

| 窗口 | 实现 | 行为 |
|---|---|---|
| **Launcher 面板** | `NSPanel`：`nonactivatingPanel` + `.accessory` + 透明 WebView + vibrancy | 全局热键（默认 `⌥Space`）唤起；不让原应用失去焦点则用 nonactivating；**compact↔expand**：compact 只留输入框+结果列表，expand 到全尺寸会话；`WKWebView` 始终按展开尺寸放置避免留白帧 |
| **会话窗口** | 标准 `NSWindow`（可记忆 frame） | 一窗一会话；会话可"浮在桌面"（辅助隐藏）；多窗负责多会话并排 |
| **设置窗口** | 独立原生窗口（不是 modal） | Raycast 准则 | 
| **Popover/Tooltip** | 独立原生窗口 | 越界渲染：工具结果预览、diff、文件差异、子代理卡片 |
| **菜单栏** | `NSStatusItem` | 引擎状态、最近会话、启动/停止、打开主窗 |

**前端多窗口入口**：一套 React 代码库，`vite` 多 entry（launcher / chat / settings），按窗口加载对应 bundle（与 Raycast"每个窗口单独入口"一致）。

---

## 8. 前端设计系统（极简准则）

- 设计 token 单一来源（`@dshmini/design`）：Typography（system font / SF Mono 等宽）、间距 4pt 网格、圆角与阴影仿原生、**明/暗两套完整 token**（macOS 外观跟随 + 手动覆盖）。
- 明确禁止：任何 `cursor:pointer`、hover 高亮、网页式按钮、浏览器默认滚动条样式、页面级刷新闪烁。
- 组件库只含拉杆级：输入框、列表行、键盘提示（⌘K）、分段控件、状态点——全部参考 macOS/ Raycast 语义，而非 web 语义。
- 动画：仅用系统允许的 200ms 内隐式缓动；面板显隐走原生窗口动画。
- 字体预热（emoji/等宽字体启动时预热，避免首次渲染 fallback 卡顿——Raycast 踩过的坑）。

---

## 9. 仓库布局（monorepo）

```
DSHmini/
├─ apps/
│  ├─ macos/                  # Swift + AppKit 外壳（Xcode 工程；swift package 组织）
│  └─ windows/                # (Phase 3) C#/.NET 8 + WPF + WebView2
├─ frontend/
│  ├─ packages/
│  │  ├─ design/              # token + 组件（极简 Design System）
│  │  ├─ bridge/              # JSBridge 客户端 + schema 声明（唯一事实源）
│  │  ├─ ui-launcher/  ui-chat/  ui-settings/
│  │  └─ web/                 # 多入口打包（vite），产出 shell 与插件 bundle
│  └─ apps/                   # 各窗口 entry
├─ engine/
│  ├─ profile-dshmini/        # dshmini profile + patch 层（客户端的 dsh 插件声明）
│  ├─ plugins/                # dshmini-keychain / dshmini-notify / dshmini-theme
│  └─ runtime/                # 分发脚本：Node 二进制 + dsh 依赖闭包收集
├─ bridge/
│  └─ schema/                 # 桥 schema（TS 单文件）→ codegen (Swift/TS)
├─ scripts/                   # 打包/签名/公证/CI
└─ docs/                      # ADR、架构、评审
```

---

## 10. 分阶段路线图

| 阶段 | 内容 | 验收标准 | 预估 |
|---|---|---|---|
| **P0 技术验证** | Swift 外壳 + WKWebView 加载 stock `dsh web`：面板窗（vibrancy/不抢焦点）、全局热键、token 信任链、引擎 spawn/重启、反节流技巧清单落实 | 面板显示/隐藏无闪烁、扩展无空白帧、杀死引擎后自动恢复且会话不丢 | 3-5 天 |
| **P1 骨架 + Launcher MVP** | 引擎监督与恢复界面；`dshmini` profile；Keychain 凭证插件；设计 token 系统；Launcher 面板（会话搜索/新建/继续、工作区切换、命令）；开发签名打包 | 可日常使用：热键唤起、输入即新会话、会话历史可搜、崩溃自愈 | 2-3 周 |
| **P2 会话窗口 + 发布** | 极简会话视图（对话/工具卡片/轨迹——复用 DSH conversation 包与 client models）；原生弹层（工具结果/diff/子代理）；菜单栏；通知；会话管理（归档/恢复/删除）；设置窗口；心跳与恢复；**Developer ID 签名 + 公证** + Sparkle 自动更新 | 正式 DMG 发布；长时间运行无泄漏；重负载下 UI 仍 60fps | 4-6 周 |
| **P3 Windows** | C#/.NET 8 + WPF + WebView2 外壳；acrylic 与自定义标题栏；每窗口独立 WebView2 环境；防焦点丢失节流；winget/Squirrel.Windows 更新；双平台 CI | Windows 通过全部 P1/P2 功能测试（前端零改动） | 4-6 周 |

---

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| 自建前端工作量大（最大风险） | 只换 presentation：复用 DSH 浏览器客户端包（client models / conversation / slots）；P0 用 stock UI 先行验证；slot 契约被卡则降级 A 方案（主题化），外壳与引擎不受影响 |
| DSH 上游升级破坏前端契约 | 钉版随应用分发；CI 每天跑上游 head 冒烟；升级前跑前端 e2e 快照对比 |
| WebKit 行为差异（版本、节流） | 以 §4 技巧清单为验收项；macOS 独占时影响面可控；Windows 侧另做 WebView2 专项 |
| 引擎崩溃/坏插件导致不可用 | dsh_desktop 式"守护瀑布"：坏插件修复、坏配置重建、内核重启（P1 实现）；
双保险：外壳级恢复界面（P0 即做最小版） |
| 分发体积（Node + dsh 闭包） | 参考 pilot-harness：打包时按依赖闭包收集、macOS 用原生 `codesign` 遍历签名（资源太多 JS 签名器不行）；只装所需 profile 的插件 |
| 内存基线偏高（WebView+Node） | 接受（与 Raycast v2 同量级）；跟踪 `phys_footprint`；面板隐藏时暂停前端定时器、引擎空闲降频 |

---

## 12. 已确认的技术选型

| 项 | 选择 | 依据 |
|---|---|---|
| 引擎 | 复用 DeepSeek Harness（`dsh --profile dshmini`） | 官方 profile 机制；插件优先原则 |
| 引擎↔前端 RPC | 官方 API Gateway（Typert） | 已类型化、已有 generation/reconnect 语义 |
| 前端 | React + TypeScript（多入口） | 与 DSH 浏览器客户端同栈，可复用客户端包 |
| macOS 外壳 | Swift + AppKit（Xcode） | 面板/热键/弹层/透明度的控制力（Raycast 同款理由） |
| Windows 外壳 | C#/.NET 8 + WPF + WebView2 | Raycast 同款路径；.NET 人才面广 |
| 桥 | 单一声明 → 生成 Swift / TS | 对齐 Raycast"类型化客户端生成"纪律 |
| 更新 | Sparkle（macOS）/ Squirrel.Windows（Win） | 原生、成熟 |
| 凭证 | Keychain provider 插件（一期） | pilot-harness 明示的缺口，直接补齐 |
| 安全模型 | 沿用引擎浏览器信任链 | 不改引擎安全面 |

## 13. 参考资料

- [Raycast: A technical deep dive into the new Raycast](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast)
- [DeepSeek Harness 架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) / [web 客户端](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-client.md) / [client-modules](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.md) / [web-server](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-server.md) / [connection](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/connection/README.md)
- 客户端竞品：[pilot-harness](https://github.com/op7418/pilot-harness)（Electron + 主题插件）、[dsh_desktop](https://github.com/myYangyunfan/dsh_desktop)（Tauri 2 + 守护瀑布）、[desktop-cc-gui](https://github.com/zhukunpenglinyutong/desktop-cc-gui)（Tauri 多引擎）、[deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop)、[dsh-starter](https://github.com/sryimnoob123/dsh-starter)
