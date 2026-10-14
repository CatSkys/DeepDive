// 模型基准登记表 —— 前端唯一自维护的数据面：模型选择器详情卡的
// 速度 / 智能 / 成本三条 0–4 刻度（用户 2026-10-10 定稿：运行时零网络依赖，
// AA 只是填表参考，不是运行时依赖）。
//
// 为什么需要这张表：引擎目录只知道「能不能路由」（可用性）与「能力事实」
// （inputModalities / contextWindow / reasoning，session/modelCatalog 投影）——
// 速度、智能、成本只有榜单与牌价有，且只用于显示。三处事实的家：
// 引擎=可用性，引擎目录投影=能力事实，本表=榜单/牌价刻度（SPEC-SEMANTICS「模型基准」）。
//
// **数据存原值，折档在代码**（用户 2026-10-11 定稿）：行里存 AA 的原始读数
// （tok/s、Intelligence Index），0–4 折档由本文件两个函数做——AA 指数是相对
// 值，会随前沿漂移（2026-10-11 实测：榜首 58、中位数 18，GLM-5.2 的 34 落在
// 旧阈值下被折成 0 档被用户抓包），漂移了改函数重校准即可，不动一百多行数据。
//
// **键 = 模型名，不带提供方**（用户 2026-10-14 定稿）：同一个模型走哪条路由都是同一个
// 模型，一个模型一行。键与查找都过 {@link benchKey}——小写 + 取最后一个 "/" 之后那段
// （网关普遍给 `<vendor>/<model>` 前缀，模型自己才是基准的身份：CommandCode 的
// `zai-org/GLM-5.2` 与 z.ai 的 `glm-5.2` 命中同一行）。**提供方差异不上表**——能不能路由
// 归引擎，本表只答「这个模型多快、多聪明、多贵」，谁家端点都一样。
//
// 缺省语义：**全有或全无**（用户 2026-10-10 定稿）——速度/智能/成本三项齐才渲染刻度，
// 条目缺席或缺项 = 详情卡只显示「暂无基准数据」占位，绝不出现"只有成本没有基准"的半张卡。
//
// 填表口径（2026-10-10/11 两轮、七批并行上网核对：AA 各模型页 + 各官方定价页）：
// - tps：AA Output Speed 原值（tok/s）→ ≥240→4，120–239→3，60–119→2，30–59→1，<30→0
//   （倍增梯子，AA 中位 ~68 落中档；具体 tok/s 随账号/区域/负载漂移，不上 UI）。
// - ii：AA Intelligence Index 原值 → ≥52→4，44–51→3，36–43→2，28–35→1，<28→0
//   （对齐 2026-10-11 的 AA 分布：榜首 58、中位 18）。
// - cost：**引擎发价的一律跟引擎**（peak 牌价，见 {@link costMeter}），只有引擎发不了价
//   的模型才手抄档：0.3×输入价 + 0.7×输出价（$/Mtok）→ ≤1→0，≤3→1，≤10→2，≤25→3，
//   否则→4（**越满越贵**，条长 = 花费量级），行尾注明来源价。手写路由（自定义端点、
//   预置提供方）的引擎牌价必然是空——适配器把 0/0 滤成"未定价"（llm-pi-ai/adapter.ts
//   的 resolvedModelCost），所以那些模型要在一张卡上出刻度，就得有手抄档。
// 2026-10-14 按 CommandCode 价目页补齐了 49 个模型的档（它按官方价不加价转发：与既有
// 手抄的 9 条官方价逐条相同）。AA 与官方均查无的模型不入表（详情卡占位）。绝不现编数值。
import type { ModelOption } from "./components/ModelMenu";

/** 一条登记行：AA 原始读数（未折档）。cost 是手抄成本**档**（0–4），只在引擎发不了价
 *  的模型上写；tools 显式 false = 已知不支持工具调用。 */
export interface ModelBenchRaw {
  /** AA Output Speed（tok/s）。 */
  tps?: number;
  /** AA Intelligence Index。 */
  ii?: number;
  /** 手抄成本档（0–4，越满越贵）；缺 = 引擎发价时自动折。 */
  cost?: number;
  /** 显式不支持工具调用的模型才写 false；缺省 = 支持。 */
  tools?: false;
}

/** 折档后的三条刻度（详情卡消费的形状）。 */
export interface ModelBench {
  /** 0–4，tps 折算。 */
  speed?: number;
  /** 0–4，ii 折算。 */
  intelligence?: number;
  /** 0–4，官方牌价折合，越满越贵。 */
  cost?: number;
  /** 显式不支持工具调用的模型才写 false；缺省 = 支持。 */
  tools?: false;
}

/** AA Output Speed → 速度档（倍增梯子；校准 2026-10-11，中位 ~68 → 2）。 */
function speedScale(tps: number | undefined): number | undefined {
  if (tps === undefined) return undefined;
  if (tps >= 240) return 4;
  if (tps >= 120) return 3;
  if (tps >= 60) return 2;
  if (tps >= 30) return 1;
  return 0;
}

/** AA Intelligence Index → 智能档（校准 2026-10-11：榜首 58、中位 18；指数随前沿漂移，定期复核）。 */
function intelligenceScale(ii: number | undefined): number | undefined {
  if (ii === undefined) return undefined;
  if (ii >= 52) return 4;
  if (ii >= 44) return 3;
  if (ii >= 36) return 2;
  if (ii >= 28) return 1;
  return 0;
}

/** 模型名归一：小写，且只取最后一个 "/" 之后那段（`zai-org/GLM-5.2` → `glm-5.2`）。
 *  登记表的键与查找都走它——带不带厂商前缀是端点的写法，不是模型的身份。 */
export function benchKey(model: string): string {
  const slash = model.lastIndexOf("/");
  return (slash === -1 ? model : model.slice(slash + 1)).toLowerCase();
}

/** 模型名 → AA 原始读数。 */
export const MODEL_BENCH: Record<string, ModelBenchRaw> = {
// ── DeepSeek（官方直连，四条全收）──
  "deepseek-flash": { tps: 217.1, ii: 39, cost: 0 }, // 价手抄 $0.3/$1.2 → 0.93
  "deepseek-v4-flash": { tps: 219.1, ii: 34, cost: 0 }, // 页标弃用；价手抄 $0.3/$1.2 → 0.93
  "deepseek-v4-flash-vision-exp": { tps: 220.3, ii: 35, cost: 0 }, // 价手抄 $0.3/$1.2 → 0.93
  "deepseek-v4-pro": { tps: 84.7, ii: 36, cost: 2 }, // 价手抄 $1.32/$3.96 → 3.17
  "deepseek-v4.1-flash": { tps: 217.1, ii: 39, cost: 0 }, // 价手抄 $0.3/$1.2 → 0.93

// ── Claude 系（Anthropic；dated 变体与主模型同页，II 多为站方 estimated）──
  "claude-fable-5": { tps: 64.4, ii: 50, cost: 4 }, // 价手抄 $10/$50 → 38
  "claude-fable-5-1": { tps: 70.2, ii: 53, cost: 4 }, // 价手抄 $10/$50 → 38
  "claude-haiku-4-5": { tps: 83.0, ii: 15 },
  "claude-haiku-4-5-20251001": { tps: 83.0, ii: 15, cost: 2 }, // 价手抄 $1/$5 → 3.8
  "claude-haiku-5-5": { tps: 239.8, ii: 43, cost: 0 }, // 价手抄 $0.1/$0.5 → 0.38
  "claude-opus-4-5": { tps: 48.2, ii: 24 },
  "claude-opus-4-5-20251101": { tps: 48.2, ii: 24 },
  "claude-opus-4-6": { tps: 40.8, ii: 26 },
  "claude-opus-4-7": { tps: 52.5, ii: 41, cost: 3 }, // 价手抄 $5/$25 → 19
  "claude-opus-4-8": { tps: 58.3, ii: 42, cost: 3 }, // 价手抄 $5/$25 → 19
  "claude-opus-5": { tps: 53.1, ii: 51, cost: 3 }, // 价手抄 $5/$25 → 19
  "claude-opus-5-5": { tps: 97.0, ii: 58, cost: 3 }, // AA #1/227；价手抄 $4/$20 → 15.2
  "claude-sonnet-4-5": { tps: 42.3, ii: 19 },
  "claude-sonnet-4-5-20250929": { tps: 42.3, ii: 19 },
  "claude-sonnet-4-6": { tps: 44.7, ii: 30, cost: 3 }, // AA 标 25est，Command Code 正式评分 30.1（2026-10-11 对照，取正式值）；价手抄 $3/$15 → 11.4
  "claude-sonnet-5": { tps: 79.0, ii: 38, cost: 2 }, // 价手抄 $2/$10 → 7.6
  "claude-sonnet-5-5": { tps: 141.8, ii: 56, cost: 2 }, // 价手抄 $2/$10 → 7.6

// ── Gemini / Gemma（Google；-latest 是别名，映射到对应代页，High 档口径）──
  "gemini-2.5-flash": { tps: 191.2, ii: 10 },
  "gemini-2.5-flash-lite": { tps: 266.4, ii: 7 },
  "gemini-2.5-pro": { tps: 117.0, ii: 16 },
  "gemini-3-flash-preview": { tps: 203.1, ii: 18 },
  "gemini-3.1-flash-lite": { tps: 330.5, ii: 16, cost: 1 }, // 与 -preview 同页；价手抄 $0.25/$1.5 → 1.12
  "gemini-3.1-flash-lite-image": { tps: 330.5, ii: 16 }, // 同上
  "gemini-3.1-flash-lite-preview": { tps: 330.5, ii: 16 }, // 页标弃用
  "gemini-3.1-pro-preview": { tps: 118.2, ii: 30 },
  "gemini-3.1-pro-preview-customtools": { tps: 118.2, ii: 30 }, // 与 -pro-preview 同页
  "gemini-3.5-flash": { tps: 200.0, ii: 33, cost: 2 }, // 页标弃用；价手抄 $1.5/$9 → 6.75
  "gemini-3.5-flash-lite": { tps: 414.0, ii: 22, cost: 1 }, // 价手抄 $0.3/$2.5 → 1.84
  "gemini-3.6-flash": { tps: 196.6, ii: 34, cost: 2 }, // 价手抄 $1.5/$7.5 → 5.7
  "gemini-3.7-flash": { tps: 306.9, ii: 39, cost: 2 }, // 页标弃用；价手抄 $1.5/$7.5 → 5.7
  "gemini-3.8-flash": { tps: 125.0, ii: 41, cost: 2 }, // 价手抄 $1.5/$7.5 → 5.7
  "gemini-flash-latest": { tps: 125.0, ii: 41 }, // 别名映射 3.8 Flash
  "gemini-flash-lite-latest": { tps: 414.0, ii: 22 }, // 别名映射 3.5 Flash-Lite
  "gemma-4-26b-a4b-it": { tps: 67.9, ii: 17 },
  "gemma-4-31b-it": { tps: 35.0, ii: 15 },

// ── GPT / o 系（OpenAI；II 多为 estimated，速度未公开的行不入表）──
  "gpt-4-turbo": { tps: 32.1, ii: 7 },
  "gpt-4.1": { tps: 139.6, ii: 13 },
  "gpt-4.1-mini": { tps: 142.3, ii: 10 },
  "gpt-4.1-nano": { tps: 170.7, ii: 8 },
  "gpt-4o": { tps: 132.8, ii: 8 },
  "gpt-4o-2024-05-13": { tps: 132.0, ii: 7 },
  "gpt-4o-2024-08-06": { tps: 121.1, ii: 8 },
  "gpt-4o-2024-11-20": { tps: 132.8, ii: 8 }, // 与 gpt-4o 同页
  "gpt-4o-mini": { tps: 111.2, ii: 7 },
  "gpt-5": { tps: 88.2, ii: 23 },
  "gpt-5-chat-latest": { tps: 88.2, ii: 23 }, // 与 gpt-5 同页
  "gpt-5-mini": { tps: 135.7, ii: 17 },
  "gpt-5-nano": { tps: 129.4, ii: 13 },
  "gpt-5.1": { tps: 94.4, ii: 25 },
  "gpt-5.2": { tps: 80.3, ii: 30 },
  "gpt-5.2-chat-latest": { tps: 80.3, ii: 30 }, // 与 gpt-5.2 同页
  "gpt-5.3-codex": { tps: 92.9, ii: 33, cost: 2 }, // 价手抄 $2/$8 → 6.2
  "gpt-5.3-codex-spark": { tps: 92.9, ii: 33 }, // AA 无独立页，按 gpt-5.3-codex 抄
  "gpt-5.4": { tps: 93.1, ii: 39, cost: 3 }, // 价手抄 $2.5/$15 → 11.25
  "gpt-5.4-mini": { tps: 258.4, ii: 24, cost: 2 }, // 价手抄 $0.75/$4.5 → 3.38
  "gpt-5.4-nano": { tps: 164.7, ii: 21 },
  "gpt-5.5": { tps: 89.9, ii: 38, cost: 3 }, // 价手抄 $5/$30 → 22.5
  "gpt-5.6-luna": { tps: 117.5, ii: 37, cost: 0 }, // 价手抄 $0.2/$1.2 → 0.9
  "gpt-5.6-sol": { tps: 80.8, ii: 47, cost: 3 }, // 价手抄 $5/$30 → 22.5
  "gpt-5.6-terra": { tps: 121.4, ii: 42, cost: 2 }, // 价手抄 $2/$12 → 9
  "gpt-6-astra": { tps: 47.7, ii: 53, cost: 4 }, // 价手抄 $10/$50 → 38
  "gpt-6-luna": { tps: 136.9, ii: 38, cost: 0 }, // 价手抄 $0.1/$0.5 → 0.38
  "gpt-6-sol": { tps: 98.1, ii: 48, cost: 2 }, // 价手抄 $2/$10 → 7.6
  "gpt-6.1-sol": { tps: 59.3, ii: 52, cost: 2 }, // 价手抄 $2/$10 → 7.6
  "o3": { tps: 133.9, ii: 20 },
  "o3-mini": { tps: 193.4, ii: 12 },
  "o4-mini": { tps: 158.3, ii: 17 },

// ── GLM（Z.ai / 智谱；mistral 上的 zai-glm-* 是同一模型的另一套拼写）──
  "glm-4.6v": { tps: 72.9, ii: 8 },
  "glm-4.7": { tps: 41.0, ii: 22 },
  "glm-5-2": { tps: 83.3, ii: 34 }, // 与 zai-glm-5-2 同页
  "glm-5.1": { tps: 54.2, ii: 26, cost: 2 }, // 价手抄 z.ai $1.4/$4.4 → 3.5（pi-ai 目录无此行，引擎发不了价）
  "glm-5.2": { tps: 83.3, ii: 34, cost: 2 }, // 价手抄 $1.4/$4.4 → 3.5
  "glm-5.3": { tps: 78.8, ii: 45, cost: 2 }, // 价手抄 $1.4/$4.4 → 3.5
  "glm-5.3-flash": { tps: 57.7, ii: 42, cost: 0 }, // 价手抄 $0.15/$0.5 → 0.39
  "zai-glm-5-2": { tps: 83.3, ii: 34 }, // Mistral API 上的 GLM-5.2
  "zai-glm-5-3": { tps: 78.8, ii: 45 },

// ── Kimi（Moonshot；kimi-coding 端点的模型 id 就是 k3）──
  "k3": { tps: 39.2, ii: 44 }, // 与 kimi-k3 同页
  "kimi-k2.6": { tps: 51.8, ii: 27, cost: 2 }, // 价手抄 kimi $0.95/$4 → 3.09（pi-ai 目录无此行，引擎发不了价）
  "kimi-k2.7-code": { tps: 66.9, ii: 26, cost: 2 }, // 价手抄 $0.95/$4 → 3.09
  "kimi-k3": { tps: 39.2, ii: 44, cost: 3 }, // 价手抄 $3/$15 → 11.4

// ── MiniMax ──
  "minimax-m2.5": { tps: 80.2, ii: 23, cost: 0 }, // 价手抄 $0.3/$1.2 → 0.93
  "minimax-m2.7": { tps: 61.4, ii: 23, cost: 0 }, // 价手抄 $0.3/$1.2 → 0.93
  "minimax-m3": { tps: 96.6, ii: 29, cost: 1 }, // 价手抄 $0.6/$2.4 → 1.86

// ── Qwen（百炼）──
  "qwen3.6-plus": { tps: 55.4, ii: 27, cost: 1 }, // 价手抄百炼 $0.5/$3 → 2.25（pi-ai 目录无此行，引擎发不了价）
  "qwen3.7-max": { tps: 196.9, ii: 29, cost: 2 }, // 价手抄百炼 $2.5/$7.5 → 6.0（同上）
  "qwen3.7-plus": { tps: 54.3, ii: 25, cost: 1 }, // 价手抄 $0.4/$1.6 → 1.24
  "qwen3.8-flash": { tps: 52.8, ii: 40, cost: 0 }, // 聚合端点名即 Qwen3.8-Flash-Next（用户 2026-10-11 确认）；价手抄 $0.16/$0.47 → 0.38
  "qwen3.8-max": { tps: 35.7, ii: 45, cost: 2 }, // 价手抄 $2/$6 → 4.8

// ── MiMo（小米）──
  "mimo-v2.5-pro": { tps: 30.7, ii: 26, cost: 2 }, // 官方 10-21 下线；价手抄 $2/$6 → 4.8
  "mimo-v2.6-flash": { tps: 61.1, ii: 38, cost: 0 }, // 价手抄 $0.14/$0.28 → 0.24
  "mimo-v2.6-pro": { tps: 44.9, ii: 46, cost: 0 }, // 价手抄 $0.435/$0.87 → 0.74

// ── Grok（xAI）──
  "grok-4.6": { tps: 60.4, ii: 44, cost: 2 }, // 价手抄 $2/$6 → 4.8
  "grok-4.7": { tps: 74.2, ii: 46, cost: 2 }, // 价手抄 $2/$6 → 4.8

// ── Muse（Meta；Contributor 档 AA 不单列，用同模型标准档近似）──
  "muse-spark-1.1": { tps: 83.9, ii: 34, cost: 2 }, // 价手抄 $1.25/$4.25 → 3.35
  "muse-spark-1.2": { tps: 325.2, ii: 40, cost: 2 }, // 价手抄 $1.25/$4.25 → 3.35
  "muse-spark-1.2-contributor": { tps: 325.2, ii: 40, cost: 0 }, // AA 不单列 Contributor 档，用同模型标准档近似；价手抄 $0.1/$0.2 → 0.17
  "muse-spark-1.3": { tps: 122.5, ii: 48, cost: 2 }, // Max 档；价手抄 $1.25/$4.25 → 3.35
  "muse-spark-1.3-contributor": { tps: 122.5, ii: 48, cost: 0 }, // 同上，1.3 Max 档；价手抄 $0.1/$0.2 → 0.17

// ── Mistral（-latest 按 docs 现行版本映射对应代页）──
  "ministral-3b-2512": { tps: 230.9, ii: 5 },
  "ministral-3b-latest": { tps: 230.9, ii: 5 }, // 与 -2512 同页
  "ministral-8b-2512": { tps: 94.4, ii: 5 },
  "ministral-8b-latest": { tps: 94.4, ii: 5 }, // 与 -2512 同页
  "ministral-14b-2512": { tps: 70.4, ii: 6 },
  "mistral-large-2512": { tps: 77.4, ii: 9 }, // Large 3
  "mistral-medium-3.5": { tps: 162.4, ii: 14 }, // 与 -2604 同页
  "mistral-medium-2505": { tps: 46.0, ii: 9 },
  "mistral-medium-2604": { tps: 162.4, ii: 14 }, // Medium 3.5
  "mistral-medium-latest": { tps: 162.4, ii: 14 }, // 与 -2604 同页
  "mistral-small-2506": { tps: 36.3, ii: 8 },
  "mistral-small-2603": { tps: 163.2, ii: 11 }, // Small 4 Reasoning
  "mistral-small-latest": { tps: 163.2, ii: 11 }, // 与 -2603 同页
  "open-mixtral-8x7b": { tps: 25.5, ii: 5 }, // 页标弃用

// ── 其他 ──
  "longcat-2.0": { tps: 65.2, ii: 19, cost: 0 }, // 价手抄 $0.3/$1.2 → 0.93
  "ring-2.6-1t": { tps: 112.3, ii: 17 },
};

/** join：引擎目录选项 × 登记表（按模型名匹配、原值折档）。未收录的模型原样回退
 *  （facts 缺席 = 占位态）。 */
export function withFacts(options: ModelOption[]): ModelOption[] {
  return options.map((o) => {
    const b = MODEL_BENCH[benchKey(o.model)];
    if (b === undefined) return o;
    const facts: ModelBench = {};
    const speed = speedScale(b.tps);
    const intelligence = intelligenceScale(b.ii);
    if (speed !== undefined) facts.speed = speed;
    if (intelligence !== undefined) facts.intelligence = intelligence;
    if (b.cost !== undefined) facts.cost = b.cost;
    if (b.tools !== undefined) facts.tools = b.tools;
    return { ...o, facts };
  });
}

/** 引擎目录透出的牌价（$/Mtok，peak 口径；官方页 off-peak 减半，不跨刻度界）。 */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** 牌价 → 成本刻度（0.3×输入价 + 0.7×输出价 → ≤1→0，≤3→1，≤10→2，≤25→3，否则 4；
 *  **越满越贵**，条长 = 花费量级，用户 2026-10-10 定稿）。 */
export function costScaleFromPrices(prices: ModelPrice | undefined): number | undefined {
  if (prices === undefined) return undefined;
  const composite = 0.3 * prices.input + 0.7 * prices.output;
  if (composite <= 1) return 0;
  if (composite <= 3) return 1;
  if (composite <= 10) return 2;
  if (composite <= 25) return 3;
  return 4;
}

/** 详情卡的成本刻度（唯一推导口径）：**有引擎牌价就一律跟引擎**，引擎发不了价的模型
 *  才用表里的手抄档兜底（反过来会让手抄档盖掉实况牌价，用户 2026-10-10 定的口径）。 */
export function costMeter(option: Pick<ModelOption, "cost" | "facts">): number | undefined {
  return costScaleFromPrices(option.cost) ?? option.facts?.cost;
}
