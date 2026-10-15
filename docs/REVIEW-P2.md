# 架构 Review（P2）— 对照 DSH 官方源码

日期：2026-08-31
对照依据：官方源码副本 `deepseek-harness-master`（含 docs/architecture.zh.md / AGENTS.md / docs/subsystems/{session,conversation}.zh.md）
结论先行：**功能可用，但事件→UI 模型与官方有结构性差距**。当前是"能跑的自建"，若要长期对齐官方、避免反复踩坑，需按本文优先级收敛。

> **收口状态（2026-09-03 更新）**：§6 建议清单里 P0 与 P1 各项**均已落地**——
> ① 可辨识联合：`types.ts` 已类型化，`ingest` 各分支显式收窄，`as any` 已消灭；
> ② O(1) 索引：`IngestCtx.callIndex/callPaths`（Map<callId, …>）取代整窗扫描（PITFALLS §3.3）；
> ③ 独立 turn-tail 渲染单元（`finalizeTurns`，与"最后一条 assistant 文本"解耦，PITFALLS §3.4）；
> ④ 加载更早历史（`loadOlder` + `beforeSeq` 翻页 + olderAnchorRef 滚动锚定）；
> ⑤ 凭据冷启动闭环（`EngineAuth` + 恢复屏「配置 API Key / 从 ~/.dsh 导入」自动重启）。
> 另有超出本 review 的性能落地：Markdown memo、增量摄取（流式只 ingest 新事件）、store 轮询签名去抖。
> **仍开放**：P2-6（评估官方 snapshot store 取代组件内 `RenderItem[]`，建议 UI 需求稳定后再做）；§1 的 `seq` 作 key（现仅 turn-tail 用稳定 `tail:{turn}` key，事件项仍 `${seq}:${type}`）。

---

## 1. 渲染模型：官方快照 vs 我们事件增量

| 维度 | 官方 | 我们 | 影响 |
|---|---|---|---|
| 数据源 | **仅追加 SessionEvent 日志**（`seq` 单调，`seq=log.length`）为唯一真源，UI 从事件*派生* | `history()` 拉取 + `mux` 事件增量 push 进组件内 `RenderItem[]` | 依赖 history+mux 双路径的 seqFloor 去重，有竞态 |
| 事件→UI | `ConversationController` 逐事件进 **external-store snapshot**；节点以**稳定业务 id**（producer-owned branded id）为 key | 组件内 `item.key = ${seq}:${type}` | `seq` 作 key：turn 内重新补发/编辑时 key 不稳定，React 可能复用错节点 |
| 事件归组 | **Location index** 把事件归属到 turn/step/turn-tail（`context.locationOf(event)`） | 手动 `turn` 字段 + `sort` 关联 | 多 step、中断、无文本 turn 时易丢 meta/产物 |
| 增量 | `ConversationNodeDefinition.match` 按 `(kind,id)` 常数时间命中 Context；热路径 **不遍历窗口** | `ingest` 多处 `out.some/find(...)` 反查整条 `RenderItem[]`（toolCallId 配对 assistant/message 替换等） | **违反官方热路径不扫描窗口原则**；O(n) 每次 append |
| 防错 | **单调追加守卫**：`prev.event.seq >= input.event.seq` 直接 throw | `seq < seqFloor` 仅丢弃，无"非单调即错误"安全网 | 若引擎重发/乱序，静默丢帧而非暴露 bug |

**关键风险点**（ingest 内 4 处 `out.find/some`）：
当前 tool/call 与 tool/result 配对靠 `out.find(x => x.kind === "tool-call" && x.toolCallId === callId)` —— 这正是官方文档点名禁止的"把 update 猜测为最近一个未完成 Context"的变体。`toolCallId` 是引擎给的调用 id，单一 union 应成立，但用**整窗扫描**找它，与官方"按 Context key 常数时间命中"不符。

---

## 2. 事件类型：需要可辨识联合

- 官方 `SessionEventMap` 是**可辨识联合**，`switch (event.type)` 直接收窄 `event.data`，`assertNever` 兜底。
- 我们 `types.ts` 里 `data: any`，前端到处 `(data as any)`、`(msg as any)`、`(chunk as any)`。
- 后果：事件载荷**无编译期约束**，之前 `data.chunk.text`/`data.message.content` 的反复出错正是源于此（类型没告诉我们字段在哪，靠运行时试错）。这是官方 AGENTS.md「Trust TypeScript at typed boundaries」/「Switch on discriminant tags」纪律的正面反例。

**建议**：把 `SessionEvent` 改为按 `type` 分发、`data` 字面量表单的 union；事件 JSON 契约从引擎 schema 生成或手工声明显式化。至少把 `ingest` 里 `content/message/content` 三处解析收敛成类型化的 `extract`（当前已做但仍是 `any`）。

---

## 3. Turn 尾部 / 产物 归属

- 官方：`TurnTailNodeView` 是**独立节点**，按 Location index 归属 turn（`node.location.turn`）；产物 `ProducedFiles` 经 `conversation.chat.turnTail` slot 渲染在 turn 尾部。turn 无文本、中断、多 step 均不丢。
- 我们：`finalizeTurns` 把 meta 附加到"该 turn 最后一个 `kind==='assistant'` 的 item"。若 turn 只有工具调用、无 assistant 文本（或以非 assistant 事件收尾），meta 无处可挂 → **丢 meta/产物**。虽然当前事件流通常是"最后一条 assistant/message 含文本"，但官方对中断/无文本 turn 有明确处理，我们未覆盖。

**建议**：引入独立 `turn-tail` 渲染单元（或至少给每个 turn 末尾挂一个 footer 项），meta/产物/时间统计都在其上，与是否有最后一条 assistant 文本解耦。

---

## 4. 滚动跟随

- 官方：`FOLLOW_THRESHOLD=24` + `[data-conversation-scroll]` 宿主，`anchorElement` 按 `data-chat-anchor-key` 定位分页锚点。
- 我们：`follow`（`scrollTop+clientHeight >= scrollHeight - 32`）简单判定，无锚点 key、无分页 anchor。功能可用，但**加载更早历史**（`history` 有 `atSeq`/`hasMore`）时无法稳定锚定滚动位置 —— 当前未实现加载 older，功能缺口。

---

## 5. 壳端协议与安全（对比 client/connection）

- mux：官方为 engine `events.mux` WS；我们桥 `ws://host/api/events.mux` 盲中继，帧解包 `raw.payload || raw`。已确认引擎帧是 `server-request` wrapper，`payload` 解包正确。重连 2s 每次，无 jitter/退避；官方客户端有明确重连语义，但我们仅需保住 mux 流即可。
- unary：对照官方 `client-request{rpcId,method,payload}`，`rpcId` **必须 string**（我们曾用 number 导致 invalid-request），现已 `crypto.randomUUID()`，正确。
- 凭据：我们靠 `DSH_HOME` 指向独立 harness home；官方适配器从 env/`.env`/credentials 读取。**我们曾因该 harness home 缺 `.credentials.yaml` 导致 LLM 空回复** —— 说明"独立 home 需自行准备凭据"这一耦合点易踩坑；建议在 EngineSupervisor 启动时校验凭据存在并给出明确日志。
- 安全：桥 `127.0.0.1` 绑定 + Origin 校验（`origin.hasSuffix(":<port>")`），符合官方 trust fence/loopback 语义。**盲中继 WS** 无 Origin 校验（upgrade 路径只查 `upgrade` 头）—— 但监听 loopback 且静态页同源，可接受；若未来放开端口需补。

---

## 6. 建议优先级

**P0（正确性红线）**
1. `data: any` → `SessionEvent` 可辨识联合（消灭 `as any`，把事件契约类型化）。这是最容易推进、且能显著减少回归的一步。
2. 消除 `ingest` 的整窗 `out.find/some`：为 tool-call 引入 **Map<callId, index>** 索引（官方 Context key 常数时间命中），assistant/message 替换 chunk 改成按 turn/当前流尾定位而非扫描。

**P1（健壮性/对齐官方）**
3. 独立 `turn-tail` 渲染单元（meta/产物/时间放到 turn 尾部），与"最后一条 assistant 文本"解耦。
4. 补齐"加载更早历史"（`history` 有 `atSeq`/`hasMore`），引入 `data-chat-anchor-key` 锚点保持滚动稳定。
5. EngineSupervisor 启动时断言凭据存在，失败给明确错误（避免静默空回复）。

**P2（长期可维护）**
6. 评估是否引入官方 snapshot store（`useChat` selector）取代组件内 `RenderItem[]` + 手动 finalize —— 这是根治乱序/重复/丢失的架构级方案，但改动大，建议在确认 UI 需求稳定后再做。

---

## 已修复未闭环项
- store.tsx 曾有 TEMP VERIFY 硬编码会话 + 未用 `openSession` —— 已清理。
- 本轮 review 前遗留：`ingest` 的 assistant/message 尾块回接 bug（多 step 穿插错位）、Think 重复渲染 —— 均已在代码修复并提交（见 git log）。
