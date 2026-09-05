# 全量深度体检报告 — 2026-09（第 3 版·已完成·已修复）

> **修复状态（2026-09-05）**：本版台账已全部处置完毕，分四批落地——
> ①`2ecf6cf` 前端止血（三 P1 + 同文件 P2）②`9fae1fb` 壳侧止血（observer/supervisor/bridge/runGit/超时）③`a1572f4` 边界与复杂度 + 清理（Composer 拆分/prefs 拆分/围栏 hook/死代码/脚本/命名）④文档批（PITFALLS §2.5/§4.9-4.12/§5/§8 沉淀 + 本报告状态回写）。
> 验证：vitest 112（+5 format）全绿、eslint 零错、tsc 严格零错、build 通过、xcodebuild 20 例全绿（+4 observer）；交付链 package→pkill→open 走完，引擎就绪/mux 观察器/host-ready 日志确认，DOM/computed-style 断言覆盖改动面（信号 token 解析、title= 归零 data-tip=24、拆分后 Composer 渲染）。**像素级截图目检在本环境不可用（图片读取通道返回 CDN 回执），已按 PITFALLS §5.3 如实记录并以 DOM 深检替代。**
> 查证结论文本见 §6.2 表内标注；坑已沉淀 docs/PITFALLS.md §2.5/§4.9-4.12/§5.4/§8。

> 评价标准唯一：**AI 下次冷启动接手时，能否快速、正确、低成本地理解和修改**。
> 审查方式：模块 1（前端核心层）由主审逐行详读；模块 2–6 由五个独立上下文的只读审查代理逐行读完，**全部 P1/P2 发现经主审回读原文逐条实证**（tok/s 计算、ModelDialog 回填、question 帧 schema 对照 vendored 引擎源、双 spawn、WS 双 close、runGit 主线程、dev.sh 吞错、pointercancel 缺失、AUD-050 迁移现状等均已亲验）；机器检查全跑；跨模块扫描（EN 词典缺键归零、死类、死导出、循环依赖）脚本核验。
> 本版取代第 2 版（v2 台账 AUD-001~060，其闭环状态在 §6 逐条对账；完整原文见 git 历史 commit 7a3a7a5）。本版新发现从 **AUD-061** 起编号。本报告未修改任何源码。

**审查进度**：✅ 全部完成（模块 1–6 + 跨模块分析 + v2 台账对账），无待查遗留。

---

## 1. 项目画像

**技术栈**：macOS 客户端三层混合。
- 壳：Swift + AppKit + WKWebView（XcodeGen，`apps/macos`，21 源文件 + 4 测试，零第三方依赖）
- 前端：React 18 + TypeScript(strict) + Vite(rolldown) + vitest + ESLint（依赖 react/lucide-react/highlight.js/katex/simple-icons，全主流）
- 引擎：dsh Node 子进程（vendored `deepseek-harness/` 按引脚嵌入，只读对照资产，不在体检范围）
- 样式：单文件 `theme.css`（3122 行）+ tokens 管线

**规模**：自有源码 122 文件 / 约 20,117 行。

**模块依赖图**（箭头 = import；总体单向）：

```
scripts/*            构建链叶子
apps/macos           main → AppDelegate → {MainWindowController, BridgeServer→MiniHTTPServer,
                     EngineSupervisor→{Gateway,Auth,EventObserver,Log}, HotKey/Dictation/StatusItem/Bubble/Alerts/Recovery}
frontend/src
  core               main → App → store → {api, host, keybinds}；i18n → store（单向）
  session/           ← SessionView 编排；依赖 core + components 呈现件
  components/        ← App / session/*；依赖 core + session 纯函数
  settings/ stats/   ← SettingsPage；依赖 core + components
  theme.css          ← 全部组件
```

文件级无循环依赖（v2 两环已断，本轮实证）；存在两处**目录级双向**（session⇄components、components⇄settings），ESM 可解析，记录为 X2。

**整体印象**：R-001~R-008 落地后 v2 的两大 P1 与 God-file 债务基本清偿（session/ 拆分、测试 107+16 全绿、i18n/品牌/打包链清账）。但本轮全量细读又发现 **3 个新的用户可见 P1**（store 改键不生效、tok/s 显示为秒数、模型编辑静默丢字段）和一批壳侧正确性 P2（question 状态卡死、退避窗双 spawn、WS 双 close、runGit 主线程死锁面、dev.sh 吞错）——规律与 v2 相同：**新 bug 都长在零测试覆盖的层**（hooks、设置弹窗、壳状态机），保护网仍只罩住纯函数层。

---

## 2. 审查覆盖清单（硬性要求）

处理方式：主审详读 / 代理详读（独立上下文逐行读完）；theme.css 为结构略读 + 死类脚本全量核验。单文件 >800 行（theme.css 3122）已按略读规则处理并附扫描法。

| 文件 | 行数 | 处理 |
|---|---:|---|
| frontend/src/store.tsx | 574 | 主审详读 |
| frontend/src/api.ts | 278 | 主审详读 |
| frontend/src/types.ts | 401 | 主审详读 |
| frontend/src/host.ts | 162 | 主审详读 |
| frontend/src/i18n.ts | 460 | 主审详读 |
| frontend/src/App.tsx | 190 | 主审详读（M3 代理复读） |
| frontend/src/keybinds.ts | 68 | 主审详读 |
| frontend/src/titlebar.ts | 62 | 主审详读 |
| frontend/src/diffModel.ts | 75 | 主审详读 |
| frontend/src/turnGroups.ts | 50 | 主审详读 |
| frontend/src/atGrammar.ts | 40 | 主审详读 |
| frontend/src/commands.ts | 26 | 主审详读 |
| frontend/src/planReview.ts | 31 | 主审详读 |
| frontend/src/useAtCandidates.ts | 47 | 主审详读 |
| frontend/src/useCompositionGuard.ts | 22 | 主审详读 |
| frontend/src/main.tsx | 12 | 主审详读 |
| frontend/src/css-modules.d.ts | 2 | 主审详读 |
| frontend/src/theme.css | 3122 | 代理略读：分区通读 + 376 自定义类逐类 grep 核验（排除 hljs-*/katex-* 与模板串误报） |
| frontend/src/session/renderModel.ts | 469 | 代理详读（M2） |
| frontend/src/session/useSessionEvents.ts | 213 | 代理详读（M2） |
| frontend/src/session/ToolRow.tsx | 271 | 代理详读（M2） |
| frontend/src/session/Cards.tsx | 191 | 代理详读（M2） |
| frontend/src/session/MessageRow.tsx | 131 | 代理详读（M2） |
| frontend/src/session/Item.tsx | 124 | 代理详读（M2） |
| frontend/src/session/ToolIcon.tsx | 117 | 代理详读（M2） |
| frontend/src/session/useSessionModels.ts | 97 | 代理详读（M2） |
| frontend/src/session/format.ts | 99 | 代理详读（M2） |
| frontend/src/session/QueueDock.tsx | 86 | 代理详读（M2） |
| frontend/src/session/SessionHeader.tsx | 77 | 代理详读（M2） |
| frontend/src/session/eventText.ts | 52 | 代理详读（M2） |
| frontend/src/session/sessionMention.ts | 52 | 代理详读（M2） |
| frontend/src/session/sessionTitle.ts | 11 | 代理详读（M2） |
| frontend/src/components/Composer.tsx | 618 | 代理详读（M3） |
| frontend/src/components/SettingsPage.tsx | 551 | 代理详读（M3/M4 复读） |
| frontend/src/components/Sidebar.tsx | 436 | 代理详读（M3） |
| frontend/src/components/StatusCapsule.tsx | 304 | 代理详读（M3） |
| frontend/src/components/Markdown.tsx | 283 | 代理详读（M3） |
| frontend/src/components/ModelMenu.tsx | 247 | 代理详读（M3） |
| frontend/src/components/SessionView.tsx | 245 | 代理详读（M3/M2 复读） |
| frontend/src/components/LoadingState.tsx | 149 | 代理详读（M3） |
| frontend/src/components/CapsuleGitSection.tsx | 145 | 代理详读（M3） |
| frontend/src/components/ProviderIcon.tsx | 134 | 代理详读（M3） |
| frontend/src/components/UsageMeter.tsx | 132 | 代理详读（M3） |
| frontend/src/components/Tooltip.tsx | 132 | 代理详读（M3） |
| frontend/src/components/GoalBar.tsx | 135 | 代理详读（M3） |
| frontend/src/components/ThinkingState.tsx | 113 | 代理详读（M3） |
| frontend/src/components/Icons.tsx | 173 | 代理详读（M3，对照 vendored） |
| frontend/src/components/ProjectMenu.tsx | 78 | 代理详读（M3） |
| frontend/src/components/PlanReviewCard.tsx | 66 | 代理详读（M3） |
| frontend/src/components/AttachmentImage.tsx | 64 | 代理详读（M3） |
| frontend/src/components/HoverScrollText.tsx | 58 | 代理详读（M3） |
| frontend/src/components/DiffBlock.tsx | 57 | 代理详读（M3） |
| frontend/src/components/AgentMode.tsx | 37 | 代理详读（M3） |
| frontend/src/components/HeroBrand.tsx | 32 | 代理详读（M3） |
| frontend/src/components/Lightbox.tsx | 23 | 代理详读（M3） |
| frontend/src/components/capsuleModel.ts | 63 | 代理详读（M3） |
| frontend/src/components/workspacePicker.ts | 14 | 代理详读（M3） |
| frontend/src/settings/ModelDialog.tsx | 367 | 代理详读（M4）+ 主审实证 |
| frontend/src/settings/ModelsManage.tsx | 243 | 代理详读（M4） |
| frontend/src/settings/SettingsRows.module.css | 471 | 代理详读（M4） |
| frontend/src/settings/controls.tsx | 156 | 代理详读（M4）+ 主审实证 |
| frontend/src/settings/archivedGroups.ts | 75 | 代理详读（M4） |
| frontend/src/settings/permissionPreset.ts | 54 | 代理详读（M4） |
| frontend/src/stats/usageStats.ts | 281 | 代理详读（M4） |
| frontend/src/stats/UsageHeatmap.tsx | 181 | 代理详读（M4） |
| frontend/src/stats/UsageTrend.tsx | 165 | 代理详读（M4） |
| frontend/src/stats/UsageSection.tsx | 131 | 代理详读（M4） |
| frontend/src/stats/UsageDonut.tsx | 120 | 代理详读（M4） |
| frontend/src/stats/UsageSection.module.css | 150 | 代理详读（M4） |
| frontend/src/stats/chartMath.ts | 37 | 代理详读（M4） |
| frontend/src/stats/ChartTip.tsx | 35 | 代理详读（M4） |
| apps/macos/Sources/DSHminiApp/AppDelegate.swift | 664 | 代理详读（M5）+ 主审实证 runGit |
| apps/macos/Sources/DSHminiApp/MainWindowController.swift | 489 | 代理详读（M5） |
| apps/macos/Sources/DSHminiApp/EngineSupervisor.swift | 331 | 代理详读（M5）+ 主审实证 spawn/start |
| apps/macos/Sources/DSHminiApp/FloatingBubble.swift | 277 | 代理详读（M5） |
| apps/macos/Sources/DSHminiApp/BridgeServer.swift | 263 | 代理详读（M5）+ 主审实证 WS/diag 路由 |
| apps/macos/Sources/DSHminiApp/EngineEventObserver.swift | 249 | 代理详读（M5）+ 主审实证 question 帧 |
| apps/macos/Sources/DSHminiApp/MiniHTTPServer.swift | 185 | 代理详读（M5） |
| apps/macos/Sources/DSHminiApp/JSONValue.swift | 179 | 代理详读（M5） |
| apps/macos/Sources/DSHminiApp/RecoveryWindowController.swift | 158 | 代理详读（M5） |
| apps/macos/Sources/DSHminiApp/NativeAlerts.swift | 145 | 代理详读（M5） |
| apps/macos/Sources/DSHminiApp/EngineGateway.swift | 144 | 代理详读（M5） |
| apps/macos/Sources/DSHminiApp/DictationController.swift | 129 | 代理详读（M5） |
| apps/macos/Sources/DSHminiApp/StatusItemController.swift | 124 | 代理详读（M5） |
| apps/macos/Sources/DSHminiApp/HotKeyManager.swift | 118 | 代理详读（M5） |
| apps/macos/Sources/DSHminiApp/DSHAppPrefs.swift | 112 | 代理详读（M5） |
| apps/macos/Sources/DSHminiApp/HotkeyRecorderWindow.swift | 91 | 代理详读（M5） |
| apps/macos/Sources/DSHminiApp/AppPaths.swift | 76 | 代理详读（M5） |
| apps/macos/Sources/DSHminiApp/EngineAuth.swift | 55 | 代理详读（M5） |
| apps/macos/Sources/DSHminiApp/EngineLog.swift | 38 | 代理详读（M5） |
| apps/macos/Sources/DSHminiApp/WebViewTheme.swift | 18 | 代理详读（M5） |
| apps/macos/Sources/DSHminiApp/main.swift | 22 | 代理详读（M5） |
| apps/macos/Tests/JSONValueTests.swift | 66 | 代理详读（M5） |
| apps/macos/Tests/HotKeyManagerTests.swift | 60 | 代理详读（M5） |
| apps/macos/Tests/EngineSupervisorTests.swift | 31 | 代理详读（M5） |
| apps/macos/Tests/BridgeServerTests.swift | 23 | 代理详读（M5） |
| frontend/src/__tests__/ 全部 14 文件 | 1193 | 代理详读（M6，逐例评估断言质量） |
| frontend/packages/design/gen-tokens.mjs | 72 | 代理详读（M6） |
| frontend/vite.config.ts | 25 | 代理详读（M6） |
| frontend/eslint.config.js | 23 | 代理详读（M6） |
| scripts/prepare-dsh-runtime.sh | 151 | 代理详读（M6） |
| scripts/embed-engine.sh | 106 | 代理详读（M6） |
| scripts/package-macos.sh | 33 | 代理详读（M6） |
| scripts/check-dsh-source.sh | 27 | 代理详读（M6） |
| scripts/dev.sh | 21 | 代理详读（M6）+ 主审实证 |
| scripts/test.sh | 16 | 代理详读（M6） |
| scripts/build-release.sh | 14 | 代理详读（M6） |
| scripts/embed-web.sh | 11 | 代理详读（M6） |
| scripts/build-frontend.sh | 10 | 代理详读（M6） |

（跳过：`deepseek-harness/` vendored 只读资产；`design/logo/` 种子工程；docs/*.md、tokens.json 等非源码。）

---

## 3. 机器检查结果（2026-09-05 本机实跑）

| 检查 | 结果 |
|---|---|
| `npm run build`（tsc -b + vite build） | ✅ 通过（350ms） |
| `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | ✅ 零错误 |
| `npm run test`（vitest） | ✅ 14 文件 / 107 例全绿 |
| `npm run lint` | ✅ 零报错 |
| `npm audit` | ✅ 0 vulnerabilities |
| `xcodebuild test`（壳 XCTest） | ✅ 16 例全绿 TEST SUCCEEDED |
| EN 词典缺键扫描（主审脚本） | ✅ 归零 |
| ⚠️ 单 JS chunk 813kB（gzip 265kB） | 沿用 AUD-059 观察项 |

---

## 4. 逐模块报告

### M1 前端核心与桥接层（17 文件，~2,900 行）——主审详读

一句话职责：写得出来（api=RPC 客户端、host/titlebar=壳桥、store=全局状态、types=wire 契约、i18n=词典、纯函数工具群）。依赖：最底层。冷启动：改 store ≈ 4 文件 1,415 行。适用 33 项通过 28 项。健康分 **4.5/5**。
问题：AUD-061（P1 memo deps）、AUD-062（P2 裸中文 alert）、AUD-063（P2 大文件膨胀）、AUD-064（P3 applyFrame）、AUD-065（P3 事件总线常量化）。

### M2 session/ 会话渲染层（14 文件，~2,050 行）——代理详读

一句话职责：写得出来（renderModel=事件流→RenderItem O(1) 摄取、useSessionEvents=live/poll 双源、组件群=呈现分流、纯函数群=format/eventText/mention/title）。上游 core+components；被 SessionView 编排。冷启动：核心链 5 文件 ~1,100 行。适用 26 项通过 18 项。健康分 **4/5**。
关键问题：**AUD-066（P1）tok/s 显示的是解码秒数**（renderModel.ts:426 无 tokens 分子，MessageRow.tsx:74 渲染为 tok/s，主审实证）；AUD-077 plan 芯条可能卡死【待确认】；AUD-083 setItems updater 内副作用靠 seq 守卫兜 StrictMode；AUD-084 审批卡无 in-flight 防重；AUD-085 乐观选模型失败不回滚；AUD-086 SessionHeader [face] 依赖致流式期监听重挂；AUD-087 "Auto"/"Plan ×" 裸文案【待确认】；AUD-114 死注释块×3+孤儿导出。
正面：IngestCtx O(1) 索引注释直引官方规则；对"为什么每个 case 都要 cast"的约束性注释；AUD-060 已收敛（key 由 renderModel seq 确定生成）。

### M3 components/ + theme.css（25 tsx/ts + css，~5,000 行）——代理详读

一句话职责：写得出来（呈现与交互层，SessionView 编排）。适用 9 大项通过 6 项。健康分 **3.5/5**。
关键问题：AUD-023 仍在（**Composer 486→618 行**，单组件函数 555 行，附件链路 +104 是膨胀主源）；AUD-041 半修（Sidebar 三分支齐、**ModelMenu 缺 pointercancel**：手势打断后监听永久滞留、滑杆卡死，主审实证）；AUD-088 Sidebar 归档失败裸中文 alert；AUD-089 拖拽 effect 闭包滞留旧语言；AUD-090 narrowGitStatus 死导出掩盖 host 弱收窄；AUD-091 手写色值违反 token 单一事实源（#FF9F0A×3 等）；AUD-092 SessionView 渲染体内每帧重建 keyIdx+全扫；AUD-093 focus-search effect [store] 依赖；AUD-094 effort 装饰动画最多 960 span；AUD-095 手写 {m} 插值绕开 tt()；AUD-096 不稳 key（附件 chip key={i}、todo key={content}）；AUD-097 openExternal 无 scheme 白名单；死类 4 处（capsule-commit-btn/task-row .row-btn/effort-row/model-menu-pill）；AUD-026/042/043/046/047/051/052 全部仍在。
正面：Tooltip 事件委托+自愈巡检；Sidebar 搜索 seq 门三件套；capsuleModel+回归钉文化。

### M4 settings/ + stats/（14 文件，~2,450 行）——代理详读

一句话职责：写得出来（settings=模型/密钥/预设管理走引擎 RPC，stats=纯前端用量聚合）。适用 9 大项通过 4 项。健康分 **3.5/5**。
关键问题：**AUD-067（P1）模型编辑不回填原字段**（ModelDialog.tsx:81-82 初始化空串、:173/:192 直接整条替换——编辑只改一项即静默丢 name/contextWindow，pi 编辑恒丢 contextWindow，主审实证）；**AUD-068（P2）自动发现失败漏 setDiscovering(false)**（:152-156，重试入口被锁死，主审实证）；AUD-025 仍在（Row/Section 死导出+引用不存在 CSS 类，主审实证零 import）；AUD-098 围栏 4 份无冲突重试+快照窗口；AUD-099 刷新失败静默显旧数据；AUD-100 死 revision 字段×3；AUD-101 keyIsConfigured 编辑态误报；AUD-102 编辑撞 id 无查重；AUD-103 controls.tsx 名不副实；AUD-104 stats 每次全量重拉（观察项）；AUD-105 错误态与空态混同。
stats 数据流（代理已对引擎 paginate 源核验）：session.list → 每会话 history 全翻页（排他锚点、页内升序、末尾归位，无重无漏）→ 纯函数折叠 O(事件数)；本地时区分桶口径一致；除零全有守卫。
正面：usageStats 纯函数+唯一 IO 入口分层；Dropdown 三次事故的因果注释；archivedGroups 哨兵设计。

### M5 apps/macos Swift 壳（25 文件，~4,000 行）——代理详读

一句话职责：写得出来（壳=OS 能力+进程监督，业务状态零经手，实测成立）。适用 29 项通过 18 项。健康分 **3.5/5**。
关键问题：**AUD-069（P2）question 帧解析违反铁律 9 且状态只进不出**（EngineEventObserver.swift:180 读不存在的 questionId 字段——引擎 schema events.schema.ts:51 只有 sessionId+questions；question/resolved（schema:52）完全未处理，pendingQuestions 只增不减，一次提问后"需注意"状态卡死，主审对照 vendored 源实证）；**AUD-070（P2）退避窗双 spawn**（start():52 有 process 守卫但不取消挂起 restartWorkItem；spawn():143 无守卫、:217 直接覆盖引用→首个引擎成孤儿进程，主审实证）；**AUD-071（P2）WS 泵双 close**（BridgeServer.swift:158-159/170-171 两条 detached 线程各关同一对 fd，二次 close 在 fd 复用窗口误关无关 socket，主审实证）；AUD-015 仍在且**新增 stderr 死锁面**（runGit 主线程同步 3 条 git + stderr Pipe 从不排空，超 64KB 缓冲即整 app 冻结，AppDelegate:345-383，主审实证）；AUD-037a/b 仍在（诊断路由 503 前置 ：62-71、recv/semaphore 无超时+body 无上限）；AUD-074 就绪即清零 attempts→秒崩循环永不升级；AUD-075 webRoot 缺失兜底托管家目录；AUD-076 JSONValue intValue 截断 Int64；AUD-077 boot token 明文落 engine.log；AUD-078 engine.log 无轮转；AUD-079 pickAttachments 主线程读整图；AUD-080 hidePanel 动画竞态；AUD-081 as? Bool 与 CFBoolean 纪律相悖；AUD-082 旧名注释×2；AUD-083(M5-22) EngineSupervisor 331 行越线；AUD-029/035/036/038/039/034 全部仍在。
正面：Origin 全等闸的事故叙事注释；drainLines 事故→修复→静态函数→XCTest 钉的完整闭环；"看似死代码勿删"约束写足。
测试评估：16 例罩住设置面 diff/热键/UTF-8 分片/穿越守卫；**手写风险最高的 readRequest/route/probe/observer 帧映射零测试**——AUD-069/037 本会被测出。

### M6 scripts/ + 测试资产 + 工程配置（~25 文件 + 14 测试文件）——代理详读

一句话职责：写得出来（构建链引脚 fail-loud，dev 短链，测试资产全 mock）。适用 8 类通过项见 §3/§6。健康分 **4/5**。
关键问题：**AUD-072（P2）dev.sh 管线吞错**（:7-10 `xcodebuild | tail -5` 无 pipefail，构建失败被洗白后 embed-web 把新 web 嵌进旧 .app 且 open 成功退出码 0——同坑 test.sh 已修、dev.sh 漏网，主审实证）；AUD-106 陈锁自旋无超时；AUD-107 RUNTIME_SOURCE 外部源未校验【待确认是否 dev 逃生门】；AUD-108 cp||true 吞错；AUD-109 双重深签耗时；AUD-110 .build 目录缺失首跑炸；AUD-111 脚本风格分裂+dev.sh bashism（AUD-053 残留）；AUD-033/054/056 死码三项仍在；AUD-112 tsconfig/eslint 不覆盖 vite.config 与 eslint.config 自身；AUD-113 phase1/2/5/6 测试命名与模块脱节（无 3/4、renderModel 测试散在 4 文件）。
测试质量：H2 通过（107 例全部真断言、测试名即行为、无烟雾测试）；H3 通过（fetch 全 mock、零真实服务、固定时钟）；覆盖矩阵：12 模块全覆盖、4 部分、**纯逻辑层 8 模块零覆盖（format/eventText/sessionTitle/permissionPreset/workspacePicker/keybinds/useAtCandidates/i18n 键奇偶性）、组件与 hooks ~44 文件零覆盖**。
正面：test.sh "输出落盘再截尾"是管线退出码正解；prepare 双检锁；api.test.ts 每条断言锚定 PITFALLS 条款。

---

## 5. 跨模块问题

**X1 全局重复实现**：①时长格式化 **×4**（StatusCapsule elapsed / session/format.ts formatRunDuration / stats/usageStats formatDuration / LoadingState useElapsed 内联）+ renderModel retryText 内联拼秒——AUD-047 扩大；②goal 阶段标签表 ×2（AUD-046）；③settings.update 围栏 ×4 份（AUD-006→AUD-098）；④裸中文 alert ×2（store.tsx:515 AUD-062、Sidebar.tsx:372 AUD-088）；⑤手写 {m} 插值绕开 tt() ≥5 处（AUD-095）；⑥原生 title= vs data-tip 混用（AUD-051，components 3 处+session 4 处）；⑦错误处理三风格并存（alert / 静默 catch / 行内 error 态）。

**X2 循环/单向违规**：文件级零循环（脚本+代理核验）；目录级双向两处：session⇄components（SessionHeader→Sidebar）、components⇄settings（SettingsPage→ModelDialog→ProviderIcon；controls.tsx 全局控件住在 settings/ 下，AUD-103）。

**X3 风格一致性**：G1 概念用词基本统一（RPC 只走 api.ts、壳桥只走 host.ts 实测无第二份）；G2 错误处理见 X1-⑦；导出风格 AUD-052；词典纪律良好（EN 缺键归零，仅 2 处裸中文漏网）。

**X4 孤岛代码**：narrowGitStatus（死导出+真收窄被 host 弱内联替代，AUD-090）、controls Row/Section（AUD-025）、LoadingState Surfer 全套（AUD-026）、vite buildSha define（AUD-033）、AppPaths.openAtLogin（AUD-034）、tokens shadow/motion 死数据（AUD-054）、三处 revision 死字段+ArchivedRow（AUD-100）、死注释块×3（AUD-114）、theme.css 死类 4 处（AUD-031 残留）。

**X5 该沉淀未沉淀**：时长格式化应收敛 format.ts；git 收窄应让 host 消费 capsuleModel.narrowGitStatus；围栏应抽 useSettingNamespace；i18n 键奇偶性扫描应从一次性脚本沉淀为测试。

**X6 冷启动成本 Top 5**：①store.tsx(574)+api+types+host ≈1,415 行（全局状态+桥+契约一站式）；②Composer.tsx 618（草稿/附件/菜单/听写/发送全在一个函数）；③AppDelegate.swift 664（生命周期+指令路由+git+偏好）；④theme.css 3,122（改任何 UI 必搜）；⑤壳网络/监督三件套 BridgeServer+MiniHTTPServer+EngineSupervisor ≈780（手写 HTTP/WS/进程状态机）。

---

## 6. 全局问题总台账（v3；v2 项沿用原编号对账）

### 6.1 v2 台账（AUD-001~060）对账结论

**已修/失效（实证）**：AUD-005（三组重复已收敛 sessionTitle/SessionHeader/modelOptions）、AUD-011（两循环断）、AUD-012、AUD-013（R-003）、AUD-014（EN 缺键归零，本轮脚本复核）、AUD-016（用户可见品牌归零）、AUD-018、AUD-021、AUD-022（session/ 拆分全 ≤469）、AUD-024（守卫在 ModelDialog:170-171）、AUD-028、AUD-030、AUD-032、AUD-040、AUD-044（文件已删）、AUD-053 半修（make test 已有；bashism 残留→AUD-111）、AUD-060（key 已由 renderModel 稳定生成；新增他处不稳 key→AUD-096）。
**仍在→本轮已清**：下表"仍在"各项中，AUD-006/015/017/023/025/026/029/031/033/034/035/036/037/038/039/041/042/043/046/047/048/049/050/051/052/054/056 已全部在 a1572f4/9fae1fb 修复（含 031 死类清零+LoadingState 连带死类、047 收敛 formatElapsed、049 壳桥 10s 超时）；AUD-059/104 维持观察/接受。
**仍在（位置随代码演进迁移）**：AUD-006（6→4 份，→AUD-098）、AUD-015（+stderr 死锁新面）、AUD-017（R-006 修 4 处后又长出新实例：Composer×5、useSessionEvents×2、MessageRow:50、UsageSection 等）、AUD-023（Composer 反涨至 618）、AUD-025、AUD-026、AUD-029、AUD-031（死类 10→4）、AUD-033、AUD-034、AUD-035、AUD-036、AUD-037a/b、AUD-038、AUD-039、AUD-041（ModelMenu 侧）、AUD-042、AUD-043、AUD-046、AUD-047（×4 扩大）、AUD-048（部分）、AUD-049、AUD-050（迁移至 useSessionEvents.ts:106）、AUD-051、AUD-052、AUD-054、AUD-056、AUD-059。

### 6.2 本版新台账（AUD-061 起）

> **处置结论（2026-09-05 修复批）**：AUD-061~068、070~078、080~097、099~114 **全部已修**（批次见文件头四条提交）；AUD-073 查证**不成立**（引擎 plan 投影键常驻纯折叠，已注释定论）；AUD-079 已后台化；AUD-083 已备案（EngineSupervisor 尾注）；AUD-087 维持现状（"Auto"/"Plan ×" 为品牌英文，两语言同形，与词典既有 "Default": "Default" 同类）；AUD-104 维持观察（stats 全量重拉无缓存，会话量大或用户反馈慢再做增量）；AUD-059 维持接受（chunk 813kB 本地壳加载可感前不做分割）。AUD-069→按 schema 重写并补 4 例表驱动测试；AUD-072 连带 Makefile 侧 `sh scripts/*` 经实测在 POSIX 模式下兼容，未强改。

| 编号 | 级别 | 位置 | 问题 | 建议修复方式 |
|---|---|---|---|---|
| AUD-061 | **P1** | frontend/src/store.tsx:570 | value memo deps 漏 keybinds/hotkeyOn，运行中改键不生效（启动期被 prefs 批量下发掩盖） | 补 deps + 手工验证路径 |
| AUD-066 | **P1** | frontend/src/session/renderModel.ts:426 | tokensPerSecond 算的是解码秒数（无 tokens 分子），MessageRow.tsx:74 渲染为 "N tok/s"——12.5s 解码显示 "12.5 tok/s"；官方口径 outputTokens÷解码秒，ctx.turnUsage 就在手边 | 分子取 turnUsage.outputTokens；session-ingest.test.ts 补带 usage 夹具的钉 |
| AUD-067 | **P1** | frontend/src/settings/ModelDialog.tsx:81-82,173,192 | 编辑目录条目不回填原字段：modelName/modelContext 初始空串、保存整条替换——只改一项即静默丢 name/contextWindow；pi 编辑恒丢 contextWindow | 打开编辑时从 knownModels 回填；pi 编辑保留原 contextWindow |
| AUD-068 | P2 | frontend/src/settings/ModelDialog.tsx:152-156 | save 内自动发现失败 catch 漏 setDiscovering(false)——发现按钮永久禁用锁死重试入口 | catch 分支补复位 |
| AUD-069 | P2 | apps/macos/…/EngineEventObserver.swift:178-195 | question/requested 读不存在的 questionId 字段（UUID 兜底）；question/resolved 未处理——pendingQuestions 只进不出，"需注意"卡死到引擎重启（schema 对照实证） | 按 schema：requested 直取契约字段；补 resolved 配对移除 |
| AUD-070 | P2 | apps/macos/…/EngineSupervisor.swift:50-55,143,217,325-329 | start() 不取消挂起 restartWorkItem 且 spawn() 无 process 守卫：退避窗内点重启→双引擎孤儿进程共用 DSH_HOME | start() 先 cancel；spawn() 前置守卫 |
| AUD-071 | P2 | apps/macos/…/BridgeServer.swift:149-172 | WS 泵两条线程各 close 同一对 fd：二次 close 在 fd 复用窗口误关无关 socket；应 shutdown 唤醒对端 | 单一属主 close + shutdown |
| AUD-072 | P2 | scripts/dev.sh:7-10 | xcodebuild\|tail 无 pipefail：构建失败被洗白，embed-web 嵌新 web 进旧 .app、open 成功、退出码 0 | 抄 test.sh 落盘再截尾 |
| AUD-073 | P2 | frontend/src/session/useSessionEvents.ts:151-154 | plan 投影键被引擎移除时 setPlan 不清空，Plan ×芯条卡死【待确认引擎键生命周期】 | 无条件 setPlan(planVal?…:undefined) 或查实后注释 |
| AUD-062 | P2 | frontend/src/store.tsx:515 | 裸中文 alert（同病 Sidebar.tsx:372=AUD-088） | 词典键 + tt() |
| AUD-063 | P2 | store.tsx(574)/i18n.ts(460)/types.ts(401) | 超限文件继续膨胀：偏好类状态全堆 StoreProvider | 拆 prefsSlice |
| AUD-023+ | P2 | frontend/src/components/Composer.tsx（618） | v2 台账项无视续涨（附件链路+104）；AUD-083 同类：EngineSupervisor 331 越线 | 拆三 hook；壳侧新逻辑另开文件 |
| AUD-074 | P3 | EngineSupervisor.swift:295 | 就绪即清零 attempts：秒崩循环永不升级 failed，无界 churn | 时间窗判定 |
| AUD-075 | P3 | BridgeServer.swift:214 | webRoot 缺失兜底托管整个家目录（危险方向的兜底，违铁律 10） | 缺失即整体 503 |
| AUD-076 | P3 | JSONValue.swift:27 | NSNumber.intValue 为 Int32：Int64 毫秒时间戳静默截断 | int64Value |
| AUD-077 | P3 | EngineSupervisor.swift:290 | 就绪行含 boot token 原文明文落 engine.log | 落日志前脱敏 |
| AUD-078 | P3 | EngineLog.swift:21-30 | engine.log 只增不转，磁盘无界 | 大小截断 |
| AUD-079 | P3 | AppDelegate.swift:448-480 | pickAttachments 主线程读整图+base64 卡 UI | 后台读回主线程推 |
| AUD-080 | P3 | MainWindowController.swift:343-366 | hidePanel 完成回调无条件 orderOut，动画窗内再 show 被盖 | 回调校验当前意图 |
| AUD-081 | P3 | AppDelegate.swift:235 | set-theme as? Bool 与同函数 CFBoolean 纪律相悖 | 同 CFBoolean 分流 |
| AUD-082 | P3 | MainWindowController.swift:16,286；EngineSupervisor.swift:250 | 注释引用旧名 dshmini/__dshminiHost（实际 deepdive/__deepDiveHost） | 更正注释 |
| AUD-084 | P3 | session/useSessionEvents.ts:124-135 | setItems updater 内副作用（log.push/ingest），StrictMode 双调用靠 seq 守卫兜住 | 移出 updater 或注释声明幂等依据 |
| AUD-085 | P3 | session/Cards.tsx:12-20 | ApprovalCard 无 in-flight 防重（QuestionCard 有，不对称） | 补 pending 禁用 |
| AUD-086 | P3 | session/useSessionModels.ts:71-90 | 乐观选模型/档位失败不回滚，UI 与引擎持续脱钩 | 失败回滚或重拉校正 |
| AUD-087 | P3 | session/SessionHeader.tsx:56 等 | "Auto"/"Plan ×" 裸文案【待确认是否有意】 | 入词典或 UI-SPEC 注明 |
| AUD-088 | P3 | components/Sidebar.tsx:372 | 归档失败裸中文 alert + 两处错误风格并存 | tt() + 统一策略 |
| AUD-089 | P3 | components/Composer.tsx:276-323 | 拖拽 effect 按首渲染闭包：切语言后 drop 提示滞留旧语言 | 文案读全局态 |
| AUD-090 | P3 | components/capsuleModel.ts:28-33 | narrowGitStatus 零调用，host.ts:66-69 用更弱内联——死导出掩盖校验缺口 | host 消费 narrowGitStatus 或删 |
| AUD-091 | P3 | theme.css:2506,2593,2627 等 | 手写语义色（#FF9F0A×3/#e5484d/#3A3A40/#7FDBCA）违反 token 唯一事实源 | 入 tokens.json |
| AUD-092 | P3 | components/SessionView.tsx:144-201 | 渲染体内每帧重建 keyIdx Map+全量扫（流式期线性成本） | useMemo 化 |
| AUD-093 | P3 | components/Sidebar.tsx:63-70,299 | focus-search effect [store] 依赖每 tick 重挂；列表无虚拟化 | 稳定依赖；量大再虚拟化 |
| AUD-094 | P3 | components/ModelMenu.tsx:229-234 | effort 装饰网格最多 960 个独立动画 span | 限规模或改渐变 |
| AUD-095 | P3 | SettingsPage.tsx:136,274,338；ModelDialog.tsx:117,153,203 | t("…{m}").replace 手写插值 ≥5 处，绕开 tt() 契约 | 改 tt |
| AUD-096 | P3 | Composer.tsx:461；StatusCapsule.tsx:207,219 | 可删除列表 key={i}、todo key={content}（内容重复即撞键） | attachmentId/拼序号 |
| AUD-097 | P3 | components/Markdown.tsx:163-166 | openExternal 不校验 scheme（javascript: 可达 window.open 兜底） | http(s)/file/mailto 白名单 |
| AUD-098 | P3 | settings/ 围栏 4 份 | expectedRevision 无冲突重试；弹窗快照距写可达分钟级（单客户端风险低） | 共享 hook+冲突提示 |
| AUD-099 | P3 | stats/UsageSection.tsx:47-72 | 有旧数据时刷新失败全静默（未注释的隐式降级） | 提示或显式注释 |
| AUD-100 | P3 | ModelsManage.tsx:40-41 等 | 死 revision 字段×3 + ArchivedRow 死导出 | 删 |
| AUD-101 | P3 | ModelDialog.tsx:105 | keyIsConfigured 编辑态无条件宣称已配置（误导） | 去 `\|\| !!edit` |
| AUD-102 | P3 | ModelDialog.tsx:173-174 | 编辑改 id 撞既有条目无查重 | 先 filter 再替换 |
| AUD-103 | P3 | settings/controls.tsx | 全局共享控件住在 settings/ 下（目录即地图违例+层级双向） | 迁 components/ |
| AUD-104 | P3 | stats/usageStats.ts | 每次进设置页全量重拉（1+Σ⌈E/500⌉ 次 RPC），观察项 | sessionId+mtime 增量缓存（若慢） |
| AUD-105 | P3 | ModelsManage.tsx:102 | 拉取失败降级文案把"失败"说成"没配置" | 分错误态/空态 |
| AUD-106 | P3 | scripts/prepare-dsh-runtime.sh:131 | 陈锁（SIGKILL 后 .prepare.lock 永存）无限自旋 | 锁龄检测 |
| AUD-107 | P3 | scripts/embed-engine.sh:37-40 | 外部 RUNTIME_SOURCE 不做版本校验【待确认是否 dev 逃生门】 | 补校验或注释声明 |
| AUD-108 | P3 | scripts/embed-engine.sh:84 | cp 失败被 \|\| true 无声吞 | \|\| warn |
| AUD-109 | P3 | package-macos.sh:27 + embed-engine.sh:80 | 同 bundle 深签两次纯耗时 | 去重 |
| AUD-110 | P3 | scripts/test.sh:12 | fresh clone 首跑 .build 不存在重定向先炸 | 前置 mkdir -p |
| AUD-111 | P3 | scripts/ 风格 | sh/bash 三种头部+euo pipefail 不齐；dev.sh:15 bashism | 统一 bash+euo pipefail |
| AUD-112 | P3 | frontend/tsconfig.json:20-22 | vite.config/eslint.config 落在 tsc 与 eslint 双覆盖外 | include 补齐 |
| AUD-113 | P3 | __tests__/phase*.test.ts ×4 | 命名与模块脱节（无 3/4、renderModel 测试散 4 文件） | 按模块语义重命名 |
| AUD-114 | P3 | session/ 死注释×3 + eventText messageReasoning 孤儿导出 | 搬迁残留清理 | 删 |

统计（v3 增量）：P0 ×0、**P1 ×3**、P2 ×9（AUD-062/063/068/069/070/071/072/073+AUD-023 续）、P3 ×33；另有 v2 沿用未闭环 24 项（§6.1）。

---

## 7. 健康度评分卡

| 维度 | 分 | 一句话理由 |
|---|---|---|
| 边界清晰度 | **4.5** | 文件名即地图、职责注释全覆盖、依赖单向（文件级零循环）；扣分：controls 层级错位、目录级双向×2 |
| 复杂度控制 | **3.5** | 无框架魔法、抽象克制、依赖全主流；扣分：Composer 618 续涨、死代码一批（死类 4+死导出 6+死 define/token 死数据）、EngineSupervisor 越线 |
| 正确性与安全 | **3** | 事故教训固化好、注入/穿越/Origin 防线扎实；扣分：3 个 P1 + question 卡死/双 spawn/WS 双 close/runGit 死锁面/dev.sh 吞错，且 AUD-015/037 拖三轮未清 |
| 测试保护（行为规格） | **3.5** | 107+16 全绿、真断言、零外部依赖、回归钉文化；扣分：纯逻辑 8 模块+hooks/组件 ~44 文件零覆盖，本轮 3 个 P1 又全部长在缺口里 |
| 一致性 | **3.5** | 词典纪律好（EN 缺键归零）；扣分：时长格式化 ×4、围栏 ×4、错误处理三风格、alert×2、手写插值×5 |
| 工程规范 | **4.5** | 七项机器检查全绿、引脚 fail-loud、构建链自检；扣分：dev.sh 吞错、脚本风格分裂、tsconfig 盲区 |

**综合：3.7/5** —— 与 v2（3.5）相比工程化继续向好（拆分/词典/打包链清账兑现），但"保护网与 bug 分布错位"的结论连续第三版成立：**每次体检新发现的 P1 都恰好长在零测试层**。当前最高杠杆动作不是继续修单点，而是把测试网从纯函数层扩到 hooks/设置弹窗/壳状态机层（见路线图阶段 0）。

---

## 8. 优化路线图（四阶段，按此顺序）

| 任务ID | 阶段 | 目标 | 涉及文件 | 风险 | 验证方式 | 规模 |
|---|---|---|---|---|---|---|
| R3-1 | 0 保护网 | 三个 P1 先钉后修的测试：①session-ingest 补带 usage 的 tok/s 钉（AUD-066）②ModelDialog 编辑回填行为钉（AUD-067）③store keybinds 生效钉（AUD-061）；④EngineEventObserver 按 schema 表驱动测试（AUD-069 前置）⑤MiniHTTPServer.readRequest 解析测试（AUD-037 前置） | __tests__/、apps/macos/Tests/ | 低 | vitest+xcodebuild 绿 | M |
| R3-2 | 1 止血 | 修三 P1：AUD-061 补 deps、AUD-066 分子取 turnUsage、AUD-067 编辑回填 | store.tsx / renderModel.ts / ModelDialog.tsx | 低 | R3-1 钉转绿 + 手工三链 | S |
| R3-3 | 1 止血 | 设置弹窗与状态机止血：AUD-068 discovering 复位、AUD-069 question resolved 配对、AUD-070 双 spawn 守卫、AUD-071 WS 单属主 close | ModelDialog / EngineEventObserver / EngineSupervisor / BridgeServer | 中（壳侧手写状态机） | 单测 + 手测提问/退避窗重启/长连接 | M |
| R3-4 | 1 止血 | AUD-015 runGit 后台化+stderr 排空；AUD-072 dev.sh pipefail；AUD-050 首屏失败显式化 | AppDelegate.swift / scripts/dev.sh / useSessionEvents.ts | 低 | 大仓库 git 胶囊不卡 UI；删源文件制造构建失败验证 dev.sh 即停 | S |
| R3-5 | 2 边界 | 拆分与收敛：AUD-023 Composer 三 hook（618→≤300×n）、AUD-063 prefsSlice、AUD-047 时长格式化收敛 format.ts（×4→1）、AUD-006/098 useSettingNamespace（×4→1）、AUD-046 阶段表并入 capsuleModel | Composer/store/format/settings | 中 | 全量 test + 交付链截图 | L |
| R3-6 | 2 边界 | 壳侧边界：AUD-037 超时/body 上限/诊断路由前置、AUD-074 重启风暴窗口、AUD-090 host 消费 narrowGitStatus | MiniHTTPServer/BridgeServer/EngineSupervisor/host.ts | 中 | readRequest 测试 + 手测 | M |
| R3-7 | 3 清理 | 死代码批删（AUD-025/026/031/033/034/054/100/114）、命名统一（AUD-052/103/113）、手写色值入 token（AUD-091）、注释清理（AUD-017 新实例/AUD-082）、AUD-095 插值改 tt、AUD-088/062 alert 入词典、AUD-111 脚本统一、AUD-112 tsconfig 补盲区 | 全仓散点 | 低 | tsc noUnused 零错 + 死类脚本零命中 + lint | M |
| R3-8 | 3 清理 | 观察项处置记录：AUD-059 chunk（接受）、AUD-104 stats 缓存（按反馈）、AUD-073/087/107【待确认】三项查证引擎源码后定论 | docs + 个别文件 | 低 | — | S |

**路线原则**：延续 v2 的"先测后改"——R3-2/R3-3 动手前必须先有 R3-1 的钉；壳侧状态机（AUD-069/070/071）修复时顺手落表驱动测试，补上 v2 以来一直缺失的 observer/readRequest 罩面。前端/UI 改动走铁律 2 交付链。

---

## 附：本轮主审实证痕迹（供复核）

- AUD-061：store.tsx:570 deps 数组逐项比对，keybinds/hotkeyOn 缺席（value 对象 :538-541 引用二者）。
- AUD-066：renderModel.ts:426 原文 `Math.round(((runMs - ttftMs) / 1000) * 100) / 100` 无 tokens 分子；MessageRow.tsx:74 `formatTokensPerSecond(tokensPerSecond)} tok/s`；同作用域 :440 `ctx.turnUsage.get(turn)` 可取分子。
- AUD-067：ModelDialog.tsx:81-82 `useState("")`、:173-175/:191-193 整条替换原文。
- AUD-068：:143 setDiscovering(true)→:152-156 catch 分支无复位（成功路径 :157 有）。
- AUD-069：vendored 引擎 `packages/host/apiproxy/src/api/events.schema.ts:51-52`——requested={sessionId,questions}（无 questionId）、resolved={sessionId,questionRpcId,outcome}；Observer :178 匹配式 `contains("request")` 接不住 resolved，:180 读不存在的 questionId。
- AUD-070：start():52 有 process 守卫但不 cancel restartWorkItem（仅 stop():73 cancel）；spawn():143 无守卫、:217 `self.process = process` 无条件覆盖；restartWorkItem :325-329 持有 spawn 闭包。
- AUD-071：BridgeServer.swift:158-159 与 :170-171 两条 detached 线程各 `close(upstream); close(client)`。
- AUD-015+stderr：AppDelegate.swift:345-383 runGit 同步 readDataToEndOfFile+waitUntilExit，:358 `process.standardError = Pipe()` 从不读取（call site :269-270 在 WKScriptMessage 主线程回调内）。
- AUD-072：dev.sh `set -e`（/bin/sh 无 pipefail）+ `xcodebuild … | tail -5`。
- AUD-041 半修：ModelMenu.tsx:190-204 仅挂 pointermove/pointerup（SidebarResizer:409-415 三分支对照）。
- AUD-050：useSessionEvents.ts:106 `.catch(() => void 0)`（首屏 loadPage 链）。
- AUD-025：全仓仅 `import { Dropdown[, Toggle] }`（AgentMode.tsx:7、SettingsPage.tsx:9），Row/Section 零 import。
- EN 词典缺键：主审 node 脚本扫描全部非测试 t() 字面量 → 0 missing。
