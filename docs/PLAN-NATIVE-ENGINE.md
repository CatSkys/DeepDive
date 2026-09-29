# DeepDive 原生引擎重构方向

> 本文是「引擎与应用融为一体、Agent 与 harness 更精简」的**唯一事实源**：现状量出来的数、三个方向（归属 / 精简 / 融合）、落地顺序与判据。
> 架构现状见 `ARCHITECTURE.md`；引擎 fork 的范围与改动纪律见 `engine/README.md`；产品待办见 `TODO.md`。

## 0. 结论

**「要有我们自己的原生引擎」不是重写内核。** 内核——Cordis（一切皆插件、无特权内核）、agent loop 的轮次语义、会话日志（"模型可见即已记录"）、工具管线与能力 seam——是我们要**继承**的东西，而且已经在本仓（`engine/`，MIT，逐字复制未改名）。真正要做的是三件事：

1. **归属**：让自有引擎成为**默认**，而不是一条可选轨。
2. **精简**：把产品不消费的层从组合与分发里剪掉。
3. **融合**：把壳替引擎写的状态继续搬回引擎（设置面与会话数据已完成）。

## 1. 现状（量出来的，2026-09-29）

| 维度 | 现状 |
|---|---|
| 引擎来源 | 双轨：默认嵌 npm 闭包；`DEEPDIVE_ENGINE_SOURCE=fork` 嵌 `engine/` 构建的产物 |
| 引擎工作区 | 268 个包；自有组合 `engine/profile/cordis.patch.yml` **111 行** |
| 其中宿主禁用 | **25 行**（`disabled: true`）——工具面由 4 个 agent preset（`standard`/`minimal`/`ptc`/`cordis`，7–32 行）按模式打开 |
| 运行时闭包 | 508 包；裁剪 44 棵树后**随包 198 个 `@deepseek-ai` 包 / 276 MB** |
| 引擎自有 TS | ~30 万行（含 `vendor/` 与**未装载**的 `client/*` 包） |
| 通信 | SPA→引擎：`POST /api/<ns>/<method>` + `ws /api/remote.mux`；壳→引擎：stdio；壳↔SPA：`WKScriptMessageHandler` |
| 壳仍持有 | OS 能力（窗口/热键/通知/选目录）、进程监督、**应用分发**（profile、AGENTS.md 托管块、随应用发布的技能）、MCP 密钥注入、插件卸载、git |

**已经做对的效率设计**（继续沿用的方向）：工具面**不**在宿主全局打开，而是由 agent preset 按模式组合——未启用的行不进组合树，它的工具 schema 也就不进每次请求的提示词。

## 2. 方向一：归属——自有引擎成为默认

- **事实**：双轨已经名存实亡。设置面的新 RPC（`skills/admin*`、`pluginInventory/patch*`）与会话的 `session/deleteSessions` / `workspace/unarchiveSessions` **只存在于 `engine/`**，npm 闭包轨下这些面直接不可用（前端已降级为"这个引擎没有该接口"）。也就是说：默认轨产出的应用是**功能残缺**的。
- **做什么**：`scripts/embed-engine.sh` 的默认改成 fork；npm 闭包轨降级为"对照 / 回退"（脚本保留，`DEEPDIVE_ENGINE_SOURCE=npm` 显式选择）。
- **判据**：不带 env 跑 `make app`，产出应用里 `skills/adminList`、`session/deleteSessions`、`pluginInventory/patchList` 三条 RPC 可用（经桥打一次即可）；`scripts/check-dsh-source.sh` 仍与 `scripts/dsh-runtime-version.txt` 对齐。
- **风险**：fork 与上游发布闭包的版本漂移（约 74 个包，已记在 `engine/README.md`）。等价性不靠版本号一致，靠三道闸门（真实启动 / 消息可落 / 组合零差异）。

## 3. 方向二：精简——把不消费的层剪掉

### 3.1 第一刀：官方 Web UI 那条线（第一轮已落，2026-09-29）

- **事实**：DeepDive 的 SPA 是唯一前端，但随包里还带着官方 Web UI 的宿主与浏览器模块：
  `dsh-web-frontend` 4.6 MB、`ui-conversation` 4.4 MB、`ui-chat` 3.6 MB、`ui-theme` 0.7 MB、
  `ui-deliverables` 0.7 MB、`ui-settings-general` 0.5 MB、`client-locale` 0.6 MB、`dsh-web`/`dsh-web-app` 0.4 MB
  —— **≈15 MB 与十余个包**，加上仍在 profile 表里的 13 条 `client/ui-*` 行。
- **为什么不能直接删**：profile 的有意移除清单已经写明，`ui-chat` / `ui-conversation` / `ui-theme` /
  `ui-deliverables` / `ui-settings-general` / `locale` **注册了真实的 host 状态**（system-prompt 段、设置命名空间）——
  删行等于删掉模型可见的提示词段或设置面。`DeploymentPrompt`（把部署提示词落进 `AGENTS.md` 托管块）已经是"把官方那层做的事换成我们自己的"先例。
- **已落地的五个行**（`ui-theme` / `locale` / `ui-settings-general` / `ui-chat` / `ui-deliverables`，共约 11 MB）：每个都按"它注册的 host 状态我们读不读"逐个核过 `frontend/src`——四个设置命名空间（`ui-theme` / `locale` / `ui-onboarding` / `ui-chat`）**零读者**；`ui-deliverables` 的两条 `/api/present.*` 路由也没人用，它那段 system-prompt 里**有行为价值的那半句搬进了部署提示词**（`DeploymentPrompt.swift` 的 AGENTS.md 托管块），"以便在 Web 里点开"那半句删掉（我们的 SPA 不把行内代码渲染成可点链接）。
- **已查明但不能剪的一块**：`dsh-web-frontend`（4.6 MB，官方页面资产）看着像死重——我们的页面由桥托管，引擎的 `/` 从不被浏览。但它**是活的**：壳的 `EngineAuth` 用"请求 `/` → 303 + Set-Cookie"换会话 cookie（`EngineAuth.swift`），而 `/` 由 `web-app` 行在**请求时**解析 `@deepseek-ai/dsh-web-frontend/dist/index.html`，包不在就直接抛错——剪掉等于让应用连不上引擎。要剪它得先让引擎的 `/` 由一个 DeepDive 自己的极简 static owner 应答（那是"自有引擎"该走的一步），不是删包。
- **仍然保留一行**：`ui-conversation`。它的浏览器半同样是死重（4.4 MB），但**我们的 SPA 读它的设置命名空间**（`ui-conversation.busyEnter`，发送方式 queue/steer，设置页/Composer/侧栏三处）。要剪它得先有一个 DeepDive 自己的宿主包来注册这个命名空间——那是"我们自己的引擎"该走的一步，不该把用户可见设置悄悄换家。
- **判据**：组合 dump 与 `composition.expected.txt` 的 diff **只有这五行**（证明没有连带丢配置）；`smoke-engine-boot.sh` + `smoke-engine-prompt.sh` 全绿。

### 3.2 第二刀：未接的能力（已处置，2026-09-29）

- **结论**（逐组核过，`TODO §10` 已随之删节）：
  - **持久终端**：不是"未接"——`dsh-terminal` / `dsh-terminal-bash` 由 agent preset 启用（`tool-bash-persistent` / `tool-pwsh-persistent` 要用），**已是现役**。原 TODO 那句"现役 shell 是逐调用新 shell"是旧观察。
  - **`tool-cordis`**（1.9 MB 自省目录）：同样由 `cordis` preset 启用，**保留**。
  - **LSP / SDK**：**根本没随包**（闭包里没有），所以没有"剪"的问题；要接就得先把包带回来。
  - **hooks 桥（claude-code / codex）与 ACP**：未接、无行、无 preset 引用，只由 `apps/cli` 的依赖树拉进闭包 → **已从分发剪掉**（`scripts/prune-dsh-runtime.sh`，判据是真实启动冒烟）。
  - **`experimental/*` 与 agent-team**：本就不在闭包里（未装载），不占分发体积。
- **判据**：`prune-dsh-runtime.sh` 的 `OK: pruned N package trees` 与 boot/prompt 冒烟全绿。

### 3.3 第三刀：组合行与工具面

- **事实**：111 行里 25 行宿主禁用。这是"宿主保持最小、能力按 preset 开"的正确形态。
- **做什么**：① 把每条 `disabled: true` 的**理由**写进 profile 注释（哪些是"由 preset 打开"、哪些是"产品不用"）；② 继续把模型可见面收敛到 preset（宿主只留基础行）；③ 组合表按「core / 工具 / 客户端宿主 / 未接」四档分组注释，让"剪哪一行"一眼可判。
- **判据**：`--dump-config` 的 disabled 行与理由一一对应；单次请求的工具 schema token 数（可从 `request/context` 事件量）不上升。

### 3.4 目标口径

| 指标 | 现在 | 目标 | 怎么量 |
|---|---|---|---|
| 随包 `@deepseek-ai` 包数 | 198 | ~150 | `ls $APP/Contents/Resources/Runtime/dsh/node_modules/@deepseek-ai \| wc -l` |
| 引擎目录体积 | 276 MB | ~200 MB | `du -sh $APP/Contents/Resources/Runtime/dsh` |
| 冷启动 | boot smoke 就绪 | 不退化 | `scripts/smoke-engine-boot.sh` 计时 |

## 4. 方向三：融合——app↔engine 的边界再收

**已完成（2026-09-29）**：技能目录读写、插件启停落账、会话取消归档与删除都搬回引擎（`skills/admin*`、`pluginInventory/patch*`、`workspace/unarchiveSessions`、`session/deleteSessions`）；壳不再替引擎写任何状态文件，前端那套本地覆盖层整体删除。**壳现在只剩 OS 能力 + 进程监督 + 应用分发。**

**还剩的，以及各自的方向**：

| 壳现在做的 | 方向 |
|---|---|
| 把随应用发布的技能正文写进 `<DSH_HOME>/skills/` | 搬进 `engine/profile/skills/`，作为 bundled/custom skill root 随引擎装载——壳连"发布技能"都不做 |
| MCP server 行（写 patch）+ 密钥（注入引擎 env） | 引擎自带凭据面（`ctx.credentials` 已在组合里）+ 自己的配置源；壳只做 UI |
| 插件卸载（改 profile 依赖） | profile 自持（引擎管自己的依赖树），或明确归"应用分发"并写清 |
| `write-agents`（项目 AGENTS.md） | 留壳：一次性文件写，OS 能力 |
| git（审查面板） | 留壳：引擎无 git 面，且是工作区能力 |

**判据**：壳的 host 指令集里"写引擎状态文件"的调用点归零；应用分发那几处进白名单并在 `ARCHITECTURE.md` 写清。

## 5. 效率——Agent 与 harness 本身

1. **能力集下沉到 preset**（已有雏形，继续）：宿主行最小化，工具面按模式开。工具越多，每次请求的 schema token 越多；MCP 每个 server 的工具定义都会给**每次**请求加 token（`TODO §7` 已记），这条同理适用。
2. **统计/用量走投影，不走重放**：统计页现在逐会话 `session/follow` + `session/page` 重放历史（159 会话 ~17s，见 `PITFALLS §4.16`）。按会话日志那条"模型可见即已记录"的同族做法，把用量折成一个投影单元，客户端读 `stateOf()`。判据：统计页首帧出数、耗时回到亚秒级。
3. **启动与分发**：现在每次启动把 `EngineProfile` 装进 harness home（一次拷贝）；可评估只读引用或预装进 bundle。判据：冷启动时间与 `make app` 产物体积。

## 6. 落地顺序（下一步）

1. **默认轨切 fork**（1 行 + 文档 + 完整交付链）——不切，后面所有引擎改动都只活在一半的产品里。
2. **第一刀**：官方 Web UI 那条线的 host 状态搬迁 → 剪包 → 组合漂移门绿。
3. **第二刀**：未接的四组逐一拍板（接 / 删）。
4. **随应用发布的技能搬进 `engine/profile`**（融合表的第 1 行）。
5. **统计走投影单元**（效率第 2 条）。

## 7. 不做

- **不重写内核**：Cordis、agent loop、会话日志、工具管线继承使用，改动走"新行为挂到已有扩展点"（见上游 `docs/architecture` 的归属表）。
- **不 fork 改名**：`@deepseek-ai/*` 保持原样（改名只带来 diff，不带来能力）。
- **不动轮次语义**：`turn/*`、`step/*`、`request/context` 的语义是模型可见面的一部分。
- **不对外开 SDK / ACP**：产品当前不需要被外部程序驱动（`TODO §12`）。
