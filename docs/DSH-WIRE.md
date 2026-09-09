# DSH Wire 契约与载荷形状（0.1.2-rc.1 实测）

> 本文拥有「引擎 wire 面的载荷形状与通道可用性」这一事实。全部条目来自
> 对引脚引擎（版本见 `scripts/dsh-runtime-version.txt`）的**实机 POST/WS 实测**
> 或 vendored 源码实读，非猜测；升级引脚时须复核并整篇更新。路由与参数的
> 权威清单在**内嵌 runtime 各包的 `lib/typert.remote-client.js`**（`id:
> '<pkg>#<ns>/<method>'`、`scope.wire`、`parameters[].wire` 逐项给出 wire
> 参数名；rc.2 时代的 `dsh-host-apiproxy`/`UNARY_ROUTES` 已随包消亡）。

## 0. 传输层（0.1.2 定版）

- **鉴权**：boot token 在就绪行 URL（`dsh web: http://…/?token=…`，日志落盘
  前由壳剥除）；`GET /?token=…` → `303 + Set-Cookie`（authority 绑定签名
  cookie，30 天）。此后**每个** `/api` HTTP 与 WS 升级都只认 cookie（`/api`
  路径上的 token 不具鉴力）。壳侧交换见 `EngineAuth`（Foundation 跟随 303
  会丢 Set-Cookie——实测坑，须禁重定向截获），前端经桥接自动携带。
- **HTTP unary**：`POST /api/<ns>/<method>`（斜杠形），`Content-Type:
  application/json`（否则 415），信封 `{type:"client-request", rpcId, method,
  payload}`，**`method` 必须与端点字符串逐字一致**，响应 `{type:
  "server-response", rpcId, result:{ok:true,value}|{ok:false,error:{code,
  message,details}}}`。
- **payload 参数形状**（`payload.args` 内，来自生成客户端权威清单）：
  - 单层 `request` 包裹：`session/create|fork|prompt|updateQueue|cancel|
    rename|search|attachment|selectModel|page|follow|modelCatalog|…` 与
    `workspace/create|rename|delete|archiveSession`
  - 保留参数 `request: {}`：`session/list`（签名 `list(_request, signal)`）
  - 扁平具名：`goals/*`（`{agentId, ref?, request?}`）、`subagents/list
    {parentSessionId}`、`subagents/interruptByParent {childSessionId,
    parentSessionId, mode:'continuable'}`、`settings/update|mutate {ns,…}`、
    `credentials/*`
  - `llm/discoverModels {settingsNs, request:{provider?|baseURL?, api?, apiKey?}}`
    → **直数组** `[{id, name?, contextWindow?, maxTokens?}]`
- **WS 多路流**：单条 `/api/remote.mux`（cookie 鉴权；**`events.mux` 已删除**）。
  上行 `{type:'open', streamId, endpoint, payload:{args}}` / `{type:'cancel',
  streamId}`（**必须文本帧**，二进制帧被断连）；下行 `{type:'item', streamId,
  value?}` / `{type:'error', streamId, error}` / `{type:'end', streamId}`。
  前端实现 `frontend/src/mux.ts`（断线 2s 重连，重连后服务端每代重发基线/快照）。
- **流端点**：`$events`（args 恒 `{}`）、`session/follow`、`session/control`、
  `workspace/follow`。

## 1. 通道可用性（2026-09-09 实测）

| 方法/面 | 结论 |
|---|---|
| `messageFeedback/list\|put\|delete` | **已落地**（args 为 `request` 包裹；put/delete 带 `ifVersion` CAS，version 为不透明字符串 token，version-conflict 回 `current` 权威 item；UI=轮尾 👍/👎+备注，见 `frontend/src/session/feedback.ts`） |
| `commands/list\|execute` | **可用**（`{agentId}` / `{agentId, line, images}`——斜杠命令原行直发，客户端静态目录可原生化，Phase 2） |
| `pluginInventory/list` | **可用**（返回 entries：include/插件清单） |
| `fileReferences/list` | 可用（args 校验在） |
| `session/search` | **原生常开**——session-query-sqlite 已进 base bundle，`--patch` overlay 的 session-query 条目已删 |
| `session/models`、`llm/models` | **已删除**——模型目录唯一面 `session/modelCatalog`（含 reasoning 档位元数据 + default + failures） |
| `session/history` | **已删除**——冷读走 `session/follow` 开窗快照 + `session/page` 向前翻页 |
| `workspace/list`、`workspace/unarchiveSession` | **已删除**——列表走 `workspace/follow` 流；归档单向（仅 `workspace/archiveSession`），unarchive UI 已随之删除 |
| `subagent.*` | 改名 `subagents/list|prompt|interruptByParent`；`subagent.history` 消亡，子会话冷读走 follow 的 subagent 地址 `{kind:'subagent', parentSessionId, childSessionId, mode}` |
| `goal.*` | 改名 `goals/*`（`create/edit/pause/resume/complete/clear`，作用域首参 `agentId`） |
| `agentPreset.list` | 改名 `agentPresets/list` → `{presets: AgentPresetRow[], authorable}`（name 变可选，新增 `broken?`） |
| `settings.openDocument` | 改名 `settings/openSettingsDocument`（+`openAgentPresetDirectory`/`canOpenAgentPresetDirectory`） |
| `llm.providers` | 改名 `llm/listProviders`（`[{id,name}]` 直数组）；配置归属面 `llm/listConfigurableProviders`（`[{provider,displayName,settingsNs,settingsPath}]`） |
| `/api/respond` | **已删除**——审批/提问应答走 `$events/result`（见 §2） |
| `dsh-schedule` 插件 | 仍不在 web profile bundles；壳 overlay 注入保留（engine-patch.yml 仅剩此条目） |

## 2. $events 转发事件流（交互与通知的唯一下行）

开流 `$events`（`{args:{}}`）后，item value 为四态帧（stream-protocol.ts）：

- `{type:'ready', clientId, host:{home}}` —— 世代身份；**应答 waterfall 必带**
- `{type:'emit', event, args[]}` —— 通知类（白名单见 api-remotes
  `API_REMOTE_FORWARDED_EVENTS`）：`api-session/activity|added|error|removed|
  status`、`agent-preset/selected`、`commands/change`、`credentials/
  reference-updated`、`llm/adapters-updated`、`settings/document-updated` 等；
  **没有 `session/event`**——直播转录走 per-session 的 `session/follow`
- `{type:'waterfall', event, eventId, agentId, request}` —— 交互请求：
  `approval/request`（request=`{toolName, callId?, reason?}`；应答值 =
  `'allowed-once'|'rejected'` 字面量）与 `user-questions/request`（request=
  `{questions:[{id,question,header?,detail?,options,multiSelect?}]}`；应答值 =
  `{answers:[{id, selected, custom?}]}`）
- `{type:'cancel', eventId}` —— 引擎侧撤销挂起交互

应答走 HTTP `$events/result`：`{args:{clientId, eventId, outcome}}`，outcome =
`{kind:'next'}`（不决策）/ `{kind:'result', value}` / `{kind:'rejected',
error:{name,message,code?}}`。引擎在**所有**客户端世代都回 next 时才落
next——通知-only 客户端（壳观察者）恒回 next，SPA 是唯一决策者。多客户端
并行（壳观察者 + SPA + 开发浏览器）实测互不阻塞。

## 3. session/follow 与 session/page（冷热读）

- `session/follow {request:{address, maxMessages?}}` 流：首帧
  `{type:'snapshot', header, cursor, records, hasMore, projections}`，此后
  `{type:'event', event}` 逐条追加（gap-free）。断线重连重发快照（消费方全量替换）。
- `session/page {request:{address, throughSeq, beforeSeq?, maxMessages?}}` →
  `{records, hasMore}`；**`throughSeq` 必须取自对应 follow 开窗帧的 cursor**
  （超出实际 cursor 报 `gateway/bad-request "past cursor"`，不可猜）。
- `address`：`{kind:'session', sessionId}` | `{kind:'subagent', parentSessionId,
  childSessionId, mode}`（子会话冷读不再需要 subagent.history）。
- `records` 两态：`{type:'event', event}`（事件原样）或 **打包 chunk 行**
  `{type:'chunks', event:{type:'chunkrow/text-chunks'|'chunkrow/reasoning-chunks'|
  'chunkrow/tool-call-chunks', seq, time, data}}`——连续 assistant/chunk 增量
  的无损压缩（锚点在 `event.seq/time` = 首成员 seq0/time0），解码器移植在
  `frontend/src/chunkRows.ts`，展开后事件词表不变。
- 事件词表（durable）与 rc.2 兼容：`turn/start|end`、`step/*`、`user/message`、
  `assistant/chunk|message`、`tool/call|result`、`command/run|done`、
  `compaction/*`、`llm/retry*`、`tool-workflow/*`、`schedule/change`；新增
  log-only 事件（`permission/preset`、`sandbox/mode`、`approval/policy`、
  `request/header|context`、`session/title`、`agent/inbox/spliced`、
  `session/end-seed` 等）经前端 catch-all 忽略。`tool/result` 的 `meta.diffs`
  槽位仍在（FileDiff 同形）；**history 条目不再携带 view 卡**——call 侧
  pending diff 由前端 `deriveCallDiffs` 从 write/edit/str_replace_editor 参数
  推导（官方 presentCall 同款：`write{file_path,content}`、
  `edit{file_path,old_string,new_string}`、`str_replace_editor{command,path,
  file_text|old_str,new_str}`）。

## 4. session/control 与 workspace/follow（实时面）

- `session/control`（args `{}`）host 全量流：首帧 `{type:'baseline', value:
  {queues, jobs, projections}}`（三张 Record<sessionId,…> 表），此后
  `{type:'queue', sessionId, items}` / `{type:'jobs', sessionId, jobs}` /
  `{type:'projection', sessionId, key, value, seq}`。rc.2 的
  `session/queue|jobs|projection` mux 广播帧全部由本流承载。
- `workspace/follow`（args `{}`）：首帧 `{type:'baseline', value:{items,
  archivedSessionIds}}`，此后 `upsert {workspace}` / `remove {workspaceId}` /
  `order {workspaceIds}` / `archived {archivedSessionIds}`（归档唯一事实源）。
- 投影键集（follow 快照实测 15 键）：`title, goal, tokenUsage,
  contextPressure, contextBreakdown, sessionStats, turnOutline, agentPreset,
  subagentTiming, subagent, schedule, permissions, modelSelection,
  sessionListMetadata, imageLimits`（另有 `plan`/`todos`）。**title 投影冷启动
  渐进填充**：引擎对小 artifact 内联冷观察（`coldBlankProbeMaxBytes` 预算），
  大会话标题在打开观察后出现——官方同款行为，非缺陷。`modelSelection` =
  `{next, lastUsed}`（会话实时选择 = `next ?? lastUsed`，session/models 的
  替代读法）。

## 5. 会话操作契约（要点）

- `session/prompt {requestId, sessionId, mode:'queue'|'steer', content:
  PromptContentPart[], clientTimeZone?}` —— **`requestId` 必填**（客户端
  mint，落盘在被接受的用户消息上；排队消息的 `rpcId` 即它）
- `session/fork {sessionId, atSeq?}` → `{sessionId}`；`session/search {query}`
  → `{items:[{sessionId,snippet}], hasMore}`；`session/attachment` 同 rc.2
- `goals/create {agentId, request:{objective, maxGoalRounds?}}` → `{ref:{id,
  revision}}`；`goals/edit {agentId, ref, request:{objective?,
  maxGoalRounds?}}`；`goals/pause|resume|complete|clear {agentId, ref}`——
  CAS 围栏语义不变（过期 revision 报 STALE）
- 排队操作 `session/updateQueue`、取消 `session/cancel`、重命名
  `session/rename {sessionId, title}` 形状不变（仅包 request）

## 6. 命令目录（引擎注册，前端静态内置）

| 命令 | 输入 |
|---|---|
| `compact` | — |
| `goal` | `[<objective>\|clear\|edit <objective>\|pause\|resume]` |
| `permission` | `<preset>` |
| `plan` | `[off\|message]` |
| `feedback` | `<text>` |

`commands/list`/`commands/execute` RPC 已在（§1）——目录原生化（替代前端
静态表 + `/goal` 客户端派发改走 `commands/execute`）列 Phase 2。`/export`
仍按范围拍板不入目录。

## 7. @ 引用与 plan-review

- @ 菜单候选仍由壳侧 FileManager `list-dir` 提供；引擎 `sessionReferenceResolver/
  candidates` RPC 已在（Phase 2 候选原生化）。
- plan-review 收窄规则（单题 + `intent.kind==='plan-review'` + detail + 非
  multiSelect + options≤2 + approve 选项在）与应答语义不变；0.1.2 上
  `commands/execute` 可达，plan-mode 激活路径已通（rc.2 三门全关的记录作废）。

## 8. Settings/Provider 面

- `settings/update|mutate` 形状不变（revision 围栏、`settings/conflict` 错误码
  在）；`settings/describe` 命名空间实测口径见 PITFALLS §7.3（升引脚后以
  `--dump-config` 复核）。
- `llm/listConfigurableProviders` 给配置归属（provider/displayName/settingsNs/
  settingsPath）；「用户手写落盘」以 llm-pi-ai 存在该 provider profile 为准
  （组级删除入口判定，前端 `useModelCatalog`）。
- `llm/discoverModels` 返回直数组；`api` 仍只读 OpenAI 兼容清单。
- 插件配置命名空间（shell/agent-loop/web-search-deepseek）沿用 §7.3/§7.4 记录。
