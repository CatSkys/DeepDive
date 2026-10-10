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

/** provider/model → 基准刻度。AA 取数日期 2026-10-10（四批并行核对：AA 各模型页
 *  + DeepSeek/z.ai/Kimi/MiniMax/小米/阿里百炼/OpenAI/xAI/Meta 官方定价页）；键段 =
 *  引擎真实路由（settings 声明 + deepseek-official 内置目录，2026-10-10 实测）。
 *  成本刻度：引擎发价的行一律跟引擎（peak 牌价，costScaleFromPrices），本表只在
 *  引擎**不发价**的行手抄官方牌价折档（行尾注明）；官方与 AA 均查无的模型不入表
 *  （详情卡走「暂无基准数据」占位——hy3 / hy4-preview / qwen3.8-flash / mimo-v2.5 /
 *  omen-alpha / space-bunny-free，2026-10-10 核对）。 */
export const MODEL_BENCH: Record<string, ModelBench> = {
  // —— deepseek-official（官方直连，四条全收，价由 llm-deepseek 内置目录直发）——
  // deepseek-flash 与 v4-flash / vision-exp 是 flash 同层端点（官方已并层）；AA 上
  // flash 端点归并在 V4.1 Flash 页（217.1 tok/s · II 39），v4-flash 有独立页（219.1 · 34）。
  "deepseek-official/deepseek-flash": { speed: 3, intelligence: 1 },
  "deepseek-official/deepseek-v4-flash": { speed: 3, intelligence: 0 }, // 219.1 tok/s · II 34（页标弃用）
  "deepseek-official/deepseek-v4-pro": { speed: 2, intelligence: 1 }, // 84.7 tok/s · II 36
  "deepseek-official/deepseek-v4-flash-vision-exp": { speed: 3, intelligence: 1 }, // 220.3 · II 35

  // —— opencode-go（聚合路由；27 条在册，引擎价来自 pi-ai opencode-go 目录）——
  "opencode-go/minimax-m3": { speed: 2, intelligence: 0 }, // 96.6 tok/s · II 29
  "opencode-go/deepseek-v4-flash": { speed: 3, intelligence: 0 }, // 219.1 · 34
  "opencode-go/deepseek-v4-flash-vision-exp": { speed: 3, intelligence: 1 }, // 220.3 · 35
  "opencode-go/deepseek-v4-pro": { speed: 2, intelligence: 1 }, // 84.7 · 36
  "opencode-go/deepseek-v4.1-flash": { speed: 3, intelligence: 1 }, // 217.1 · 39
  "opencode-go/glm-5.1": { speed: 1, intelligence: 0, cost: 2 }, // 54.2 · 26；价手抄 z.ai $1.4/$4.4 → 3.5（引擎目录无此行）
  "opencode-go/glm-5.2": { speed: 2, intelligence: 0 }, // 83.3 · 34
  "opencode-go/glm-5.3": { speed: 2, intelligence: 3 }, // 78.8 · 45
  "opencode-go/glm-5.3-flash": { speed: 1, intelligence: 2 }, // 57.7 · 42
  "opencode-go/kimi-k2.6": { speed: 1, intelligence: 0, cost: 2 }, // 51.8 · 27；价手抄 kimi $0.95/$4 → 3.09（引擎目录无此行）
  "opencode-go/kimi-k2.7-code": { speed: 1, intelligence: 0 }, // 66.9 · 26
  "opencode-go/kimi-k3": { speed: 0, intelligence: 3 }, // 39.2 · 44
  "opencode-go/longcat-2.0": { speed: 1, intelligence: 0 }, // 65.2 · 19
  "opencode-go/mimo-v2.5-pro": { speed: 0, intelligence: 0 }, // 30.7 · 26（官方 10-21 下线）
  "opencode-go/minimax-m2.7": { speed: 1, intelligence: 0 }, // 61.4 · 23
  "opencode-go/qwen3.6-plus": { speed: 1, intelligence: 0, cost: 1 }, // 55.4 · 27est；价手抄百炼 $0.5/$3 → 2.25（引擎目录无此行）
  "opencode-go/qwen3.7-max": { speed: 3, intelligence: 0, cost: 2 }, // 196.9 · 29；价手抄百炼 $2.5/$7.5 → 6.0（引擎目录无此行）
  "opencode-go/qwen3.7-plus": { speed: 1, intelligence: 0 }, // 54.3 · 25
  "opencode-go/qwen3.8-max": { speed: 0, intelligence: 3 }, // 35.7 · 45
  "opencode-go/gpt-5.6-luna": { speed: 2, intelligence: 1 }, // 117.5 · 37
  "opencode-go/grok-4.6": { speed: 1, intelligence: 3 }, // 60.4 · 44
  "opencode-go/muse-spark-1.2-contributor": { speed: 4, intelligence: 2 }, // AA 不单列 Contributor 档，用同模型标准档 325.2 · II 40 近似
  "opencode-go/muse-spark-1.3-contributor": { speed: 2, intelligence: 3 }, // 同上，1.3 Max 122.5 · 48

  // —— opencode-go-new（自包含路由，引擎不发价：成本全档手抄官方牌价）——
  "opencode-go-new/deepseek-flash": { speed: 3, intelligence: 1, cost: 0 }, // 217.1 · 39；$0.3/$1.2 → 0.93
  "opencode-go-new/minimax-m2.5": { speed: 2, intelligence: 0, cost: 0 }, // 80.2 · 23est；$0.3/$1.2 → 0.93
  "opencode-go-new/mimo-v2.6-flash": { speed: 1, intelligence: 1, cost: 0 }, // 61.1 · 38；$0.14/$0.28 → 0.24
  "opencode-go-new/mimo-v2.6-pro": { speed: 1, intelligence: 3, cost: 0 }, // 44.9 · 46；$0.435/$0.87 → 0.74

  // —— opencode-go-responses（自包含路由，引擎不发价）——
  "opencode-go-responses/gpt-6-luna": { speed: 3, intelligence: 1, cost: 0 }, // 136.9 · 38；$0.1/$0.5 → 0.38
  "opencode-go-responses/grok-4.7": { speed: 2, intelligence: 3, cost: 2 }, // 74.2 · 46；$2/$6 → 4.8
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
