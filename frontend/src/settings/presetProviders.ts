// 预置提供方：引擎安装目录之外、由前端整条声明的手写路由（写进 llm-pi-ai.providers）。
//
// 为什么单开一张表：引擎侧一条路由只挂一个协议（llm-pi-ai/provider.ts 的 PROTOCOLS，
// 手写路由的模型没有安装目录条目可继承协议），而厂商常在一个端点上同时开好几套协议、
// 模型按协议分流。这类厂商事实既不进引擎目录、也不该让用户手敲端点与协议，所以由本表
// 承载：**一张卡片 = 填一把密钥 = 若干条路由**。
//
// 边界（一事一家）：`vendors.ts` 管**引擎目录内置**提供方的显示名与快捷入口；本表管
// **目录之外**的整条声明。表里的端点与分流规则来自厂商文档，并对着厂商自己的模型清单
// 端点核过（2026-10-14 实测 `api.commandcode.ai/provider/v1/models`：89 条中 78 条只报
// `/chat/completions`〔70 条另带 `/responses`〕、11 条 `claude-*` 只报 `/messages`）。
// 模型能力（收不收图）端点不报,由**模型目录**（`modelFacts.ts` 的收图清单）给出——
// 能力是模型的事实、不是提供商的事实，所以本表一个字都不写（见 `modelVision`）。

/** 一条预置路由：引擎 llm-pi-ai.providers 的一个键。 */
export interface PresetRoute {
  /** 路由 id（= profile 的键，也是密钥 ref 的派生源）。 */
  id: string;
  /** 该路由的 wire 协议（引擎 PROTOCOLS 之一）。 */
  api: string;
  /** 模型菜单与「已保存模型」里的分组名（落盘进 profile.displayName）。 */
  displayName: string;
  /** 发现回来的模型归不归这条路由。同一条模型恰好归一条：谓词互斥且穷尽。 */
  takes: (modelId: string) => boolean;
}

export interface PresetProvider {
  /** 快速添加卡片的键（= 主路由 id）。 */
  id: string;
  /** 卡片上的名字。 */
  displayName: string;
  /** 厂商端点：所有路由共用同一个（协议不同，路径前缀相同）。 */
  baseURL: string;
  /** 路由清单。**第一条同时是「列模型」路由**：发现只问一次端点，用它的协议方言
   *  （同一个 URL，差别在请求头——OpenAI 方言走 Bearer，Anthropic 方言走 x-api-key）。 */
  routes: readonly PresetRoute[];
}

/** Anthropic 家族的模型 id 前缀。厂商文档：Claude 模型只在 `/v1/messages` 上回答。 */
const isClaude = (modelId: string): boolean => modelId.startsWith("claude");

export const PRESET_PROVIDERS: readonly PresetProvider[] = [
  {
    id: "commandcode",
    displayName: "CommandCode",
    baseURL: "https://api.commandcode.ai/provider/v1",
    routes: [
      {
        id: "commandcode",
        api: "openai-completions",
        displayName: "CommandCode",
        takes: (modelId) => !isClaude(modelId),
      },
      {
        id: "commandcode-anthropic",
        api: "anthropic-messages",
        displayName: "CommandCode (Anthropic)",
        takes: isClaude,
      },
    ],
  },
];

/** 卡片键 → 预置提供方；引擎目录内置提供方与自定义路由都返回 undefined。 */
export function presetProviderOf(id: string): PresetProvider | undefined {
  return PRESET_PROVIDERS.find((provider) => provider.id === id);
}

/** 某条**路由** id → 问这个端点要模型清单要带的端点与协议（连通探测按路由问，
 *  而路由可能是预置的第二条——它的 id 不等于卡片键）。表外返回 undefined。 */
export function presetRouteDraft(routeId: string): { baseURL: string; api: string } | undefined {
  for (const provider of PRESET_PROVIDERS) {
    const route = provider.routes.find((candidate) => candidate.id === routeId);
    if (route) return { baseURL: provider.baseURL, api: route.api };
  }
  return undefined;
}

/** 一次发现回来的模型按路由分流；空段不出现在结果里（不建一条没有模型的路由）。 */
export function splitByRoute<T extends { id: string }>(
  provider: PresetProvider,
  models: readonly T[],
): Array<{ route: PresetRoute; models: T[] }> {
  return provider.routes
    .map((route) => ({ route, models: models.filter((model) => route.takes(model.id)) }))
    .filter((bucket) => bucket.models.length > 0);
}

