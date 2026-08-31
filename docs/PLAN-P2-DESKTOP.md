# DSHmini 桌面增强实现计划（P2 · 待确认 v1）

> 状态：**方案待确认（spec 先行，未动实现代码）**。本文是这一阶段的**工程实现总纲**，把引擎运行时、设置窗口、通知与悬浮球三个工程流的决策与依据收口。语义/视觉要求以 `SPEC-SEMANTICS.md`、`UI-SPEC.md` 为主；本文件只补充"如何实现"。
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

- **引擎分发**：构建期捆绑（`prepare-dsh-runtime.sh` + `dsh-runtime-version.txt` 钉版本 + `embed-engine.sh` 拷入 App）。`DSHMINI_DSH_ENTRY`/系统 dsh 仅作开发/覆盖。
- **引擎版本**：先钉 `0.1.2-alpha.2`（暴露 provider Remote；此为本仓库源码对应版本）。
- **版本韧性**：客户端能力探测 + 优雅降级；设置写操作带 revision 防串写；引擎升级走 **App 自更新（Sparkle）** 随版本带新内核。
- **设置页**：`UI-SPEC §3.3` **独立原生 480×600 窗口**，左导航 160，**6 分区全做**（模型/审批/快捷键/外观/通知/数据），黑白灰阶、token 单一来源。
- **通知/悬浮球**：原生实现；重点参考参考项目 `NativeAlerts.swift` / `FloatingBubble.swift`。
- **品牌**：产品 logo **先使用 dsh 官方 logo**（placeholder），后续再定 DSHmini 自有 logo。**悬浮球按钮同样使用 dsh 官方 logo（鲸鱼）**：`apps/web/public/favicon.svg` 鲸鱼 path，或 `dsh-client-ui-primitives` 的 `FishLogo`（`currentColor` 单色）——详见 `SPEC-NOTIFICATIONS-FLOATING-BALL.md §2.3`。
- **范围界碑**：D5（原生审批弹窗 P1）、D4（菜单栏驻留无 Dock）沿用 `SPEC-SEMANTICS §9`。

## 5. 实施顺序

1. **A 引擎运行时**（工程前提，独立且重要）：捆绑脚本 + 入口优先 bundled + 能力探测基建。
2. **B 设置窗口**：原生窗口壳 + 前端设置入口 + 6 分区。
3. **C 通知 + 悬浮球**：原生件 + 事件来源接线 + 设置开关。

## 6. 品牌与资产

- 产品 logo/图标：**暂用 dsh 官方 logo**（`dsh` 仓库自带或官方分发资产）。正式的 DSHmini 自有标识后续单独设计，不在本阶段。

## 7. 文档关系

- 语义层：`SPEC-SEMANTICS.md`（§5 通知与注意力、§6 窗口、§8 功能矩阵、§9 决策）。
- 视觉层：`UI-SPEC.md`（§1 token、§3.3 设置窗口、§4 平台惯例 gate）。
- 架构层：`ARCHITECTURE.md`（外壳/前端/引擎/桥；§5.4 引擎管理、§12 更新=Sparkle）。
- 本文件三份子 spec：`SPEC-ENGINE-RUNTIME.md`、`SPEC-SETTINGS-WINDOW.md`、`SPEC-NOTIFICATIONS-FLOATING-BALL.md`。

## 8. 待实施时再确认的单点（已收敛，不阻塞 spec）

- 设置窗口分区命名：`UI-SPEC §3.3`（模型/审批/快捷键/外观/通知/数据）与 `SPEC-SEMANTICS §6/§8`（模型/附件路由/审批策略/快捷键/外观/通知/数据，另含"角色名单"）略有差异。**以 UI-SPEC 6 分区为准**，附件路由/角色名单并入相应分区（模型/审批）或作为子项，不单列。
- 通知/悬浮球的"彩色红点"vs `UI-SPEC` 黑白纪律：参考项目用红点/彩色海景，DSHmini 按 spec 转 **monochrome**（运行=亮圈、后台完成=白点呼吸/灰✓），红色仅保留于 diff 内容层语义色。
