# SELF-EVOLUTION — 自进化（经验沉淀与校验闭环）spec（草稿 v2 · 待拍板）

> **状态（2026-09-12）：Phase 1 已实现**（会话内采集 → 设置里的待审队列 → 采纳交办），**Phase 2 未做**：后台复盘运行、到期校验、备份/撤销、运行历史（§9.4 列明）。
> 用户已定四件事（§9.1）；其余按参考项目的最佳实践落、**不自己发挥**——每条设计在 §2/§3/§5 里都标了出处（出处清单见 §11）。
> **落地文件**：`docs/EVOLUTION-POLICY.md`（政策，本设计的二级进化对象）、`AGENTS.md` 铁律 11（一行指路）、`frontend/src/evolution/`（protocol / store / useEvolution / EvolutionSection）、`dsh` 技能 `deepdive-evolution`（`EngineSupervisor.ensureEvolutionSkill`）。
> 本文件是「自进化」这件事的**唯一事实源**：进化什么、谁变异、谁来选、效果怎么算、UI 长什么样。
> 相关：协议与建议卡沿用 `docs/SPEC-AUTOMATION.md §3` 的通道；校验复用同文件的定时任务；引擎能力事实归 `docs/DSH-WIRE.md`；壳桥消息清单归 `frontend/src/host.ts` 头部。

## 0. 一句话

把会话里挣到的**可复用工程经验**沉淀回仓库的知识家（AGENTS.md / skills / 长期记忆文档 / 提议策略），每条都带**可证伪的效果主张**：到期用独立数据（会话日志、git）校验，无效即退役并把教训回流去收紧提议策略。**默认"只提议"（Propose）——永不自动改变行为**；进化的对象是规则 / 技能 / 文档这一层，**不含产品代码**。

## 1. 为什么是「知识层自进化」（三条约束）

- **没有裁判**。AHE 能把 Terminal-Bench 从 69.7% 抬到 77.0%，靠的是可复现评估集自动判死活；我们的裁判是交付链和你本人。所以闭环停在"带证据地提议 → 人点头 → 到期用独立数据校验"；没有独立数据时不宣称提升。
- **仓库怎么被消费**。这个仓库靠提交信息、文档、截图消费，知识本来就分家住在 `AGENTS.md`、`docs/PITFALLS.md`、`docs/SPEC-*.md`、技能正文里。所以进化的动作是**往已有的家里补一条**。
- **persona 页的教训**。空编辑框不知道该写什么；值钱的是**循环**：什么时候值得记、拿什么证据、记到哪个家、怎么证明它真省了事。

## 2. 自进化四要素（每条标明出处）

| 要素 | 本设计 | 出处 |
|---|---|---|
| **变异** | 一条提案 = 对某个知识家的**有界编辑**：正文由模型写，落点由协议锚定，范围限允许清单（§5）。 | penguin-harness 的 RSI 例子：`Evaluate → Diagnose → Edit → Re-evaluate`，**Edit 由 agent 自己写进自己的 `AGENTS.md`**；self-learning-skills：把黄金路径写进项目本地 skill / 规则文件。 |
| **选择** | 双门：①**人审**（默认 `Propose`，状态机 `pending → applied / dismissed / expired`）；②**到期校验**（独立数据上的复现次数 / 步数对比），未过即退役。 | dsh-evolve-modes：自进化默认 `Propose`，"只提出候选规则，不会自动改变后续行为"；penguin：**只有再评估均分真的提升才保留改动**。 |
| **存档** | 知识正文落仓库文件（git 提交即谱系）；提案队列、状态机、运行历史存应用侧（设置页可查）。 | dsh-evolve-modes：`settings[]` + `proposals[]` + `runs[]` + **`backups[]`** 分开存；AHE：组件 git 追踪、报告另存。 |
| **二级进化** | **提议策略文件**（`docs/EVOLUTION-POLICY.md`，动工时创建）：什么算值得提、证据门槛、阈值、允许清单，按一级结果更新。这是唯一被"改"的 harness 层。 | AHE 的 evolve 组件本身也在迭代（提出改动同时预测影响，下一轮被自动证伪）；dsh-evolve-modes 把批次/上限等参数放在设置页可调。 |

## 3. 形态：六段闭环（逐段标出处）

1. **触发（会话内，两类）**。`explicit`：用户说"记住这个""下次别再让我解释"；`implicit`：任务试错数轮才走通、发现非显然的项目事实、同一坑第二次出现。**判据与措辞照 self-learning-skills 的"识别时刻"清单**（含"连死路一起记"）；`inference: explicit | implicit` 这个二分照 dsh-evolve-modes。
2. **批量学习（后台，隔离）**。每累计完成 **N 次回复**触发一次学习运行（默认 **N=3**，可调 1..100）；学习运行**不继承上下文、不建子代理、不带工具、不读工作区 AGENTS.md**，只吃"最近 ≤100 条学习消息"（用户消息逐字 + 每轮最后一条助手消息；助手内容 >2000 字按"头 1000 + 尾 1000"截断），且只分析可能长期有效的经验。失败记进设置页、未完成批次保留重试、**不阻断正常回复**。以上照 dsh-evolve-modes 的"学习数据如何被整理 / 学习请求是隔离的"两节。
3. **待审队列**。上限 **100 条**（可调 1..1000），到顶不再堆积。状态机 `pending | applied | dismissed | expired`；删除原因 `explicit_denial | expired | replaced`。（出处同 §3.2；字段见 §4。）
4. **采纳落库（agent 在会话里写）**。点采纳 → 应用开一轮会话，让 agent 按提案的落点与正文写进目标文件（写法遵循该家规范），并提交一次 git（提交信息引用提案 id 与证据指针）；**写盘前留一份原文备份**（`backups[]`），所以撤销是精确回滚，不会撞上你未提交的改动。**为什么由 agent 写**：penguin 的 RSI 例子里 Edit 步骤就是 agent 自己写自己的 `AGENTS.md`，self-learning-skills 同样是技能自己落盘——这是两家既定做法，也省得应用自造一套文档格式逻辑。
5. **到期校验**。窗口到期（默认 14 天，可调）由一条内置定时任务执行：按台账生成指令，让 agent 用 shell 挖会话日志（`zstd -dc <session>.jsonl.zstd | grep …`）报出**复现次数**或**步数前后对比**。数据只认日志与 git。
6. **退役与回流**。判无效 → 状态置 `expired`（或 `replaced`），正文保留并附失败原因 → 同时产出一条**二级提案**改 `EVOLUTION-POLICY.md` 的对应判据。于是"无效"是策略的一次变异，不是终点。

## 4. 数据形状（照 dsh-evolve-modes 的 schema 收敛，字段语义沿用）

```jsonc
// 一条提案（存应用侧队列）
{
  "id": "l-7f3a",
  "action": "add | update | delete",
  "category": "incident | workflow | fact | rule",      // 对应知识家的四类：坑 / 流程 / 事实 / 规则
  "home": "pitfalls | agents | spec | skill | policy",  // 落点（允许清单见 §5）
  "anchor": "### 4.17 桥端口一变",                        // 标题锚；找不到整条拒绝，不猜位置
  "content": "要写入的完整文本（≤2000 字）",
  "targetId": null,                                     // update / delete 指向已有条目 id
  "inference": "explicit | implicit",
  "evidence": [{ "sessionId": "…", "turn": 12, "eventSeq": 431, "excerpt": "逐字 ≤500 字" }],
  "predict": { "metric": "repeat-incident | steps", "signature": "可 grep 的串", "windowDays": 14 },
  "status": "pending | applied | dismissed | expired",
  "createdAt": 0, "updatedAt": 0
}
```

硬规则（来自 dsh-evolve-modes 的证据条款）：**证据必须逐字**——助手的推断、一次性任务细节、实现结果、"没有再提到"都不能单独作为证据；`predict.signature` 必须在日志里**自证可 grep**，否则降为 `style` 类且不进统计；缺 `predict` 的条目同样按 `style` 处理。

## 5. 允许清单（按参考收敛，不自己划）

进化可写的家 = **AGENTS.md（规则）+ skills（技能正文）+ 长期记忆 / 知识文档（PITFALLS、SPEC 的设计段）+ 提议策略文件**。
依据：self-learning-skills 落到"项目本地 skill / 规则文件"；penguin 落到"自己的 `AGENTS.md`"；AHE 的七个组件是 **system prompt / tool descriptions / tool implementations / middleware / skills / sub-agents / long-term memory**（`LongTermMEMORY.md` 里带一段 `## Agent Added Memories` 供 agent 追加），**没有"产品代码"**；dsh-evolve-modes 只认 `identity | preference | work_rule` 三类。
**代码、脚本、配置一律不在清单内**——四个参考没有任何一个把产品代码当进化对象。有异议你再说，这条我不再问。

## 6. 效果口径（"明确有效果"按这三条算）

- **指标 A · 重复事故率**：`repeat-incident` 类经验在窗口内被 grep 到的次数。目标 **0**；≥1 判无效。数据源：会话日志。
- **指标 B · 关键流程步数**：`steps` 类经验落地前后，同一流程（按签名匹配）在会话里的工具调用数均值。目标至少 **−30%**。
- **指标 C · 循环健康度**：采纳率（目标 ≥50%）、复提率（目标趋近 0）、学习运行失败率。全部可从提案队列算出。
- **基线可回溯**：A、B 都能先在现有日志上跑一遍得到"之前是多少"，所以第一批落地后**几天内**就有前后对比。
- **反作弊**：校验数据只认日志 / git，不许自评；`style` 类不进统计；签名须自证可 grep；样本不足一律标 `未验证`，不折算成成功。
- 出处：形态来自 penguin 的"**rubric 打分 + 再评估，均分提升才保留**"；把 rubric 换成"日志上的复现次数 / 步数"是**本地适配**（我们没有基准任务集，这点不装成别人的做法）；"预测 + 被下一轮证伪"来自 AHE 的 decision observability。

## 7. 非目标

- 不改产品代码、脚本、配置。
- 不自动合并：默认 `Propose`，任何落库都过人（照 dsh-evolve-modes）。
- 不建平行记忆库：知识正文留在仓库的家里，应用侧只存提案与运行历史。
- 不做隐藏的全局指令块（persona 页老路）。
- 不宣称没有独立数据支撑的提升。

## 8. UI：设置里一个独立的「自进化」分区（用户定稿：其他地方全隐藏）

- 设置左导航新增 **自进化** 分区（与 模型 / 自动化 平级）。
- 顶部 **Dashboard**：累计经验 N 条、待审 M 条、已采纳 / 已退役各几条、上次学习运行与上次校验的时间与结果。（dsh-evolve-modes 的设置页就是这个结构：学习失败与运行历史都落在设置页。）
- 列表：每条一行 → 展开看落点、正文、逐字证据、预测与到期日、状态；操作为 **采纳 / 丢弃 / 撤销**（撤销走 `backups[]`）。
- 运行历史：学习运行与校验运行的时间线（含失败与重试入口）。
- **会话里零 UI**：提议不在消息流出卡片、不弹提示，用户只在设置页看它们。（这条是用户定稿；与 `SPEC-AUTOMATION` 的建议卡是两套交互，别混用。）

## 9. 已定与待定

0. **Phase 1 落地时对设计的三处本地适配**（照旧标出来，不装成别人的做法）：
   1. **后台复盘运行会是一条独立会话**（Phase 2），而不是 `dsh-evolve-modes` 那种"插件直连模型、无工具、不读工作区"的隔离调用——SPA 没有直接模型通道，只能经 `session/prompt` 走 agent 循环；届时靠"新会话第一轮 + 只读权限预设 + 指令限定只分析"逼近那份隔离性。
   2. **证据定位由应用盖戳**：提案块里只要求 `excerpt`（+可选 `note`），`origin {sessionId, turn, eventSeq}` 由采集端写入，**不采信模型自报的定位**（模型拿不到可靠的 seq）。政策 §3 里"逐字证据"的要求不变。
   3. **`applied` 语义 = 已交办**（附落库会话 id）；Phase 2 用 `git log` 里是否出现引用该提案 id 的提交来确认真正落地，再翻成"已验证/已过期"。

1. **用户已定（2026-09-12）**：① 提案来源＝会话内顺手记 **＋** 后台复盘，两者都要；② 采纳后**由 agent 在会话里写**进仓库；③ 入口＝设置里**独立一个「自进化」分区**；④ 允许清单按参考收敛（§5），不让用户拍。
2. **按参考定的默认值**（可调，不再问）：学习批次 N=3、待审上限 100、窗口 14 天、默认模式 `Propose`。出处：dsh-evolve-modes 的默认设置表。
3. **已定（用户 2026-09-12）**：二级进化的载体＝新建 `docs/EVOLUTION-POLICY.md`（正文）+ `AGENTS.md` 一行指针（合两条家规：一事一家 + 规则只留 1-3 行并链接）。
4. **Phase 2 待办**：后台复盘运行（每累计 3 次回复一批，隔离形态见 §9.0.1）、到期校验任务（按签名扫会话日志）、`backups[]` 与撤销、运行历史与 Dashboard 的校验列。

## 10. 验收口径（动工后按这个验）

- 说一句"记住这个" → 设置页待审队列 +1，**消息流里什么都没有**（零 UI）。
- 点采纳 → 目标文件出现该节、`backups[]` 有一份原文、有一次引用提案 id 的 git 提交。
- 点丢弃 → 状态 `dismissed` 留档；同一签名再提会被策略压低优先级（复提率可观测）。
- 到期校验跑一次 → 标记补上复现次数与结论；人为重造一次那个签名，校验必须判**无效**并产出二级提案。
- Dashboard 上的"前后对比"能在现有日志上算出来（不依赖新数据积累）。

## 11. 出处清单（本研究逐个核过星数、推送时间与源码）

| 仓库 | 我们拿它的什么 |
|---|---|
| [GraySilver/dsh-evolve-modes](https://github.com/GraySilver/dsh-evolve-modes) | 默认 Propose、提案状态机与删除原因、证据必逐字、学习批次与上限默认值、隔离学习运行、设置页承载 Dashboard 与运行历史、`backups[]` |
| [Prism-Shadow/penguin-harness](https://github.com/Prism-Shadow/penguin-harness) | `Evaluate → Diagnose → Edit → Re-evaluate` 循环、"均分提升才保留"、Edit 由 agent 自己写 `AGENTS.md`、契约限定进化面 |
| [Kulaxyz/self-learning-skills](https://github.com/Kulaxyz/self-learning-skills) | "识别时刻"判据、连死路一起记、落点是项目本地 skill / 规则文件 |
| [china-qijizhifeng/agentic-harness-engineering](https://github.com/china-qijizhifeng/agentic-harness-engineering) | 组件化 + git 可回滚、`LongTermMEMORY.md` 的 `## Agent Added Memories` 段、decision observability（预测 + 自动证伪） |
| [NVlabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi) | 机制默认关闭、逐条 opt-in、每条都要可量的收益主张 |
| [greyhaven-ai/autocontext](https://github.com/greyhaven-ai/autocontext) | 每轮留下 traces / 报告 / playbook：留有用教训、丢死路 |
