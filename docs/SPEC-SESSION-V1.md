# 自研会话层 v1（@deepdive/session）设计（草案）

> 状态（2026-10-10）：草案，待定稿（M2a 门槛：**三方设计对照定稿才动代码**，
> PLAN-ENGINE-SELF-IMPL §4）。对照对象：dsh `session-persistence-jsonl`（本仓逐字拥有）
> 与 pi-durable v1.0（不引包，只作设计参照——实验期 API、自带另一套 loop、强绑 chord）。

## 0. 三方对照（结论先行）

| 维度 | dsh persistence | pi-durable | v1 采纳 |
|---|---|---|---|
| 记录模型 | 全事件化 JSONL，「模型可见即已记录」，V3 实测吃透 | 不可变 Entry + Conversation 一等 | **dsh 骨架**：事件日志 + snapshot/cursor 分页；词汇 = WIRE-V1 §4 |
| 原子性 | 轮末 durable attempt settlement（大块原子） | `conversation.commit(tx)` 全量原子 | dsh settlement 语义保留；append-only 行写入天然原子，**不引**全量 tx |
| 崩溃恢复 | checkpoint 策略（每 N 事件/秒落投影行） | ≤100ms 提交窗口 + `resume()` | **收编候选**：轮中途落账窗口（每 N ms/chunk）——与 settlement 粒度的取舍定稿拍板（写放大 vs 崩溃损失） |
| 缓存亲和 | KV 稳定纪律（请求冻结、前缀稳定） | **UUIDv7 provider session id 跨一切保留** | **pi 设计收编**：会话持久 UUIDv7 provider id，跨重开 / 换模型 / fork / 压缩不重置 |
| fork / 压缩 | `session/fork atSeq`；compaction（组合里 disabled） | fork / reset / compaction 一等操作 + compaction task | fork 照 A；压缩 v1 **留位不实现**（组合现状 disabled） |
| 投影 | 投影单元 + checkpoint 缓存行 | Document（pi.agent / pi.usage…） | dsh 投影机制收编，v1 必建 `usage`（WIRE-V1 §6） |
| 测试范式 | 三道闸门 + 包级 spec | `registerStorageConformance` 一致性套件 | **pi 范式收编**：内存 / 文件两后端过同一套用例 |
| 依赖 | 本仓拥有（含 fork 补丁） | experimental + chord | 不引包，只读其实现作对照 |

## 1. 存储格式 v1

- 一会话一文件 JSONL，`<home>/sessions/`（沿 dsh 布局，V3 同目录惰性共存）；
  行 = `{seq, ts, event}`，event ∈ WIRE-V1 §4 durable 词表 + log-only 注记集。
- 单写者 append；fsync / checkpoint 两旋钮沿 dsh（writeEveryEvents / writeIntervalMs）。
- follow 开窗 + gap-free 追加 + page 语义照 A（throughSeq 取自 cursor 的约束照抄）。

## 2. 惰性 V3 迁移（决策文档 §5.4）

- 读路径双格式：V3 文件原样逐行转换进内存；**首次写入** = 生成 v1 文件，
  V3 原文件只读备档不删——最坏回退 = 旧引擎原样读，数据无损。
- 列表合并呈现；fixture 用真实 V3 样本（含「1100+ seq → 29 条聚合记录」形态）。

## 3. 投影

- v1 必建：`usage`（tokens / 轮次 / 活跃时长，语义逐条照 `@deepdive/engine-host` 的
  usage-projection，数字不变）。
- checkpoint 时落盘，冷读不回写（沿上游「cache rows are never materialized here」取舍）。

## 4. 测试

- 一致性套件：内存 / 文件两后端同用例（开合、追加、崩溃截断恢复、fork、V3 双读）。
- 三道闸门变体：boot 冒烟 + 「消息可落」（M2a 起以自研会话层跑同脚本）。

## 开放点（已拍板，2026-10-10，用户授权实施者定）

1. **fork = 物理拷贝**：`session/fork atSeq` 把前缀记录拷贝进新会话文件——与 A 的
   删除/归档/子会话冷读语义对齐，不引入悬空引用。
2. **落账粒度 = settlement per attempt**（照 A）：每次模型调用周期结束落一次 durable
   settlement；不引 pi-durable 的 ≤100ms 中途窗口（写放大不值，崩溃最多丢当前步的
   直播增量——直播帧本就进程级、不入日志）。中途落账留作未来增强。
3. **spill 归工具面**：会话层只负责记录事件（spill 改写后的 tool/result 原样入账）；
   spill-local/policy 的改写语义在 M2c/M2d 的工具收编里对照 dsh 现实现。
