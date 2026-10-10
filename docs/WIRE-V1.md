# WIRE v1 —— DeepDive 自研引擎契约

> 状态（2026-10-10）：**已定稿**（用户授权实施者拍板开放点）。本文拥有「v1 引擎 ↔
> SPA/壳」的契约；现状事实源仍是 [DSH-WIRE.md](DSH-WIRE.md)（下称「实现注记 A」
> = dsh 引擎现状帧形）。前端实现：`frontend/src/wire/`（v1 类型 + A→v1 归一化 +
> 版本侦测），测试在 `frontend/src/__tests__/wire-normalize.test.ts`。

## 0. 原则

- **管道不动**：HTTP unary + 单 mux WS + cookie 鉴权 + 就绪行——壳的 BridgeServer /
  移动远程 / 配对 / EngineEventObserver 零改动。v1 只收编「信封、词汇、版本规则」。
- **前向兼容**：v1 内只增不改；破坏性变更 = v2，按 §1 协商。
- **未知容忍**：未知事件类型 / 未知 RPC 显式降级（包装透传 / 能力探测隐藏），绝不崩。

## 1. 版本协商与双读

- unary：响应头 `X-DeepDive-Wire: 1`；**无此头 = 实现注记 A**（现 dsh 引擎）。
- mux：`$events` ready 帧带 `wireVersion: 1`；缺省 = A。
- 前端 `frontend/src/wire/` 归一化适配层：A 帧形 → v1 类型，M0 起常驻——引擎换血
  （M1/M2）期间 SPA 不改。fixture 双套：A 实测帧 + v1 合成帧。
- 两边都认不出 → 显式「引擎与前端版本不匹配」横幅（fail-loud，不猜形状）。

## 2. unary RPC 面（v1 清单）

v1 的面 = SPA 实际调用集（定稿时逐条以 `frontend/src/api.ts` 消费核对）。按族列现状
（引 DSH-WIRE §1/§5-8 实测口径）：

| 族 | 方法 | v1 处置 |
|---|---|---|
| 会话 | create/fork/prompt/updateQueue/cancel/rename/search/attachment/selectModel/page/follow/list/deleteSessions | 保留（形状照 A） |
| 文件/媒体 | fileUploads/upload、/api/session/uploadFileBinary、/api/file?path= | 保留 |
| 工作区 | workspace/create/rename/delete/archiveSession + workspace/follow | 保留 |
| 实时 | session/control（baseline/queue/jobs/projection） | 保留 |
| 交互 | $events + $events/result（waterfall） | 保留（§5） |
| 模型 | session/modelCatalog、llm/listProviders、llm/listConfigurableProviders、llm/discoverModels | 保留；条目增 `cost`（M1） |
| 设置 | settings/describe\|update\|mutate\|openSettingsDocument | 保留 |
| 凭据 | credentials/* | 保留 |
| 技能/插件 | skills/admin*、pluginInventory/list\|patch* | 保留 |
| 命令 | commands/list\|execute | 保留 |
| 引用 | fileReferences/list、sessionReferenceResolver/candidates | 保留 |
| 子代理 | subagents/list\|prompt\|interruptByParent | 保留（M2b 落自研 loop） |
| 目标 | goals/* | 保留（右栏状态面板目标区 CapsuleGoalSection 是活跃产品面：编辑/暂停/恢复/清除，CAS 修订围栏） |

## 3. mux 下行流（语义照 A，字段归 v1 词表）

- `$events`：四态帧 ready（带 wireVersion / clientId / host）→ emit / waterfall / cancel。
- `session/follow`：snapshot {header, cursor, records, hasMore, projections} → event 逐条
  追加（gap-free）+ assistant-stream 直播帧（start/chunk/end，outcome committed|abandoned）；
  断线重连重发快照。
- `session/page`：throughSeq 必须取自对应 follow 开窗帧的 cursor（A 的实测约束照抄）。
- `session/control`：baseline {queues, jobs, projections} → queue / jobs / projection 增量。
- `workspace/follow`：baseline {items, archivedSessionIds} → upsert / remove / order / archived。

## 4. 会话事件词汇（durable，v1 定案）

- 轮与步：`turn/start|end`、`step/start|end`
- 消息：`user/message`、`assistant/message|attempt`
- 工具：`tool/call|result`（result 内容块含 image 引用；`meta.diffs` 槽位保留）
- 命令：`command/run|done`（按 commandId 配对）
- 其他 durable：`compaction/*`、`llm/retry*`、`schedule/change`
- **log-only（实现细节，客户端 catch-all 忽略）**：permission/preset、sandbox/mode、
  approval/policy、request/header|context、system/message、session/title*、
  agent/inbox/spliced、session/end-seed 等
- 未知事件：由词表联合的尾部 catch-all 成员原样透传（不包装、不崩、不丢），由摄取层
  default 分支忽略；A 的备选拼写（tool/call 的 id/toolName/argsRaw、tool/result 的
  toolCallId/callId/ok 等）由归一化层收敛成 v1 规范形状——渲染层只见 canonical。

## 5. 交互（waterfall，语义与 A 逐字同）

- `approval/request {toolName, callId?, reason?}` → 应答 `'allowed-once'|'rejected'`
- `user-questions/request {questions:[…]}` → `{answers:[{id, selected, custom?}]}`
- 应答走 `$events/result {clientId, eventId, outcome}`；outcome ∈ next / result / rejected。
- **多客户端纪律保留**：所有世代都回 next 引擎才落 next——壳观察者恒 next，SPA 是唯一
  决策者；plan-review 收窄规则照 DSH-WIRE §7。

## 6. 投影

- v1 投影键 = SPA 实际读取集，已知必含：`usage`（M2a 唯一必建投影）、`title`、
  `modelSelection`、`contextPressure`、`imageLimits`、`subagent(Catalog)`、`schedule`、
  `inbox`（排队全量投影，control 的 queue 帧由它派生）。
- `turnOutline`：现无前端消费者——**缓建**，v1 词表保留键名占位。
- title 冷启动渐进填充（冷观察预算）是官方面行为，v1 保持同款语义。

## 7. 演进规则

- v1 内：只加方法 / 只加可选字段 / 只加事件类型；改形状 = v2。
- 每个里程碑换引擎实现时以本文验收；实现注记 A 的事实源 DSH-WIRE.md 在 M3 后归档为历史注记。
