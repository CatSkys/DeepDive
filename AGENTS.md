# AGENTS.md

DeepDive（深潜）—— DeepSeek Harness 的 macOS 客户端：Swift+AppKit 原生壳（`apps/macos`）+ 自建 React SPA（`frontend`）+ 被监督的 dsh 引擎子进程（bundled 分发）。对外品牌 DeepDive；内部代号 DSHmini（scheme/目录/包名）有意保留（`docs/BRANDING.md §5`）。

动手前先读对应的家，不要凭记忆：

- `docs/ARCHITECTURE.md` — as-built 架构：三层职责、通信矩阵、文件清单、与原蓝图的偏差
- `docs/PITFALLS.md` — 踩坑记录：**改相关代码前必读对应条目**（每条都来自真实事故）
- `docs/WORKING-AGREEMENTS.md` — 用户定稿的协作与交付纪律，每轮改动必须遵守
- `docs/UI-SPEC.md` / `docs/SPEC-SEMANTICS.md` — 视觉规范 / 产品语义（头部有已实现/未实现状态）
- `docs/DSH-SOURCE-MAP.md` — 移植官方 UI 的源码对照图（对照仓内 vendored 副本 `deepseek-harness-master/`，勿自行发挥）

## 仓库布局

```
apps/macos/                Swift 壳（XcodeGen；局部规则见 apps/macos/AGENTS.md）
frontend/                  自建 SPA（React+TS+Vite；局部规则见 frontend/AGENTS.md）
frontend/packages/design/  tokens.json 唯一事实源 → gen-tokens.mjs → tokens.css / Tokens.swift
design/logo/               品牌 logo 种子工程（BRANDING.md）
scripts/                   构建/打包/引擎嵌入脚本 + 运行时版本引脚
docs/                      架构/规范/踩坑/协作约定
deepseek-harness-master/   官方 DSH 源码 vendored 副本：资产源/移植对照，勿当运行时、勿改动
```

## 命令

```sh
make dev        # Debug 构建并打开（scripts/dev.sh）
make app        # Release 构建 + 嵌入 web/engine 并打开（scripts/build-release.sh）
make package    # Release + adhoc 深签 + DMG（dist/）
make tokens     # tokens.json → tokens.css + Tokens.swift（改 token 后必跑）
make clean      # 清 .build 与 dist

cd frontend && npm run build   # tsc -b --noEmit && vite build（提交前门槛）
cd apps/macos && xcodegen generate   # 改 project.yml 后重新生成工程
```

## 工程铁律

每条 1-3 行；事故与细节在链接的家，勿在此展开。

1. **改前先读 PITFALLS 对应条目**；用户报告"没生效/不对"时先读源码与构建产物实证，绝不拿"旧实例/没重启"打发（WORKING-AGREEMENTS §1，PITFALLS §5.1）。
2. **交付链固定**：前端 build → package → pkill 旧进程 → open 最新包 → 日志确认 → 截图亲自看图后再回复（WORKING-AGREEMENTS §2/§4；PITFALLS §5.2）。改前端/UI 必须走全链。
3. **单一事实源**：token=`tokens.json`、样式=`theme.css`、引擎版本=`scripts/dsh-runtime-version.txt`。易变值（版本号、端口、状态）**不内联**进文档正文与代码注释，指向事实源。
4. **wire 契约勿猜**：新 RPC 方法先查引擎源码 `UNARY_ROUTES`（PITFALLS §4.6）；版本敏感面用 `probeMethod` 能力探测降级，缺则隐藏不崩溃。
5. **空 catch 必须写明吞掉了什么**（`/* engine may be busy */` 式）；降级与静默必须是显式决定。
6. **只修用户指出的问题**：不扩大范围、不顺手"根除"（WORKING-AGREEMENTS §3）。
7. **改动即提交**（中文详述因果）；临时验证代码当轮还原（WORKING-AGREEMENTS §4）。

## 代码约定

- TypeScript 严格：无可辨识联合不用 `as any` 溢出；`sessionId`/`callId`/`toolCallId` 是裸 string，同名概念勿混用。
- 事件摄取热路径 O(1)（Map 索引），禁止整窗扫描（PITFALLS §3.3）。
- UI 文案一律经 `t()`/`tt()` 词典（`frontend/src/i18n.ts`），JSX 不写裸中文。
- 注释只写代码看不出的约束（契约/边界/为什么），不写实现叙述。
- 平行值的未解释不对称通常意味着漏了一次抽取——优先补齐而非各写一套。
- 引擎/壳侧标识符用 `deepdive.*` 命名空间（桥钩子 `__deepDiveHost`、消息通道 `deepdive`/`deepdiveHost`），勿再用 dshmini 旧名。

## 文档约定

- **现状态写作**：正文写"是什么"，禁 previously/now/no longer/"已实现！"式状态标注；变更史归 commit message。
- **一事一家**：同一事实只有一个文档拥有，别处链接；发现重复时收敛到一个家。
- SPEC 顶部允许一行状态头（已实现/开放 + 日期），但行为细节以代码与引脚文件为准。

## 维护本文件

每条规则保持 1-3 行并链接到它的家；细节与故事不搬进来（一事一家）。`CLAUDE.md` 是本文件的符号链接——编辑本文件，勿编辑链接。
