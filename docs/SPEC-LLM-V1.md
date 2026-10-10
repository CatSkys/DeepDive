# LLM seam v1（@deepdive/llm）设计（草案）

> 状态（2026-10-10）：草案，待定稿（M1 门槛，PLAN-ENGINE-SELF-IMPL §3）。
> 行为对表对象：`engine/packages/llm/*`（MIT，本仓逐字拥有，**含 fork 自有补丁**——
> 如 llm-pi-ai 的 describableReasoningLevel 兜底，PITFALLS §7.6，上游没有这行为）。

## 0. 不变量（服务契约，M1 期间 dsh-agent 仍消费）

- StreamChunk 词汇不变（block-start → text-delta / reasoning / tool-call → usage → finish，
  恒以 terminal finish 收尾）；每流一个 provider attempt，重试归 `llm-retry` 行
  （**保留**，吃同一契约）。
- 请求深冻结（dsh 纪律保留）：消费方可读不可写。
- 路由名不变：`deepseek-official` + 用户 settings 路由——`agent-default-model` 与前端零改动。

## 1. 路由实现

- **deepseek-official**：pi-ai 的 deepseek provider 承载（同为 openai-completions +
  `thinkingFormat: deepseek`）；与 dsh-llm-deepseek 逐项对表后并入：thinking 档位映射、
  图片输入、baseURL / 凭据按请求解析、cacheRead/cacheWrite 语义。
- **pi-ai providers**：收编 llm-pi-ai 的目录 / compat 开关 / 端点发现（GET /models 两种
  方言与 URL 归一规则）/ 图片三预算（pixel / per-request / aggregate）行为。
- **配置面换成自有 settings 命名空间**：不走 profile 合并 / 补丁链——§7.4 / §7.6 的
  事故面（静默丢段、`off` 键 YAML 布尔坑）从 LLM 路径上消失；改配置下次请求生效，
  快照语义保留（请求不跨配置代）。

## 2. 目录与成本

- 模型条目增 `cost {input, output, cacheRead, cacheWrite}`（pi-ai 目录原生；
  llm-pi-ai 曾把它归零——`catalog.ts` 的 `NO_COST`）；`session/modelCatalog` 投影透出。
- `modelFacts.ts` 手抄牌价退役，只留 AA 速度 / 智能两列（前端 join 引擎 cost）。
- `llm/discoverModels` 行为与 A 一致（直数组、OpenAI 兼容清单）。

## 3. 凭据与登录

- 阶段 1 引擎仍是 dsh 内核组合：凭据继续走 `credentials` seam（apiKeyEnv 引用逐请求解析，
  MISSING_CREDENTIAL fail-loud 语义保留）。
- OAuth 登录面（pi-ai 自带、authorization seam 现未挂载）是后续产品项，M1 不做。

## 4. 组合与验收

- `cordis.patch.yml`：`llm` / `llm-deepseek` / `llm-pi-ai` 三行换 `@deepdive/llm` 一行；
  组合快照重推。
- 验收：决策文档 §3 阶段 1 判据 + 成本刻度回归（详情卡读引擎目录）+ A/B 同 prompt 对跑
  chunk 流形状一致（fixture）。

## 开放点

- deepseek 档位兜底行为必须从 fork 现实现带过来（PITFALLS §7.6 是我们打的补丁）。
- `reasoningEfforts` 用户配置在新配置面里复测（`off` 键 YAML 布尔坑，§7.4）。
