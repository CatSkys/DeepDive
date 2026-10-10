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
// anthropic…那类键在本引擎路由里永不命中）。缺省语义：条目里哪项没抄到就不写哪项（该行
// 不渲染）；整条目缺席 = 详情卡显示「暂无基准数据」占位。绝不现编数值。
//
// 填表口径（更新时照此抄录，行尾注释留出处与日期）：
// - speed：AA 榜 Output Speed (tok/s) → ≥250→4，120–249→3，70–119→2，40–69→1，<40→0。
//   相对快慢；具体 tok/s 随账号/区域/负载漂移，不上 UI。
// - intelligence：AA Intelligence Index → ≥50→4，44–49→3，40–43→2，35–39→1，<35→0。
// - cost：官方牌价折合（0.3×输入价 + 0.7×输出价，$/Mtok）→ ≤1→4，≤3→3，≤10→2，
//   ≤25→1，否则→0（越满越省）。套餐端点（0/0 牌价）不折成本刻度。
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

/** provider/model → 基准刻度。AA 取数日期一律 2026-10-10；键段 = 引擎真实路由（2026-10-10 目录实测）。
 *  成本刻度（2026-10-10 M1 起）：默认家 = 引擎目录的 peak 牌价（costScaleFromPrices），
 *  本表只对**不在任何目录里的套餐/聚合行**保留手工档（覆盖语义，见 costMeter）。 */
export const MODEL_BENCH: Record<string, ModelBench> = {
  // —— deepseek-official（官方直连路由，四条全收）——
  // deepseek-flash 与 deepseek-v4-flash 是同一物理模型的两个端点（新名 DeepSeek-V41-Flash
  // 显示），AA DeepSeek 页只有一组 V4.1 Flash 值（226.1 tok/s · II 34，AA 已标弃用），两条共用。
  // 成本档摘掉：引擎目录直发 peak 牌价（flash 0.93→4；v4-pro 3.17→2——此前手抄档 4 是错的，由引擎价修正）。
  "deepseek-official/deepseek-flash": { speed: 3, intelligence: 0 },
  "deepseek-official/deepseek-v4-flash": { speed: 3, intelligence: 0 },
  "deepseek-official/deepseek-v4-pro": { speed: 2, intelligence: 1 }, // 89.0 tok/s · II 36

  // —— opencode-go（聚合路由）——
  "opencode-go/minimax-m3": { cost: 4 },
  "opencode-go/minimax-m2.7": { cost: 4 },
  "opencode-go/qwen3.8-max": { speed: 0, intelligence: 3 }, // 套餐端点 0/0 牌价，不折成本刻度
  "opencode-go/deepseek-v4-flash": { speed: 3, intelligence: 0, cost: 4 },
  "opencode-go/deepseek-v4.1-flash": { speed: 3, intelligence: 0, cost: 4 },
  "opencode-go/deepseek-v4-pro": { speed: 2, intelligence: 1, cost: 4 },
  "opencode-go/glm-5.3": { speed: 2, intelligence: 3, cost: 3 }, // 83.0 tok/s · II 45
  "opencode-go/glm-5.3-flash": { cost: 4 },
  "opencode-go/glm-5.2": { cost: 3 },
  "opencode-go/kimi-k3": { speed: 1, intelligence: 3, cost: 1 }, // 40.4 tok/s · II 44
  "opencode-go/kimi-k2.7-code": { cost: 3 },
  "opencode-go/gpt-5.6-luna": { cost: 4 },
  "opencode-go/grok-4.6": { speed: 3, intelligence: 2, cost: 2 }, // 121.0 tok/s · II 41

  // —— opencode-go-new ——
  "opencode-go-new/deepseek-flash": { speed: 3, intelligence: 0, cost: 4 },

  // —— opencode-go-responses ——
  "opencode-go-responses/gpt-6-luna": { cost: 4 },
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

/** 牌价 → 成本刻度（登记表口径原样：0.3×输入价 + 0.7×输出价 → ≤1→4，≤3→3，≤10→2，≤25→1，否则 0）。 */
export function costScaleFromPrices(prices: ModelPrice | undefined): number | undefined {
  if (prices === undefined) return undefined;
  const composite = 0.3 * prices.input + 0.7 * prices.output;
  if (composite <= 1) return 4;
  if (composite <= 3) return 3;
  if (composite <= 10) return 2;
  if (composite <= 25) return 1;
  return 0;
}

/** 详情卡的成本刻度（唯一推导口径）：手工档（套餐行）覆盖，引擎 peak 价兜默认家。 */
export function costMeter(option: Pick<ModelOption, "cost" | "facts">): number | undefined {
  return option.facts?.cost ?? costScaleFromPrices(option.cost);
}
