# 全量深度体检报告 — 2026-09

> 审查人：AI（资深架构师+代码审查员视角）。评价标准唯一：**AI 下次冷启动接手时，能否快速、正确、低成本地理解和修改**。
> 审查方式：逐文件详读全部自有源码（不抽样）+ 机器检查 + 跨模块扫描（死类/未定义 CSS 变量/循环依赖/词典缺键/未用依赖均为脚本实证，非目测）。
> 本报告只审查与规划，未修改任何源码。

**审查进度**：✅ 全部完成（M1–M11 全部模块 + 跨模块分析）。本次为单会话完成全部批次，无待查遗留。

---

## 1. 项目画像

**技术栈**：macOS 客户端，三层混合——
- 壳：Swift + AppKit + WKWebView（XcodeGen 生成工程，无第三方 SwiftPM 依赖）
- 前端：React 18 + TypeScript(strict) + Vite 5，zustand/immer/clsx/schemastery 声明了但**零使用**（实际是 React Context + useState 手写 store）
- 引擎：dsh 子进程（vendored Node 运行时闭包，版本引脚 `scripts/dsh-runtime-version.txt` = 0.1.1-rc.2）
- 设计 token：tokens.json → gen-tokens.mjs → tokens.css（Web 用）+ Tokens.swift（壳侧**零消费**）

**规模**（自有源码，不含 vendored 副本）：约 60 个源码文件 / 约 10,400 行。最大文件：theme.css 2258 行、SessionView.tsx 1551 行、SettingsPage.tsx 597 行、store.tsx 492 行、MainWindowController.swift 489 行。另有 vendored 官方源码副本 9078 个文件 / 79MB（只读对照资产，不参与构建运行时）。

**模块划分与依赖图**（文字版，箭头 = import/调用）：

```
M1 前端核心通道   main.tsx → App.tsx → {Sidebar, SessionView, SettingsPage}(M2/M3)
                  store.tsx → {api.ts, host.ts, i18n.ts, types.ts}
                  i18n.ts ⇄ store.tsx（唯一循环依赖，运行时无害）
                  titlebar.ts 独立（main.tsx 挂载，仅桥直连壳）
M2 前端会话渲染   SessionView → {Markdown, ThinkingState, LoadingState, Icons, HeroBrand, Composer, ModelMenu, Sidebar(WorkspacePill)}
M3 前端输入/导航  Composer/ModelMenu/Sidebar/SettingsPage → {store, api, host, i18n}；settings/controls.tsx ← SettingsPage
M4 样式与 token   theme.css → @import generated/tokens.css ← gen-tokens.mjs ← tokens.json；SettingsRows.module.css ← SettingsPage/controls
M5 壳应用骨架     main.swift → AppDelegate → {MainWindowController, StatusItemController, HotKeyManager, RecoveryWindowController, DictationController}
M6 壳引擎监督族   AppDelegate → EngineSupervisor → EngineLog；EngineEventObserver → {EngineGateway, EngineAuth, FloatingBubble, NativeAlerts, StatusItemController}
M7 壳桥与网络     AppDelegate → BridgeServer → {MiniHTTPServer, EngineAuth}；EngineGateway → EngineAuth
M8 壳系统能力面   NativeAlerts/FloatingBubble → AppDelegate.shared（回环）；WebViewTheme/Tokens.swift 生成物；DSHAppPrefs/AppPaths 被动引用
M9 构建与脚本     Makefile → scripts/* → {frontend build, xcodegen, xcodebuild, embed, codesign, DMG}
M10 设计种子      design/logo/index.html（自包含设计稿，独立于产品链）
M11 vendored      deepseek-harness-master/（对照资产，无 import 关系）
```

依赖方向总体单向（SPA→引擎经 api.ts、SPA→壳经 host.ts、壳→引擎经 supervisor/gateway 三条独立通道），除 i18n⇄store 一处循环。

**整体印象**：这是一个**文档纪律罕见地好**的 AI 维护仓库——AGENTS.md 军令体系、PITFALLS 真实事故库、as-built 架构文档互相链接，冷启动认知成本的大头已被文档消化。代码本身偏朴素直白（符合自家心法），契约面（wire/桥/token）都有显式类型与注释。主要债务集中在四处：**零测试**（最大风险）、**几个静默失效的真 bug**（CSS 变量未定义、通知名不匹配、EOF 忙等复发）、**SessionView/theme.css 两个巨文件**、以及一批"规范说了但代码没跟上"的漂移（i18n 漏网、旧命名空间、死代码）。

---

## 2. 审查覆盖清单（硬性要求）

处理方式：**详读**=逐行读完；**略读**=结构性通读（CSS/生成物/文档类，重点段逐行）；**跳过**=非源码或第三方，注明原因。单文件 >800 行（SessionView.tsx、theme.css）均已详读。

| 文件 | 行数 | 处理 |
|---|---:|---|
| frontend/src/main.tsx | 13 | 详读 |
| frontend/src/App.tsx | 154 | 详读 |
| frontend/src/api.ts | 243 | 详读 |
| frontend/src/types.ts | 200 | 详读 |
| frontend/src/store.tsx | 492 | 详读 |
| frontend/src/host.ts | 72 | 详读 |
| frontend/src/titlebar.ts | 62 | 详读 |
| frontend/src/i18n.ts | 299 | 详读（+脚本核验词典缺键） |
| frontend/src/css-modules.d.ts | 1 | 详读 |
| frontend/src/components/SessionView.tsx | 1551 | **详读**（>800 红线） |
| frontend/src/components/Composer.tsx | 371 | 详读 |
| frontend/src/components/Sidebar.tsx | 386 | 详读 |
| frontend/src/components/SettingsPage.tsx | 597 | 详读 |
| frontend/src/components/ModelMenu.tsx | 247 | 详读 |
| frontend/src/components/Markdown.tsx | 165 | 详读 |
| frontend/src/components/LoadingState.tsx | 149 | 详读（+variant 消费方核实） |
| frontend/src/components/ThinkingState.tsx | 113 | 详读 |
| frontend/src/components/Icons.tsx | 173 | 详读 |
| frontend/src/components/ProviderIcon.tsx | 80 | 详读 |
| frontend/src/components/HeroBrand.tsx | 21 | 详读 |
| frontend/src/components/HoverScrollText.tsx | 58 | 详读 |
| frontend/src/settings/controls.tsx | 120 | 详读 |
| frontend/src/settings/SettingsRows.module.css | 213 | 略读（+死类脚本核验） |
| frontend/src/theme.css | 2258 | **详读**（>800 红线；+死类/未定义变量脚本核验） |
| frontend/packages/design/tokens.json | 99 | 详读 |
| frontend/packages/design/gen-tokens.mjs | 152 | 详读 |
| frontend/index.html | 27 | 详读 |
| frontend/vite.config.ts | 27 | 详读（+__DSH_BUILD_SHA__ 消费方核实） |
| frontend/tsconfig.json | 19 | 详读 |
| frontend/package.json | 29 | 详读（+依赖引用核实） |
| frontend/package-lock.json | 1914 | 跳过（锁文件，npm audit 已覆盖） |
| apps/macos/Sources/DSHminiApp/main.swift | 23 | 详读 |
| apps/macos/Sources/DSHminiApp/AppDelegate.swift | 444 | 详读 |
| apps/macos/Sources/DSHminiApp/MainWindowController.swift | 489 | 详读 |
| apps/macos/Sources/DSHminiApp/BridgeServer.swift | 255 | 详读 |
| apps/macos/Sources/DSHminiApp/MiniHTTPServer.swift | 185 | 详读 |
| apps/macos/Sources/DSHminiApp/EngineSupervisor.swift | 293 | 详读 |
| apps/macos/Sources/DSHminiApp/EngineGateway.swift | 144 | 详读 |
| apps/macos/Sources/DSHminiApp/EngineAuth.swift | 55 | 详读 |
| apps/macos/Sources/DSHminiApp/EngineEventObserver.swift | 217 | 详读 |
| apps/macos/Sources/DSHminiApp/EngineLog.swift | 38 | 详读 |
| apps/macos/Sources/DSHminiApp/NativeAlerts.swift | 128 | 详读 |
| apps/macos/Sources/DSHminiApp/FloatingBubble.swift | 277 | 详读 |
| apps/macos/Sources/DSHminiApp/StatusItemController.swift | 118 | 详读 |
| apps/macos/Sources/DSHminiApp/RecoveryWindowController.swift | 155 | 详读 |
| apps/macos/Sources/DSHminiApp/HotKeyManager.swift | 97 | 详读 |
| apps/macos/Sources/DSHminiApp/HotkeyRecorderWindow.swift | 110 | 详读 |
| apps/macos/Sources/DSHminiApp/DictationController.swift | 124 | 详读 |
| apps/macos/Sources/DSHminiApp/JSONValue.swift | 179 | 详读 |
| apps/macos/Sources/DSHminiApp/WebViewTheme.swift | 18 | 详读 |
| apps/macos/Sources/DSHminiApp/Tokens.swift | 75 | 略读（生成物；消费方核实=零引用） |
| apps/macos/Sources/DSHminiApp/DSHAppPrefs.swift | 79 | 详读 |
| apps/macos/Sources/DSHminiApp/AppPaths.swift | 76 | 详读 |
| apps/macos/project.yml | 49 | 详读 |
| apps/macos/Assets.xcassets/**（2 个 Contents.json + 9 PNG） | — | 跳过（资产目录，非逻辑） |
| scripts/build-frontend.sh | 10 | 详读 |
| scripts/build-release.sh | 14 | 详读 |
| scripts/dev.sh | 21 | 详读 |
| scripts/embed-engine.sh | 103 | 详读 |
| scripts/embed-web.sh | 11 | 详读 |
| scripts/package-macos.sh | 27 | 详读 |
| scripts/prepare-dsh-runtime.sh | 151 | 详读 |
| scripts/dsh-runtime-version.txt / node-version.txt | 1/1 | 详读（引脚事实源） |
| Makefile | 12 | 详读 |
| design/logo/index.html | 400 | 略读（自包含设计稿，非产品链） |
| design/logo/README.md | 50 | 详读 |
| docs/（ARCHITECTURE/PITFALLS/WORKING-AGREEMENTS/UI-SPEC/SPEC-SEMANTICS/SPEC-ENGINE-RUNTIME/SPEC-SETTINGS-WINDOW/SPEC-NOTIFICATIONS-FLOATING-BALL/REVIEW-P2/BRANDING/DSH-SOURCE-MAP） | 96/161/24/292/207/93/74/83/86/53/45 | 略读（文档，用于交叉验证代码声明） |
| AGENTS.md / frontend/AGENTS.md / apps/macos/AGENTS.md / README.md | 82/34/33/42 | 详读（军令即审查基准） |
| CLAUDE.md ×3 | — | 跳过（AGENTS.md 的符号链接） |
| .gitignore | 18 | 详读 |
| deepseek-harness-master/（9078 个文件） | ~79MB | 跳过（vendored 官方源码只读对照副本，勿改动勿运行；已抽查 pnpm-lock/api-catalog 等确认非自有代码） |

---

## 3. 机器检查结果

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端构建 | `cd frontend && npm run build`（tsc -b --noEmit && vite build） | ✅ 通过（1591 模块，dist JS 288.86KB / gzip 98.95KB） |
| 严格类型 | `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | ✅ 零错误 |
| Swift 构建 | `xcodegen generate` + `xcodebuild -scheme DSHmini -configuration Debug build` | ✅ BUILD SUCCEEDED |
| 测试 | — | ❌ **不存在**：前端零测试文件/零测试框架；壳工程零 test target。**按审查标准记为最高优先级问题（AUD-001）**——没有测试就没有行为规格，后续一切重构无从谈起 |
| lint | — | ❌ **无配置**：项目无 ESLint/Prettier/SwiftLint；但代码里有 5 处 `eslint-disable-next-line react-hooks/exhaustive-deps` 注释指向不存在的工具（AUD-017） |
| 依赖漏洞 | `npm audit` | ⚠️ 2 个（1 high 1 moderate，均在 devDependencies 链）：vite 5.4.11 经由 esbuild ≤0.24.2（GHSA-67mh-4wv8-2f99，dev server 任意网站读取漏洞）。**只影响开发服务器，不影响产物**。修复需 vite 大版本升级（audit 建议直上 8.x，破坏性变更），见 AUD-029 |
| git 历史 | 最大 blob 核查 | ✅ 最大 1.2MB（logo 导出 PNG，历史内已删）；无密钥/凭据类文件入库迹象 |

---

## 4. 逐模块报告

### M1 前端核心通道（main/App/api/types/store/host/titlebar/i18n）

一句话职责：写得出来——"SPA 的骨与血：路由骨架、引擎 RPC 唯一入口、事件可辨识联合、全局状态、壳桥、标题栏 rect 推送、双语词典"，文件名即地图（A1/A2 通过）。
依赖：上游 = 引擎 wire（经 same-origin fetch）+ 壳桥（webkit.messageHandlers）；下游 = M2/M3 全部组件。
冷启动成本：读 store.tsx + api.ts + types.ts + host.ts ≈ 1000 行，加 PITFALLS §2/§4 做背景 ≈ 1 天内可改。
清单通过率：适用 19 项（A1,A2,A3,A4,A5,A6,C2,C3,C4,C7,E3,F4,G1,G3,B4,B6,B7,I3），通过 12 项。未通过：**A4**（i18n⇄store 循环）、**C7**（mux 回调 `frame: any` ×2 + 3 处 `as any`）、**B6**（store.tsx 492 行，StoreProvider 400 行、refresh 75 行）、**B7**（applyFrame 空参数 async 壳）、**G1**（store.tsx:448 裸中文 alert）、**I3**（localStorage 3 个 key 散落 + 壳 prefs 双通道）、**F4**（服务端列表态与 UI 态混在同一 store，但签名去抖已缓解）。

| 编号 | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| AUD-008 | P2 | frontend/src/store.tsx:161-162 | `JSON.parse(localStorage.getItem("deepdive.pinned"/"unread"))` 无 try/catch；同文件 292 行对 workspace key 有 "corrupt" 防护——不对称，值损坏即启动抛错白屏 | 与 292 行统一：包 try/catch 回退空集 |
| AUD-011 | P2 | frontend/src/i18n.ts:8 ↔ store.tsx:4 | 循环依赖（i18n→useStore，store→setI18nLang）；运行时无害，阅读与热替换有隐性成本 | 把 currentLang 状态经参数注入（useT(store.lang) 已传参，去掉模块级写回 i18n.ts:297 即可断环） |
| AUD-027 | P3 | frontend/src/store.tsx:453-489 | value memo 依赖表不含 refresh/createSession/subscribeMux，靠"全部可变量走 ref"的隐含约定成立——脆弱，后人改 refresh 加普通 state 即 stale closure | refresh/createSession 也 useCallback 包进依赖；或文件头注释明示该约定 |
| AUD-028 | P3 | frontend/src/i18n.ts:297 | useT() 渲染期写模块级 currentLang（hook 副作用） | 可与 AUD-011 一并处理（t() 显式传 lang） |

### M2 前端会话渲染（SessionView + 呈现组件）

一句话职责：写得出来——"事件日志 → RenderItem 摄取 → 会话流渲染（用户气泡/agent 文本/工具行/turn-tail/审批/提问/排队卡）"，但塞进了一个文件。
依赖：上游 = M1（store/api/types/i18n）；下游 = 无（叶子）。
冷启动成本：SessionView 1551 行 + types.ts 200 行 + PITFALLS §2/§3/REVIEW-P2 ≈ 2000 行必读——**全仓最高**。
清单通过率：适用 17 项，通过 12 项。未通过：**B6**（1551 行/SessionView 组件 409 行/ingest 114 行）、**B7**（MessageMeta 的 branch 按钮无 onClick，SessionView.tsx:808-816 死按钮）、**C7**（`e.event as import("../types").SessionEvent` 冗余断言 :289）、**E2**（超长会话 DOM 无上限，靠 content-visibility 缓解）、**G1**（"Deep diving..." :446 硬编码英文）。
亮点（不计分但值得记录）：O(1) callIndex/callPaths 摄取、独立 turn-tail、严格递增 seq 守卫、Markdown memo——REVIEW-P2 的 P0/P1 建议全部落地，与官方架构对齐良好。

| 编号 | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| AUD-014a | P2 | frontend/src/components/SessionView.tsx:63-471 | SessionView 组件 409 行（模型加载/摄取/滚动/分页/渲染全在一身） | 拆出 useSessionEvents（log+ingest+finalize）与 useSessionModels 两个 hook，组件只留编排 |
| AUD-026 | P3 | frontend/src/components/SessionView.tsx:1231 | item.key=`${seq}:${type}`，引擎重发/编辑时 key 不稳（REVIEW-P2 §1 已登记开放） | 等 P2-6 snapshot store 决策时一并处理，勿单独打补丁 |

### M3 前端输入与导航（Composer/ModelMenu/Sidebar/SettingsPage/controls）

一句话职责：写得出来。
依赖：上游 = M1；下游 = 无。
冷启动成本：4 文件 ≈ 1340 行。
清单通过率：适用 16 项，通过 11 项。未通过：**C7**（Composer `content as any`×2 :141,145、`icon:any` :19,363；Sidebar `(s.projections as any)` :383）、**B6**（SettingsPage 597 行、Sidebar 组件 280 行）、**G1**（Sidebar.tsx:319 裸中文 alert，且词典已有 "归档失败：{m}" 键未用；SettingsPage.tsx:533 `t("New Chat")` 反向用法）、**C2→已证实为功能谎报**（快捷键表，见 AUD-005）。

| 编号 | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| AUD-005 | P1 | frontend/src/components/SettingsPage.tsx:465-468 | 应用内快捷键表列出 ⌘K/⌘T/⌘1..9/⌘V/Tab 等，但全 SPA 无任何 keydown/metaKey 实现（grep 零命中）——设置页在向用户承诺不存在的行为 | 二选一：删掉未实现条目只留真实存在的（Esc/Enter/⌘,）；或补实现。**禁止保持现状**（AI 冷启动也会被骗） |
| AUD-010 | P2 | frontend/src/components/Composer.tsx:141,145 | `api.prompt({... content: content as any})`——api.ts 的 content 类型未建模 image 分块（{type:"image",mediaType,data,name}），类型缺口被 as any 压住，两次调用各自静默 | 在 api.ts 把 content 类型扩成 `Array<{type:"text";text:string}|{type:"image";mediaType:string;data:string;name?:string}>`，删两处 as any |

### M4 样式与 token 管线（theme.css/SettingsRows.module.css/tokens.json/gen-tokens.mjs）

一句话职责：写得出来（"全部样式的唯一事实源 + 双端 token 生成"）。
清单通过率：适用 12 项，通过 7 项。未通过：**C1 类静默失效**（未定义 CSS 变量，AUD-002）、**B6**（theme.css 2258 行，存量豁免但持续膨胀）、**B7**（.glass 家族/.effort-row/.model-menu-pill/.row-btn/.selectField 死类）。

| 编号 | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| AUD-002 | P1 | frontend/src/theme.css（22 处）+ settings/SettingsRows.module.css（6 处）；代表行 theme.css:325,384,426,445,516,2059 等 | 引用未定义自定义属性 `--dur-fast/--dur-med/--dur-slow/--ease-out`（全仓 grep 无定义；tokens.json motion 段生成的是 `--dsh-motion-*`）。var() 无 fallback 时该声明 invalid-at-computed-value-time → **所有这些 transition/animation 整条静默失效**（hover 过渡、ws-view 横滑、hero 入场等全都没在动） | 在 theme.css 头部或 tokens.json motion 段补定义四个变量（--dur-fast:120ms; --dur-med:200ms; --dur-slow:300ms; --ease-out:cubic-bezier(.2,0,0,1)，与 tokens.json motion 值一致）；修复后按铁律 2 截图验证动效真的出现 |
| AUD-015b | P3 | frontend/src/theme.css:117-153 | `.glass/.glass::before/.glass::after`（37 行）唯一"引用"是 Composer.tsx:49 的注释——死样式（死类扫描被注释骗过） | 删除；顺带删 .effort-row/.model-menu-pill/.row-btn/.selectField |

### M5 壳应用骨架（main/AppDelegate/MainWindowController/project.yml）

一句话职责：写得出来。
清单通过率：适用 17 项，通过 14 项。未通过：**C2/C5 真 bug**（通知名不匹配 AUD-003）、**G2**（手拼 JSON 与 JSONSerialization 并存 AUD-013）、**B6**（AppDelegate.applicationDidFinishLaunching 110 行、handleHostMessage 76 行；MainWindowController.init 83 行）。

| 编号 | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| AUD-003 | P1 | apps/macos/Sources/DSHminiApp/main.swift:12 ↔ AppDelegate.swift:107 | 二实例广播 `com.dshmini.app.show`，监听的是 `com.deepdive.app.show`——名字不匹配，"再次启动唤起既有窗口"通路静默失效；同时违反自家 deepdive.* 命名军令 | 两处统一为 `com.deepdive.app.show`（改 main.swift 一行即可） |
| AUD-013 | P2 | apps/macos/Sources/DSHminiApp/AppDelegate.swift:74-77,143-148 | 手拼 JSON `#"{"sessionId":"\#(sessionId)"}"#`，sessionId 含 `"` 即产生非法 JSON；同文件 pickWorkspaceDirectory(:263-265) 用 JSONSerialization——两种做法并存 | 统一 JSONSerialization（抽一个 `jsonPayload([String:Any]) -> String` 小工具，3 个调用点换用） |
| AUD-024 | P3 | apps/macos/Sources/DSHminiApp/MainWindowController.swift:16-17,286 | 注释仍写 "dshmini" message handler / `window.__dshminiHost`，实际标识符是 deepdive / `__deepDiveHost`——过时注释会把冷启动 AI 的 grep 带沟里 | 改注释（两处） |

### M6 壳引擎监督族（EngineSupervisor/Gateway/Auth/EventObserver/EngineLog）

一句话职责：写得出来（"子进程监督/自愈/凭据断言/事件观察/网关调用"）。
清单通过率：适用 16 项，通过 13 项。未通过：**C4**（EOF 忙等复发 AUD-004）、**B7**（无操作语句 :34）、**C1**（pending 集合随机 ID 兜底泄漏风险）。

| 编号 | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| AUD-004 | P1 | apps/macos/Sources/DSHminiApp/EngineSupervisor.swift:203-207 | `readabilityHandler` 的空数据分支只有 `return`，未置 `handle.readabilityHandler = nil`——**直接违反 PITFALLS §4.4 / apps/macos/AGENTS.md 进程纪律**（该坑曾真实发生：引擎退出后 CPU 空转）。当前靠 Process 释放间接兜底，时序脆弱 | 空数据分支显式 `handle.readabilityHandler = nil; return`（一行修复，军令要求） |
| AUD-020 | P3 | apps/macos/Sources/DSHminiApp/EngineEventObserver.swift:164,178 | approvalId/questionId 缺失时用随机 UUID 插入 pending 集合，resolved 帧按真实 id 删除 → 引擎若省略 id 则集合永久泄漏（现引擎总带 id，低风险） | 缺 id 时直接 return + 日志，不要造 id |
| AUD-018 | P3 | apps/macos/Sources/DSHminiApp/EngineAuth.swift:36-38 | cookie 写入 `HTTPCookieStorage.shared`（进程级共享）——任何到 127.0.0.1 的请求都会带上引擎 cookie | 用 `URLSessionConfiguration.httpCookieStorage` 指向私有 store，取完 header 即弃 |

### M7 壳桥与网络（BridgeServer/MiniHTTPServer/JSONValue）

一句话职责：写得出来（"同源托管：静态文件 + /api 反代 + WS 盲中继"）。
清单通过率：适用 15 项，通过 12 项。未通过：**B2**（手写 HTTP 服务器/WS 泵——依赖零的显性决定，但与"禁自造轮子"军令存在张力，列为已接受风险）、**C4 边界**（无读超时/无 body 上限）、**C2**（诊断路由被 503 挡住）。
安全面通过项值得点名：Origin 全等校验（:58，PITFALLS §4.5 教训已固化）、路径穿越先 decode 再标准化+前缀检查（:220-223）、仅绑定 127.0.0.1。

| 编号 | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| AUD-021 | P3 | apps/macos/Sources/DSHminiApp/MiniHTTPServer.swift:97-135 | 读请求无超时、body 无大小上限；失联本地进程可长期占住 detached 线程 | readRequest 外层加 SO_RCVTIMEO；body 上限（如 32MB）超限即断。本地信任边界内可排在 P3 |
| AUD-019 | P3 | apps/macos/Sources/DSHminiApp/BridgeServer.swift:62-71 | `guard let engineBase else 503` 在 `/__deepdive_error` 之前——引擎未起时前端错误上报全被 503 吞掉，恰是最需要诊断线索的时刻 | 诊断路由提到 guard 之前 |

### M8 壳系统能力面（通知/悬浮球/状态栏/恢复屏/热键/听写/偏好/路径）

一句话职责：写得出来。
清单通过率：适用 15 项，通过 13 项。未通过：**G1**（悬浮球偏好用旧 `dsh.bubble.*` 命名空间）、**B7**（openAtLogin 死字段）、**G4→B**（HotkeyRecorderWindow 闭包体重复）。

| 编号 | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| AUD-012 | P2 | apps/macos/Sources/DSHminiApp/FloatingBubble.swift:16-18,36,129,150 | 偏好键 `dsh.bubble.enabled` / `dsh.bubble.frame` 用旧 dsh.* 命名空间，违反 deepdive.* 军令；且 LegacyPrefsMigration 只迁旧 suite 的 dsh.*，这两个键永远无人迁 | 迁到 `deepdive.bubble.*`（读旧键做一次性迁移），或并入 DSHAppPrefs 统一管理 |
| AUD-025 | P3 | apps/macos/Sources/DSHminiApp/NativeAlerts.swift:73；RecoveryWindowController.swift:25 | 用户可见文案/窗口标题用旧品牌 "DSHmini"（对外品牌 DeepDive，BRANDING §5） | 换 DeepDive（两处字符串） |
| AUD-015c | P3 | apps/macos/Sources/DSHminiApp/HotkeyRecorderWindow.swift:40-59,63-82 | showRecorder 与 rearm 两个闭包体逐行相同（~20 行×2） | 提取 `armMonitor()` 一个方法 |

### M9 构建与脚本（scripts/* / Makefile / package.json / vite / tsconfig）

一句话职责：写得出来——版本引脚 fail-loud、embed 后重签名+自检、嵌套依赖同 prerelease 段放行，都是踩坑后固化的正确做法。
清单通过率：适用 11 项，通过 9 项。未通过：**I2**（4 个零引用依赖 + vite 版本漏洞）、**B7**（vite define 死代码）。

| 编号 | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| AUD-006 | P1 | frontend/package.json:14-21 | `clsx/immer/schemastery/zustand` 四个 dependencies 零 import（脚本核实）；且 docs/ARCHITECTURE.md §4 仍写"zustand 状态（轮询签名去抖）"——文档与代码漂移，冷启动 AI 会去找 zustand | npm remove 四个包；ARCHITECTURE.md §4 该行改为"React Context 手写 store"。**注意：删依赖属构建面变更，按军令 7 先征得用户同意** |
| AUD-029 | P2 | frontend/package.json devDependencies | vite ^5.4.11 处于 audit high 链（经 esbuild GHSA-67mh-4wv8-2f99，dev-server 漏洞，不影响产物） | 近期迭代里升 vite（5→7/8 需同步 @vitejs/plugin-react 与 build.target=safari16 复测），或明确记录"接受 dev-only 漏洞"的决定 |
| AUD-007b | P2 | frontend/vite.config.ts:7-13,18-19 | `buildSha()`/`__DSH_BUILD_SHA__` define 烘焙后全 src 零消费（PITFALLS §5.1 的角标已随 hero 改版删除，规范条目未同步） | 删 define 与函数，或在 Sidebar 复活角标——二选一，同步改 PITFALLS §5.1 |

### M10 设计种子（design/logo）

一句话职责：写得出来（"ASCII 鲸鱼 logo 唯一事实源 + 生成器"）。
清单通过率：适用 5 项，通过 4 项。未通过：**I4/I5**（exports 产物未入库）。

| 编号 | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| AUD-016 | P2 | design/logo/exports/ 与 design/logo/preview-dock.png | README 称 exports/ 为"全部渲染产物/唯一事实源"，但既未 git track 也未 gitignore——新克隆缺失资产、git status 恒脏（1.2MB 历史版本曾在库内后被移除） | 决定入库（git add，约 2-3MB）或 gitignore + README 注明"本地生成"；当前悬空状态最差 |

### M11 vendored 对照副本（deepseek-harness-master/）

非自有代码，按仓库军令"勿当运行时、勿改动"。作为对照资产与 DSH_SOURCE 源工作正常。唯一提醒：9078 文件/79MB 让全仓 grep/工具显著变慢，AI 冷启动搜索时需要自觉加路径排除——建议在根 AGENTS.md"仓库布局"处已有说明的基础上，后续可考虑 sparse checkout 或 submodule 化（属结构变更，仅记录不建议现在动）。

---

## 5. 跨模块问题

**X1 全局重复实现汇总**
1. 空会话/欢迎页头部（title-row + model 按钮 + ModelMenu）：App.tsx:113-141 与 SessionView.tsx:318-353 两份近乎复制（AUD-015a）。
2. 会话标题回退：Sidebar.tsx:381-386 `titleOf()` vs SettingsPage.tsx:533 内联（且后者 `t("New Chat")` 反向用法、中英文案不一致）。
3. pickModel：App.tsx:82-90 vs SessionView.tsx:153-176（后者带 effort 逻辑，前者无）。
4. 时间/时长格式化：Sidebar.tsx:14-38（fmtTime/bucketLabel，中文内联三元）vs SessionView.tsx:1445-1467（formatClock/formatRunDuration/…，走 tt()）vs i18n.ts 词典时间键——三处体系并存。
5. 死按钮分支 chrome：SessionView.tsx MessageMeta branch 按钮渲染但无行为（官方是传 onBranch 才渲染）。
→ 沉淀建议：抽 `SessionHeader.tsx`（1+3 一起消）、`sessionTitle()` 工具（2）、`format.ts`（4）。

**X2 依赖图循环/单向违规**：脚本验证唯一循环 = `i18n.ts ⇄ store.tsx`（AUD-011）；其余全部单向。壳侧单例互引（AppDelegate.shared ← FloatingBubble/NativeAlerts）是回环但为 AppKit 惯例，可接受。

**X3 风格一致性全局评估**：整体高（错误处理风格统一为"注释式空 catch"、文案统一 t()/tt()——例外已列入 AUD-009）。两大系统性偏差：① i18n 词典缺键与裸文案共存（脚本核实缺：保存/当前使用/返回工作区/新建会话 等 t() 键）；② JSON 构造双轨（手拼 vs JSONSerialization，壳侧 AUD-013）。

**X4 孤岛代码**：无整文件级孤岛（除死代码清单 AUD-007）。`Tokens.swift` 生成物零消费（唯一引用是 MainWindowController.swift:62 的注释）——整个 token→Swift 半边管线是 0 调用方抽象层（B1），要么在壳里真用起来（如 headerCenterY/侧栏宽取 Tokens.Metric），要么砍掉 Swift 生成腿只留 CSS。

**X5 该沉淀未沉淀**：见 X1 沉淀建议；另 theme.css 的"弹出面板统一配方"注释宣称统一，但 .approval-card/.question-card/.queue-dock 仍是各写一份 bg/shadow（theme.css:1065-1075,1152-1163,1083-1090），配方只统一了三分支（.model-menu/.composer-menu/.ctx-menu）。

**X6 冷启动成本 Top 5**

| 排名 | 模块 | 需读 | 为什么贵 |
|---|---|---|---|
| 1 | SessionView.tsx + types.ts | ~1750 行 + PITFALLS §2/§3 + REVIEW-P2 | 摄取引擎、20 个组件、格式化函数一文件；每个不变量都有历史事故背书，不敢跳读 |
| 2 | store.tsx + api.ts + host.ts | ~810 行 + PITFALLS §4.6 | wire 契约、boot 策略、mux 分发、prefs 双通道交织；ref 镜像约定是隐式的 |
| 3 | EngineSupervisor 五件套 + SPEC-ENGINE-RUNTIME | ~940 行 + PITFALLS §7 | 引擎版本协议史（rc.2/alpha.2 两次断裂）全部压在这几个文件与引脚上 |
| 4 | theme.css + tokens.css + UI-SPEC | ~2600 行 | 2258 行手写 CSS 靠注释分区；改一处需知道 PITFALLS §1 的四个 WebKit 陷阱 |
| 5 | BridgeServer + MiniHTTPServer + EngineAuth | ~495 行 + PITFALLS §4.5/§7 | 手写 HTTP/WS 泵 + 认证交换，安全敏感且无测试兜底 |

---

## 6. 全局问题总台账

| 编号 | 级别 | 位置 | 问题 | 建议修复方式 |
|---|---|---|---|---|
| AUD-001 | **P0** | 全仓库 | 零测试：前端无测试框架/文件，壳无 test target。无行为规格，任何重构（含本报告所有建议）都没有安全网 | 阶段 0 落地：前端引入 vitest（先覆盖 types 判别联合 + SessionView 的 ingest/finalizeTurns 纯函数——它们是纯函数可无渲染测试）+ api.ts envelope/probeMethod（mock fetch）；壳补最小 XCTest（HotKeyManager.parse、JSONValue.diffOps、BridgeServer 路径穿越/Origin 用例）。引入测试框架属新依赖，按军令 7 需用户确认 |
| AUD-002 | **P1** | theme.css（22 处）/SettingsRows.module.css（6 处），代表 theme.css:325,384,516 | `--dur-*`/`--ease-out` 未定义 → 28 处 transition/animation 静默失效 | 补 4 个变量定义（值对齐 tokens.json motion），截图验证动效恢复 |
| AUD-003 | **P1** | main.swift:12 ↔ AppDelegate.swift:107 | 二实例通知名 dshmini/deepdive 不匹配，唤起通路失效 | 统一为 com.deepdive.app.show |
| AUD-004 | **P1** | EngineSupervisor.swift:203-207 | EOF 分支未置 readabilityHandler=nil，违反 PITFALLS §4.4 | 空数据分支显式置 nil（一行） |
| AUD-005 | **P1** | SettingsPage.tsx:465-468 | 设置页宣传不存在的快捷键（⌘K/⌘T/⌘1..9…全未实现） | 删未实现条目或补实现；禁止现状 |
| AUD-006 | **P1** | frontend/package.json:14-21 | clsx/immer/schemastery/zustand 零引用；ARCHITECTURE.md §4 仍写 zustand | 移除 4 依赖 + 改文档（先征用户同意） |
| AUD-007 | **P2** | 多处 | 死代码集合：LoadingState Surfer/Dots/Orbit 变体+videoSrc（:86-148）与配套样式（theme.css:1803-1835）；vite buildSha/__DSH_BUILD_SHA__（vite.config.ts:7-13,18-19）；AppConfig.openAtLogin（AppPaths.swift:52）；EngineEventObserver.swift:34 无操作语句；MessageMeta branch 死按钮（SessionView.tsx:808-816）；死类 .glass 家族/.effort-row/.model-menu-pill/.row-btn/.selectField | 阶段 3 一批删除；branch 按钮要么实现 onBranch 要么删；PITFALLS §5.1 同步 |
| AUD-008 | P2 | store.tsx:161-162 | pinned/unread localStorage 解析无防护（同文件 292 行有防护） | 包 try/catch 回退空集 |
| AUD-009 | P2 | store.tsx:448；Sidebar.tsx:319；SessionView.tsx:446；Markdown.tsx:112；SettingsPage.tsx:533；i18n.ts 词典 | 文案漏网：裸中文 alert ×2、硬编码 "Deep diving…"/"已复制"、t("New Chat") 反向、词典缺 保存/当前使用/返回工作区/新建会话 等键 | 全部收进 t()/tt()；跑一次英文 UI 截图核对漏网中文 |
| AUD-010 | P2 | Composer.tsx:141,145,19,363；Sidebar.tsx:383；store.tsx:351,392,359 | as any/any 掩盖：prompt content 类型未建模 image、icon any、projections any、mux frame any | api.ts 扩 content 联合类型；mux 回调用 MuxFrame 判别联合 |
| AUD-011 | P2 | i18n.ts:8 ↔ store.tsx:4 | 唯一循环依赖 | t() 显式传 lang 断环 |
| AUD-012 | P2 | FloatingBubble.swift:16-18,36,129,150 | 悬浮球偏好用旧 dsh.bubble.* 命名空间（军令违规+迁移盲区） | 迁 deepdive.bubble.* 带一次性读旧键 |
| AUD-013 | P2 | AppDelegate.swift:74-77,143-148 | 手拼 JSON 注入边 + 与 JSONSerialization 双轨 | 抽 jsonPayload() 统一 |
| AUD-014 | P2 | SessionView.tsx 1551 行/组件 409 行/ingest 114 行；SettingsPage 597；Sidebar 组件 280；StoreProvider 400/refresh 75；AppDelegate didFinishLaunching 110/handleHostMessage 76；MainWindowController.init 83；wsRelay 85 | B6 体积红线全清单（存量豁免但均为冷启动第一成本） | 阶段 2 拆分：SessionView 拆 ingest.ts+hook+子组件；SettingsPage 按_section 文件化；函数级拆 50 行内 |
| AUD-015 | P2 | App.tsx:113-141↔SessionView.tsx:318-353；Sidebar.tsx:381-386↔SettingsPage.tsx:533；App.tsx:82-90↔SessionView.tsx:153-176 | X1 重复实现三组（头部/标题回退/pickModel） | 抽 SessionHeader/sessionTitle；与 AUD-014 同期做 |
| AUD-016 | P2 | design/logo/exports/、preview-dock.png | README 宣称的事实源产物未入库未忽略（悬空） | 入库或 gitignore+README 注明 |
| AUD-017 | P2 | App.tsx:41,63；store.tsx:346,389；SessionView.tsx:269 等 5 处 | eslint-disable 注释指向不存在的 ESLint——工具性谎言 | 引 eslint（阶段 0，征用户同意）后生效；或删注释 |
| AUD-029 | P2 | frontend/package.json devDeps | vite 5.4.11 audit high（dev-only，esbuild GHSA-67mh-4wv8-2f99） | 升 vite 或显式记录接受 |
| AUD-030 | P3 | SessionView.tsx flow 区 | 超长会话 DOM 无上限（分页 120/页 + content-visibility 缓解，尚可） | 观察项；若用户报长会话卡顿再上虚拟化 |
| AUD-018 | P3 | EngineAuth.swift:36-38 | 引擎 cookie 进进程级共享 cookie store | 私有 cookie storage |
| AUD-019 | P3 | BridgeServer.swift:62-71 | /__deepdive_error 被 503 前置拦截 | 诊断路由前置 |
| AUD-020 | P3 | EngineEventObserver.swift:164,178 | pending 集合随机 ID 兜底可能泄漏 | 缺 id 即 return+日志 |
| AUD-021 | P3 | MiniHTTPServer.swift:97-135 | 无读超时/无 body 上限（本地信任边界内） | SO_RCVTIMEO + 大小上限 |
| AUD-015c | P3 | HotkeyRecorderWindow.swift:40-82 | 监听闭包体重复两份 | 提取 armMonitor() |
| AUD-023 | P3 | tokens.json size 段 | panel/settingsWindow/menuBarPopover 等生成后两端零引用 | 阶段 3 清理或等真用上 |
| AUD-024 | P3 | MainWindowController.swift:16-17,286 | 注释仍称 dshmini/__dshminiHost（实际 deepdive/__deepDiveHost） | 改注释 |
| AUD-025 | P3 | NativeAlerts.swift:73；RecoveryWindowController.swift:25 | 用户可见旧品牌 DSHmini | 换 DeepDive |
| AUD-026 | P3 | SessionView.tsx:1231 | key=`${seq}:${type}` 不稳（登记在案开放项） | 随 P2-6 snapshot store 决策一并处理 |
| AUD-027 | P3 | store.tsx:453-489 | memo 依赖表缺 refresh/createSession（靠 ref 约定成立） | useCallback 补齐或注释明示约定 |
| AUD-028 | P3 | i18n.ts:297 | useT 渲染期写模块状态 | 与 AUD-011 一并处理 |
| AUD-031 | P3 | Tokens.swift（生成物） | token→Swift 管线零消费方（B1：0 调用方抽象层） | 要么壳侧真消费（headerCenterY/侧栏宽改读 Tokens.Metric），要么砍 Swift 生成腿——现状最迷惑 |
| AUD-032 | P3 | theme.css:1065-1075,1152-1163,1083-1090 | "统一弹出配方"未覆盖 approval/question/queue 卡（各写一份 bg/shadow） | 收进统一配方或改注释范围 |

统计：P0 ×1、P1 ×5、P2 ×13、P3 ×13。

---

## 7. 健康度评分卡（各 1–5）

| 维度 | 分 | 一句话理由 |
|---|---|---|
| 边界清晰度 | **4.5** | 三层职责、文件名即地图、军令体系兜底；扣分：SessionView/theme.css 两个 God file、i18n⇄store 一处循环 |
| 复杂度控制 | **3.5** | 无框架魔法、无继承深渊、抽象极少；扣分：两个巨文件、token→Swift 死管线、Surfer 等未来预留、4 个零用依赖 |
| 正确性与安全 | **3.5** | 事故教训固化得好（Origin 校验/路径穿越/seq 守卫）；扣分：3 个静默失效真 bug（CSS 变量/通知名/快捷键谎言）+ EOF 忙等复发 |
| 测试保护（行为规格） | **1** | 零测试。唯一好消息：ingest/finalizeTurns/diffOps/parse 等核心逻辑是纯函数，补测试的边际成本很低 |
| 一致性 | **4** | t()/tt()、空 catch 注释、deepdive.* 命名大体贯彻；扣分：i18n 漏网一批、dsh.bubble.* 旧名、JSON 双轨、过时注释 |
| 工程规范 | **4** | build/tsc/严格模式全绿、版本引脚 fail-loud、交付链文档化；扣分：无 lint、无测试框架、audit 未处理、品牌资产悬空 |

**综合：3.4/5** —— 底子好、债务集中且全部可修。这份代码库在"AI 可维护性"上已优于绝大多数同规模项目（文档-事故-军令闭环是杀手锏），当前最大风险不是烂，而是**"看起来有保护其实没有"**（零测试 + 静默失效 bug + 规范漂移）。

---

## 8. 优化路线图（四阶段，按此顺序）

| 任务ID | 阶段 | 目标 | 涉及文件 | 风险 | 验证方式 | 规模 |
|---|---|---|---|---|---|---|
| R-001 | 0 保护网 | 引入 vitest（需用户点头，军令 7）；对 ingest/finalizeTurns/parseTodos/extractToolResult/types 判别联合 建** golden 事件回放**测试（用 PITFALLS §6.1 的真实 dump 做夹具） | 新增 frontend/src/**tests**、package.json | 低 | `npx vitest run` 绿 | M |
| R-002 | 0 保护网 | 壳补 XCTest：HotKeyManager.parse/hotkeySpec 往返、JSONValue.diffOps/at/setting、BridgeServer 静态路径穿越用例 | apps/macos 新 test target + project.yml | 低 | xcodebuild test 绿 | M |
| R-003 | 0 保护网 | 引 ESLint（typescript-eslint + react-hooks）并修到绿——5 处 disable 注释从谎言变真实约束；锁依赖（package-lock 已有，audit 决定见 R-012） | frontend 新增 eslint 配置 | 低 | `npx eslint src` 绿 | S |
| R-004 | 1 止血 | AUD-002 定义 --dur-fast/med/slow、--ease-out | theme.css 或 tokens.json | 低 | 交付链截图：ws 横滑/hero 入场/hover 过渡恢复 | S |
| R-005 | 1 止血 | AUD-003 通知名统一 com.deepdive.app.show | main.swift:12 | 极低 | 双开实例验证唤起 | S |
| R-006 | 1 止血 | AUD-004 EOF 置 nil readabilityHandler | EngineSupervisor.swift:205 | 极低 | 杀引擎进程后 Activity Monitor 观察 CPU 不空转 | S |
| R-007 | 1 止血 | AUD-005 快捷键表改真（删未实现） | SettingsPage.tsx:465-468 | 低 | 设置页截图 | S |
| R-008 | 1 止血 | AUD-006 移除 4 个零用依赖 + 改 ARCHITECTURE §4 zustand 表述 | package.json、docs/ARCHITECTURE.md | 低（先征用户） | npm run build 绿 + grep zustand 归零 | S |
| R-009 | 1 止血 | AUD-008 localStorage 防护；AUD-013 JSON 统一 | store.tsx、AppDelegate.swift | 低 | 手改坏 localStorage 值启动不白屏 | S |
| R-010 | 2 边界 | AUD-014 SessionView 拆分：ingest.ts（纯函数+ctx）+ useSessionEvents + useSessionModels + 子组件文件（每个 ≤300 行）；REVIEW-P2 的 P2-6（snapshot store）**不**借此顺手做——UI 需求稳定前不动渲染模型 | frontend/src/components/session/* | 中（有 R-001 测试兜底后可控） | vitest 全绿 + 交付链截图逐位比对 | L |
| R-011 | 2 边界 | AUD-015 抽 SessionHeader/sessionTitle/format 工具消三组重复 | App/SessionView/Sidebar/SettingsPage | 低 | 同上 | M |
| R-012 | 2 边界 | AUD-029 vite 升级消 audit；AUD-031 token→Swift 管线决策（消费或砍） | package.json、gen-tokens.mjs 或 MainWindowController | 中 | build + audit 0 漏洞 + 圆角截图（若动 token 面） | M |
| R-013 | 3 清理 | AUD-007 死代码批删（Surfer/Orbit/Dots、buildSha、openAtLogin、死类 .glass 等）；AUD-016 品牌资产入库决策；AUD-012 dsh.bubble.* 迁移；AUD-009/AUD-025 文案与品牌收口；AUD-024 过时注释修正 | 见台账 | 低 | tsc noUnused 零错误 + grep 核对 + 英文 UI 截图 | M |
| R-014 | 3 清理 | AUD-023 无消费 size token 清理；AUD-032 弹出配方统一或收窄注释；AUD-022/015c 壳侧小重复提取 | tokens.json、theme.css、HotkeyRecorderWindow | 低 | build + 截图 | S |

**路线原则**：0 未做完（测试红绿灯亮起）不进 2；R-010 动 SessionView 前必须先有 R-001 的事件回放夹具——这正是它至今没人敢拆的原因。所有前端/UI 改动走铁律 2 交付链。

---

## 附：本次审查的机器验证痕迹（供复核）

- 未定义 CSS 变量：`grep -rn "^\s*--dur-\|^\s*--ease" src/ packages/` 空结果；用法计数 theme.css 22 / SettingsRows 6。
- 死类扫描：237 类中 3 类无 word-boundary 引用 + `.glass`（仅注释引用）。
- 循环依赖：自写解析器 DFS，唯一环 i18n⇄store。
- 词典缺键：提取全部 `t("...")` 字面量对比 EN 词典。
- 依赖引用：`grep -rn "from \"<pkg>\"" src/` 逐包核对。
- 快捷键：`grep -rn "metaKey|KeyK|key === \"k\"" --include=*.tsx --include=*.ts` 零命中。
- Tokens.swift 消费方：`grep -rn "Tokens\." apps/macos/Sources`（除生成物自身）仅一条注释。
- __DSH_BUILD_SHA__ 消费方：仅 vite.config.ts 定义处。
- git 大 blob：`git rev-list --objects --all | git cat-file --batch-check` top5。
