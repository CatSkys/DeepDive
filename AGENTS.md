# AGENTS.md

DeepDive（深潜）—— DeepSeek Harness 的 macOS 客户端：Swift+AppKit 原生壳（`apps/macos`）+ 自建 React SPA（`frontend`）+ 被监督的自研 dsh 引擎子进程（`engine/`，仓内构建随包分发）。对外品牌 DeepDive；内部代号 DSHmini（scheme/目录/包名）有意保留（`docs/BRANDING.md §5`）。

动手前先读对应的家，不要凭记忆：

- `docs/ARCHITECTURE.md` — as-built 架构：三层职责、通信矩阵、文件清单、与原蓝图的偏差
- `docs/PITFALLS.md` — 踩坑记录：**改相关代码前必读对应条目**（每条都来自真实事故）
- `docs/WORKING-AGREEMENTS.md` — 用户定稿的协作与交付纪律，每轮改动必须遵守
- `docs/UI-SPEC.md` / `docs/SPEC-SEMANTICS.md` — 视觉规范 / 产品语义（头部有已实现/未实现状态）
- `docs/DSH-SOURCE-MAP.md` — 移植官方 UI 的源码对照图（对照仓内 vendored 副本 `deepseek-harness/`，勿自行发挥）

## 心法

- **本仓库由 AI 维护**，用户通过提交信息、文档与截图消费代码：写给下一个 agent 看，用该技术栈最主流、最默认的写法；禁止自造轮子、禁止聪明写法。
- 模块化组件化：高内聚、低耦合、单一职责——一个文件/组件/函数只管一件事，跨模块只经显式入口。
- 简洁、高效、可读优先；只写当前需要的，不做未来预留。警惕过度设计：越强调"设计感"，越容易得到无谓的抽象层和下一个 agent 也看不懂的代码——宁可朴素直白，不可聪明堆叠。
- 目录即地图：文件名/目录名必须能说明里面是什么；新文件开头一两句注明职责（管什么、不管什么）。

## 仓库布局

```
apps/macos/                Swift 壳（XcodeGen；局部规则见 apps/macos/AGENTS.md）
frontend/                  自建 SPA（React+TS+Vite；局部规则见 frontend/AGENTS.md）
frontend/packages/design/  tokens.json 唯一事实源 → gen-tokens.mjs → tokens.css
design/logo/               品牌 logo 种子工程（BRANDING.md）
engine/                    自研 dsh 引擎（pnpm monorepo；构建 scripts/build-engine.sh，说明见 engine/README.md）
scripts/                   构建/打包/引擎嵌入脚本 + 引擎/插件版本号
docs/                      架构/规范/踩坑/协作约定
deepseek-harness/          官方 DSH 源码 vendored 副本（fork 基线对照源，版本=引擎版本号，embed 时强校验）：资产源/移植对照，勿当运行时、勿改动
```

## 命令

```sh
make dev        # Debug 构建并打开（scripts/dev.sh）
make app        # Release 构建 + 嵌入 web/engine 并打开（scripts/build-release.sh）
make package    # Release + adhoc 深签 + DMG（dist/）
DSHMINI_NOTARY_PROFILE=DSHMINI_NOTARY make package   # 分发档（公证+装钉）：打包前自动把版本号最后一位 +1；前两位只有用户确认才能动（README 开发节）
make tokens     # tokens.json → tokens.css（改 token 后必跑）
make test       # 前端 vitest+两道门 ∥ 壳 XCTest 两腿并行（scripts/test.sh；起跑前自动清占测试锁的残留宿主）
make clean      # 清 .build 与 dist

cd frontend && npm run build   # tsc -b --noEmit && vite build
cd frontend && npm run test    # vitest run（事件回放/纯函数/api 信封）
cd frontend && npm run lint    # eslint src，零报错
node frontend/scripts/check-architecture.mjs   # 架构约束门（make test 已含）：CSS Module 类名写错、新文件超行数
cd apps/macos && xcodegen generate   # 改 project.yml 后重新生成工程
cd apps/macos && xcodebuild test -project DSHmini.xcodeproj -scheme DSHmini -configuration Debug -derivedDataPath ../../.build/debug CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO   # 壳 XCTest（改 Swift 后必跑）
```

## 完成的定义

- `cd frontend && npm run build` 通过——严格 tsc（noUnusedLocals/noUnusedParameters 配在 tsconfig）就是 build 的第一步，不用再单跑一遍。
- `cd frontend && npm run lint` 零失败；`make test` 全绿：前端 vitest + 两道门（架构约束 `check-architecture.mjs`、引擎组合 `check-engine-composition.sh`）与壳 XCTest 两腿并行，改过壳侧 Swift 由其中的 XCTest 覆盖。
- 改前端/UI 的提交走完交付链到"应用已重启、用户可直接看"为止；**验收归用户，不自行截图/做视觉验收**（铁律 2）。
- 无死代码残留：删除功能时代码、样式、文案、文档引用一并删干净；禁止留下注释掉的代码。

## 工程铁律

每条 1-3 行；事故与细节在链接的家，勿在此展开。

1. **改前先读 PITFALLS 对应条目**；用户报告"没生效/不对"时先读源码与构建产物实证，绝不拿"旧实例/没重启"打发（WORKING-AGREEMENTS §1，PITFALLS §5.1）。
2. **交付链固定**：前端 build → package → pkill 旧进程 → open 最新包 → 日志确认，到此为止（WORKING-AGREEMENTS §2/§4；PITFALLS §5.2/§5.3）。**验收归用户**：不自行截图、不自行做视觉或端到端测试，用户明确要求时才做（WORKING-AGREEMENTS §2）。样式/布局问题仍要用可量化的坐标或 computed style 自证。
3. **单一事实源**：token=`tokens.json`、样式=`theme.css`、引擎版本=`scripts/dsh-runtime-version.txt`。易变值（版本号、端口、状态）**不内联**进文档正文与代码注释，指向事实源。
4. **wire 契约勿猜**：新 RPC 方法先查引擎源码 `UNARY_ROUTES`（PITFALLS §4.6）；版本敏感面用 `probeMethod` 能力探测降级，缺则隐藏不崩溃。
5. **空 catch 必须写明吞掉了什么**（`/* engine may be busy */` 式）；降级与静默必须是显式决定，外部输入只在边界处校验（wire/解析/持久化），同进程信任类型。
6. **只修用户指出的问题**：不扩大范围、不顺手"根除"（WORKING-AGREEMENTS §3）。
7. **新增依赖先停下来问用户**：是否主流、是否必要；不得擅自引入新技术栈。
8. **改动即提交**（中文详述因果）；临时验证代码当轮还原（WORKING-AGREEMENTS §4）。
9. **不确定就问，禁止猜测性代码**：字段名、契约、行为含义有任何不确定 → 先查事实源（引擎源码/类型定义/文档），查不到就停下来问用户；禁止枚举猜测掩盖未知（例：不清楚接口响应的 id 字段名，就写 `id ?? userId ?? user_id` 一串猜）。
10. **禁止兜底/保底/冗余代码**：不为"保证能跑"堆防御——对不该为空的值层层 `?.`、try-catch 包一切、掩盖错误的兜底默认值，都是把问题藏进代码。合法降级只有铁律 4/5 那种查证后显式设计的；拿不准的按铁律 9 问，不写代码垫背。

## 代码约定

- **写新代码前先搜项目内同类实现**；同一功能禁止出现第二份拷贝。统一入口：RPC 只走 `api.ts`、壳桥只走 `host.ts`、共享状态经 `store.tsx`、样式用语义变量——同类通道禁止另开第二份。
- **新文件 ≤300 行、函数 ≤50 行**，超了先拆再继续；存量大文件（`theme.css`、`session/renderModel.ts` 等）不强制重构，但新逻辑放新文件，不再向上堆。
- TypeScript 严格：无可辨识联合不用 `as any` 溢出；`sessionId`/`callId`/`toolCallId` 是裸 string，同名概念勿混用。
- 事件摄取热路径 O(1)（Map 索引），禁止整窗扫描（PITFALLS §3.3）。
- UI 文案一律经 `t()`/`tt()` 词典（`frontend/src/i18n.ts`），JSX 不写裸中文；同一概念全项目同一词。
- 注释只写代码看不出的约束（契约/边界/为什么），不写实现叙述。
- 平行值的未解释不对称通常意味着漏了一次抽取——优先补齐而非各写一套。
- 引擎/壳侧标识符用 `deepdive.*` 命名空间（桥钩子 `__deepDiveHost`、消息通道 `deepdive`/`deepdiveHost`），勿再用 dshmini 旧名。

## 文档约定

- **现状态写作**：正文写"是什么"，禁 previously/now/no longer/"已实现！"式状态标注；变更史归 commit message。
- **一事一家**：同一事实只有一个文档拥有，别处链接；发现重复时收敛到一个家。
- SPEC 顶部允许一行状态头（已实现/开放 + 日期），但行为细节以代码与引脚文件为准。

## 维护本文件

每条规则保持 1-3 行并链接到它的家；细节与故事不搬进来（一事一家）。`CLAUDE.md` 是本文件的符号链接——编辑本文件，勿编辑链接。
