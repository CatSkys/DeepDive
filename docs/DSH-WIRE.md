# DSH Wire 契约与载荷形状（rc.2 实测）

> 本文拥有「引擎 wire 面的载荷形状与通道可用性」这一事实。全部条目来自
> 对引脚引擎（版本见 `scripts/dsh-runtime-version.txt`）的**实机 POST 实测**
> 或引擎源码实读，非猜测；升级引脚时须复核并整篇更新。RPC 信封与传输层见
> `frontend/src/api.ts` 头注；路由权威清单是内嵌 runtime 的
> `dsh-host-apiproxy/lib/index.js` `UNARY_ROUTES`（含每个 payload 的 zod schema）。

## 1. 通道可用性（2026-09-03 实测）

| 方法 | 结果 | 结论 |
|---|---|---|
| `fileReferences.list` | 404 `not found` | Remote domain RPC，rc.2 无 `/api/remote.mux` 承载（PITFALLS §7.1）；@ 候选**不走引擎发现** |
| `messageFeedback.list` | 404 | 同上；**消息反馈（点赞）无通道，UI 不做**，待升 alpha.2+ |
| `pluginInventory.list` | 404 | 插件清单无浏览器面；设置页插件分区维持降级文案 |
| `host.listDirectory` | 403 `directory-picker-unavailable` | web-app bundle 挂 `directory-picker-auto`，darwin+回环+ attended 事实解析为 native（browse 能力关闭）；patch 层**不能换模块**（`applyEntryPatches` 对 `name` 不匹配直接 skip），auto 亦无 config 覆盖点 → 该 RPC 在桌面部署不可用 |
| `session.search` | 默认禁用；`--patch` 后可用 | web-app bundle patch 显式 `session-query-sqlite { path: ':memory:', openAt: never }`；经 `dsh --profile web --patch <overlay>` 覆盖 `openAt: first-search` 实测放行（中文可搜，snippet 正常） |
| `session.fork` / `session.attachment` / `goal.*` / `subagent.*` / `skill.list` / `host.openPath` | 白名单内 | 可用 |

## 2. 关键 unary 契约（schema 摘录）

- `session.fork { sessionId, atSeq? }` → `{ sessionId }`（子会话 id）
- `session.search { query(1..500) }` → `{ items: [{sessionId, snippet≤240}], hasMore }`（≤20 条）
- `session.attachment { sessionId, attachmentId }` → `{ attachment, data }`（图片字节）
- `host.openPath { path }` → 在 Finder 打开/揭示路径（壳侧已接 `reveal-path` 语义）
- `goal.*`：`{ sessionId, ref?, objective?, maxGoalRounds? }`（阶段 5 面向）

## 3. 事件载荷形状（实测/引擎源码）

### 3.1 `turn/end` — `reason` 是对象，不是字符串

```json
{ "type": "turn/end", "data": { "turn": 1, "reason": { "kind": "completed" } } }
```

实测四种 `reason.kind`：`completed` / `interrupted` /
`{kind:"aborted", reason:{kind:"user"}}` /
`{kind:"error", error:{message, code:"MISSING_CREDENTIAL"}}`。
agent-loop 源码另有 `max-tokens`（finish.kind 映射）。

### 3.2 usage

`assistant/chunk` 的 `chunk.type:"usage"` 与 `assistant/message` 的 `data.usage`：
`{ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens?, reasoningTokens }`。

### 3.3 投影值（`session.list[].projections.values`，实测键集）

| 键 | 形状 |
|---|---|
| `tokenUsage` | `{uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens}` |
| `contextPressure` | `{pressureTokens, projectedTokens, contextWindow}` |
| `contextBreakdown` | `{systemTokens, toolsTokens, messageTokens}` |
| `sessionStats` | `{turns, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens}` |
| `permissions` | `{options:[{value,name}], currentValue}` |
| `plan` | `{active, pending}` |
| `goal` / `subagent` / `todos` | 未用时为 `null` |
| `imageLimits` | `{maxImageBytes, maxImagesPerMessage, mediaTypes:[…png/jpeg/webp/gif]}` |
| `sessionListMetadata` | `{blank, lastPromptAt}` |

### 3.4 `tool/result` 的 diff 槽位

`data.meta.diffs: FileDiff[]`，`FileDiff = { path, oldText: string|null, newText }`
（`oldText:null` = 新建/覆盖无前文；来源 `core/tools/src/presentation.ts`）。
编辑类工具的 call 侧 arguments 也推导同形 diffs（结果先于结果事件时）。

### 3.5 命令生命周期事件

```
command/run  { commandId, name, args?, source:{kind:'user'} }
command/done { commandId, kind:'success'|'error', text?, sourceEventSeq? }
```

### 3.6 压缩事件（`compaction/*`，log-only）

`compaction/start {compactionId, turn|null}` →
`compaction/summary {compactionId, summary:ContentBlock[], shadowedRange, shadowedSeqs, shadowedTokenCount, provider, model, usage?}` →
`compaction/end {compactionId, error?}`。表面替换由紧随的 `user/message`
（shadow 定价）承担——渲染压缩卡应以 `compaction/summary` 为准。

### 3.7 `llm/retry`（重试链）

`{retryId, turn, step, provider, mode:'normal'|'always', policyKey, retry, maxRetries?, delayMs, failure:{message, code, status?, providerRetryAfterMs?}}`；
`llm/retry-started {retryId, turn, step, retry}` 收尾一次等待。

### 3.8 会话预设/上下文事件

- `permission/preset {preset}`；`sandbox/mode {mode}`；`approval/policy {policy}`
- `request/context {provider, model, contextWindow}`（占用环分母来源）
- `agent/inbox/spliced {target, start, inserted[]}`（steer 插队落点）
- `session/title {title, messageSeqs, source}`

## 4. 命令目录（引擎内注册，静态内置依据）

| 命令 | 描述（引擎原文） | 输入 |
|---|---|---|
| `compact` | Compact older conversation history | — |
| `goal` | set or view the goal for a long-running task | `[<objective>|clear|edit <objective>|pause|resume]` |
| `permission` | Switch the permission preset (sandbox mode + approval policy) | `<preset>` |
| `plan` | Enter or leave plan mode | `[off|message]` |
| `feedback` | record feedback about this session | `<text>` |

`/export`（Download this Session log as a ZIP archive）在引擎侧存在但按范围
拍板**不入本轮目录**。无 `commands.list` RPC——目录静态内置，升引擎时对照
上表来源复核（`command-compact` / `command-goal` / `permission-presets` /
`plan-mode` / `command-feedback` 各自的注册处）。

## 5. @ 引用 grammar（官方 `dsh-file-reference/grammar`，浏览器安全可移植）

- 触发：行首或空白后的 `@`；`@"` 开启带引号路径（可含空格）
- 补全候选缺失时的降级：@ 菜单候选由**壳侧 FileManager 列目录**提供
  （`list-dir` host 指令），引擎在 prompt 侧自行解析 `@path` 文本
  （`dsh-file-reference-local` 注入 `FILE_REFERENCE_PROMPT`），插入纯文本即生效
- 格式化：目录补尾 `/`；含空格路径用 `@"…"`；目录保持引号开启以便续层

## 6. plan-review 收窄规则（官方 `PlanReviewPanel` + `planReviewOf`）

单题 + `intent.kind==='plan-review'` + `detail`（计划正文 markdown）+
非 multiSelect + options ≤2 + 存在 label===`intent.approve` 的选项，才由
计划审查卡接管。批准/拒绝 = 应答 `selected:[对应 option.label]`；
继续讨论 = cancel（ASK_CANCELLED）。不满足则回退通用提问流。

## 7. 阶段 5 面：长任务与并行工作（2026-09-03 实测/实读）

### 7.1 Goal（投影 + CAS RPC）

- `goal` 投影整值：`{ goal: { id, revision, objective, phase: active|paused|blocked|complete, blockedReason?, maxGoalRounds }, roundsStarted, createdAt, updatedAt } | null`；实时经 `session/projection` mux 帧（key=goal），`session.list` 兜底
- `goal.create {sessionId, objective, maxGoalRounds?}`；`goal.edit {sessionId, ref, objective?, maxGoalRounds?}`；`goal.pause/resume/clear {sessionId, ref}`，`ref = {id, revision}` 为 **CAS 修订围栏**——过期 revision 报 `GOAL_STALE_REVISION`，UI 必须取投影当前值
- phase 迁移校验：complete 不可 resume（`GOAL_INVALID_TRANSITION`）；创建即驱动 goal round（roundsStarted 递增）

### 7.2 Subagent（谱系 + 冷读）

- `subagent.list {parentSessionId}` → `{ entries, parentAvailable }`；entry = `child { id, activity: running|inactive, hasChildren, mode: one-shot|continuable, label? }` | `diagnostic { id, reason }`（子代理身份由 `subagent` 投影 fold 而来；运行中的创建窗口候选被省略）
- `subagent.history { parentSessionId, childSessionId, mode, beforeSeq?, maxMessages? }` → `{ events, hasMore, projections? }`——**未激活子会话的冷读通道**（`session.history` 对其 404）
- `subagent.interrupt { parentSessionId, childSessionId, mode: 'continuable' }` → `{accepted}`；目录寻址的子会话无人类 composer（官方 SubagentReadOnlyComposer：one-shot / parent-unavailable 两因）

### 7.3 Jobs（mux 帧广播）与 Schedule（事件折叠）

- `session/jobs { sessionId, jobs: JobView[] }` mux 帧（同 session/queue 族，全量快照）；`JobView = { id, kind, label, status: running|stopping|completed|killed|failed, detail?, startedAt, finishedAt? }`；rc.2 无任务 kill 的浏览器面 → 目录只读
- Schedule 无任何 RPC/帧；durable 状态在 `schedule/change` 事件（`{version:1, operation: create|delete|dispatch|advance, schedule?|id, scheduledAt?}`）；记录 = `{id, kind: after|at|every, prompt, scheduledAt?|everySeconds?}`；会话本地投递（session-local），无外部通知通道

### 7.4 Workflow（父会话事件流嵌套卡）

`tool-workflow/run-start {runId, name}` → `agent-start {runId, seq, label, phase?, childId}` → `agent-end {runId, seq, outcome: completed|failed|cancelled}` → `run-end {runId, stopReason: completed|cancelled|error}`；全部为普通 session 事件，无独立 RPC。

### 7.5 Provider/模型目录与插件配置（settings 面）

- `llm.providers` → `{provider, displayName, settingsNs, settingsPath, active, declared?}`；`llm.discoverModels {settingsNs, provider?, baseURL?, api?, apiKey?}` → `{models: [{id, name?, contextWindow?, maxTokens?}]}`（apiKey 只上送不存储）
- 模型/路由配置写 `settings.update`（revision 围栏）：`llm-deepseek.models = [{id, name, contextWindow, inputModalities, …}]`；`llm-pi-ai.providers = {<route>: {apiKeyEnv?, displayName?, api?, baseURL?, models?}}`
- 插件配置命名空间（实测）：`shell {timeoutMs, maxTimeoutMs, maxOutputBytes, maxSpillBytes, graceMs}`、`agent-loop {maxParallelToolCalls}`、`web-search-deepseek {apiKeyEnv, model, apiVersion, maxTokens, maxUses}` + secret `apiKey`（credentials 写入）
