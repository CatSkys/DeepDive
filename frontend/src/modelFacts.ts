// 模型基准登记表 —— 前端唯一自维护的数据面：模型选择器详情卡的
// 速度 / 智能 / 成本三条 0–4 刻度（用户 2026-10-10 定稿：运行时零网络依赖，
// AA 只是填表参考，不是运行时依赖）。
//
// 为什么需要这张表：引擎目录只知道「能不能路由」（可用性）与「能力事实」
// （inputModalities / contextWindow / reasoning，session/modelCatalog 投影）——
// 速度、智能、成本只有榜单与牌价有，且只用于显示。三处事实的家：
// 引擎=可用性，引擎目录投影=能力事实，本表=榜单/牌价刻度（SPEC-SEMANTICS「模型基准」）。
//
// 键规则：逐字等于引擎目录投影的 `${provider}/${model}`（provider = session/modelCatalog
// 的**路由 key**，2026-10-10 实测为 deepseek-official / opencode-go / opencode-go-new /
// opencode-go-responses 四组——**不是** pi-ai 数据层的品牌直连 id（deepseek / minimax /
// anthropic…那类键在本引擎路由里永不命中）。缺省语义：**全有或全无**（用户 2026-10-10
// 定稿）——速度/智能/成本三项齐才渲染刻度，条目缺席或缺项 = 详情卡只显示「暂无基准
// 数据」占位，绝不出现"只有成本没有基准"的半张卡。绝不现编数值。
//
// 填表口径（更新时照此抄录，行尾注释留出处与日期）：
// - speed：AA 榜 Output Speed (tok/s) → ≥250→4，120–249→3，70–119→2，40–69→1，<40→0。
//   相对快慢；具体 tok/s 随账号/区域/负载漂移，不上 UI。
// - intelligence：AA Intelligence Index → ≥50→4，44–49→3，40–43→2，35–39→1，<35→0。
// - cost：官方牌价折合（0.3×输入价 + 0.7×输出价，$/Mtok）→ ≤1→0，≤3→1，≤10→2，
//   ≤25→3，否则→4（**越满越贵**，用户 2026-10-10 定稿：条长 = 花费量级，与速度/
//   智能同向可读；此前的「越满越省」满格被读成成本拉满）。登记表只对引擎不发价
//   的行手抄成本；0 牌价（套餐/免费端点）折 0。
// 网关/镜像路由（bedrock、azure、vertex、openrouter…）不入表：模型与官方路由同体，
// 显示刻度跟官方路由走，避免同一模型两条记录漂移。
import type { ModelOption } from "./components/ModelMenu";

/** 一条基准记录：三项刻度各自可选（没抄到的项不写）。 */
export interface ModelBench {
  /** 0–4，AA Output Speed 折算。 */
  speed?: number;
  /** 0–4，AA Intelligence Index 折算。 */
  intelligence?: number;
  /** 0–4，官方牌价折合，越满越省。 */
  cost?: number;
  /** 显式不支持工具调用的模型才写 false；缺省 = 支持。 */
  tools?: false;
}

/** provider/model → 基准刻度。覆盖两层（2026-10-10/11 两轮核对，四批+七批并行上网）：
 *  ① 引擎在册路由（会话实际可路由的）——成本跟引擎 peak 牌价（costMeter 兜底）；
 *  ② pi-ai 品牌直营目录的全部聊天模型（用户 2026-10-11 定稿：不止在册路由，凡是
 *     有公开数据的都入表）——路由接通后成本自动跟引擎目录牌价，本表只抄速度/智能。
 *  网关/镜像文件（openrouter/bedrock/azure/vertex/cloudflare/huggingface/together…）
 *  仍不入表：模型与官方路由同体，避免同一模型两条记录漂移。
 *  AA 与官方均查无的模型不入表（详情卡占位「暂无基准数据」）。绝不现编数值。 */
export const MODEL_BENCH: Record<string, ModelBench> = {
  // ── ① 引擎在册路由 ──
  // deepseek-official（官方直连，四条全收，价由 llm-deepseek 内置目录直发）：
  // flash 端点已并层到 V4.1 Flash（AA 归并页 217.1 tok/s · II 39），v4-flash 有独立页（219.1 · 34）。
  "deepseek-official/deepseek-flash": { speed: 3, intelligence: 1 },
  "deepseek-official/deepseek-v4-flash": { speed: 3, intelligence: 0 }, // 219.1 tok/s · II 34（页标弃用）
  "deepseek-official/deepseek-v4-pro": { speed: 2, intelligence: 1 }, // 84.7 tok/s · II 36
  "deepseek-official/deepseek-v4-flash-vision-exp": { speed: 3, intelligence: 1 }, // 220.3 · II 35
  // opencode-go（聚合路由；引擎价来自 pi-ai opencode-go 目录）
  "opencode-go/minimax-m3": { speed: 2, intelligence: 0 }, // 96.6 tok/s · II 29
  "opencode-go/qwen3.8-flash": { speed: 1, intelligence: 2 }, // 聚合端点名即 Qwen3.8-Flash-Next（用户 2026-10-11 确认）；52.8 · II 40
  "opencode-go/deepseek-v4-flash": { speed: 3, intelligence: 0 }, // 219.1 · 34
  "opencode-go/deepseek-v4-flash-vision-exp": { speed: 3, intelligence: 1 }, // 220.3 · 35
  "opencode-go/deepseek-v4-pro": { speed: 2, intelligence: 1 }, // 84.7 · 36
  "opencode-go/deepseek-v4.1-flash": { speed: 3, intelligence: 1 }, // 217.1 · 39
  "opencode-go/glm-5.1": { speed: 1, intelligence: 0, cost: 2 }, // 54.2 · 26；价手抄 z.ai $1.4/$4.4 → 3.5（目录缺行被引擎丢弃，settings 仍声明）
  "opencode-go/glm-5.2": { speed: 2, intelligence: 0 }, // 83.3 · 34
  "opencode-go/glm-5.3": { speed: 2, intelligence: 3 }, // 78.8 · 45
  "opencode-go/glm-5.3-flash": { speed: 1, intelligence: 2 }, // 57.7 · 42
  "opencode-go/kimi-k2.6": { speed: 1, intelligence: 0, cost: 2 }, // 51.8 · 27；价手抄 kimi $0.95/$4 → 3.09（目录缺行被引擎丢弃，settings 仍声明）
  "opencode-go/kimi-k2.7-code": { speed: 1, intelligence: 0 }, // 66.9 · 26
  "opencode-go/kimi-k3": { speed: 0, intelligence: 3 }, // 39.2 · 44
  "opencode-go/longcat-2.0": { speed: 1, intelligence: 0 }, // 65.2 · 19
  "opencode-go/mimo-v2.5-pro": { speed: 0, intelligence: 0 }, // 30.7 · 26（官方 10-21 下线）
  "opencode-go/minimax-m2.7": { speed: 1, intelligence: 0 }, // 61.4 · 23
  "opencode-go/qwen3.6-plus": { speed: 1, intelligence: 0, cost: 1 }, // 55.4 · 27est；价手抄百炼 $0.5/$3 → 2.25（目录缺行被引擎丢弃，settings 仍声明）
  "opencode-go/qwen3.7-max": { speed: 3, intelligence: 0, cost: 2 }, // 196.9 · 29；价手抄百炼 $2.5/$7.5 → 6.0（目录缺行被引擎丢弃，settings 仍声明）
  "opencode-go/qwen3.7-plus": { speed: 1, intelligence: 0 }, // 54.3 · 25
  "opencode-go/qwen3.8-max": { speed: 0, intelligence: 3 }, // 35.7 · 45
  "opencode-go/gpt-5.6-luna": { speed: 2, intelligence: 1 }, // 117.5 · 37
  "opencode-go/grok-4.6": { speed: 1, intelligence: 3 }, // 60.4 · 44
  "opencode-go/muse-spark-1.2-contributor": { speed: 4, intelligence: 2 }, // AA 不单列 Contributor 档，用同模型标准档 325.2 · II 40 近似
  "opencode-go/muse-spark-1.3-contributor": { speed: 2, intelligence: 3 }, // 同上，1.3 Max 122.5 · 48
  // opencode-go-new（自包含路由，引擎不发价：成本档手抄官方牌价）
  "opencode-go-new/deepseek-flash": { speed: 3, intelligence: 1, cost: 0 }, // 217.1 · 39；$0.3/$1.2 → 0.93
  "opencode-go-new/minimax-m2.5": { speed: 2, intelligence: 0, cost: 0 }, // 80.2 · 23est；$0.3/$1.2 → 0.93
  "opencode-go-new/mimo-v2.6-flash": { speed: 1, intelligence: 1, cost: 0 }, // 61.1 · 38；$0.14/$0.28 → 0.24
  "opencode-go-new/mimo-v2.6-pro": { speed: 1, intelligence: 3, cost: 0 }, // 44.9 · 46；$0.435/$0.87 → 0.74
  // opencode-go-responses（自包含路由，引擎不发价）
  "opencode-go-responses/gpt-6-luna": { speed: 3, intelligence: 1, cost: 0 }, // 136.9 · 38；$0.1/$0.5 → 0.38
  "opencode-go-responses/grok-4.7": { speed: 2, intelligence: 3, cost: 2 }, // 74.2 · 46；$2/$6 → 4.8

  // ── ② pi-ai 品牌直营目录（未路由：只抄速度/智能，成本等路由接通后跟引擎）──
  // anthropic（AA 2026-10-11；dated 变体与主模型同页；II 多为站方 estimated）
  "anthropic/claude-fable-5": { speed: 1, intelligence: 4 }, // 64.4 · 50
  "anthropic/claude-fable-5-1": { speed: 2, intelligence: 4 }, // 70.2 · 53
  "anthropic/claude-haiku-4-5": { speed: 2, intelligence: 0 }, // 83.0 · 15est
  "anthropic/claude-haiku-4-5-20251001": { speed: 2, intelligence: 0 },
  "anthropic/claude-haiku-5-5": { speed: 3, intelligence: 2 }, // 239.8 · 43
  "anthropic/claude-opus-4-5": { speed: 1, intelligence: 0 }, // 48.2 · 24est
  "anthropic/claude-opus-4-5-20251101": { speed: 1, intelligence: 0 },
  "anthropic/claude-opus-4-6": { speed: 1, intelligence: 0 }, // 40.8 · 26est
  "anthropic/claude-opus-4-7": { speed: 1, intelligence: 2 }, // 52.5 · 41est
  "anthropic/claude-opus-4-8": { speed: 1, intelligence: 2 }, // 58.3 · 42
  "anthropic/claude-opus-5": { speed: 1, intelligence: 4 }, // 53.1 · 51
  "anthropic/claude-opus-5-5": { speed: 2, intelligence: 4 }, // 97.0 · 58（#1/227）
  "anthropic/claude-sonnet-4-5": { speed: 1, intelligence: 0 }, // 42.3 · 19est
  "anthropic/claude-sonnet-4-5-20250929": { speed: 1, intelligence: 0 },
  "anthropic/claude-sonnet-4-6": { speed: 1, intelligence: 0 }, // 44.7 · 25est
  "anthropic/claude-sonnet-5": { speed: 2, intelligence: 1 }, // 79.0 · 38
  "anthropic/claude-sonnet-5-5": { speed: 3, intelligence: 4 }, // 141.8 · 56
  // google（AA 2026-10-11；-latest 是别名映射最新一代页；High 档口径）
  "google/gemini-2.5-flash": { speed: 3, intelligence: 0 }, // 191.2 · 10
  "google/gemini-2.5-flash-lite": { speed: 4, intelligence: 0 }, // 266.4 · 7
  "google/gemini-2.5-pro": { speed: 2, intelligence: 0 }, // 117.0 · 16
  "google/gemini-3-flash-preview": { speed: 3, intelligence: 0 }, // 203.1 · 18
  "google/gemini-3.1-flash-lite": { speed: 4, intelligence: 0 }, // 330.5 · 16（与 -preview 同页）
  "google/gemini-3.1-flash-lite-image": { speed: 4, intelligence: 0 }, // 同上
  "google/gemini-3.1-flash-lite-preview": { speed: 4, intelligence: 0 }, // 330.5 · 16（页标弃用）
  "google/gemini-3.1-pro-preview": { speed: 2, intelligence: 0 }, // 118.2 · 30
  "google/gemini-3.1-pro-preview-customtools": { speed: 2, intelligence: 0 }, // 与 -pro-preview 同页
  "google/gemini-3.5-flash": { speed: 3, intelligence: 0 }, // 200.0 · 33（页标弃用）
  "google/gemini-3.5-flash-lite": { speed: 4, intelligence: 0 }, // 414.0 · 22
  "google/gemini-3.6-flash": { speed: 3, intelligence: 0 }, // 196.6 · 34
  "google/gemini-3.7-flash": { speed: 4, intelligence: 1 }, // 306.9 · 39（页标弃用）
  "google/gemini-3.8-flash": { speed: 3, intelligence: 2 }, // 125.0 · 41
  "google/gemini-flash-latest": { speed: 3, intelligence: 2 }, // 别名映射 3.8 Flash
  "google/gemini-flash-lite-latest": { speed: 4, intelligence: 0 }, // 别名映射 3.5 Flash-Lite
  "google/gemma-4-26b-a4b-it": { speed: 1, intelligence: 0 }, // 67.9 · 17
  "google/gemma-4-31b-it": { speed: 0, intelligence: 0 }, // 35.0 · 15
  // openai（AA 2026-10-11；II 多为 estimated；未公开速度的行不入表）
  "openai/gpt-4-turbo": { speed: 0, intelligence: 0 }, // 32.1 · 7est
  "openai/gpt-4.1": { speed: 3, intelligence: 0 }, // 139.6 · 13est
  "openai/gpt-4.1-mini": { speed: 3, intelligence: 0 }, // 142.3 · 10est
  "openai/gpt-4.1-nano": { speed: 3, intelligence: 0 }, // 170.7 · 8est
  "openai/gpt-4o": { speed: 3, intelligence: 0 }, // 132.8 · 8est
  "openai/gpt-4o-2024-05-13": { speed: 3, intelligence: 0 }, // 132.0 · 7est
  "openai/gpt-4o-2024-08-06": { speed: 3, intelligence: 0 }, // 121.1 · 8est
  "openai/gpt-4o-2024-11-20": { speed: 3, intelligence: 0 }, // 与 gpt-4o 同页
  "openai/gpt-4o-mini": { speed: 2, intelligence: 0 }, // 111.2 · 7est
  "openai/gpt-5": { speed: 2, intelligence: 0 }, // 88.2 · 23est
  "openai/gpt-5-chat-latest": { speed: 2, intelligence: 0 }, // 与 gpt-5 同页
  "openai/gpt-5-mini": { speed: 3, intelligence: 0 }, // 135.7 · 17
  "openai/gpt-5-nano": { speed: 3, intelligence: 0 }, // 129.4 · 13est
  "openai/gpt-5.1": { speed: 2, intelligence: 0 }, // 94.4 · 25est
  "openai/gpt-5.2": { speed: 2, intelligence: 0 }, // 80.3 · 30est
  "openai/gpt-5.2-chat-latest": { speed: 2, intelligence: 0 }, // 与 gpt-5.2 同页
  "openai/gpt-5.3-codex": { speed: 2, intelligence: 0 }, // 92.9 · 33est
  "openai/gpt-5.4": { speed: 2, intelligence: 1 }, // 93.1 · 39est
  "openai/gpt-5.4-mini": { speed: 4, intelligence: 0 }, // 258.4 · 24
  "openai/gpt-5.4-nano": { speed: 3, intelligence: 0 }, // 164.7 · 21
  "openai/gpt-5.5": { speed: 2, intelligence: 1 }, // 89.9 · 38
  "openai/gpt-5.6-sol": { speed: 2, intelligence: 3 }, // 80.8 · 47
  "openai/gpt-5.6-terra": { speed: 3, intelligence: 2 }, // 121.4 · 42
  "openai/gpt-6-astra": { speed: 1, intelligence: 4 }, // 47.7 · 53
  "openai/gpt-6-sol": { speed: 2, intelligence: 3 }, // 98.1 · 48
  "openai/gpt-6.1-sol": { speed: 1, intelligence: 4 }, // 59.3 · 52
  "openai/o3": { speed: 3, intelligence: 0 }, // 133.9 · 20
  "openai/o3-mini": { speed: 3, intelligence: 0 }, // 193.4 · 12
  "openai/o4-mini": { speed: 3, intelligence: 0 }, // 158.3 · 17
  // openai-codex（OpenAI 自家 codex 端点，同模型同 openai 数值）
  "openai-codex/gpt-5.3-codex-spark": { speed: 2, intelligence: 0 }, // 与 gpt-5.3-codex 同模型（AA 无独立页，按 92.9 · 33est 抄）
  "openai-codex/gpt-5.5": { speed: 2, intelligence: 1 },
  "openai-codex/gpt-5.6-luna": { speed: 2, intelligence: 1 },
  "openai-codex/gpt-5.6-sol": { speed: 2, intelligence: 3 },
  "openai-codex/gpt-5.6-terra": { speed: 3, intelligence: 2 },
  "openai-codex/gpt-6-astra": { speed: 1, intelligence: 4 },
  "openai-codex/gpt-6-luna": { speed: 3, intelligence: 1 },
  "openai-codex/gpt-6-sol": { speed: 2, intelligence: 3 },
  "openai-codex/gpt-6.1-sol": { speed: 1, intelligence: 4 },
  // deepseek（品牌直营；在册 deepseek-official 覆盖日常，这里供未来 deepseek 路由键）
  "deepseek/deepseek-flash": { speed: 3, intelligence: 1 },
  "deepseek/deepseek-v4-pro": { speed: 2, intelligence: 1 },
  // zai（智谱国际；AA 2026-10-10/11）
  "zai/glm-4.7": { speed: 1, intelligence: 0 }, // 41.0 · 22est
  "zai/glm-5.2": { speed: 2, intelligence: 0 }, // 83.3 · 34
  "zai/glm-5.3": { speed: 2, intelligence: 3 }, // 78.8 · 45
  "zai/glm-5.3-flash": { speed: 1, intelligence: 2 }, // 57.7 · 42
  "zai-coding-cn/glm-4.6v": { speed: 2, intelligence: 0 }, // 72.9 · 8est
  "zai-coding-cn/glm-5.3": { speed: 2, intelligence: 3 },
  "zai-coding-cn/glm-5.3-flash": { speed: 1, intelligence: 2 },
  // minimax（AA 2026-10-10）
  "minimax/MiniMax-M2.7": { speed: 1, intelligence: 0 }, // 61.4 · 23
  "minimax/MiniMax-M3": { speed: 2, intelligence: 0 }, // 96.6 · 29
  // moonshotai（AA 2026-10-10）
  "moonshotai/kimi-k2.6": { speed: 1, intelligence: 0 }, // 51.8 · 27
  "moonshotai/kimi-k2.7-code": { speed: 1, intelligence: 0 }, // 66.9 · 26
  "moonshotai/kimi-k3": { speed: 0, intelligence: 3 }, // 39.2 · 44
  "kimi-coding/k3": { speed: 0, intelligence: 3 }, // 与 kimi-k3 同页（39.2 · 44）
  // ant-ling（AA 2026-10-11；Ling 系未公开速度 → 不入表）
  "ant-ling/Ring-2.6-1T": { speed: 2, intelligence: 0 }, // 112.3 · 17
  // meta（AA 2026-10-11；Contributor 档 AA 不单列，用同模型标准档近似）
  "meta/muse-spark-1.1": { speed: 2, intelligence: 0 }, // 83.9 · 34
  "meta/muse-spark-1.2": { speed: 4, intelligence: 2 }, // 325.2 · 40
  "meta/muse-spark-1.2-contributor": { speed: 4, intelligence: 2 },
  "meta/muse-spark-1.3": { speed: 3, intelligence: 3 }, // 122.5 · 48（Max 档）
  "meta/muse-spark-1.3-contributor": { speed: 3, intelligence: 3 },
  // mistral（AA 2026-10-11；Devstral/Magistral/Large 2/Pixtral/Voxtral/Nemo 系速度
  // 未公开或查无 → 不入表；-latest 按 docs 现行版本映射对应代页）
  "mistral/ministral-14b-2512": { speed: 2, intelligence: 0 }, // 70.4 · 6
  "mistral/ministral-3b-2512": { speed: 3, intelligence: 0 }, // 230.9 · 5
  "mistral/ministral-3b-latest": { speed: 3, intelligence: 0 }, // 与 -2512 同页
  "mistral/ministral-8b-2512": { speed: 2, intelligence: 0 }, // 94.4 · 5
  "mistral/ministral-8b-latest": { speed: 2, intelligence: 0 }, // 与 -2512 同页
  "mistral/mistral-large-2512": { speed: 2, intelligence: 0 }, // 77.4 · 9（Large 3）
  "mistral/mistral-medium-2505": { speed: 1, intelligence: 0 }, // 46.0 · 9est
  "mistral/mistral-medium-2604": { speed: 3, intelligence: 0 }, // 162.4 · 14（Medium 3.5）
  "mistral/mistral-medium-3.5": { speed: 3, intelligence: 0 }, // 与 -2604 同页
  "mistral/mistral-medium-latest": { speed: 3, intelligence: 0 }, // 与 -2604 同页
  "mistral/mistral-small-2506": { speed: 0, intelligence: 0 }, // 36.3 · 8est
  "mistral/mistral-small-2603": { speed: 3, intelligence: 0 }, // 163.2 · 11（Small 4 Reasoning）
  "mistral/mistral-small-latest": { speed: 3, intelligence: 0 }, // 与 -2603 同页
  "mistral/open-mixtral-8x7b": { speed: 0, intelligence: 0 }, // 25.5 · 5est（页标弃用）
  "mistral/zai-glm-5-2": { speed: 2, intelligence: 0 }, // 83.3 · 34（Mistral API 上的 GLM-5.2）
  "mistral/zai-glm-5-3": { speed: 2, intelligence: 3 }, // 78.8 · 45
  "mistral/glm-5-2": { speed: 2, intelligence: 0 }, // 与 zai-glm-5-2 同页
};

/** join：引擎目录选项 × 登记表。未收录的模型原样回退（facts 缺席 = 占位态）。 */
export function withFacts(options: ModelOption[]): ModelOption[] {
  return options.map((o) => {
    const facts = MODEL_BENCH[`${o.provider}/${o.model}`];
    return facts === undefined ? o : { ...o, facts };
  });
}

/** 引擎目录透出的牌价（$/Mtok，peak 口径；官方页 off-peak 减半，不跨刻度界）。 */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** 牌价 → 成本刻度（登记表口径原样：0.3×输入价 + 0.7×输出价 → ≤1→0，≤3→1，
 *  ≤10→2，≤25→3，否则 4；越满越贵，见填表口径）。 */
export function costScaleFromPrices(prices: ModelPrice | undefined): number | undefined {
  if (prices === undefined) return undefined;
  const composite = 0.3 * prices.input + 0.7 * prices.output;
  if (composite <= 1) return 0;
  if (composite <= 3) return 1;
  if (composite <= 10) return 2;
  if (composite <= 25) return 3;
  return 4;
}

/** 详情卡的成本刻度（唯一推导口径）：手工档（套餐行）覆盖，引擎 peak 价兜默认家。 */
export function costMeter(option: Pick<ModelOption, "cost" | "facts">): number | undefined {
  return option.facts?.cost ?? costScaleFromPrices(option.cost);
}
