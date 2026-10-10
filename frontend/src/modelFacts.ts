// 模型基准登记表 —— 前端唯一自维护的数据面：模型选择器详情卡的
// 速度 / 智能 / 成本三条 0–4 刻度（用户 2026-10-10 定稿：运行时零网络依赖，
// AA 只是填表参考，不是运行时依赖）。
//
// 为什么需要这张表：引擎目录只知道「能不能路由」（可用性）与「能力事实」
// （inputModalities / contextWindow / reasoning，session/modelCatalog 投影）——
// 速度、智能、成本只有榜单与牌价有，且只用于显示。三处事实的家：
// 引擎=可用性，引擎目录投影=能力事实，本表=榜单/牌价刻度（SPEC-SEMANTICS「模型基准」）。
//
// 键规则：逐字等于引擎目录的 `${provider}/${model}`（路由 key + 模型 id，抄自
// 引擎内置目录，勿凭记忆拼写）。缺省语义：条目里哪项没抄到就不写哪项（该行
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

/** provider/model → 基准刻度。AA 取数日期一律 2026-10-10。 */
export const MODEL_BENCH: Record<string, ModelBench> = {
  // —— DeepSeek（核心路由）——
  "deepseek/deepseek-v4-pro": { speed: 2, intelligence: 1, cost: 4 }, // 89.0 tok/s · II 36
  // pi-ai 1.1 目录把 v4-flash 换名 deepseek-flash（同一模型），AA 值原样顺延
  "deepseek/deepseek-flash": { speed: 3, intelligence: 0, cost: 4 }, // 226.1 tok/s · II 34（AA 已标弃用）
  // —— Anthropic ——
  "anthropic/claude-fable-5-1": { speed: 2, intelligence: 4, cost: 0 }, // 70.4 tok/s · II 53（#5/227）
  "anthropic/claude-fable-5": { cost: 0 },
  "anthropic/claude-opus-5": { speed: 1, intelligence: 4, cost: 1 }, // 53.1 tok/s · II 51（AA 已标弃用）
  "anthropic/claude-opus-4-8": { speed: 1, intelligence: 2, cost: 1 }, // 58.3 tok/s · II 42（AA 已标弃用）
  "anthropic/claude-sonnet-5": { speed: 2, intelligence: 1, cost: 1 }, // 79.3 tok/s · II 38（AA 已标弃用）
  "anthropic/claude-sonnet-4-6": { cost: 1 },
  "anthropic/claude-haiku-4-5": { cost: 2 },
  // —— OpenAI ——
  "openai/gpt-6-astra": { speed: 1, intelligence: 4, cost: 0 }, // 46.9 tok/s · II 53（#7/227）
  "openai/gpt-5.6-terra": { speed: 2, intelligence: 2, cost: 2 }, // 118.7 tok/s · II 42
  "openai/gpt-5.6-sol": { speed: 2, intelligence: 3, cost: 1 }, // 79.3 tok/s · II 47（AA 已标弃用）
  "openai/gpt-5.6-luna": { cost: 4 },
  "openai/gpt-5.5": { cost: 1 },
  "openai/gpt-5.5-pro": { cost: 0 },
  // —— xAI ——
  "xai/grok-4.6": { speed: 3, intelligence: 2, cost: 2 }, // 121.0 tok/s · II 41
  "xai/grok-4.5": { speed: 1, intelligence: 3, cost: 1 }, // 59.5 tok/s · II 44（AA 已标弃用）
  "xai/grok-4.3": { cost: 3 }, // 无基准占位态的样例模型（参考截图二）
  // —— Google ——
  "google/gemini-3.5-flash": { speed: 3, intelligence: 0, cost: 2 }, // 197.5 tok/s · II 33（AA 已标弃用）
  "google/gemini-3.8-flash": { cost: 3 },
  "google/gemini-3.6-flash": { cost: 3 },
  "google/gemini-3.1-pro-preview": { cost: 2 },
  // —— Moonshot / Kimi ——
  "moonshotai/kimi-k3": { speed: 1, intelligence: 3, cost: 1 }, // 40.4 tok/s · II 44
  "moonshotai/kimi-k2.7-code": { cost: 3 },
  "moonshotai/kimi-k2.6": { cost: 3 },
  // —— 智谱 GLM ——
  "zai/glm-5.3": { speed: 2, intelligence: 3, cost: 3 }, // 83.0 tok/s · II 45
  "zai/glm-5.3-flash": { cost: 4 },
  "zai/glm-5.2": { cost: 3 },
  // —— Qwen（套餐端点牌价 0/0，不折成本刻度）——
  "qwen-token-plan/qwen3.8-max": { speed: 0, intelligence: 3 }, // 36.0 tok/s · II 45
  // —— MiniMax ——
  "minimax/MiniMax-M3": { cost: 4 },
  "minimax/MiniMax-M2.7": { cost: 4 },
  // —— Mistral ——
  "mistral/mistral-large-2512": { cost: 3 },
  "mistral/mistral-medium-2604": { cost: 2 },
};

/** join：引擎目录选项 × 登记表。未收录的模型原样回退（facts 缺席 = 占位态）。 */
export function withFacts(options: ModelOption[]): ModelOption[] {
  return options.map((o) => {
    const facts = MODEL_BENCH[`${o.provider}/${o.model}`];
    return facts === undefined ? o : { ...o, facts };
  });
}
