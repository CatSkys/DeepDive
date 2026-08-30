# P1 实现计划（套壳 v1 · 待确认）

> 上游：`ARCHITECTURE.md`（v0.3 阶段口径）、`SPEC-SEMANTICS.md`（P2+ 蓝图，P1 **不实现**其中客户端自有功能）、`UI-SPEC.md`（v1 仅外壳界面 + 主题覆盖最小集）。
> 本计划待用户确认后开工。

## 1. 目标与非目标

**目标**：一个可日常使用的 DSH macOS 客户端（套壳）——
- 客户端功能面 = **DSH 官方 web UI 全量能力**（会话/工作区/工具/审批/问答/模型设置/轨迹/子代理/计划模式……都在，无删减）。
- 客户端只负责：原生窗口与面板、全局热键、菜单栏驻留、引擎监督（起/停/自愈）、黑白玻璃主题覆盖、恢复屏。
- **零新功能**：不加任何引擎没有的产品能力（Memory 卡/⌘K 浮层/置顶/时间分组/通知增强/原生审批弹窗……全部属 P2 蓝图）。

**非目标（P1 明确不做）**：自建极简前端、原生审批弹窗、Memory/上下文卡、任务置顶、⌘K 动作浮层、聚合通知、Keychain 凭证插件、自动更新（Sparkle）、公证分发、Windows 外壳、bundled Node 运行时（P1 末视打包情况决定，v1.0 先依赖系统 dsh）。

## 2. 交付物与范围

```
DSHmini/
├─ apps/macos/                # Swift + AppKit 外壳（XcodeGen project.yml）
│  └─ Sources/DSHminiApp/
│     ├─ AppDelegate.swift         # 应用生命周期、状态项
│     ├─ EngineSupervisor.swift    # dsh 子进程：spawn/URL 解析/自愈重启/诊断尾巴
│     ├─ MainWindowController.swift# 玻璃主窗 + 透明 WKWebView + 显隐防闪烁
│     ├─ WebViewThemeInjector.swift# 黑白覆盖 CSS（注入，不侵入引擎）
│     ├─ HotKeyManager.swift       # Carbon 全局热键 ⌥Space（可配置）
│     ├─ StatusItem.swift          # 菜单栏：状态点/显示隐藏/重启引擎/退出
│     └─ RecoveryView.swift        # 引擎启动失败恢复屏（诊断复制）
├─ frontend/packages/design/  # tokens.json → gen-tokens.mjs → tokens.css + Tokens.swift
├─ engine/                    # 主题覆盖 CSS 源、引擎观测脚本（dev）、profile 备注
├─ scripts/                   # package-macos.sh（dev 签名 DMG）、build.sh
└─ docs/                      # 本文档 + 既有规格
```

**外壳行为（v1 版）**：
- **一个主窗口**（启动即建，隐藏态常驻）：加载 `dsh web`（透明 WebView + `NSVisualEffectView` 玻璃衬底；`windowOcclusionDetectionEnabled=false`；显影前等渲染完成——按 UI-SPEC §4 防闪烁验收）。
- **⌥Space** 全局热键：显示/聚焦主窗口（其它应用前台也可用）。
- **菜单栏常驻**（LSUIElement、无 Dock）：状态点（O=运行 / ◌=重启中 / ! = 异常）+ 菜单[显示主窗口 · 重启引擎 · 引擎启动时打开 · 退出]。
- **引擎监督**：`DSH_HOME=~/Library/Application Support/DSHmini/harness`（自动初始化）；`dsh --profile web --no-open --port 0`；stdout 解析 `dsh web:` 行；崩溃指数退避重启（1s→30s 封顶）；连续失败 ≥3 次 → 恢复屏（含诊断尾巴复制按钮）；引擎退出时随应用退出。
- **工作区根**：v1 壳提供「启动工作区目录」选择（引擎 cwd=该目录，对应 sandbox 根；见已知限制#2）。
- **主题覆盖**：注入 CSS（黑白 token、圆角、去 hover/装饰、玻璃衬底）——只调视觉，不动官方 UI 信息架构；切换开关在菜单栏（默认开）。
- **配置**：`~/Library/Application Support/DSHmini/config.json`（热键、主题开关、启动工作区）。

## 3. 里程碑与验收

| 里程碑 | 内容 | 验收（可执行） |
|---|---|---|
| **M0 脚手架**（~1d） | repo 初始化、XcodeGen 工程、design/tokens codegen、最小玻璃窗口可编译 | `make dev` 弹出一个空白玻璃窗口（无白帧） |
| **M1 引擎 + 窗口**（~3d） | EngineSupervisor + 主窗加载官方 UI + 热键 | 启动后 ⌥Space 可唤；官方 UI 全功能可达（新建会话/选工作区/工具执行/审批/模型设置/轨迹）；`kill -9 dsh` 后 ≤30s 自动恢复就绪、会话历史仍在 |
| **M2 玻璃与主题**（~1-2d） | vibrancy、透明 WebView、黑白覆盖 v0.1、菜单栏、恢复屏 | 面板显隐无闪烁/白帧；主题覆盖后近单色玻璃观感；恢复屏可复制诊断 |
| **M3 打包**（~1d） | dev 签名 DMG + README | `open DSHmini-0.1.0.dmg` 安装可跑；不依赖 Xcode |

## 4. 已知限制（v1 明示，不隐藏）

1. **官方 UI 信息架构原样保留**——极简布局（参考图式）属 P2 自建前端工作。
2. **工作区与 sandbox 根**：引擎 `sandbox-policy.workspaceRoot = 进程 cwd`；官方 UI 的 workspace 选择器管理注册表但不改进程 cwd——v1 用「启动工作区」设置对齐；多工作区并行切换的引擎级处理列入 P2。
3. **通知**：v1 依赖官方 UI 自身提示；系统级通知/徽标属 P2（需要读引擎事件流 = 客户端数据面，v1 不建）。
4. **凭证**：v1 沿用官方 UI 的 key 管理（file-backed credential）；Keychain 插件 P2。
5. **引擎版本**：v1 使用系统 `dsh`；bundled runtime 与版本钉死 P1 末评估。

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 官方 UI 在透明 WebView 中不透明背景导致玻璃失效 | 注入 CSS 强制 body 透明；若官方样式依赖不透明底 → 回退方案：WebView 不透明+近黑底（视觉仍黑白，丢玻璃透感，不阻塞） |
| WKWebView 节流导致面板显隐卡顿 | 按 Raycast 技巧清单逐项落实（M2 专门验收：显 20 次无滞留帧） |
| `dsh web:` URL 解析格式随版本变化 | 解析函数只认 `dsh web: ` 前缀 + 容错；解析失败 → 展示原始日志于恢复屏 |
| 引擎升级破坏官方 UI 布局 | 主题覆盖用**选择器+token**最小集；升级后第一时间人工目检（主题开关可随时关闭） |

## 6. 决策待确认

- [ ] **整体计划**确认后开工（可勾选）
- [ ] 菜单栏形态：**A 无 Dock + 菜单栏常驻**（推荐，UI-SPEC D4 已定）／B 常规 Dock 应用（v1 先这样，P2 切 A）
- [ ] 热键默认 `⌥Space` 是否可接受（macOS 系统默认未被占用，可直接注册）
- [ ] v1 打包先 dev 签名（无公证，用户需右键打开）是否可接受
