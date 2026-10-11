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
// 旧阈值下被折成 0 档被用户抓包），漂移了改函数重校准即可，不动 150 行数据。
//
// 键规则：逐字等于引擎目录投影的 `${provider}/${model}`（provider = session/modelCatalog
// 的**路由 key**，2026-10-10 实测为 deepseek-official / opencode-go / opencode-go-new /
// opencode-go-responses 四组——**不是** pi-ai 数据层的品牌直连 id；品牌直营目录的行
// 用 pi-ai provider id 作前缀，供未来同名路由接通后命中）。缺省语义：**全有或全无**
// （用户 2026-10-10 定稿）——速度/智能/成本三项齐才渲染刻度，条目缺席或缺项 =
// 详情卡只显示「暂无基准数据」占位，绝不出现"只有成本没有基准"的半张卡。绝不现编数值。
//
// 填表口径（2026-10-10/11 两轮、七批并行上网核对：AA 各模型页 + 各官方定价页）：
// - tps：AA Output Speed 原值（tok/s）→ ≥240→4，120–239→3，60–119→2，30–59→1，<30→0
//   （倍增梯子，AA 中位 ~68 落中档；具体 tok/s 随账号/区域/负载漂移，不上 UI）。
// - ii：AA Intelligence Index 原值 → ≥52→4，44–51→3，36–43→2，28–35→1，<28→0
//   （对齐 2026-10-11 的 AA 分布：榜首 58、中位 18）。
// - cost：官方牌价折合（0.3×输入价 + 0.7×输出价，$/Mtok）→ ≤1→0，≤3→1，≤10→2，
//   ≤25→3，否则→4（**越满越贵**，条长 = 花费量级）。引擎发价的行一律跟引擎
//   （peak 牌价，costMeter 兜底），本表只对引擎不发价的行手抄档（行尾注明）。
// 网关/镜像文件（openrouter/bedrock/azure/vertex/cloudflare/huggingface/together…）
// 不入表：模型与官方路由同体，避免同一模型两条记录漂移。AA 与官方均查无的模型
// 不入表（详情卡占位）。绝不现编数值。
import type { ModelOption } from "./components/ModelMenu";

/** 一条登记行：AA 原始读数（未折档）。cost 是手抄成本**档**（0–4），只在引擎
 *  不发价的行出现；tools 显式 false = 已知不支持工具调用。 */
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

/** provider/model → AA 原始读数。 */
export const MODEL_BENCH: Record<string, ModelBenchRaw> = {
  // ── ① 引擎在册路由（成本跟引擎 peak 牌价，见 costMeter；行尾注 AA 读数）──
  // deepseek-official（官方直连，四条全收，价由 llm-deepseek 内置目录直发）：
  // flash 端点已并层到 V4.1 Flash（AA 归并页 217.1 · II 39），v4-flash 有独立页（219.1 · 34）。
  "deepseek-official/deepseek-flash": { tps: 217.1, ii: 39 },
  "deepseek-official/deepseek-v4-flash": { tps: 219.1, ii: 34 }, // 页标弃用
  "deepseek-official/deepseek-v4-pro": { tps: 84.7, ii: 36 },
  "deepseek-official/deepseek-v4-flash-vision-exp": { tps: 220.3, ii: 35 },
  // opencode-go（聚合路由；引擎价来自 pi-ai opencode-go 目录）
  "opencode-go/minimax-m3": { tps: 96.6, ii: 29 },
  "opencode-go/qwen3.8-flash": { tps: 52.8, ii: 40 }, // 聚合端点名即 Qwen3.8-Flash-Next（用户 2026-10-11 确认）
  "opencode-go/deepseek-v4-flash": { tps: 219.1, ii: 34 },
  "opencode-go/deepseek-v4-flash-vision-exp": { tps: 220.3, ii: 35 },
  "opencode-go/deepseek-v4-pro": { tps: 84.7, ii: 36 },
  "opencode-go/deepseek-v4.1-flash": { tps: 217.1, ii: 39 },
  "opencode-go/glm-5.1": { tps: 54.2, ii: 26, cost: 2 }, // 价手抄 z.ai $1.4/$4.4 → 3.5（目录缺行被引擎丢弃，settings 仍声明）
  "opencode-go/glm-5.2": { tps: 83.3, ii: 34 },
  "opencode-go/glm-5.3": { tps: 78.8, ii: 45 },
  "opencode-go/glm-5.3-flash": { tps: 57.7, ii: 42 },
  "opencode-go/kimi-k2.6": { tps: 51.8, ii: 27, cost: 2 }, // 价手抄 kimi $0.95/$4 → 3.09（目录缺行被引擎丢弃，settings 仍声明）
  "opencode-go/kimi-k2.7-code": { tps: 66.9, ii: 26 },
  "opencode-go/kimi-k3": { tps: 39.2, ii: 44 },
  "opencode-go/longcat-2.0": { tps: 65.2, ii: 19 },
  "opencode-go/mimo-v2.5-pro": { tps: 30.7, ii: 26 }, // 官方 10-21 下线
  "opencode-go/minimax-m2.7": { tps: 61.4, ii: 23 },
  "opencode-go/qwen3.6-plus": { tps: 55.4, ii: 27, cost: 1 }, // 价手抄百炼 $0.5/$3 → 2.25（目录缺行被引擎丢弃，settings 仍声明）
  "opencode-go/qwen3.7-max": { tps: 196.9, ii: 29, cost: 2 }, // 价手抄百炼 $2.5/$7.5 → 6.0（同上）
  "opencode-go/qwen3.7-plus": { tps: 54.3, ii: 25 },
  "opencode-go/qwen3.8-max": { tps: 35.7, ii: 45 },
  "opencode-go/gpt-5.6-luna": { tps: 117.5, ii: 37 },
  "opencode-go/grok-4.6": { tps: 60.4, ii: 44 },
  "opencode-go/muse-spark-1.2-contributor": { tps: 325.2, ii: 40 }, // AA 不单列 Contributor 档，用同模型标准档近似
  "opencode-go/muse-spark-1.3-contributor": { tps: 122.5, ii: 48 }, // 同上，1.3 Max 档
  // opencode-go-new（自包含路由，引擎不发价：成本档手抄官方牌价）
  "opencode-go-new/deepseek-flash": { tps: 217.1, ii: 39, cost: 0 }, // $0.3/$1.2 → 0.93
  "opencode-go-new/minimax-m2.5": { tps: 80.2, ii: 23, cost: 0 }, // $0.3/$1.2 → 0.93
  "opencode-go-new/mimo-v2.6-flash": { tps: 61.1, ii: 38, cost: 0 }, // $0.14/$0.28 → 0.24
  "opencode-go-new/mimo-v2.6-pro": { tps: 44.9, ii: 46, cost: 0 }, // $0.435/$0.87 → 0.74
  // opencode-go-responses（自包含路由，引擎不发价）
  "opencode-go-responses/gpt-6-luna": { tps: 136.9, ii: 38, cost: 0 }, // $0.1/$0.5 → 0.38
  "opencode-go-responses/grok-4.7": { tps: 74.2, ii: 46, cost: 2 }, // $2/$6 → 4.8

  // ── ② pi-ai 品牌直营目录（未路由：只存速度/智能原值，成本等路由接通后跟引擎）──
  // anthropic（AA 2026-10-11；dated 变体与主模型同页；II 多为站方 estimated）
  "anthropic/claude-fable-5": { tps: 64.4, ii: 50 },
  "anthropic/claude-fable-5-1": { tps: 70.2, ii: 53 },
  "anthropic/claude-haiku-4-5": { tps: 83.0, ii: 15 },
  "anthropic/claude-haiku-4-5-20251001": { tps: 83.0, ii: 15 },
  "anthropic/claude-haiku-5-5": { tps: 239.8, ii: 43 },
  "anthropic/claude-opus-4-5": { tps: 48.2, ii: 24 },
  "anthropic/claude-opus-4-5-20251101": { tps: 48.2, ii: 24 },
  "anthropic/claude-opus-4-6": { tps: 40.8, ii: 26 },
  "anthropic/claude-opus-4-7": { tps: 52.5, ii: 41 },
  "anthropic/claude-opus-4-8": { tps: 58.3, ii: 42 },
  "anthropic/claude-opus-5": { tps: 53.1, ii: 51 },
  "anthropic/claude-opus-5-5": { tps: 97.0, ii: 58 }, // AA #1/227
  "anthropic/claude-sonnet-4-5": { tps: 42.3, ii: 19 },
  "anthropic/claude-sonnet-4-5-20250929": { tps: 42.3, ii: 19 },
  "anthropic/claude-sonnet-4-6": { tps: 44.7, ii: 30 }, // AA 标 25est，Command Code 正式评分 30.1（2026-10-11 对照，取正式值）
  "anthropic/claude-sonnet-5": { tps: 79.0, ii: 38 },
  "anthropic/claude-sonnet-5-5": { tps: 141.8, ii: 56 },
  // google（AA 2026-10-11；-latest 是别名映射最新一代页；High 档口径）
  "google/gemini-2.5-flash": { tps: 191.2, ii: 10 },
  "google/gemini-2.5-flash-lite": { tps: 266.4, ii: 7 },
  "google/gemini-2.5-pro": { tps: 117.0, ii: 16 },
  "google/gemini-3-flash-preview": { tps: 203.1, ii: 18 },
  "google/gemini-3.1-flash-lite": { tps: 330.5, ii: 16 }, // 与 -preview 同页
  "google/gemini-3.1-flash-lite-image": { tps: 330.5, ii: 16 }, // 同上
  "google/gemini-3.1-flash-lite-preview": { tps: 330.5, ii: 16 }, // 页标弃用
  "google/gemini-3.1-pro-preview": { tps: 118.2, ii: 30 },
  "google/gemini-3.1-pro-preview-customtools": { tps: 118.2, ii: 30 }, // 与 -pro-preview 同页
  "google/gemini-3.5-flash": { tps: 200.0, ii: 33 }, // 页标弃用
  "google/gemini-3.5-flash-lite": { tps: 414.0, ii: 22 },
  "google/gemini-3.6-flash": { tps: 196.6, ii: 34 },
  "google/gemini-3.7-flash": { tps: 306.9, ii: 39 }, // 页标弃用
  "google/gemini-3.8-flash": { tps: 125.0, ii: 41 },
  "google/gemini-flash-latest": { tps: 125.0, ii: 41 }, // 别名映射 3.8 Flash
  "google/gemini-flash-lite-latest": { tps: 414.0, ii: 22 }, // 别名映射 3.5 Flash-Lite
  "google/gemma-4-26b-a4b-it": { tps: 67.9, ii: 17 },
  "google/gemma-4-31b-it": { tps: 35.0, ii: 15 },
  // openai（AA 2026-10-11；II 多为 estimated；速度未公开的行不入表）
  "openai/gpt-4-turbo": { tps: 32.1, ii: 7 },
  "openai/gpt-4.1": { tps: 139.6, ii: 13 },
  "openai/gpt-4.1-mini": { tps: 142.3, ii: 10 },
  "openai/gpt-4.1-nano": { tps: 170.7, ii: 8 },
  "openai/gpt-4o": { tps: 132.8, ii: 8 },
  "openai/gpt-4o-2024-05-13": { tps: 132.0, ii: 7 },
  "openai/gpt-4o-2024-08-06": { tps: 121.1, ii: 8 },
  "openai/gpt-4o-2024-11-20": { tps: 132.8, ii: 8 }, // 与 gpt-4o 同页
  "openai/gpt-4o-mini": { tps: 111.2, ii: 7 },
  "openai/gpt-5": { tps: 88.2, ii: 23 },
  "openai/gpt-5-chat-latest": { tps: 88.2, ii: 23 }, // 与 gpt-5 同页
  "openai/gpt-5-mini": { tps: 135.7, ii: 17 },
  "openai/gpt-5-nano": { tps: 129.4, ii: 13 },
  "openai/gpt-5.1": { tps: 94.4, ii: 25 },
  "openai/gpt-5.2": { tps: 80.3, ii: 30 },
  "openai/gpt-5.2-chat-latest": { tps: 80.3, ii: 30 }, // 与 gpt-5.2 同页
  "openai/gpt-5.3-codex": { tps: 92.9, ii: 33 },
  "openai/gpt-5.4": { tps: 93.1, ii: 39 },
  "openai/gpt-5.4-mini": { tps: 258.4, ii: 24 },
  "openai/gpt-5.4-nano": { tps: 164.7, ii: 21 },
  "openai/gpt-5.5": { tps: 89.9, ii: 38 },
  "openai/gpt-5.6-sol": { tps: 80.8, ii: 47 },
  "openai/gpt-5.6-terra": { tps: 121.4, ii: 42 },
  "openai/gpt-6-astra": { tps: 47.7, ii: 53 },
  "openai/gpt-6-sol": { tps: 98.1, ii: 48 },
  "openai/gpt-6.1-sol": { tps: 59.3, ii: 52 },
  "openai/o3": { tps: 133.9, ii: 20 },
  "openai/o3-mini": { tps: 193.4, ii: 12 },
  "openai/o4-mini": { tps: 158.3, ii: 17 },
  // openai-codex（OpenAI 自家 codex 端点，同模型同 openai 数值）
  "openai-codex/gpt-5.3-codex-spark": { tps: 92.9, ii: 33 }, // AA 无独立页，按 gpt-5.3-codex 抄
  "openai-codex/gpt-5.5": { tps: 89.9, ii: 38 },
  "openai-codex/gpt-5.6-luna": { tps: 117.5, ii: 37 },
  "openai-codex/gpt-5.6-sol": { tps: 80.8, ii: 47 },
  "openai-codex/gpt-5.6-terra": { tps: 121.4, ii: 42 },
  "openai-codex/gpt-6-astra": { tps: 47.7, ii: 53 },
  "openai-codex/gpt-6-luna": { tps: 136.9, ii: 38 },
  "openai-codex/gpt-6-sol": { tps: 98.1, ii: 48 },
  "openai-codex/gpt-6.1-sol": { tps: 59.3, ii: 52 },
  // deepseek（品牌直营；供未来 deepseek 路由键）
  "deepseek/deepseek-flash": { tps: 217.1, ii: 39 },
  "deepseek/deepseek-v4-pro": { tps: 84.7, ii: 36 },
  // zai（智谱国际；AA 2026-10-10/11）
  "zai/glm-4.7": { tps: 41.0, ii: 22 },
  "zai/glm-5.2": { tps: 83.3, ii: 34 },
  "zai/glm-5.3": { tps: 78.8, ii: 45 },
  "zai/glm-5.3-flash": { tps: 57.7, ii: 42 },
  "zai-coding-cn/glm-4.6v": { tps: 72.9, ii: 8 },
  "zai-coding-cn/glm-5.3": { tps: 78.8, ii: 45 },
  "zai-coding-cn/glm-5.3-flash": { tps: 57.7, ii: 42 },
  // minimax（AA 2026-10-10）
  "minimax/MiniMax-M2.7": { tps: 61.4, ii: 23 },
  "minimax/MiniMax-M3": { tps: 96.6, ii: 29 },
  // moonshotai（AA 2026-10-10）
  "moonshotai/kimi-k2.6": { tps: 51.8, ii: 27 },
  "moonshotai/kimi-k2.7-code": { tps: 66.9, ii: 26 },
  "moonshotai/kimi-k3": { tps: 39.2, ii: 44 },
  "kimi-coding/k3": { tps: 39.2, ii: 44 }, // 与 kimi-k3 同页
  // ant-ling（AA 2026-10-11；Ling 系未公开速度 → 不入表）
  "ant-ling/Ring-2.6-1T": { tps: 112.3, ii: 17 },
  // meta（AA 2026-10-11；Contributor 档 AA 不单列，用同模型标准档近似）
  "meta/muse-spark-1.1": { tps: 83.9, ii: 34 },
  "meta/muse-spark-1.2": { tps: 325.2, ii: 40 },
  "meta/muse-spark-1.2-contributor": { tps: 325.2, ii: 40 },
  "meta/muse-spark-1.3": { tps: 122.5, ii: 48 }, // Max 档
  "meta/muse-spark-1.3-contributor": { tps: 122.5, ii: 48 },
  // mistral（AA 2026-10-11；Devstral/Magistral/Large 2/Pixtral/Voxtral/Nemo 系速度
  // 未公开或查无 → 不入表；-latest 按 docs 现行版本映射对应代页）
  "mistral/ministral-14b-2512": { tps: 70.4, ii: 6 },
  "mistral/ministral-3b-2512": { tps: 230.9, ii: 5 },
  "mistral/ministral-3b-latest": { tps: 230.9, ii: 5 }, // 与 -2512 同页
  "mistral/ministral-8b-2512": { tps: 94.4, ii: 5 },
  "mistral/ministral-8b-latest": { tps: 94.4, ii: 5 }, // 与 -2512 同页
  "mistral/mistral-large-2512": { tps: 77.4, ii: 9 }, // Large 3
  "mistral/mistral-medium-2505": { tps: 46.0, ii: 9 },
  "mistral/mistral-medium-2604": { tps: 162.4, ii: 14 }, // Medium 3.5
  "mistral/mistral-medium-3.5": { tps: 162.4, ii: 14 }, // 与 -2604 同页
  "mistral/mistral-medium-latest": { tps: 162.4, ii: 14 }, // 与 -2604 同页
  "mistral/mistral-small-2506": { tps: 36.3, ii: 8 },
  "mistral/mistral-small-2603": { tps: 163.2, ii: 11 }, // Small 4 Reasoning
  "mistral/mistral-small-latest": { tps: 163.2, ii: 11 }, // 与 -2603 同页
  "mistral/open-mixtral-8x7b": { tps: 25.5, ii: 5 }, // 页标弃用
  "mistral/zai-glm-5-2": { tps: 83.3, ii: 34 }, // Mistral API 上的 GLM-5.2
  "mistral/zai-glm-5-3": { tps: 78.8, ii: 45 },
  "mistral/glm-5-2": { tps: 83.3, ii: 34 }, // 与 zai-glm-5-2 同页
};

/** join：引擎目录选项 × 登记表（原值折档）。未收录的模型原样回退（facts 缺席 = 占位态）。 */
export function withFacts(options: ModelOption[]): ModelOption[] {
  return options.map((o) => {
    const b = MODEL_BENCH[`${o.provider}/${o.model}`];
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

/** 详情卡的成本刻度（唯一推导口径）：手工档（引擎不发价的行）覆盖，引擎 peak 价兜默认家。 */
export function costMeter(option: Pick<ModelOption, "cost" | "facts">): number | undefined {
  return option.facts?.cost ?? costScaleFromPrices(option.cost);
}
