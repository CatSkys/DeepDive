# SELF-EVOLUTION — 自进化（经验沉淀与校验闭环）spec

> **状态（2026-09-13）：v3 as-built——零人审全量重构已落地。** v1/v2 的人审门（采纳按钮）移除：人的角色收敛为「开关处一次性批准政策 + 事后审计」，单条经验的生死全部由机械门与效果校验判定。本文件是「自进化」的唯一事实源；标准与红线归 `docs/EVOLUTION-POLICY.md`（§0 自治模型）。
> 落地面：`frontend/src/evolution/`（protocol / prompts / pipeline / store / useEvolution / EvolutionSection）、`frontend/src/memory/`（会话记忆分区）、壳 `EngineSupervisor`（固化脚本/插件/技能）与 `AppDelegate`（lesson-tool / memory 审计桥）。

## 0. 一句话

把会话里挣到的**可复用工程经验**自动沉淀回仓库的知识家与引擎能力层，每条都带**可证伪的效果主张**：到期用会话日志机械校验，无效自动回滚。**零人审**——信任不靠"写之前人看过"，靠参考项目一致的组合拳：**变异面有界（允许清单）+ 写前机械门 + 写后机械验证 + 回滚完全且便宜**。

## 1. 闭环（七段，全部自动）

1. **采集**：会话内 lesson 块（self-learning-skills 识别时刻）＋ 后台复盘（摩擦信号挑靶 + 24h 节流 + 7 天静默兜底——MiMo Dream/Distill 节奏）。复盘跑在一次性会话 `自进化·复盘`，输出随流采回（采集跟随运行会话直到 turn/end）。
2. **机械门**（`lesson-gate.mjs` 宿主直跑，模型不在环内）：证据逐字 + 锚点存在；不过门即退役留档。
3. **自动落地**：过门 FIFO、每日 ≤3 条（dsh-evolve-modes 批次默认）。落库会话按落点作用域创建——仓库家 cwd=工作区、DSH_HOME 家 cwd=`$DSH_HOME`：**沙箱 workspaceRoot 即会话 cwd**（引擎 sandbox-policy 原生），写边界由此机械生效（MiMo 代码级路径约束的引擎等价物）。
4. **落地确认**（`lesson-land.mjs` 宿主直跑）：git 提交 + 允许清单 + 文件回读；不采信 agent 口头"完成"（Ditto selftest）。出允许清单自动撤销；内容缺失打回重落（≤2 次）后退役。
5. **到期校验**（`lesson-verify.mjs` 宿主直跑）：签名命中按事件时间归入落地前/后两等长窗（锚定 appliedAt），应用按政策阈值判有效/无效/样本不足。校验零 token、无编造面。
6. **无效自动撤销**（penguin「再评估不提升才保留」）：git revert / 删节 / 摘挂载块，状态退役留档。
7. **整理环**（每 7 天，MiMo Dream）：按作用域两轮独立会话对知识文件去重、清失效锚点、压缩；直接维护性编辑 + git 提交，不走提案协议。

## 2. 数据形状（as-built）

提案 JSON（`lesson` 围栏块）见 POLICY §1/§4 与 `evolution/protocol.ts`：`{category, home, anchor, content ≤2000, inference, evidence[{excerpt ≤500, note?}], predict{metric, signature, windowDays}|null}`；`origin {sessionId, turn, eventSeq}` 由应用盖戳（不采信模型自报定位）。应用侧状态字段：`gate {verbatim, anchorFound, at}`、`appliedAt / appliedSessionId / applyAttempts`、`lastVerifyAt / lastLandAt / revokeAt`、`landing {landed, commit?, files[], reason?, at}`、`verdict {before, after, verdict, at}`。状态机 `pending → applied → expired`（+`dismissed` 审计动作）；`pending` 是"过门待落地"的瞬态。

## 3. 允许清单（七家）

`agents / pitfalls / spec / skill / policy`（仓库四家+政策）、`global`（`$DSH_HOME/AGENTS.md`，AHE 式追加区，无 git 担保较弱）、`plugin`（引擎插件 + 用户层挂载，热装）。细则与依据归 POLICY §1。产品代码一律不在清单内。

## 4. 能力层（plugin 家）

- 落地物 = Cordis 函数插件 `{name, inject, apply}`（范本=盘上 dsh-schedule）+ `profiles/web/cordis.patch.yml` 挂载块（`name` 绝对路径 + `# mounted-by-deepdive <提案id>` 戳）。web profile `patchReload: "live"`——挂载经引擎 HMR 热装，不重启（引擎原生机制，Cordis 论文的动态组合）。
- selftest：land 阶段 `node --check` 语法自检 + 挂载块带戳校验。
- 崩溃自愈：引擎连续 3 次启动失败且用户层 patch 有 `lesson-` 挂载块 → 壳整块摘除（全文进日志）再给一次重启（EverOS fail-open 的宿主侧）。
- 撤销 = 删插件目录 + 摘挂载块（Cordis dispose：移除即完全回滚）。

## 5. 会话记忆（Session 层，设置→记忆）

随应用铺盘的引擎插件 `deepdive-session-memory`：每轮第一个模型步前注入 `<session_memory>` 围栏笔记（不可信历史证据，EverOS 同款，fail-open）；模型用 `memory_note_write` 整份重写（字段照 MiMo writer checkpoint 裁 8 节）、`memory_note_read` 回读、`new_context` 走 `ctx.compaction.compactNow`（引擎无自定义种子接口，笔记每轮注入天然接管恢复——适配）。单写者：每会话一份文件、Node 串行写。笔记落 `<DSH_HOME>/deepdive/memory/`，审计面（查看/忘记/全清）在设置→记忆。开关默认关；装配在启动时读，对会话晚一拍生效。

## 6. Recall 层（跨会话情节召回，EverOS）

挂载 EverMind 官方 dsh 插件（本地源码安装于 `~/Library/Application Support/DeepDive/vendor/everos-dsh-plugin`，profile bundles 已注册）+ EverOS 服务（`uv tool install everos==1.3.1`，**钉 release**；`defer_extraction` 需其 main 分支，不追）。提取端点 DeepSeek（`~/.everos/everos.toml` → `api.deepseek.com/v1`，api_key 由用户填写——应用不碰凭据）。壳 spawn 时探测 `~/.local/bin/everos` 注入 `EVEROS_DSH_START_COMMAND` 绝对路径。机制：每轮 pre-step 召回注入（围栏成不可信证据）、轮停边界无 LLM 捕获、闲时批量提取、fail-open；**故意不提供模型可写的记忆工具**（单一提取权威）。隐私：捕获轨迹含源码片段与命令，会流经 `~/.everos` 与所配模型提供方——敏感仓库使用前须知晓。

## 7. UI

**后台会话的判据与两层处置**（唯一事实源 `frontend/src/session/backgroundSession.ts`）：

- **判据读会话自身的属性**——投影标题 `projections.values.title`，不是应用侧另存的 id 台账。形态照 MiMo-Code 的 `session/visibility.ts` + `auto-dream.ts`（`isSystemSession` 读会话，注释里记着他们的代理判据误杀过 28 个真会话，故换直接判据）。**fail-open**：读不到标题（老会话/无投影）一律当用户会话——宁可多显示一个真会话。
- **两层**（照 MiMo：dream/distill 带 `[Auto]` 徽章可见，checkpoint-writer 宿主永不渲染）：`badge`＝整理类（`自进化·复盘` / `自进化·整理`）留在列表、侧栏加「自动」标识；`hidden`＝执行类（`自进化·落库` 会话、自动化的每次运行），不进用户列表——各功能自己的「运行历史」仍可打开（审计路径）。
- 判据与命名共用同一份常量：机器开的会话**建会话时即按约定命名**（`api.sessionRename`），so 判据无需额外查询。
- **会话里零 UI：合法 lesson 块不渲染**（SPEC-AUTOMATION §3 的 automation 卡是另一套交互，勿混用）。


- **自进化分区**：开关（默认关，知情确认写明自动落地与消耗）→ 台账 Dashboard（状态环图 + 近 30 天活动柱状）→ 处理中（管线状态：证据校验中/待落地/未过证据门）→ 台账（已定案：落地 commit、校验结论、无效已撤）→ 运行历史（模型会话可打开；本机执行标「本机执行」）。审计动作：丢弃、撤销、查看证据原文（跳 origin 会话——EverMe `read_original` 界面等价）、查看写入会话。
- **记忆分区**：会话记忆开关 + 笔记查看/单条忘记/全部清除（Ditto 记忆页同款）。
- 会话里零 UI：合法 lesson 块不渲染（SPEC-AUTOMATION §3 的 automation 卡是另一套交互，勿混用）。

## 8. 设计对本地约束的适配（逐条显式，不装成参考的原样）

1. 复盘/整理是独立会话（SPA 无直连模型通道），靠"一次性会话 + read-only/workspace-write + 成本上限"逼近 dsh-evolve-modes 的隔离学习；判定独立，不复用交办会话历史。
2. 证据定位由应用盖戳；模型只给逐字摘录。
3. 复盘节流 24h+7d（参考是每 3 回复一次廉价调用——我们的复盘是一整轮 agent）。
4. 校验从"校验会话跑脚本"升级为**宿主直跑**（v3）：token 成本归零、无编造面；`lesson-verify` 围栏块仅作历史兼容解析。
5. 撤销走 git，不落 `backups[]`（dsh-evolve-modes 有 backups；git 谱系可精确回滚，应用侧不留快照）。
6. `new_context` ≈ 引擎压缩通道 + 笔记接力（无自定义种子接口）。
7. `global` 家锚点固定 AHE 式追加区（文件可能不存在，落库时创建）。
8. 判定在应用侧（`judgeVerdict` 阈值表），模型/脚本只报 before/after。

## 9. 验收口径

- 说一句"记住这个" → 台账出现一条 pending（证据校验中），消息流零 UI。
- 过门 → 自动落地 → 台账显示落地 commit；`git log --grep=<id>` 命中、触碰文件 ⊆ 允许清单。
- 编造摘录 / 锚点不存在 → 未过证据门，直接退役（日志可查）。
- 到期 → 本机校验出 before/after → 阈值判无效 → 自动回滚，git 无该节内容。
- 7 天静默 → 复盘自行运行；7 天 → 整理环自行运行。

## 10. 出处清单（逐个核过源码/实装）

| 来源 | 拿它的什么 |
|---|---|
| [Cordis 论文（DeepSeek-AI×北大）](https://github.com/deepseek-ai/deepseek-harness) | 自进化 harness 的一等公民定位；可逆效应/反应式协效应→dsh 插件 dispose 与 inject；dsh 即其实现（app-boot/patch/HMR） |
| [GraySilver/dsh-evolve-modes](https://github.com/GraySilver/dsh-evolve-modes) | 状态机与退役语义、证据必逐字、批次=3、待审上限、隔离学习 |
| [Prism-Shadow/penguin-harness](https://github.com/Prism-Shadow/penguin-harness) | Evaluate→Diagnose→Edit→Re-evaluate；「不提升即撤」→无效自动回滚 |
| [Kulaxyz/self-learning-skills](https://github.com/Kulaxyz/self-learning-skills) | 识别时刻判据、连死路一起记 |
| [china-qijizhifeng/agentic-harness-engineering](https://github.com/china-qijizhifeng/agentic-harness-engineering) | 组件化+git 谱系、`## Agent Added Memories`（global 家锚点）、预测+证伪 |
| [NVlabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi) | 机制默认关、逐条 opt-in、搜出即固化（lesson-verify.mjs） |
| [EverMind-AI/EverOS + plugins/dsh](https://github.com/EverMind-AI/EverOS) | Recall 层整体；围栏成不可信证据+记号中和、fail-open、单一提取权威（模型不可写记忆）、事件游标增量捕获、宿主侧 provision/selftest 姿势 |
| Ditto（Timothy-kira/Ditto，EverMe） | 宿主打补丁+selftest 验证+失败回滚；会话笔记每轮注入+new_context 不摘要换窗；记忆页查看/忘记/全清；哈希核原文→「查看原文」 |
| [XiaomiMiMo/MiMo-Code](https://github.com/XiaomiMiMo/MiMo-Code) | Dream/Distill 周期整理与固定节奏；Markdown=可审查性；写入代码级约束→沙箱作用域会话；single-writer；checkpoint 字段裁剪；零人审+审计的信任模型 |
