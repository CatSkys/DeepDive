# 引擎自研化实施计划（feat/engine-self）

> 实施计划：把 [PLAN-ENGINE-PI-CORE.md](PLAN-ENGINE-PI-CORE.md) 的四阶段决策落成包级工作
> 分解与里程碑。决策 / 依据 / 自研原则见决策文档；wire 载荷现状见 [DSH-WIRE.md](DSH-WIRE.md)；
> 架构现状见 ARCHITECTURE.md。本文只管「怎么干」。

## 0. 工作方式

- **载体**：worktree `DSHmini-engine-self`（分支 `feat/engine-self`），主 checkout 与其在途改动不动；
  每个里程碑独立 PR 链，合并即进下一段。
- **闸门**：现有三道闸门（真实启动 / 消息可落 / 组合等价）全程跑，形态随阶段演进——M0/M1 照旧，
  M2 起按自研形态重定义（boot 冒烟与组合快照对着新引擎推）；`make test` 两道门全程绿。
- **纪律**：解题纪律（碰到问题先查 dsh 与 pi 双方现成解，可收编则收编，禁止不查就硬加，决策文档 §5）；
  依赖问询（铁律 7）；新文件 ≤300 行；改前端走完整交付链。

## 1. pi-agent-core 事实（M2 的定稿依据）

API 面（v1.0 实测其 README 与源码形状）：

- **`Agent` 类**：`initialState`（systemPrompt / model / thinkingLevel / tools / messages）+
  `streamFn`（pi-ai `streamSimple`）起步；`prompt / continue / steer / followUp / abort /
  waitForIdle / reset` 驱动。
- **钩子即接缝**：`beforeToolCall`（可 block → 审批闸）、`afterToolCall`、`prepareRequest`
  （每请求重建上下文 → KV 稳定与压缩缝）、`finishTurn`（continue/end → plan/goal 缝）、
  `transformContext`、`getApiKey`。
- **steer / followUp**（一次一条或全部两种模式）→ 插话与排队的产品语义有原生挂点。
- **事件**：`agent/turn/message/tool` 十种，`subscribe` 监听按注册序 await → wire v1 durable
  事件的桥。
- **工具**：`AgentTool { name, label, description, TypeBox parameters, executionMode,
  execute(id, params, signal, onUpdate) }`。

**pi-durable（用户 2026-10-10 指名参考）**：它是**另一套自带 loop 的 durable harness**
（GenerationTask / ToolTask 内建，不消费 pi-agent-core），实验期、README 自认 API unstable、
强绑 chord——所以不引包，也不改 M2b 的选型；但它的持久化设计正是 M2a 要对照的现成解：

- 原子提交：`conversation.commit(tx)`——entries / docs / tasks 同落或同不落；
- 崩溃续跑：进度默认 ≤100ms 提交窗口 + `harness.resume()`；
- **UUIDv7 provider session id 持久随会话**（跨 reopen / retry / reset / compaction / 换模型）
  ——与我们的 KV cache 稳定纪律同向，值得收编；
- 存储一致性套件（`registerStorageConformance`）——自研存储的测试范式可照此收编；
- fork / reset / compaction 是 conversation 的一等操作；`test/examples` 里 subagent、
  plan mode、沙箱都有成例可读。

- **引包集**：`@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`，其余
  （durable / chord / server / protocol / …）不引（决策文档 §5.5）。

## 2. M0 —— 契约自立（wire v1，不改引擎）

**交付物**：

1. `docs/WIRE-V1.md`（独立小文档，**先定稿后动代码**；草案已落：[WIRE-V1.md](WIRE-V1.md)）：
   - 传输层照旧：HTTP unary + 单 mux WS + cookie 鉴权——壳的 BridgeServer / 远程面 / 配对全不动；
   - 信封收归我们：client-request / server-response / ready 帧带 `wireVersion`；
   - 会话事件词汇 = 前端 renderModel 实际消费集（从 DSH-WIRE §3 的 durable 词表裁剪定案），
     log-only 事件显式列为「实现细节，客户端可忽略」；
   - 交互语义保留：approval/request 与 user-questions/request 的 waterfall 三态应答原样
     （壳观察者恒 next 的多客户端纪律是通知面的地基）；
   - 迁移期双读：适配层同时接受「dsh 实现注记」帧形与 v1 帧形——引擎换血期间前端不动。
2. `frontend/src/wire/`（新目录）：v1 可辨识联合 + 归一化适配层；`useSessionEvents` /
   `renderModel` 改吃 v1。
3. fixture 回放测试：以现状实测帧为样本（DSH-WIRE 的实机口径）。

**不改动**：引擎、壳。
**判据**：WIRE-V1.md 定稿；`wire/` 单测绿；`make test` 绿；交付链走完（build → package →
pkill → open → 日志确认）。

## 3. M1 —— LLM seam 换 pi-ai 直连

> 设计草案：[SPEC-LLM-V1.md](SPEC-LLM-V1.md)。

**交付物**：

1. `@deepdive/llm`（Cordis 插件）：实现现 `dsh-llm` 的**服务契约**（StreamChunk 词汇、
   `discoverModels` / providers 面不变，dsh-agent 无感）；路由 `deepseek-official` 与
   llm-deepseek 行为对表（thinking 档位映射、图片输入、KV 稳定语义）后并入；
   配置面换成自己的 settings 命名空间——不走 profile 合并 / 补丁链，§7.4/§7.6 事故面消失。
2. 组合换行：`cordis.patch.yml` 的 `llm` / `llm-deepseek` / `llm-pi-ai` 三行换一行；组合快照重推。
3. 目录成本透出：模型条目带 `cost`；`frontend/src/modelFacts.ts` 手抄牌价退役（只留 AA 速度 /
   智能两列）。

**收编来源**：`engine/packages/llm/*`（MIT，本仓逐字拥有）做行为对表；pi-ai 的消费姿势参照
pi-agent-core 的 `streamFn` 用法。
**判据**：决策文档 §3 阶段 1 判据 + 详情卡成本刻度改读引擎目录的回归。

## 4. M2 —— loop / session 收编（风险集中段，拆四个子里程碑）

- **M2a 自研会话层 `@deepdive/session`**（设计草案：[SPEC-SESSION-V1.md](SPEC-SESSION-V1.md)）：**第一份交付物是三方设计对照**（dsh
  `session-persistence-jsonl` / pi-durable（§1）/ wire v1 对 follow·page·list 与投影的需求），
  定稿才动代码。实现收编 dsh 纪律（「模型可见即已记录」、全事件化记录、checkpoint 策略），
  并按对照结论择优吸收 pi-durable 的候选设计（原子提交、崩溃续跑窗口、UUIDv7 provider
  session id 缓存亲和、存储一致性套件）+ 投影（`usage` / `turn-outline` 两个）+
  **惰性 V3 迁移**（决策文档 §5.4：读旧 V3、下次写入起新格式）。
- **M2b loop**：收编 pi-agent-core 为 `@deepdive/agent-core`（fork 纪律），Cordis service 提供
  Agent 实例；dsh `agent` / `agent-loop` 退役。**第一份交付物是对表面**（草案已落：
  [SPEC-AGENT-CORE-V1.md](SPEC-AGENT-CORE-V1.md)）：dsh-agent 语义 ↔
  pi 钩子映射（轮次、steer、审批、plan、工具 schema 进请求的方式），定稿才动代码。
- **M2c 安全缝**：`beforeToolCall` 挂审批 / 沙箱闸（收编 dsh `user-approval` /
  `sandbox-policy` / `permission-presets` 语义）；`$events` 的 approval waterfall 应答语义不变。
- **M2d 产品语义对齐**：steer / 排队 / plan mode / 命令面 / @ 引用与文件引用；工具面收编 =
  dsh tool 执行体包成 `AgentTool`，**preset 驱动的工具组合保留**（PLAN-NATIVE-ENGINE §5.1
  效率设计：未启用模式的 schema 不进请求）。
- **开放问题（M2b 前拍板）**：子代理与 goals——pi 无对应物。倾向：subagent 是产品面，
  收编 dsh 实现改挂自研 loop；goals 随 plan mode 一并评估去留。

**判据**：决策文档 §3 阶段 2 判据（审批卡 / 排队 / 计划模式行为不变、存量会话可读、壳契约保持）。

## 5. M3 —— 收编收尾

- prune 链按退役清单重推：目标 = `@deepseek-ai` 随包从 198 包 / 276 MB 降到组合最小集
  （boot / loader / vendor 骨架保留，收编形态在 M3 拍板）。
- 组合快照与 `cordis.patch.yml` 语义固化；`sync-engine-fork` / 引脚升级流程退役
  （上游对照面冻结在最后同步点）。
- **判据**：决策文档 §3 阶段 3 判据。

## 6. 风险与回退

- **里程碑隔离**：M0 / M1 完全不动 loop；风险集中在 M2，且 M2a→M2d 每步可单独回退。
- **会话数据**：惰性转换 + 真实 V3 样本 fixture；最坏回退 = 旧引擎读 V3 原样，数据无损。
- **审批 / 沙箱（M2c）是安全命门**：接闸前工具面由 preset 控制（不开即无风险面）；接闸后走
  完整交付链 + 用户人工验收。
- **供应商漂移**：收编即冻结（fork 纪律）——pi / dsh 上游的更新从此是我们的对照升级，
  不是被动跟随。

## 7. 里程碑顺序

M0 契约 → M1 LLM → M2a 会话 → M2b loop → M2c 安全缝 → M2d 语义对齐 → M3 收尾。
每段绿了才进下一段；本分支合并回 main 即该段交付。

## 8. 交付台账（2026-10-10 更新）

- **M0 已交付**（634a133f）：`frontend/src/wire/` v1 词表 + A→v1 归一化 + 版本侦测；
  761→763 用例全绿。
- **M1 已交付**（42403292）：成本 peak 牌价端到端直发（seam→deepseek/pi-ai→
  modelCatalog→详情卡）；组合零漂。
- **M2 判定已落**（见 SPEC-AGENT-CORE-V1 §3 与 SPEC-SESSION-V1 验证结论）：
  会话层与 loop 的「自研包」不再新建——fork 现有的 session/agent/agent-loop 就是
  收编形态（MIT、逐字拥有、带仓内修复链）；pi-agent-core 替换判定=降级，不执行。
  **M2c/M2d 结论**：审批/沙箱/plan/goal/命令/@ 引用的产品语义就是 antrop 侧
  composition 行 + `$events` waterfall，M0 词表已覆盖（goals 保留的实证即其）。
- **M2 交付**（本提交）：引擎开口说 wire v1——`X-DeepDive-Wire: 1` 响应头
  （host-webserver）+ `$events` ready 帧 `wireVersion: 1`（gateway）；
  unary 头已在真实构建上实证（boot 后 `session/list` 200 + 头）。
- **M3 收尾判定**：`sync-engine-fork` 升级流程**保留**（对照升级路径，判定见
  PLAN-ENGINE-PI-CORE §3 的 M3 修订）；组合/prune 维持现状（本分支无组合漂移）。
- **待用户复核**：~~agent 核心不换 pi 的改判~~ **已复核：确认（2026-10-10）**——
  pi 定型 pi-ai 层，loop 保留 dsh 本体；按确认路径合并 `feat/engine-self` 回 main
  并走完整交付链。
