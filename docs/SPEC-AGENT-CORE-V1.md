# Agent 核心 v1（@deepdive/agent-core）对表面（草案）

> 状态（2026-10-10）：草案，待定稿（M2b 门槛：**对表面定稿才动代码**，PLAN-ENGINE-SELF-IMPL §4）。
> 收编对象：`@earendil-works/pi-agent-core` v1.0（fork 纪律：逐字复制 → 改名 → 归我们演进）。

## 0. dsh 语义 → pi 钩子对照

| dsh 语义（组合现状） | pi-agent-core 挂点 | v1 注记 |
|---|---|---|
| agent-loop 轮次（turn/start\|end） | turn_start / turn_end 事件 + `finishTurn`(continue/end) | finishTurn 即轮次驱动缝（goal-round 语义的评估点） |
| step/start\|end | 每轮模型调用的 message_start…message_end 周期 | 事件桥合成 step 帧（§1） |
| prompt / steer（PITFALLS §3.9 落点语义） | `agent.prompt` / `agent.steer()`（steeringMode） | steer 落点逐字对表 dsh：插话事件落**轮中途** |
| 排队（QueueDock / updateQueue / inbox 投影） | `followUp`（one-at-a-time = 现产品语义） | 队列持久化归会话层（M2a），loop 只管放行 |
| 审批 allowed-once / rejected | `beforeToolCall` 可 block | `terminate` 不用；outcome 映射照 WIRE-V1 §5 |
| sandbox-policy / permission-presets / user-approval | `beforeToolCall` + 工具执行环境 | 收编 dsh 三包语义为 @deepdive 安全缝（M2c）；bash 沙箱原样 |
| plan-mode（cordis.patch 文案段 + exit_plan_mode） | system 消息段 + 工具面 + finishTurn | 文案逐字保留；plan-review 收窄规则在 SPA 不变 |
| 工具面 preset 组合（效率设计） | `Agent initialState.tools` | preset 决定 tools 数组；未启用 schema 不进请求（照旧） |
| tool 执行体（tool-fs / web / skill…，经 code-runtime 模式） | `AgentTool { execute, executionMode }` | dsh 工具包执行体包成 AgentTool；`DSH_TOOLS_MODE` 开关去留见开放点 |
| repeat-tool-reminder | `afterToolCall` 计数 | 收编为包装器，阈值配置照迁移 |
| tool-call-timeout-policy | execute 的 signal + 包装器 | 超时语义照迁移 |
| KV 稳定（请求冻结 / 前缀稳定） | `sessionId` + `prepareRequest` | 请求冻结纪律照 dsh；provider 会话 id 亲和见 SPEC-SESSION-V1 §0 |
| token-meter / usage 投影 | message 事件 usage | 汇入 M2a 的 usage 投影 |
| 子代理 / goals | **pi 无对应** | subagent：收编 dsh-subagent 改挂自研 loop（产品面不可砍）；goals：**保留**——右栏目标区是活跃产品面（CapsuleGoalSection），goal rounds 的轮次驱动在 finishTurn 缝上收编 dsh-goal/goal-round-driver 语义 |

## 1. 事件桥（pi 事件 → WIRE-V1 词表）

- `agent_start/agent_end` → 会话级状态（走 control / running 面，不落 durable 事件）
- `turn_start/turn_end` → `turn/start|end`
- `message_update`（assistant delta）→ assistant-stream chunk 直播帧（start/chunk/end；
  settle 时 `assistant/message|attempt` 落日志——A 的「直播-结算替换」语义逐字保留，
  前端半截 echo 修复的语义契约不受影响）
- `tool_execution_start/update/end` → `tool/call`（pending）与 `tool/result`（settle）

## 2. 首版不收编的 pi 面

- `streamProxy`（无浏览器直连场景）、低层 `agentLoop*`（统一用 Agent 类）、
  `CustomAgentMessages` 声明合并（我们有自己的消息类型与 wire 词汇）。

## 开放点（M2b 动代码前处理）

1. **子代理**：收编 dsh-subagent 改挂自研 loop（上表已拍板保留，具体谱系/续聊语义在对表时验证）。
2. `DSH_TOOLS_MODE`（code-runtime 的 ptc 模式）在 pi 工具模型下的去留——工具收编后
   code-runtime 还是不是产品面（M2b 对表时读 code-runtime 后定）。
3. steer 的确切落点（轮中途事件序）需在 M2b 对表时以实测事件序验证。
