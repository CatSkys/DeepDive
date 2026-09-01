# DSHmini 桌面增强实现计划（P2 · v2.1 复审收口）

> 状态：**spec v2.1（2026-08-31 两轮评审均已收口；仍未动实现代码）**。本文是这一阶段的**工程实现总纲**，把引擎运行时、设置窗口、通知与悬浮球三个工程流的决策与依据收口。语义/视觉要求以 `SPEC-SEMANTICS.md`、`UI-SPEC.md` 为主；本文件只补充"如何实现"。
> v1 → v2 主要变更：①新增**外壳↔前端通道**定义（`SPEC-NOTIFICATIONS §3.1`，通知点击转会话/主题联动的落地前提，现状为零通道）②通知按 `SPEC-SEMANTICS §5` 分级静默（回合完成不带 sound）③补引擎失败通知④快捷键分区拆"全局可改 / 应用内仅展示"⑤bundled 入口形状钉死（node + `lib/bin.js`）+ node 版本引脚⑥凭据冷启动闭环（配 key → 自动重启）⑦资产以本仓库 vendored 副本为准等细则。
> v2 → v2.1（复审）：`DSHMINI_DSH_ENTRY` 显式 env 改为**最强覆盖**（压过 bundled，否则跨版本对照失效）；通知点击指令 **pending 暂存**（冷启动不丢转入意图）；悬浮球显隐**不占全局热键**（撤销 `⌥⌘Y`，全局键仅唤起面板一个）；`package-macos.sh` 深签；node 引脚不符 fail-loud。
> 参考实现：`/Users/hanbyking/Projects/deepseek-harness-macos`（luochenw/deepseek-harness-macos）——原生 SwiftUI/AppKit + **内置 Node 和完整 DSH runtime** 的范式；通知与悬浮球重点参考其 `NativeAlerts.swift`、`FloatingBubble.swift`、`DSHSettingsView.swift`、`DSHSettingsEditor.swift`。

---

## 1. 一句话定位

让 DSHmini 成为**真正自包含的 macOS 桌面客户端**：不依赖系统 dsh（引擎随包分发）、设置页按 `UI-SPEC §3.3` 做**独立原生 480×600 窗口**（左导航 6 分区）、提供**原生通知 + 悬浮球**（WebView 做不到的 OS 级能力）、并让引擎版本变化对客户端**无感**（能力探测 + 优雅降级）。

## 2. 三条工程流

| # | 工程流 | 目标 | 对应 spec |
|---|---|---|---|
| A | 引擎运行时 | 用户无需安装 dsh；引擎版本可管理、可升级且不返工 | `SPEC-ENGINE-RUNTIME.md` |
| B | 设置窗口 | spec §3.3 原生设置窗口，6 分区全做 | `SPEC-SETTINGS-WINDOW.md` |
| C | 通知 + 悬浮球 | 原生通知 + 常驻悬浮球（OS 级） | `SPEC-NOTIFICATIONS-FLOATING-BALL.md` |

## 3. 关键事实（调研结论，作为依据）

1. **引擎 API 面随版本漂移**（实测）：`settings.describe/update/mutate/replace`、`credentials.describe/set/unset`、`llm.models`、`agentPreset.list` 是**跨版本稳定面**；`llm.listProviders`/`listConfigurableProviders`/`discoverModels`（provider 管理器）**仅在 `0.1.2-alpha.2` 起才成为 `@Remote` 网关端点**，在 `0.1.1-rc.2` 返回 HTTP 404。→ 客户端不得写死方法集，必须**能力探测 + 优雅降级**。
2. **高星 DSH 客户端普遍捆绑引擎**（dsh-desktop / pilot-harness / deepseek-harness-eac 皆为构建期捆绑 Node+dsh；hairyf 为首次运行下载+缓存）。→ DSHmini 采用**构建期捆绑**，保证"无 dsh 也能用"。
3. **通知/悬浮球是原生能力**：`UNUserNotificationCenter` + `NSStatusItem` + `NSPanel` 只能在原生侧实现，WebView 标签页无法做到（参考项目明示）。→ 落在 Swift 原生层。

## 4. 已确认决策

- **引擎分发**：构建期捆绑（`prepare-dsh-runtime.sh` + `dsh-runtime-version.txt` 钉版本 + `embed-engine.sh` 拷入 App）。`DSHMINI_DSH_ENTRY` 为**最强覆盖**（显式 env 优先于 bundled），系统 dsh 兜底——均开发/覆盖用途。
- **引擎版本**：钉 `0.1.1-rc.2`（与本阶段自建 SPA 的 unary `/api/<method>` RPC 协议兼容）。**实测 alpha.2 已破坏协议**：浏览器 RPC 全部迁入 `/api/remote.mux` WS 流并强制 cookie 鉴权（见 PITFALLS），升 alpha.2 需先移植前端协议层——provider Remote 面届时按 §4.2 能力探测自动出现，当前经能力探测优雅隐藏，不阻塞。
- **版本韧性**：客户端能力探测 + 优雅降级；设置写操作带 revision 防串写；引擎升级走 **App 自更新（Sparkle）** 随版本带新内核。
- **设置页**：**内置主窗口（v3 变更，用户拍板 2026-08-31）**——独立原生窗口方案废弃（试作后风格与主界面割裂）；改为 WebView 内浮层，**复用官方 dsh ui-settings 的面板外壳与行/卡片/按钮 CSS**（token 驱动，自动继承暗玻璃），分区：模型/审批/快捷键/外观/通知/数据。
- **通知/悬浮球**：原生实现；重点参考参考项目 `NativeAlerts.swift` / `FloatingBubble.swift`。
- **品牌**：产品 logo **先使用 dsh 官方 logo**（placeholder），后续再定 DSHmini 自有 logo。**悬浮球按钮同样使用 dsh 官方 logo（鲸鱼）**：鲸鱼 path 取自**本仓库 vendored 的 dsh 源码副本 `deepseek-harness-master/`**（`0.1.2-alpha.2`，与 runtime 引脚同版；勿取 `docs/DSH-SOURCE-MAP.md` 指向的 `~/Downloads/` 副本）——`deepseek-harness-master/apps/web/public/favicon.svg` 鲸鱼 path（viewBox 0 0 50 50），或 `deepseek-harness-master/packages/client/ui-primitives/src/FishLogo.tsx`（`currentColor` 单色）——详见 `SPEC-NOTIFICATIONS-FLOATING-BALL.md §2.3`。
- **范围界碑**：D5（原生审批弹窗 P1）、D4（菜单栏驻留无 Dock）沿用 `SPEC-SEMANTICS §9`。

## 5. 实施顺序

1. **A 引擎运行时**（工程前提，独立且重要）：捆绑脚本 + 入口优先 bundled + 能力探测基建。
2. **B 设置窗口**：原生窗口壳 + 前端设置入口 + 6 分区。
3. **C 通知 + 悬浮球**：原生件 + 事件来源接线 + 设置开关。

## 6. 品牌与资产

- 产品 logo/图标：**暂用 dsh 官方 logo**（本仓库 vendored 副本 `deepseek-harness-master/` 自带资产，见 §4 品牌条）。正式的 DSHmini 自有标识后续单独设计，不在本阶段。
- 注：官方 logo 作 placeholder 属**商标使用**问题，与 `THIRD_PARTY_NOTICES`（版权/许可声明，`SPEC-ENGINE-RUNTIME §3.3`）分属两事；正式对外分发（Sparkle）前单独评估。

## 7. 文档关系

- 语义层：`SPEC-SEMANTICS.md`（§5 通知与注意力、§6 窗口、§8 功能矩阵、§9 决策）。
- 视觉层：`UI-SPEC.md`（§1 token、§3.3 设置窗口、§4 平台惯例 gate）。
- 架构层：`ARCHITECTURE.md`（外壳/前端/引擎/桥；§5.4 引擎管理、§12 更新=Sparkle）。
  - 注：`ARCHITECTURE §5.4/§12` 仍写 profile `dshmini`，实际自 P1 起为 `--profile web`（`PLAN-P1` 已定）；属既有文档漂移，非本阶段引入，后续统一对齐 ARCH，P2 spec 一律按 `--profile web` 表述。
- 本文件三份子 spec：`SPEC-ENGINE-RUNTIME.md`、`SPEC-SETTINGS-WINDOW.md`、`SPEC-NOTIFICATIONS-FLOATING-BALL.md`。

## 8. 待实施时再确认的单点（已收敛，不阻塞 spec）

- 设置窗口分区命名：`UI-SPEC §3.3`（模型/审批/快捷键/外观/通知/数据）与 `SPEC-SEMANTICS §6/§8`（模型/附件路由/审批策略/快捷键/外观/通知/数据，另含"角色名单"）略有差异。**以 UI-SPEC 6 分区为准**，附件路由/角色名单并入相应分区（模型/审批）或作为子项，不单列。
- 通知/悬浮球的"彩色红点"vs `UI-SPEC` 黑白纪律：参考项目用红点/彩色海景，DSHmini 按 spec 转 **monochrome**（运行=亮圈、后台完成=白点呼吸/灰✓），红色仅保留于 diff 内容层语义色。
