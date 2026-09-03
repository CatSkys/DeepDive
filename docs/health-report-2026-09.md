# 全量深度体检报告 — 2026-09（第 2 版）

> 审查人：AI（资深架构师+代码审查员视角）。评价标准唯一：**AI 下次冷启动接手时，能否快速、正确、低成本地理解和修改**。
> 审查方式：逐文件详读全部自有源码（不抽样；组件批与壳小文件批由两个只读审查代理逐行读完、其 P1/P2 级发现经主审逐条抽查实证）+ 机器检查 + 脚本实证扫描（循环依赖/死类/未定义 CSS 变量/词典缺键/未用导出均为脚本核验）。
> 本报告只审查与规划，未修改任何源码。
> **本版取代同月第 1 版**（commit e80bc45 之后的 48 个提交大幅演进：测试框架落地、ESLint 落地、依赖清理、~30 个新文件）。第 1 版台账逐条复核结果见 §9。

**审查进度**：✅ 全部完成（M1–M11 全部模块 + 跨模块分析 + 旧台账复核）。本次为单会话分批完成（批次：①前端核心通道 ②SessionView ③组件/设置/测试 ④样式 token ⑤壳 Swift ⑥脚本/构建 ⑦跨模块扫描），无待查遗留。

---

## 1. 项目画像

**技术栈**：macOS 客户端，三层混合——
- 壳：Swift + AppKit + WKWebView（XcodeGen 生成工程，无第三方 SwiftPM 依赖）
- 前端：React 18 + TypeScript(strict) + Vite 8 + vitest 4 + ESLint 10；依赖面干净（react/lucide-react/highlight.js/katex/simple-icons，全部主流）
- 引擎：dsh 子进程（vendored Node 运行时闭包，版本引脚 `scripts/dsh-runtime-version.txt`）
- 设计 token：tokens.json → gen-tokens.mjs → tokens.css（Web 消费）+ Tokens.swift（壳侧**仍零消费**）

**规模**（自有源码，不含 vendored 副本）：约 96 个源码/配置文件 / 约 17,900 行。最大文件：theme.css 2976、SessionView.tsx 2056（+505 vs 上版）、SettingsPage.tsx 631、AppDelegate.swift 581、store.tsx 518、MainWindowController.swift 489、Composer.tsx 478。vendored `deepseek-harness/` 9078 文件/79MB 为只读对照资产。

**模块划分与依赖图**（文字版，箭头 = import/调用）：

```
M1 前端核心通道   main.tsx → App.tsx → {Sidebar, SessionView, SettingsPage, Composer, ModelMenu, Tooltip}
                  store.tsx → {api.ts, host.ts, i18n.ts, types.ts}；i18n.ts ⇄ store.tsx（循环①）
                  纯逻辑层（新）：atGrammar/commands/planReview/turnGroups/diffModel/useCompositionGuard/useAtCandidates
                  turnGroups.ts ⇄ SessionView.tsx（循环②，type-only，运行时无害）
M2 前端会话渲染   SessionView → {Markdown, ThinkingState, LoadingState, Icons, Composer, ModelMenu,
                  DiffBlock, PlanReviewCard, UsageMeter, GoalBar, StatusCapsule, AttachmentImage, turnGroups}
M3 前端输入/导航  Composer/ModelMenu/Sidebar/SettingsPage → {store, api, host, i18n, atGrammar, useAtCandidates}
                  settings/{controls, ModelCatalog, PluginConfigCards, permissionPreset} ← SettingsPage
M4 样式与 token   theme.css → @import packages/design/generated/tokens.css ← gen-tokens.mjs ← tokens.json
M5 壳应用骨架     main.swift → AppDelegate → {MainWindowController, StatusItemController, HotKeyManager,
                  RecoveryWindowController, DictationController, FloatingBubble, NativeAlerts}
M6 壳引擎监督族   AppDelegate → EngineSupervisor；EngineEventObserver → {EngineGateway, EngineAuth,
                  FloatingBubble, NativeAlerts, StatusItemController}
M7 壳桥与网络     AppDelegate → BridgeServer → {MiniHTTPServer, EngineAuth}
M8 壳系统能力面   NativeAlerts/FloatingBubble → AppDelegate.shared（回环，AppKit 惯例）；Tokens.swift 生成物零消费
M9 构建与脚本     Makefile → scripts/* → {frontend build, xcodegen, xcodebuild, embed, codesign, DMG}
M10 设计种子      design/logo/（自包含，独立于产品链；exports 已入库）
M11 vendored      deepseek-harness/（对照资产，无 import 关系）
```

依赖方向总体单向，循环共 2 处（见 AUD-011/AUD-012）。

**整体印象**：距上版体检后工程化明显补课——测试从 0 → 59 前端 + 14 壳侧全绿、ESLint 落地、4 个零用依赖清除、vite 升 8.x 消掉 audit、旧报告 11 项 P1/P2 已修复。纯逻辑下沉（capsuleModel/diffModel/atGrammar/turnGroups/planReview + vitest 钉子）是新亮点，正是"AI 可维护"的正确方向。**但本次全量细读发现了两个上版漏网的用户可见 P1 真_bug（Markdown 链接/图片渲染错位、归档页无限拉取），恰好都长在零测试覆盖区**——保护网还只罩住了纯函数层，渲染层与设置页仍是裸奔。其余债务集中在：SessionView/Composer 持续膨胀、标题回退/时长格式化/settings.update 链三组跨文件复制、品牌与命名空间残留扩散、打包链两处静默断点。

---

## 2. 审查覆盖清单（硬性要求）

处理方式：**详读**=逐行读完（含两个审查代理的逐行批次，其 P1/P2 发现均经主审抽查原文实证）；**略读**=结构性通读（CSS 分区通读+脚本全量核验）；**跳过**=非源码，注明原因。单文件 >800 行（SessionView.tsx、theme.css）均已详读/分区详读。

| 文件 | 行数 | 处理 |
|---|---:|---|
| frontend/src/main.tsx | 12 | 详读 |
| frontend/src/App.tsx | 163 | 详读 |
| frontend/src/api.ts | 275 | 详读 |
| frontend/src/types.ts | 401 | 详读 |
| frontend/src/store.tsx | 518 | 详读 |
| frontend/src/host.ts | 132 | 详读 |
| frontend/src/titlebar.ts | 62 | 详读 |
| frontend/src/i18n.ts | 401 | 详读（+缺键/死词条脚本核验） |
| frontend/src/atGrammar.ts | 40 | 详读 |
| frontend/src/commands.ts | 25 | 详读 |
| frontend/src/planReview.ts | 31 | 详读 |
| frontend/src/turnGroups.ts | 50 | 详读 |
| frontend/src/useAtCandidates.ts | 47 | 详读 |
| frontend/src/useCompositionGuard.ts | 22 | 详读 |
| frontend/src/diffModel.ts | 75 | 详读 |
| frontend/src/css-modules.d.ts | 1 | 详读 |
| frontend/src/components/SessionView.tsx | 2056 | **详读**（>800 红线；主审逐行） |
| frontend/src/components/Composer.tsx | 478 | 详读（代理逐行+主审抽检） |
| frontend/src/components/Sidebar.tsx | 428 | 详读（代理+主审抽检） |
| frontend/src/components/SettingsPage.tsx | 631 | 详读（代理+主审实证 574 行循环） |
| frontend/src/components/ModelMenu.tsx | 247 | 详读（代理） |
| frontend/src/components/Markdown.tsx | 280 | 详读（代理+主审实证正则缺陷） |
| frontend/src/components/StatusCapsule.tsx | 304 | 详读（代理） |
| frontend/src/components/LoadingState.tsx | 149 | 详读（代理+死分支核验） |
| frontend/src/components/ThinkingState.tsx | 113 | 详读（代理） |
| frontend/src/components/Tooltip.tsx | 127 | 详读（代理） |
| frontend/src/components/UsageMeter.tsx | 132 | 详读（代理） |
| frontend/src/components/CapsuleGitSection.tsx | 145 | 详读（代理） |
| frontend/src/components/GoalBar.tsx | 135 | 详读（代理） |
| frontend/src/components/Icons.tsx | 173 | 详读（代理，14 导出全在用） |
| frontend/src/components/ProviderIcon.tsx | 80 | 详读（代理） |
| frontend/src/components/PlanReviewCard.tsx | 66 | 详读（代理） |
| frontend/src/components/AttachmentImage.tsx | 64 | 详读（代理） |
| frontend/src/components/HoverScrollText.tsx | 58 | 详读（代理） |
| frontend/src/components/DiffBlock.tsx | 57 | 详读（代理） |
| frontend/src/components/HeroBrand.tsx | 21 | 详读（代理） |
| frontend/src/components/Lightbox.tsx | 23 | 详读（代理） |
| frontend/src/components/capsuleModel.ts | 63 | 详读（代理，全量有测试） |
| frontend/src/settings/controls.tsx | 142 | 详读（代理+死导出核验） |
| frontend/src/settings/ModelCatalog.tsx | 225 | 详读（代理） |
| frontend/src/settings/PluginConfigCards.tsx | 142 | 详读（代理） |
| frontend/src/settings/permissionPreset.ts | 54 | 详读（代理） |
| frontend/src/settings/SettingsRows.module.css | 222 | 略读（代理逐行+主审死类脚本核验） |
| frontend/src/theme.css | 2976 | **详读**（>800 红线；主审分区通读+死类/未定义变量/配方漂移脚本核验） |
| frontend/src/__tests__/（8 文件） | 629 | 详读（代理逐文件评估断言质量） |
| frontend/packages/design/tokens.json | 99 | 详读（代理：shadow/motion/border.width/icon 为死数据） |
| frontend/packages/design/gen-tokens.mjs | 152 | 详读（代理：hex() 死函数、死分支、单位陷阱） |
| frontend/index.html | 26 | 详读（代理） |
| frontend/vite.config.ts | 25 | 详读（代理+__DSH_BUILD_SHA__ 消费方核验=零） |
| frontend/tsconfig.json | 22 | 详读（代理） |
| frontend/eslint.config.js | 23 | 详读（代理） |
| frontend/package.json | 34 | 详读（依赖引用逐包核验=全部在用） |
| frontend/package-lock.json | 3140 | 跳过（锁文件，npm audit 已覆盖） |
| apps/macos/Sources/DSHminiApp/main.swift | 22 | 详读（代理） |
| AppDelegate.swift | 581 | 详读（主审逐行） |
| MainWindowController.swift | 489 | 详读（主审逐行） |
| BridgeServer.swift | 263 | 详读（主审逐行） |
| MiniHTTPServer.swift | 185 | 详读（主审逐行） |
| EngineSupervisor.swift | 324 | 详读（主审逐行） |
| EngineEventObserver.swift | 217 | 详读（主审逐行） |
| FloatingBubble.swift | 277 | 详读（主审逐行） |
| EngineGateway.swift | 144 | 详读（代理） |
| EngineAuth.swift | 55 | 详读（代理+主审复核 :42） |
| JSONValue.swift | 179 | 详读（代理） |
| NativeAlerts.swift | 128 | 详读（代理+主审复核 :72-73） |
| RecoveryWindowController.swift | 158 | 详读（代理） |
| StatusItemController.swift | 118 | 详读（代理） |
| HotKeyManager.swift | 118 | 详读（代理） |
| HotkeyRecorderWindow.swift | 97 | 详读（代理） |
| DictationController.swift | 124 | 详读（代理+主审复核 :27-37） |
| DSHAppPrefs.swift | 79 | 详读（代理） |
| AppPaths.swift | 76 | 详读（代理） |
| Tokens.swift | 75 | 略读（生成物；消费方核实=零引用） |
| EngineLog.swift | 38 | 详读（代理） |
| WebViewTheme.swift | 18 | 详读（代理） |
| apps/macos/Tests/（3 文件） | 149 | 详读（代理+主审跑 xcodebuild test 14/14 绿） |
| apps/macos/project.yml | 70 | 详读（代理） |
| scripts/（build-frontend/build-release/check-dsh-source/dev/embed-engine/embed-web/package-macos/prepare-dsh-runtime） | 10/14/27/21/106/11/27/151 | 详读（代理逐行+主审实证 package-macos 两处断点） |
| scripts/dsh-runtime-version.txt / node-version.txt | 1/1 | 详读（引脚=0.1.1-rc.2 / 26.7.0，与 vendored package.json 及两处消费一致） |
| Makefile | 17 | 详读（代理） |
| design/logo/index.html + README.md | 400/50 | 略读（自包含设计稿；exports 已入库） |
| docs/（12 个文档） | — | 略读（交叉验证：ARCHITECTURE 已无 zustand 表述；frontend/apps 局部 AGENTS 为审查基准） |
| AGENTS.md ×3 / CLAUDE.md ×3 / README.md | — | 详读（军令即审查基准） |
| .gitignore / Assets.xcassets/** | — | 略读 |
| deepseek-harness/（9078 文件，79MB） | — | 跳过（vendored 官方源码只读对照副本，勿改动勿运行） |

---

## 3. 机器检查结果

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端测试 | `cd frontend && npm run test` | ✅ **59/59 绿**（8 文件：api 信封/capsuleModel/diffModel+planReview/atGrammar/foldSchedule/turnGroups+ingest 回放/parseTodos+extractToolResult） |
| 前端构建 | `npm run build`（tsc -b --noEmit && vite build） | ✅ 通过；⚠️ bundle 763KB（gzip 246KB）超 500kB 警示——katex/highlight.js/simple-icons 全量同步打包，无代码分割（AUD-036） |
| 严格类型 | `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | ✅ 零错误 |
| Lint | `npm run lint`（ESLint 10 + typescript-eslint + react-hooks） | ✅ 零报错（9 处 eslint-disable 逐条核过：7 处合理有注释，2 处掩盖真实缺口见 AUD-028） |
| 壳测试 | `xcodegen generate && xcodebuild test` | ✅ **14/14 绿**（BridgeServer 路径穿越/HotKeyManager 键码往返/JSONValue diff→ops） |
| 依赖漏洞 | `npm audit` | ✅ **0 漏洞**（上版 vite/esbuild high 链已随 vite 8 升级消除） |
| git 历史 | 最大 blob 核查 | ✅ 无大文件/敏感文件入库迹象；design/logo/exports 已规范入库（上版悬空已修） |

上版最高优先级问题"零测试"（旧 AUD-001）**已解除**：前后端合计 73 个用例，且断言质量高（锁形状与顺序、名字即行为、fetch 全 mock 零外部依赖）。剩余缺口见 AUD-037（渲染层/设置页/桥层零覆盖——本次两个新 P1 恰好都长在缺口里）。

---

## 4. 逐模块报告

### M1 前端核心通道（main/App/api/types/store/host/titlebar/i18n + 纯逻辑层 7 文件）

一句话职责：写得出来——"SPA 的骨与血：RPC 唯一入口、事件可辨识联合、全局状态、壳桥、标题栏 rect 推送、双语词典 + 七个自包含纯逻辑模块"，文件名即地图。新抽的纯逻辑层（atGrammar/commands/planReview/turnGroups/diffModel/useCompositionGuard/useAtCandidates，合计 ~300 行）是全仓最佳实践：头注释写明管什么不管什么、vitest 钉住语义。
依赖：上游 = 引擎 wire（same-origin fetch）+ 壳桥（webkit.messageHandlers）；下游 = M2/M3 全部组件。
冷启动成本：store+api+types+host ≈ 1330 行 + 7 个纯逻辑文件 ≈ 300 行；PITFALLS §2/§4 做背景，1 天内可改。
清单通过率：适用 19 项，通过 14 项。未通过：**A4**（两处循环：i18n⇄store、SessionView⇄turnGroups）、**C2**（store.tsx:468 裸中文 alert；空 catch 多数有注释但 SessionView:290/341/411 等 `.catch(() => void 0)` 无注释）、**I3**（localStorage 4 个 key + 壳 prefs 双通道，散布但各自有注释）、**F4**（服务端列表态与 UI 态同 store，签名去抖+轮询签名已大幅缓解）。

| 编号 | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| AUD-011 | P2 | i18n.ts:8 ↔ store.tsx:4；turnGroups.ts:1 ↔ SessionView.tsx:50 | 循环依赖 ×2：①i18n→useStore / store→setI18nLang；②turnGroups→RenderItem(type) / SessionView→groupTurns。运行时均无害，但阅读与热替换有隐性成本，②的方向明显反了（共享类型住在 2056 行组件里） | ① t() 显式传 lang 断环；② 把 RenderItem/TurnMeta 移到 types.ts 或独立 renderModel.ts，turnGroups 不再 import 组件 |
| AUD-012 | P2 | i18n.ts:397-401 + SettingsPage.tsx:574 等 | `useT()` 每次渲染返回**新的** t/tt 闭包对象——凡把 `t` 放进 useEffect 依赖即每渲染重跑。SettingsPage.tsx:574 ArchivedSection `[t]` 依赖 → **归档页打开期间无限拉取循环**（每轮 workspaces+sessions+probeMethod 三请求，fetch→setRows→渲染→再 fetch） | 改依赖为 `[lang]`；更根本：useT 返回值 memo 化（模块级缓存 t/tt 按 lang 键），从源头消掉这个陷阱 |
| AUD-013 | P3 | host.ts:36-92 | listDir/gitStatus/gitRun 三个 Promise 包装体逐行近似（reqId+onHostEvent+resolve，~15 行 ×3），且**无超时**：壳侧若永不回包，onHostEvent 监听器与 Promise 永久滞留（每次 @ 查询/胶囊刷新新增一份） | 抽 `hostRequest(type, replyCmd, payload)` 一个泛型助手；加 3-5s 超时 resolve 空值并 off() |
| AUD-014 | P3 | i18n.ts:399 | useT 渲染期写模块级 currentLang（hook 副作用）——与 AUD-011①同根，可一并断 | t()/tt() 显式传 lang 后删除模块级写回 |

### M2 前端会话渲染（SessionView + 呈现组件群）

一句话职责：写得出来——"事件日志 → RenderItem 摄取 → 会话流渲染"，但 SessionView.tsx 从上版 1551 → **2056 行**（组件本体 103-637 约 534 行、ingest 227 行），同时兼任"摄取引擎模块"（导出 RenderItem/ingest/finalizeTurns/foldSchedule/parseTodos/extractToolResult 供测试 import）——一个文件两张脸。
依赖：上游 = M1；下游 = 无（叶子）。
冷启动成本：SessionView 2056 + types 401 + PITFALLS §2/§3 ≈ 2500 行必读——**全仓最高，且在继续变贵**。
清单通过率：适用 17 项，通过 12 项。未通过：**B6**（2056 行/组件 534 行/ingest 227 行，B6 红线全破）、**B7**（`key=${seq}:${type}` :1604 引擎重发时 key 不稳，登记在案）、**C7**（:687-689 对 reason 的对象链取值断言、:1863 合成 tail 事件 `as SessionEvent`——有注释背书但仍是 cast 掩盖）、**G1**（:607 `label="Deep diving..."` 硬编码英文）、**G2**（MessageMeta :1115 与 QueueDock :2038-2045 仍用原生 `title=`，全仓已迁 data-tip）。
亮点：O(1) 摄取索引、增量 ingest（流式不再全量重建）、严格递增 seq 守卫、轮折叠（长会话默认折早前轮）——上版登记的 E2 已实质缓解。

| 编号 | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| AUD-021 | **P1** | components/Markdown.tsx:109,127-142 | **inline() 正则捕获组错位**（主审用文件原文正则逐组实测）：10 个分组中 g7=图片alt、g8=图片src、g9=链接label、g10=链接url；代码图片分支 `src=mm[7]`（拿 alt 当 URL）、`alt=mm[6]`（数学组恒 undefined→alt 恒空）、链接分支条件 `mm[8]!==undefined` 对链接匹配**永假**且无兜底 push → **所有 Markdown 链接整段静默消失，图片 src=alt 必裂**。每条含链接/图片的 agent 回复都中招 | 图片分支改 `src=mm[8], alt=mm[7]`；链接分支条件改 `mm[9]!==undefined`、取 `mm[9]/mm[10]`；先给 parseBlocks/inline 补 10 行纯函数测试（见 AUD-037）再动手；修完走交付链截图验证 |
| AUD-022 | P2 | components/SessionView.tsx:1-2056 | God file 续涨（+505 行/两月）：组件本体、20 个子组件、摄取引擎、格式化函数四张脸一个文件；测试 import 它的导出使"拆"牵一发动全身 | 拆 `session/renderModel.ts`（RenderItem/ingest/finalizeTurns 已被测试钉住，移动是纯搬迁）+ `useSessionEvents`/`useSessionModels` hook + 子组件文件；**必须先有 AUD-037 的渲染层测试再动** |
| AUD-023 | P3 | components/SessionView.tsx:290 | 首屏 history 加载 `.catch(() => void 0)` 无注释且无降级 UI——引擎未起时静默空白，用户看到的是"空会话"而非"加载失败" | 补注释或加载失败态（复用 LoadingState + 重试） |

### M3 前端输入与导航（Composer/ModelMenu/Sidebar/SettingsPage/settings/*）

一句话职责：写得出来。
依赖：上游 = M1；下游 = 无。
冷启动成本：Composer 478 + Sidebar 428 + SettingsPage 631 + settings/* 585 ≈ 2100 行。
清单通过率：适用 16 项，通过 10 项。未通过：**B6**（Composer 函数本体约 400 行、Sidebar 主函数约 320 行、StatusCapsule 304 行恰破线、SettingsPage 6 个 Section 函数超 50 行）、**B7**（controls.tsx:120-142 Row/Section 死导出且引用不存在的 CSS 类 rowHead/rows/title；LoadingState Surfer 分支+videoSrc 不可达代码；GoalBar GoalActions 死导出）、**C1**（ModelCatalog.tsx:118 `Number(input)` 可为 NaN，JSON.stringify 变 null 写入设置）、**C2**（9 处空 catch 未注释：Composer:99,184,188,235,439；SettingsPage:265,417,571；ModelCatalog:43；PluginConfigCards:62——同文件其他位置有注释，标准不一）、**C3**（CapsuleGitSection:43-51 toggleBranches 无序号守卫，快速开合旧结果覆盖新状态）、**G1**（裸文案一批：Composer:207 "剪贴板"字面量、DiffBlock:34 "file/files"、LoadingState 默认英文、"Deep diving..."、SettingsPage:567 `t("New Chat")` 反向用法且 `Task ${id}` 恒英文）、**H 可测性**（Sidebar titleOf/fmtTime/bucketLabel 模块私有未导出，想测都测不了）。

| 编号 | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| AUD-024 | P2 | components/Composer.tsx:67-468 | Composer 函数约 400 行：菜单行组装/听写/草稿持久化/提交分流四块逻辑一个闭包；存量豁免但每轮 UI 迭代都在往上堆 | 拆 useDictation/useDraft/useComposerMenu + ComposerMenu 子组件（每个 ≤300 行/函数 ≤50 行） |
| AUD-025 | P2 | settings/ModelCatalog.tsx:118 | contextWindow 输入无校验：非数字 → NaN → stringify 成 null 写进引擎设置，dirty 比较恒异常 | `Number.isFinite` 守卫，非法置 undefined |
| AUD-026 | P2 | settings/controls.tsx:120-142 | Row/Section 死导出（唯一 import 是 Dropdown,Toggle），且引用 SettingsRows.module.css 里**不存在**的 rowHead/rows/title 类——谁启用谁渲染裸结构 | 删除两个组件（连同 AUD-031 的死类） |
| AUD-027 | P3 | components/Sidebar.tsx:153,177 | 两处 eslint-disable exhaustive-deps 掩盖真缺口：groups/searchGroups 依赖缺 `lang` → 切语言后分组标签/搜索匹配滞留旧语言（靠 store 轮询换 sessions 引用才自愈） | deps 补 lang 删 disable；或注释明示接受滞留 |
| AUD-028 | P3 | components/Tooltip.tsx:54-60 | 400ms 巡检 interval 挂在 mount effect **常开**（无 tip 也每 400ms 跑一次 isConnected/:hover 校验），而注释宣称"只在注释可见期间运行"——注释与实现不符 | `tip !== null` 门控 interval 的挂卸 |
| AUD-029 | P3 | ModelMenu.tsx:190-204；Sidebar.tsx:388-409 | pointerdown 手挂 window 监听仅靠 pointerup 释放；拖拽中组件卸载（会话切换）则监听器泄漏 | 改 useEffect + dragging state 驱动，或 setPointerCapture 兜底 |
| AUD-030 | P3 | AttachmentImage.tsx:18,37 | bytesCache 模块级 Map 无上限（附件多时长期占内存）；Lightbox alt 恒取 `atts[0]?.name` 而非被点开的那张 | 缓存加 LRU 上限；onOpen 传被点附件的 name |

### M4 样式与 token 管线（theme.css/SettingsRows.module.css/tokens.json/gen-tokens.mjs）

一句话职责：写得出来（"全部样式唯一事实源 + 双端 token 生成"）。
清单通过率：适用 12 项，通过 8 项。未通过：**B6**（theme.css 2976 行，+718 vs 上版）、**B7**（死类 10 个：theme.css `.waiting`(:1896) / `.row-btn`(:1935) / `.ctx-item.disabled`(:2001) / `.effort-row`/`.model-menu-pill`(:2077) / `.capsule-commit-btn`(:2792)；module css `.selectField`/`.setInline`/`.listRow`/`.listName`；另 `.ddMenu` 的 absolute 定位段被内联 fixed 全覆盖纯误导）、**G2 注释漂移**（theme.css:706 `left: calc(var(--f) * 100%)` 的 --f 全仓无定义，被 ModelMenu:241 内联 left 覆盖——冗余且误导；:188"弹出面板统一配方"注释宣称所有浮层共用，但 approval-card(:1080)/question-card(:1167) 是一对复制体、queue-dock(:1098) 第三变体，均未走配方）。
通过项点名：上版 28 处 --dur-*/--ease-out 未定义已修复（theme.css:53-56 定义且与 tokens.json motion 对齐）；全仓 var() 引用经脚本核验**零未定义**（--dsh-sidebar-w 由 store.tsx:133 JS 写入、--tip-x/y 由 data-pos 选择器定义、--dur/--p 由 ModelMenu 内联注入）。

| 编号 | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| AUD-031 | P2 | theme.css 上述 6 处 + SettingsRows.module.css 4 处 + controls.tsx:120-142 | 死样式集合（frontend/AGENTS.md:22 明文"不留零引用类"，本次脚本核验仍有 10 个） | 阶段 3 一批删除（连 AUD-026 的死组件） |
| AUD-032 | P3 | theme.css:188 注释 vs :1080-1180 | "弹出面板统一配方"覆盖面与事实不符（approval/question 复制对、queue-dock 变体） | 三卡收进配方，或把注释范围改准确 |

### M5 壳应用骨架（main/AppDelegate/MainWindowController/project.yml）

一句话职责：写得出来。
清单通过率：适用 17 项，通过 14 项。未通过：**C2/G1**（品牌残留扩散，见 AUD-016）、**E4**（AppDelegate.runGit :307-345 在主线程同步跑 git status/numstat 并阻塞读管道——大仓库会卡 UI；同文件 gitRun :350-384 已正确走后台队列，一文件两标准）、**B6**（AppDelegate 581 行、handleHostMessage 88 行、didFinishLaunching 110 行）。

| 编号 | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| AUD-015 | P2 | apps/macos/Sources/DSHminiApp/AppDelegate.swift:307-345 | runGit（状态胶囊的 gitStatus 摘要）在主线程同步 Process+readDataToEndOfFile+waitUntilExit——仓库大时每次胶囊刷新卡一下 UI；gitRun 已是后台队列样板 | 仿 gitRun 移到 global queue，主线程只回包 |
| AUD-016 | P2 | RecoveryWindowController.swift:25；NativeAlerts.swift:72-73；AppDelegate.swift:459,465,466；EngineSupervisor.swift:65,255,306 | 用户可见 DSHmini/DSH 品牌残留 8 处（恢复窗标题、通知文案、主菜单关于/隐藏/退出、引擎诊断文案）——上版只抓到 2 处，实际是"关于 DSHmini"这类前缀文案躲过了当时的 grep 模式 | 统一换 DeepDive（AppPaths.swift:24 的旧目录迁移属合法旧路径处理，勿动） |
| AUD-017 | P3 | MainWindowController.swift:16,286,75-78 | 注释仍写 "dshmini" handler / `window.__dshminiHost`（实际 deepdive/__deepDiveHost）；:75-78 宿主指令清单缺 list-dir/run-git/git-run/open-url——**apps/macos/AGENTS.md:25 自己要求"加 case 必须同步清单注释"，规则未执行** | 改三处注释；后续加 case 时按军令同步 |

### M6 壳引擎监督族（EngineSupervisor/Gateway/Auth/EventObserver/EngineLog）

一句话职责：写得出来（"子进程监督/自愈/凭据断言/事件观察/网关调用"）。
清单通过率：适用 16 项，通过 13 项。未通过：**C1**（EngineSupervisor.consume :267-280：buffer 尾部遇不完整 UTF-8 序列时 `String(data:)` 整体失败 → `removeAll()` **丢弃整段缓冲含已完整行**——引擎输出中文/emoji 且分片恰好在多字节序列中间时丢日志行，极端时丢 "dsh web:" 就绪行）、**C4**（EngineEventObserver.swift:34 `base?.port.map { _ in }` 无操作语句）、**C5**（EngineEventObserver:164,178 pending 集合随机 UUID 兜底，resolved 按真实 id 删 → 引擎省略 id 时集合永久滞留）。

| 编号 | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| AUD-018 | P2 | EngineSupervisor.swift:267-280 | consume 的 UTF-8 分片缺陷（见上）——低概率真丢数据，且丢的可能是就绪信号行 | 改为按 `\n` 字节切分再逐行 decode（`String(decoding:as:)` 容错），或 decode 失败时只保留尾部不 removeAll |
| AUD-019 | P3 | EngineEventObserver.swift:164,178；:34 | UUID 兜底滞留 + 无操作语句（上版两项均仍在） | 缺 id 直接 return+日志；删 :34 |
| AUD-020 | P3 | EngineGateway.swift:110-131；:65-67 | probe 在 noEngine（base 未就绪）时把方法缓存为"不可用"，本会话内永久判死直到 base 变化；:65 URL 构造失败误报 noEngine | noEngine 不写缓存；构造失败单独错误 |
| AUD-033 | P3 | EngineAuth.swift:36-42 | 引擎 cookie 写入 `HTTPCookieStorage.shared`（进程级持久共享罐）；:40 把网络错误与"旧引擎无 Set-Cookie"合并成同一条日志 | 私有 HTTPCookieStorage；两种失败分开记日志 |

### M7 壳桥与网络（BridgeServer/MiniHTTPServer/JSONValue）

一句话职责：写得出来（"同源托管：静态文件 + /api 反代 + WS 盲中继"）。
清单通过率：适用 15 项，通过 12 项。未通过：**C2**（`/__deepdive_error` 诊断路由仍在 503 guard 之后（:62-71），引擎未起时前端错误上报全被吞——恰是最需要线索的时刻，上版登记未修）、**C4 边界**（MiniHTTPServer readRequest 无读超时、body 无大小上限（:127-133；头部有 64KB 上限 :106）——失联本地进程可长期占住 detached 线程）、**B2（已接受风险）**（手写 HTTP/WS 泵为依赖零的显性决定，与"禁自造轮子"存在张力，维持上版判定）。
安全面通过项点名：Origin 全等校验（:58）、路径穿越 decode+standardize+前缀检查且有单测（:242-248）、仅绑定 127.0.0.1、git 参数数组直传不经 shell（AppDelegate:350）。

| 编号 | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| AUD-034 | P3 | BridgeServer.swift:62-71；MiniHTTPServer.swift:97-135 | 诊断路由前置；读超时（SO_RCVTIMEO）+ body 上限（如 32MB） | 两处小改，本地信任边界内排 P3 |

### M8 壳系统能力面（通知/悬浮球/状态栏/恢复屏/热键/听写/偏好/路径）

一句话职责：写得出来。
清单通过率：适用 15 项，通过 12 项。未通过：**G1**（FloatingBubble 偏好仍用旧 `dsh.bubble.*` 命名空间：:16-18,36,129,150——LegacyPrefsMigration 迁走 dsh.* 后这两个键永远无人迁，上版登记未修）、**C3**（DictationController.start :27-37 异步授权窗口可重入：连点两次 → beginRecording 跑两遍，第一套 AVAudioEngine tap 永不拆除）、**C4**（HotkeyRecorderWindow :18,37-59 红叉关窗不摘 local monitor，下次 showRecorder 直接覆盖引用 → 监听器泄漏）、**B7**（:40-82 重复闭包体仍在；StatusItemController:7 死 NSMenuDelegate 契约；AppPaths:52 openAtLogin 死字段）。

| 编号 | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| AUD-035 | P2 | FloatingBubble.swift:16-18,36,129,150；DictationController.swift:27-37；HotkeyRecorderWindow.swift:18,37-59,40-82 | 旧命名空间 + 听写重入 + 录制器监听器泄漏/重复闭包（三件上版登记项的实际状态：全在） | bubble 键迁 deepdive.*（读旧键一次性迁移）；start() 加 starting 位或主队列串行化；关窗摘 monitor + 提取 armMonitor() |
| AUD-036 | P3 | main.swift:9-10 | 单实例锁 fd 无 O_CLOEXEC（引擎子进程继承锁）；open 失败静默失去守卫 | 加 O_CLOEXEC；fd<0 记日志 |

### M9 构建与脚本（scripts/* / Makefile / package.json / vite / tsconfig / eslint / gen-tokens）

一句话职责：写得出来——版本引脚 fail-loud、embed 后重签名+自检、嵌套依赖同 prerelease 段放行，仍是踩坑后固化的正确做法。**但打包链发现两处实质断点**。
清单通过率：适用 11 项，通过 7 项。未通过：**I2**（vite.config.ts:7-19 buildSha/__DSH_BUILD_SHA__ 仍零消费且无 declare，上版登记未修；gen-tokens.mjs hex() 死函数+永假分支+shadow/motion/border.width/icon 组永不输出——tokens.json 里这四组是死数据）、**I4**（package-macos.sh:6 版本读取在 xcodegen:8 之前而 Info.plist 不入库：新 clone DMG 恒 0.1.0 命名；:21 `codesign ... || true` 吞掉签名失败仍产 DMG）、**I5**（dev.sh:15 `#!/bin/sh` 里用 `[[ ]]` bashism）、**I1 缺口**（Makefile 无 test 目标，测试命令只活在 AGENTS.md）。

| 编号 | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| AUD-037 | P2 | scripts/package-macos.sh:6,8,21 | 打包链两处静默断点：版本号读不到静默回退 0.1.0；签名失败被吞仍出 DMG（bundle 可能被 embed 改坏却无人知） | 版本读取移到 xcodegen 之后且不一致即 fail；去掉 `\|\| true` 失败 exit 1 |
| AUD-038 | P3 | Makefile:1；scripts/dev.sh:15；vite.config.ts:7-19；gen-tokens.mjs:43-47,74-86；tokens.json shadow/motion/border.width/icon 组；prepare-dsh-runtime.sh:83-85；DSHAppPrefs.swift:28-30 | 工程杂项集合：无 make test；bashism；buildSha 死 define；token 死数据/死函数/永假分支；alpha.* 特例死分支（引脚已回 rc.2）；sidebar 200/320 界限手工双写 | 阶段 3 一批清理；make test 与断点修复放阶段 1 |
| AUD-039 | P3 | JSONValue.swift:53-65 | `.data`/`.string`/`.isNull` 访问器零调用方（仅 .anyValue 有一处真实消费） | 删除或注明测试用途 |

### M10 设计种子（design/logo）

一句话职责：写得出来。上版"exports 悬空"已修（已入库）。清单通过率：适用 5 项，通过 5 项。无未通过项。

### M11 vendored 对照副本（deepseek-harness/）

非自有代码，按军令"勿当运行时、勿改动"。引脚一致性经脚本核验（0.1.1-rc.2 三处一致）。维持上版提醒：9078 文件/79MB 拖慢全仓 grep，AI 冷启动需自觉排除该路径；sparse checkout/submodule 化属结构变更，仅记录不建议现在动。

### MH 测试资产专项（__tests__ ×8 + Tests ×3）

一句话职责：写得出来——"纯函数与线路层的行为规格"。
通过项：59+14 用例全绿；断言锁形状/顺序/边界；fetch 全 mock 零外部依赖；HotKeyManagerTests 钉住真实键码表（历史坑）；session-ingest 是黄金回放样板。
未通过：**H1 缺口**——保护网只罩住纯函数层：Markdown parseBlocks/inline（本次 P1 所在）、permissionPreset.ts（防御式解析纯函数零测试）、Sidebar 的 titleOf/fmtTime/bucketLabel（未导出不可测）、store.tsx/host.ts/Composer/Tooltip/Dropdown/GoalBar CAS 全部零覆盖；壳侧 BridgeServer 263 行只测了 staticFileURL（relay/Cookie 注入/请求解析未测，其中后两者是安全关键）。

| 编号 | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| AUD-040 | P2 | 全仓测试缺口 | 纯函数之外的渲染/交互/桥层零覆盖——本次两个 P1 恰好都长在缺口里，证明网眼位置错了 | 阶段 0 补齐：Markdown 纯函数测试（先于 AUD-021 修复写）、permissionPreset、titleOf/fmtTime 导出后补测、SettingsPage 各 Section 的 effect 依赖行为；壳侧 MiniHTTPServer 请求解析 + relayUnary 信封 |

---

## 5. 跨模块问题

**X1 全局重复实现汇总**（均给两侧位置，脚本+读码双重核验）
1. **会话标题回退 ×3 且互相矛盾**：Sidebar.tsx:423-428 `titleOf`（blank→"New Chat"且回退"任务 {id6}"）vs SettingsPage.tsx:567（`t("New Chat")` 反向 + `Task ${id}` 恒英文）vs SessionView.tsx:141-142（blank→t("新会话")、无题→t("会话")）——同一会话在三处显示不同标题。
2. **pickModel ×2 + 模型目录加载 ×2**：App.tsx:70-91 vs SessionView.tsx:150-222（含 effort 合并第三变体 applyModelEffort）——改信封要改两处，App 侧还不传 currentModel 造成 ModelMenu.tsx:96 的 label 比对双轨判定。
3. **头部（title-row+model 触发器+ModelMenu）×3**：App.tsx:122-148、SessionView.tsx:433-455（blank 分支）、:470-491（主头）——后两者在同文件内复制。
4. **时长/相对时间格式化 ×3 + toLocaleString**：Sidebar.tsx:14-24 fmtTime、StatusCapsule.tsx:36-43 elapsed（≥1h 丢分钟）、LoadingState.tsx:71-84 useElapsed。
5. **settings.update 读-改-写围栏 ×6**：SettingsPage:134-143,363-373,426-435；ModelCatalog:47-60,62-74；PluginConfigCards:90-105——同一段 describe→find ns→{...base,key}→update(expectedRevision) 抄六遍，且都无 revision 冲突重试。
6. **失败 alert 模板双写法**：SettingsPage/ModelCatalog/PluginConfigCards 的 `alert(t("保存失败：{m}").replace("{m}",…))` ×5 vs Sidebar 的 `tt(插值)` ——tt 版才是正解。
7. **Goal 阶段标签表 ×2**：GoalBar.tsx:19-23 PHASE_LABEL vs StatusCapsule.tsx:21-26 GOAL_PHASE（差一个 complete 项，改文案必漏一边）。
8. **壳侧 JSON 构造**：AppDelegate.jsonPayload(:154) 已统一主路径，但 installDictation 内嵌 payload()(:257-259) 又手写一遍同逻辑。
9. **host.ts 请求包装 ×3**（见 AUD-013）。
→ 沉淀建议：`sessionTitle()` 工具（1）、`useModelCatalog()` hook（2+3 一起消）、`format.ts`（4）、`useSettingNamespace()` hook（5+6）、PHASE 表并入 capsuleModel（7）。

**X2 依赖图循环/单向违规**：脚本 DFS 验证循环共 2 处——`i18n ⇄ store`（运行时无害）与 `SessionView ⇄ turnGroups`（type-only，方向反了）。其余全部单向；壳侧单例回环（AppDelegate.shared）为 AppKit 惯例可接受。

**X3 风格一致性全局评估**：错误处理与 t()/tt() 纪律整体贯彻率高（空 catch 大多有注释），但存在三个系统性偏差：① **i18n 键漂移**——脚本核验缺 EN 键 7 个（失败/已复制/返回工作区/当前使用/本引擎装载的扩展模块…/New Chat/新建会话），另有"新会话 vs 新建会话"两键并存、死词条"没有匹配「{q}」"（Composer 用 tt 内联绕过了它）；② **默认导出 vs 具名导出混用**（LoadingState/ThinkingState 默认，其余具名）；③ 原生 title 与 data-tip 并存（SessionView 两处残留）。

**X4 孤岛代码**：Tokens.swift 整文件零消费（gen-tokens 的 Swift 腿是 0 调用方管线，且 sizePanel 等输出恒 0 值有陷阱）；controls.tsx Row/Section；LoadingState Surfer 分支；JSONValue 三个访问器。无整目录级孤岛。

**X5 该沉淀未沉淀**：见 X1 沉淀建议；theme.css 弹出配方注释与三卡现实不符（AUD-032）。

**X6 冷启动成本 Top 5**

| 排名 | 模块 | 需读 | 为什么贵 |
|---|---|---|---|
| 1 | SessionView.tsx + types.ts + turnGroups | ~2500 行 + PITFALLS §2/§3 | 摄取引擎、20 组件、格式化一文件四张脸；每个不变量都有事故背书，不敢跳读；还在涨 |
| 2 | store.tsx + api.ts + host.ts + DSH-WIRE.md | ~1400 行 | wire 契约、boot 策略、mux 分发、prefs 双通道交织；ref 镜像约定靠注释维持（store.tsx:510-513 已文档化，仍脆弱） |
| 3 | theme.css + tokens.css + UI-SPEC | ~3300 行 | 2976 行手写 CSS 靠注释分区；改一处需知 PITFALLS §1 的四个 WebKit 陷阱 |
| 4 | EngineSupervisor 五件套 + SPEC-ENGINE-RUNTIME | ~780 行 | 引擎版本协议史（rc.2/alpha.2 两次断裂）压在这几个文件与引脚上；alpha.2 时期的注释/特例分支仍在（AUD-038） |
| 5 | SettingsPage + settings/* | ~1220 行 | 八分区 631 行一文件 + 六遍复制的 settings.update 围栏；改一处设置行为要在三文件间对齐 |

---

## 6. 全局问题总台账

级别：P0 必须立刻修 / P1 本周修 / P2 近期迭代 / P3 可选。**无 P0**（上版 P0"零测试"已解除）。

| 编号 | 级别 | 位置 | 问题 | 建议修复方式 |
|---|---|---|---|---|
| AUD-021 | **P1** | Markdown.tsx:109,127-142 | inline() 正则捕获组错位：链接文本整段静默丢失、图片 src 取 alt 必裂（主审逐组实测） | 先补纯函数测试再修分组取值；交付链截图验证 |
| AUD-012 | **P1** | SettingsPage.tsx:574 | ArchivedSection `[t]` 依赖 → 归档页无限拉取循环 | 依赖改 `[lang]`；useT 返回值 memo 化除根 |
| AUD-005 | P2 | 位置见 §5 X1-1/2/3 | 三组核心重复：标题回退 ×3 矛盾、pickModel/目录加载 ×2、头部 ×3 | 抽 sessionTitle/useModelCatalog/SessionHeader（与 AUD-022 同期） |
| AUD-006 | P2 | SettingsPage:363-373 等 6 处 | settings.update 读-改-写围栏抄六遍且无冲突重试 | 抽 useSettingNamespace() hook |
| AUD-011 | P2 | i18n:8↔store:4；turnGroups:1↔SessionView:50 | 循环依赖 ×2 | t() 传参断环；RenderItem 移出组件文件 |
| AUD-013 | P2 | scripts/package-macos.sh:6,8,21 | 打包链断点：版本读取早于 xcodegen（新 clone DMG 恒 0.1.0）+ codesign 失败被吞 | 版本读取后置且 fail-loud；删 `\|\| true` |
| AUD-014 | P2 | i18n.ts 词典 + 多文件 | i18n 键漂移：缺 EN 键 ×7、"新会话/新建会话"双键、死词条 ×1、`t("New Chat")` 反向用法 | 补键/并键/删死词条；跑一次英文 UI 截图核对 |
| AUD-015 | P2 | AppDelegate.swift:307-345 | runGit 主线程同步阻塞（gitRun 已是后台样板，一文件两标准） | 移后台队列，主线程只回包 |
| AUD-016 | P2 | 壳侧 8 处（§M5 表） | 用户可见 DSHmini/DSH 品牌残留（上版只抓 2 处，实为 8 处） | 统一换 DeepDive |
| AUD-017 | P2 | Composer:99 等 9 处 | 空 catch 未注释（军令明文），同文件标准不一 | 逐条补注释；Composer:184/188 吞的是发送失败，评估是否需用户提示 |
| AUD-018 | P2 | EngineSupervisor.swift:267-280 | consume 不完整 UTF-8 分片丢整段缓冲（可能丢就绪行） | 按字节行切分或保留尾部 |
| AUD-022 | P2 | SessionView.tsx | God file 2056 行续涨，四张脸一个文件 | 先测试后拆（renderModel.ts + hooks + 子组件） |
| AUD-023 | P2 | Composer.tsx:67-468 | Composer 函数 ~400 行四块逻辑 | 拆三个 hook + 菜单子组件 |
| AUD-024 | P2 | ModelCatalog.tsx:118 | contextWindow NaN → null 写入设置 | Number.isFinite 守卫 |
| AUD-025 | P2 | controls.tsx:120-142 | Row/Section 死导出且引用不存在的 CSS 类 | 删除 |
| AUD-026 | P2 | LoadingState.tsx:92-140 | Surfer 分支 + videoSrc 未来预留不可达代码 | 删除（上版登记仍在） |
| AUD-027 | P2 | 测试缺口（§MH） | 保护网只罩纯函数层：Markdown/permissionPreset/Sidebar 工具/store/host/壳 HTTP 解析零覆盖——两个新 P1 长在缺口里 | 阶段 0 补齐（清单见 AUD-040 行） |
| AUD-028 | P2 | Sidebar.tsx:153,177 | eslint-disable 掩盖 lang 缺失 → 切语言分组/搜索滞留 | deps 补 lang |
| AUD-029 | P2 | FloatingBubble.swift:16-18,36,129,150 | dsh.bubble.* 旧命名空间 + 迁移盲区（上版登记仍在） | 迁 deepdive.bubble.* 带一次性旧键迁移 |
| AUD-030 | P2 | DictationController.swift:27-37 | 听写 start 异步授权窗口可重入，AVAudioEngine tap 泄漏 | starting 位或主队列串行化 |
| AUD-031 | P2 | theme.css ×6 + module ×4（§M4 表） | 死样式 10 处（军令明文不留零引用类） | 阶段 3 批删 |
| AUD-032 | P2 | HotkeyRecorderWindow.swift:18,37-82 | 红叉关窗不摘 monitor + 重复闭包体（上版登记仍在） | 关窗摘除 + 提取 armMonitor() |
| AUD-033 | P2 | vite.config.ts:7-19 | buildSha/__DSH_BUILD_SHA__ 死 define 且无 declare（上版登记仍在） | 删或真消费 |
| AUD-034 | P2 | AppPaths.swift:52 | openAtLogin 死字段（上版登记仍在） | 删或实现 |
| AUD-035 | P3 | EngineEventObserver.swift:164,178,34 | UUID 兜底滞留 + 无操作语句 | 缺 id return；删 |
| AUD-036 | P3 | EngineGateway.swift:65-67,110-131 | probe 缓存 noEngine 误判 + 构造失败误报 | 不缓存 noEngine；独立错误 |
| AUD-037 | P3 | BridgeServer.swift:62-71；MiniHTTPServer.swift:97-135 | 诊断路由 503 前置 + 无超时/无 body 上限（上版登记仍在） | 路由前置；SO_RCVTIMEO+上限 |
| AUD-038 | P3 | EngineAuth.swift:36-42 | cookie 入共享罐 + 两类失败日志合并（上版登记仍在） | 私有 storage；分日志 |
| AUD-039 | P3 | main.swift:9-10 | 锁 fd 无 O_CLOEXEC；open 失败静默 | 加标志；记日志 |
| AUD-040 | P3 | Tooltip.tsx:54-60 | 巡检 interval 常开 vs 注释声明 | tip 门控挂卸 |
| AUD-041 | P3 | ModelMenu:190-204；Sidebar:388-409 | 拖拽 window 监听卸载泄漏 | effect 化或 pointer capture |
| AUD-042 | P3 | CapsuleGitSection.tsx:43-51 | toggleBranches 无竞态守卫 | 序号门（仿 Sidebar searchReqRef） |
| AUD-043 | P3 | AttachmentImage.tsx:18,37 | bytesCache 无上限；Lightbox alt 恒首个 | LRU；传被点附件 name |
| AUD-044 | P3 | PluginConfigCards.tsx:82-86 | draft 不随 entry 刷新，外部改动后 dirty 失真 | 随 revision 同步 |
| AUD-045 | P3 | GoalBar.tsx:12-17,61-129 | GoalActions 死导出；`goal!` 非空断言 ×12 | 删导出；解构收窄去断言 |
| AUD-046 | P3 | StatusCapsule.tsx:21-26 ↔ GoalBar.tsx:19-23 | 阶段标签表 ×2 | 并入 capsuleModel |
| AUD-047 | P3 | Sidebar:14-24；StatusCapsule:36-43；LoadingState:71-84 | 时长格式化 ×3（elapsed ≥1h 丢分钟） | 统一 format.ts |
| AUD-048 | P3 | Markdown.tsx:114；ModelMenu.tsx:92 | 冗余强转 | 删 |
| AUD-049 | P3 | host.ts:36-92 | 请求包装 ×3 无超时 | 抽助手+超时 |
| AUD-050 | P3 | SessionView.tsx:290 | 首屏 history 加载失败静默空白 | 补注释或失败态 |
| AUD-051 | P3 | SessionView.tsx:1115,2038-2045 | 原生 title= 残留（应 data-tip） | 迁移 |
| AUD-052 | P3 | LoadingState/ThinkingState 默认导出 | 与全仓具名导出不一致 | 统一具名 |
| AUD-053 | P3 | Makefile:1；dev.sh:15 | 无 make test；bashism | 加目标；改 POSIX test |
| AUD-054 | P3 | gen-tokens.mjs:43-47,74-86；tokens.json 四组 | 死函数/永假分支/shadow-motion 等死数据（上版 AUD-023 演化） | 清理或真输出 |
| AUD-055 | P3 | DSHAppPrefs.swift:28-30 | sidebar 界限 200/320 手工双写 | codegen 输出 min/max 并引用 |
| AUD-056 | P3 | prepare-dsh-runtime.sh:83-85 等 | alpha.2 时期特例分支与注释成"考古层" | 标注历史或语义化 |
| AUD-057 | P3 | JSONValue.swift:53-65 | .data/.string/.isNull 死访问器 | 删或注明 |
| AUD-058 | P3 | StatusItemController.swift:7 | 死 NSMenuDelegate 契约 | 删声明 |
| AUD-059 | P3 | frontend bundle 763KB | 无代码分割，katex/hljs/simple-icons 同步全量打包（gzip 246KB 本地壳可接受，属观察项） | 若启动耗时可感再做动态 import；否则记录接受 |
| AUD-060 | P3 | SessionView.tsx:1604 | item key `${seq}:${type}` 不稳（登记在案开放项，随 P2-6 snapshot store 决策） | 不单独打补丁 |

统计：P0 ×0、P1 ×2、P2 ×20、P3 ×21。

---

## 7. 健康度评分卡（各 1–5）

| 维度 | 分 | 一句话理由 |
|---|---|---|
| 边界清晰度 | **4.5** | 三层职责、文件名即地图、军令体系兜底、纯逻辑下沉成新风范；扣分：SessionView 四张脸、循环 ×2 |
| 复杂度控制 | **3.5** | 无框架魔法、抽象极少、依赖全主流；扣分：SessionView 2056 续涨、Composer 400 行函数、死代码一批、token→Swift 死管线 |
| 正确性与安全 | **3** | 事故教训固化好（Origin/穿越/seq/EOF）、审计链干净；扣分：两个用户可见静默 bug（Markdown 链接丢失、归档页循环）+ UTF-8 分片丢缓冲 + 打包链两断点 + 听写重入 |
| 测试保护（行为规格） | **3** | 0→73 用例全绿且质量高，纯函数层已有行为规格；扣分：网眼错位——渲染/设置/桥层零覆盖，本次两个 P1 恰好都从缺口里漏过去 |
| 一致性 | **3.5** | t()/tt()、空 catch 注释、deepdive.* 大体贯彻；扣分：i18n 键漂移一批、标题回退三套矛盾、时长格式化三套、品牌残留 8 处、默认/具名导出混用 |
| 工程规范 | **4** | build/tsc/lint/test/audit 六绿、引脚 fail-loud、交付链文档化；扣分：打包链两静默断点、make test 缺位、bashism |

**综合：3.5/5** —— 工程化基线比上版（3.4）扎实：测试与 lint 落地后，"改坏了能发现"第一次成为事实（纯函数层面）。当前最大风险从"没有保护网"转为"**保护网只罩住了一半，而另一半恰好是本次两个 P1 的藏身处**"——冷启动 AI 若只看"59 测试全绿"会高估安全边际。

---

## 8. 优化路线图（四阶段，按此顺序）

| 任务ID | 阶段 | 目标 | 涉及文件 | 风险 | 验证方式 | 规模 |
|---|---|---|---|---|---|---|
| R-001 | 0 保护网 | AUD-027 补网眼：Markdown parseBlocks/inline 纯函数测试（**先于 R-002 写**）、permissionPreset、Sidebar 工具导出后补测、MiniHTTPServer 请求解析 + relayUnary 信封；Makefile 加 test 目标（AUD-053） | __tests__/、apps/macos/Tests/、Makefile | 低 | vitest+xcodebuild 全绿；make test 一键 | M |
| R-002 | 1 止血 | **AUD-021 Markdown 正则修复**（测试先行）+ **AUD-012 归档页循环**（[t]→[lang]，useT memo 化） | Markdown.tsx、SettingsPage.tsx、i18n.ts | 低 | 新测试转绿 + 含链接/图片回复截图 | S |
| R-003 | 1 止血 | AUD-013 打包链两断点（版本读取后置 fail-loud、codesign 不吞错） | package-macos.sh | 极低 | 删 Info.plist 后跑 make package 验证版本号与签名失败即停 | S |
| R-004 | 1 止血 | AUD-018 consume UTF-8 分片；AUD-030 听写重入；AUD-032 录制器 monitor 泄漏+提取 armMonitor | EngineSupervisor/DictationController/HotkeyRecorderWindow | 低 | 单测钉分片边界（R-001 顺带）；手测连点听写 | S |
| R-005 | 1 止血 | AUD-016 品牌 8 处换 DeepDive；AUD-014 i18n 键漂移清账（缺键/双键/死词条/反向用法） | 壳侧 5 文件、i18n.ts、组件文案 | 低 | 英文 UI 截图 + 词典脚本零缺键 | S |
| R-006 | 1 止血 | AUD-024 NaN 守卫；AUD-017 空 catch 补注释；AUD-028 Sidebar lang 缺失；AUD-040 Tooltip 门控 | ModelCatalog 等 9 文件 | 低 | lint/test 绿 + 切语言截图 | S |
| R-007 | 2 边界 | **AUD-022 拆 SessionView**：renderModel.ts（RenderItem/ingest/finalizeTurns 纯搬迁，测试跟着走）+ useSessionEvents/useSessionModels + 子组件文件（每个 ≤300 行） | components/session/* | 中（有 R-001 网后可控） | vitest 全绿 + 交付链截图逐位比对 | L |
| R-008 | 2 边界 | AUD-005 消三组重复（sessionTitle/useModelCatalog/SessionHeader）；AUD-011 断两环（RenderItem 移 types；t() 传 lang） | App/SessionView/Sidebar/SettingsPage/i18n/turnGroups | 中 | 同上 + 词典脚本 | M |
| R-009 | 2 边界 | AUD-006 抽 useSettingNamespace() 消六遍围栏（带 revision 冲突提示统一）；AUD-023 拆 Composer 三 hook | settings/*、Composer | 中 | 设置页各分区改值/冲突路径手测 | M |
| R-010 | 2 边界 | AUD-015 runGit 后台化；AUD-029 bubble 命名空间迁移；AUD-046/047 阶段表+时长格式化收敛 | AppDelegate/FloatingBubble/capsuleModel/format.ts | 低 | 大仓库 git 胶囊不卡 UI；旧偏好迁移后位置保留 | S |
| R-011 | 3 清理 | 死代码批删：AUD-025/026 Row-Section+Surfer、AUD-031 死类 ×10、AUD-033 buildSha、AUD-034 openAtLogin、AUD-035/039/057/058 壳侧死件、AUD-045 GoalActions、AUD-054 token 死数据 | 见台账 | 低 | tsc noUnused 零错 + 死类脚本零命中 + 截图 | M |
| R-012 | 3 清理 | 注释与文档对齐：AUD-017 三处过时注释+指令清单、AUD-056 alpha.2 考古层标注、AUD-032 配方注释收窄或统一、AUD-052 导出风格统一 | 多文件 | 低 | grep dshmini/__dshminiHost 归零 | S |

**路线原则**：R-002 动 Markdown 前必须先有 R-001 的纯函数测试——它正是"先测后改"的教科书场景；R-007 动 SessionView 前必须有 R-001 的事件回放保护（它至今没人敢拆的原因已消除一半）。所有前端/UI 改动走铁律 2 交付链。

---

## 9. 与第 1 版报告的台账对照（复核 32 项）

**已修复（11 项）**：旧 001 零测试→vitest 59+XCTest 14；002 --dur-*→已定义；003 通知名→统一 com.deepdive.app.show；004 EOF nil→已修+注释引 PITFALLS；005 快捷键表→改为"禁止列出未实现"且 Composer 真实现 metaKey；006 死依赖→package.json 干净且 ARCHITECTURE 同步；008 localStorage→readIdSet 防护；010 as any→全仓零 as any（PromptContentPart 已建模 image）；013 手拼 JSON→jsonPayload 统一；016 exports→已入库；017 eslint 谎言→ESLint 落地；029 vite audit→0 漏洞。（008/010 计入后实为 12 项修复）

**仍在（13 项，编号平移进新台账）**：011 循环→AUD-011（+新增第二环）；012→并入 AUD-029 品牌与命名空间（dsh.bubble.* 仍原样）；018→AUD-038；019/021→AUD-037；020→AUD-035；023→AUD-054；024→AUD-017 扩大（指令清单也过时）；025→AUD-016 扩大（2 处→8 处）；026→AUD-060；031→AUD-054 扩大；032→AUD-032 部分（.glass 已复活，三卡漂移仍在）；007 部分组件→AUD-026/031/033/034。

**恶化/新增（本次主要增量）**：Markdown 正则 P1（AUD-021）、归档页循环 P1（AUD-012）、SessionView +505 行（AUD-022）、打包链断点（AUD-013）、UTF-8 分片（AUD-018）、品牌残留实为 8 处（AUD-016）、听写重入（AUD-030）、标题回退 ×3 矛盾（AUD-005）。

---

## 附：本次审查的机器验证痕迹（供复核）

- 循环依赖：node 解析器（含扩展名解析）DFS，两环：store→i18n→store、SessionView→turnGroups→SessionView。
- 词典缺键：提取全部非测试 `t("...")` 字面量对比 EN 词典，缺 7 键；缺键调用位置逐一定位（CapsuleGitSection:38,70 / Markdown:207 / SettingsPage:65,296,457,480,567 / Sidebar:267）。
- 死类：node word-boundary 扫描 + 人工上下文核验（排除注释文字与 hljs-*/katex 运行时类），theme.css 6 + module 4；`.glass` 复活确认。
- 未定义 CSS 变量：含 `packages/design/generated/tokens.css` 与 JS 注入（--dsh-sidebar-w/--dur/--p）与属性选择器（--tip-x/y）后归零；`--f` 为唯一真未定义但被内联覆盖（AUD-054 相关冗余行）。
- `as any`/`: any`：src 非测试代码零命中（仅两处注释提及）。
- 依赖引用：package.json 六个 dependencies 逐包 grep 均在用。
- 测试：vitest 59/59、xcodebuild 14/14（本机实跑，日志在 .build/debug/Logs/Test/）。
- 代理 P1/P2 发现抽查实证：Markdown.tsx:109-142 正则逐组复算、SettingsPage.tsx:549-574 依赖链复算、package-macos.sh:6/8/21 原文、DictationController.swift:27-37 原文、NativeAlerts.swift:72-73 原文、dev.sh:15 原文。
