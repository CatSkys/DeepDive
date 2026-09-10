# DSH Wire 契约与载荷形状（0.1.5-rc.1 实测）

> 本文拥有「引擎 wire 面的载荷形状与通道可用性」这一事实。全部条目来自
> 对引脚引擎（版本见 `scripts/dsh-runtime-version.txt`）的**实机 POST/WS 实测**
> 或 vendored 源码实读，非猜测；升级引脚时须复核并整篇更新。路由与参数的
> 权威清单在**内嵌 runtime 各包的 `lib/typert.remote-client.js`**（`id:
> '<pkg>#<ns>/<method>'`、`scope.wire`、`parameters[].wire` 逐项给出 wire
> 参数名；rc.2 时代的 `dsh-host-apiproxy`/`UNARY_ROUTES` 已随包消亡）。

## 0. 传输层（0.1.2 定版，0.1.5 复验仍成立）

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

## 1. 通道可用性（2026-09-10 复验）

| 方法/面 | 结论 |
|---|---|
| `messageFeedback/list\|put\|delete` | **已落地**（args 为 `request` 包裹；put/delete 带 `ifVersion` CAS，version 为不透明字符串 token，version-conflict 回 `current` 权威 item；UI=轮尾 👍/👎+备注，见 `frontend/src/session/feedback.ts`） |
| `commands/list\|execute` | **已落地**（`{agentId}` / `{agentId, line, images}`——动态目录+Enter 整行直发，见 §6；转录节点=command/run+done 会话事件） |
| `pluginInventory/list` | **可用**（返回 entries：include/插件清单） |
| `fileReferences/list` | **已落地**（`{agentId, query}` → `[{path,kind}]`，cwd 亲和整库索引；@ 菜单文件候选原生源，见 §7） |
| `sessionReferenceResolver/candidates` | **已落地**（`{agentId, query}` → 候选自带规范 mention；@ 会话引用候选原生源，见 §7） |
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

## 3. session/follow 与 session/page（冷热读，0.1.5/V3 口径）

- `session/follow {request:{address, maxMessages?, assistantStream?:true}}` 流：
  首帧 `{type:'snapshot', header, cursor, records, hasMore, projections,
  assistantStream?}`，此后 `{type:'event', event}` 逐条追加（gap-free）+
  **`{type:'assistant-stream', frame}` 直播流帧**（须带 `assistantStream:true`
  开关）。断线重连重发快照（消费方全量替换，`assistantStream.activeAttempt
  .stream` 是断点续播基线）。
- `assistant-stream` 帧（进程级，不入持久日志）：`start {attemptId,revision,
  startedAfterSeq,turn,step}` / `chunk {attemptId,revision,index,time,chunk}` /
  `end {attemptId,revision,index,outcome:{kind:'committed',eventType,seq}|
  {kind:'abandoned'}}`。chunk 的 `chunk` 即 StreamChunk；turn/step 只在 start
  帧上（消费方自记）。SPA 合成 `assistant/chunk` 伪事件走既有 ingest，settle
  事件（assistant/message / assistant/attempt）落日志时自然替换直播项。
- `session/page {request:{address, throughSeq, beforeSeq?, maxMessages?}}` →
  `{records, hasMore}`；**`throughSeq` 必须取自对应 follow 开窗帧的 cursor**
  （超出实际 cursor 报 `gateway/bad-request "past cursor"`，不可猜）。
- `address`：`{kind:'session', sessionId}` | `{kind:'subagent', parentSessionId,
  childSessionId, mode}`（子会话冷读不再需要 subagent.history）。
- **V3 记录全事件化**：`records` 只剩 `{type:'event', event}`（V2 的打包
  chunk 行在引擎侧迁移聚合成 settlement，客户端不再见到；`chunkRows.ts`
  解码器已随 0.1.5 升级退役删除）。旧会话迁移后 seq 重编号但全 log 自洽，
  大会话体积显著缩小（实测 1100+ seq → 29 条记录）。
- 事件词表（durable）：`turn/start|end`、`step/start|end`、`user/message`、
  `assistant/message|attempt`、`tool/call|result`、`command/run|done`、
  `compaction/*`、`llm/retry*`、`schedule/change`；log-only 事件
  （`permission/preset`、`sandbox/mode`、`approval/policy`、`request/header|
  context`、`system/message`、`session/title*`、`agent/inbox/spliced`、
  `session/end-seed` 等）经前端 catch-all 忽略。`tool/result` 内容块可含
  `{type:'image', attachment:{attachmentId,…}}`（read_image 直出，SPA
  `resultImages` 渲染）。`tool/result` 的 `meta.diffs` 槽位仍在（FileDiff
  同形）；call 侧 pending diff 由前端 `deriveCallDiffs` 推导（官方
  presentCall 同款）。

## 4. session/control 与 workspace/follow（实时面）

- `session/control`（args `{}`）host 全量流：首帧 `{type:'baseline', value:
  {queues, jobs, projections}}`（三张 Record<sessionId,…> 表），此后
  `{type:'queue', sessionId, items}` / `{type:'jobs', sessionId, jobs}` /
  `{type:'projection', sessionId, key, value, seq}`。rc.2 的
  `session/queue|jobs|projection` mux 广播帧全部由本流承载。
- `workspace/follow`（args `{}`）：首帧 `{type:'baseline', value:{items,
  archivedSessionIds}}`，此后 `upsert {workspace}` / `remove {workspaceId}` /
  `order {workspaceIds}` / `archived {archivedSessionIds}`（归档唯一事实源）。
- 投影键集（follow 快照实测，0.1.5 增至 17 键）：`title, goal, tokenUsage,
  contextPressure, contextBreakdown, sessionStats, turnOutline, agentPreset,
  subagentCatalog, subagentTiming, subagent, schedule, permissions,
  modelSelection, sessionListMetadata, imageLimits`（另有 `plan`/`todos`/
  `inbox`）。**title 投影冷启动渐进填充**：引擎对小 artifact 内联冷观察
  （`coldBlankProbeMaxBytes` 预算），大会话标题在打开观察后出现——官方同款
  行为，非缺陷。`modelSelection` = `{next, lastUsed}`（会话实时选择 =
  `next ?? lastUsed`，session/models 的替代读法）。`turnOutline` = `[{turn,
  seq, prompt≤50, response≤120}]`（seq 是该轮 turn/start 的事件 seq，深分页
  跳转目标）——SPA 大纲轨消费（`TurnNavigator`，快照种子 + control
  projection 帧实时整值）。`inbox` = `{next-turn:[], next-step:[]}`（排队
  消息全量投影，control queue 帧即由它派生）。`subagent`（子会话身上）=
  `{mode:'continuable'|'one-shot', label?, seq}`——continuable 判据，SPA
  以此解锁子会话 Composer；`subagentCatalog`（父会话身上）= 子会话目录。

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
  `session/rename {sessionId, title}` 形状不变（仅包 request）。0.1.5 起
  `updateQueue` 可直接传**子会话 id**（须 continuable 且自家日志描述符），
  edit 仍仅文本；子会话发消息走 `subagents/prompt {request:{requestId,
  parentSessionId, childSessionId, mode:'continuable', delivery:'queue'|'steer',
  content}}`（content 只收文本/图片，无文件部件）；停止用
  `subagents/interruptByParent {childSessionId, parentSessionId, mode:
  'continuable'}`。
- **通用文件上传（0.1.5）**：`fileUploads/upload {agentId, request:{data:
  base64, name?}}` → `{receiptId, file:{attachmentId, name, bytes}}`（attachmentId
  = 字节 sha256）；`session/prompt` 的 content 第三种部件 `{type:'file',
  receiptId}`（回执随 requestId 生命周期：入队/历史/移除即退役）。引擎另有
  `/api/session/uploadFileBinary?sessionId&name` 流式面（octet-stream，经桥
  转 RPC 面简化、进度不定态）。用户消息历史块 = `{type:'file',
  attachment:{attachmentId,name,bytes}}`。子会话无文件通道。
- **本地媒体（0.1.5）**：`GET /api/file?path=<绝对路径>`（同源经桥，字节上限
  = imageLimits）——Markdown 里单斜杠开头的图片目的地重写到此面（工作区外
  截图直显）；read_image 的 tool/result 内容块带 `{type:'image', attachment}`
  引用，字节经 `session/attachment` 取。

## 6. 命令面（已原生化；0.1.5 附件键改名）

- `commands/list {agentId}` → `[{name, description, input?:{hint, images?}}]`
  （name 排序；插件注册面随引擎走，实测含 attach-workspaces/doctor/import/
  resume-* 等）——前端目录动态拉取（`useSlashCommands`），`commands/change`
  广播失效重拉。描述是引擎注册的英文原文（官方 UI 也不翻译，0.1.5 的
  中文化在其 UI 层）。
- `commands/execute {agentId, line, submittedAttachments}`（**0.1.5 从 images
  改名 submittedAttachments**，实测 args-invalid 钉死）→ `{commandId,
  result:{kind:'success'|'error', …}}`；`undefined` = 未知命令（引擎不落
  事件）。附件元素 `{type:'image',mediaType,data,name?} | {type:'file',
  receiptId}`。执行自驱效果、不经 `session/prompt`（**prompt 无命令槽**）；
  转录节点来自 `command/run`+`command/done` 会话事件（按 commandId 配对）。
- Composer Enter 裁决（`commandLine.ts`）：整行 `/name [args…]` 命中已知命令
  即直发；未知名字拒绝并保留草稿；带 `input` 的命令菜单点击为 claim（插
  `/name ` 续输）。`/export` 按范围拍板仍不入菜单。

## 7. @ 引用（0.1.2 已原生化）与 plan-review

- @ 候选两会话内走引擎：文件 `fileReferences/list {agentId, query}` →
  `[{path, kind}]`（cwd 亲和整库递归索引；含 `/` 的查询退化为目录列举，路径
  相对 agent cwd）；会话 `sessionReferenceResolver/candidates {agentId,
  query}` → `[{sessionId, label, cwd, sameWorkspace, createdAt, mention}]`
  （cwd 亲和排序、自带规范 mention）。草稿页（无 agent 作用域）回落壳侧
  list-dir 与本地会话表（`useMentionCandidates` 的兜底面）。
- plan-review 收窄规则（单题 + `intent.kind==='plan-review'` + detail + 非
  multiSelect + options≤2 + approve 选项在）与应答语义不变；plan 退出芯片
  走 `commands/execute "/plan off"`。

## 8. Settings/Provider 面

- `settings/update|mutate` 形状不变（revision 围栏、`settings/conflict` 错误码
  在）；`settings/describe` 命名空间实测口径见 PITFALLS §7.3（升引脚后以
  `--dump-config` 复核）。
- `llm/listConfigurableProviders` 给配置归属（provider/displayName/settingsNs/
  settingsPath）；「用户手写落盘」以 llm-pi-ai 存在该 provider profile 为准
  （组级删除入口判定，前端 `useModelCatalog`）。
- `llm/discoverModels` 返回直数组；`api` 仍只读 OpenAI 兼容清单。
- 插件配置命名空间（shell/agent-loop/web-search-deepseek）沿用 §7.3/§7.4 记录。
