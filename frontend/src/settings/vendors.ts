// 提供方的显示名（正式名）与「快速添加」的厂商清单。
//
// 为什么需要这张表：引擎 `llm/listConfigurableProviders` 的 `displayName` 就是 provider id
// 本身（`moonshotai`、`zai`、`xiaomi-token-plan-cn` …），平铺出来满屏小写 id，用户认不出
// 哪家是哪家。这里给已知提供方一个人读的名字（厂商官方写法），**未收录的原样回退**——
// 不认识的就不猜。

import { tt } from "../i18n";

export interface VendorName {
  zh: string;
  en: string;
}

/** provider id → 正式名。键必须逐字等于引擎目录里的 provider id。
    同一家在多个区域有端点时，首选的那个（套餐端点、国内端点）只写产品名，
    其余端点才带区域后缀——后缀是用来区分的，不是用来描述首选的。 */
export const VENDOR_NAMES: Record<string, VendorName> = {
  "deepseek-official": { zh: "DeepSeek", en: "DeepSeek" },
  deepseek: { zh: "DeepSeek", en: "DeepSeek" },
  moonshotai: { zh: "Kimi / Moonshot（国际）", en: "Kimi / Moonshot (International)" },
  "moonshotai-cn": { zh: "Kimi / Moonshot", en: "Kimi / Moonshot" },
  "kimi-coding": { zh: "Kimi Token Plan", en: "Kimi Token Plan" },
  zai: { zh: "智谱 GLM Token Plan（国际）", en: "Zhipu GLM Token Plan (International)" },
  "zai-coding-cn": { zh: "智谱 GLM Token Plan", en: "Zhipu GLM Token Plan" },
  xiaomi: { zh: "小米 MiMo API", en: "Xiaomi MiMo API" },
  "xiaomi-token-plan-ams": { zh: "小米 MiMo Token Plan（阿姆斯特丹）", en: "Xiaomi MiMo Token Plan (Amsterdam)" },
  "xiaomi-token-plan-cn": { zh: "小米 MiMo Token Plan", en: "Xiaomi MiMo Token Plan" },
  "xiaomi-token-plan-sgp": { zh: "小米 MiMo Token Plan（新加坡）", en: "Xiaomi MiMo Token Plan (Singapore)" },
  minimax: { zh: "MiniMax（国际）", en: "MiniMax (International)" },
  "minimax-cn": { zh: "MiniMax", en: "MiniMax" },
  openai: { zh: "OpenAI", en: "OpenAI" },
  "openai-codex": { zh: "OpenAI Codex", en: "OpenAI Codex" },
  anthropic: { zh: "Anthropic", en: "Anthropic" },
  xai: { zh: "xAI", en: "xAI" },
  opencode: { zh: "OpenCode", en: "OpenCode" },
  "opencode-go": { zh: "OpenCode Go", en: "OpenCode Go" },
  "qwen-token-plan": { zh: "千问 Qwen Token Plan（新加坡）", en: "Qwen Token Plan (Singapore)" },
  "qwen-token-plan-cn": { zh: "千问 Qwen Token Plan", en: "Qwen Token Plan" },
  "qwen-token-plan-individual": { zh: "千问 Qwen Token Plan（个人版）", en: "Qwen Token Plan (Individual)" },
  google: { zh: "Google Gemini", en: "Google Gemini" },
  "google-vertex": { zh: "Google Vertex AI", en: "Google Vertex AI" },
  "amazon-bedrock": { zh: "Amazon Bedrock", en: "Amazon Bedrock" },
  "azure-openai-responses": { zh: "Azure OpenAI", en: "Azure OpenAI" },
  "github-copilot": { zh: "GitHub Copilot", en: "GitHub Copilot" },
  openrouter: { zh: "OpenRouter", en: "OpenRouter" },
  groq: { zh: "Groq", en: "Groq" },
  mistral: { zh: "Mistral", en: "Mistral" },
  cerebras: { zh: "Cerebras", en: "Cerebras" },
  fireworks: { zh: "Fireworks AI", en: "Fireworks AI" },
  together: { zh: "Together AI", en: "Together AI" },
  baseten: { zh: "Baseten", en: "Baseten" },
  nvidia: { zh: "NVIDIA", en: "NVIDIA" },
  huggingface: { zh: "Hugging Face", en: "Hugging Face" },
  "cloudflare-ai-gateway": { zh: "Cloudflare AI Gateway", en: "Cloudflare AI Gateway" },
  "cloudflare-workers-ai": { zh: "Cloudflare Workers AI", en: "Cloudflare Workers AI" },
  "vercel-ai-gateway": { zh: "Vercel AI Gateway", en: "Vercel AI Gateway" },
};

/** 「快速添加」的厂商：一家一张卡片，有 Token Plan 就指套餐端点、否则指国内端点；
    顺序＝先国内后海外。名字直接取 {@link VENDOR_NAMES}（首选端点不带地区后缀），
    卡片不带地区信息——同一家的其它区域端点只在弹窗的提供方下拉里出现。
    OpenCode 指套餐端点 `opencode-go` 而非 `opencode`：后者目录上百条（用户定稿）。 */
export const QUICK_ADD_PROVIDERS: readonly string[] = [
  "deepseek-official",
  "kimi-coding",
  "zai-coding-cn",
  "xiaomi-token-plan-cn",
  "qwen-token-plan-cn",
  "minimax-cn",
  "openai",
  "anthropic",
  "xai",
  "opencode-go",
];


/** 用户点名不要列出的提供方（小米另外两个区域的同一 Token Plan）。
    已经配置过的不在此列 —— 否则配好的那条会在列表里消失，连删都删不掉。 */
export const HIDDEN_PROVIDERS: readonly string[] = [
  "xiaomi-token-plan-ams",
  "xiaomi-token-plan-sgp",
];

/** 引导卡的提供方行里不出现的提供方：OpenCode 的入口收敛到套餐端点 `opencode-go`
    （`opencode` 目录上百条，用户定稿）。只在**挑选入口**生效——设置页「已保存模型」
    照旧列它，那里是配置管理面，藏掉会让已配好的密钥没法管。 */
export const PICKER_EXCLUDED_PROVIDERS: readonly string[] = ["opencode"];

/** 要求每个请求自报会话身份的端点：provider id → 头名。
    OpenCode Go/Zen 实测：缺这个头直接 `400 MissingSessionID`，官方文档也把
    「不发它」列为客户端接入缺陷。值是安装期生成一次、此后原样带过的稳定 id
    ——引擎的 profile 头是 per-route 静态值，给不了「每个会话一个」；引擎带的
    pi-ai 不填这个头，所以只能由路由层补。 */
export const PROVIDER_SESSION_HEADERS: Record<string, string> = {
  opencode: "x-opencode-session",
  "opencode-go": "x-opencode-session",
};

/** 目录给的 displayName 就是 provider id 本身（全小写）；能认的换成人读的正式名。
    未收录的原样回退 —— 不认识的厂商编不出名字。 */
export function providerLabel(provider: string, fallback: string): string {
  const known = VENDOR_NAMES[provider];
  return known ? tt(known.zh, known.en) : fallback;
}
