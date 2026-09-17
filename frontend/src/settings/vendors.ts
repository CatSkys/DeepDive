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

/** provider id → 正式名。键必须逐字等于引擎目录里的 provider id。 */
export const VENDOR_NAMES: Record<string, VendorName> = {
  "deepseek-official": { zh: "DeepSeek", en: "DeepSeek" },
  deepseek: { zh: "DeepSeek", en: "DeepSeek" },
  moonshotai: { zh: "Kimi / Moonshot", en: "Kimi / Moonshot" },
  "moonshotai-cn": { zh: "Kimi / Moonshot", en: "Kimi / Moonshot" },
  "kimi-coding": { zh: "Kimi Token Plan", en: "Kimi Token Plan" },
  zai: { zh: "智谱 GLM Token Plan", en: "Zhipu GLM Token Plan" },
  "zai-coding-cn": { zh: "智谱 GLM Token Plan（国内）", en: "Zhipu GLM Token Plan (China)" },
  xiaomi: { zh: "小米 MiMo API", en: "Xiaomi MiMo API" },
  "xiaomi-token-plan-ams": { zh: "小米 MiMo Token Plan（阿姆斯特丹）", en: "Xiaomi MiMo Token Plan (Amsterdam)" },
  "xiaomi-token-plan-cn": { zh: "小米 MiMo Token Plan（中国）", en: "Xiaomi MiMo Token Plan (China)" },
  "xiaomi-token-plan-sgp": { zh: "小米 MiMo Token Plan（新加坡）", en: "Xiaomi MiMo Token Plan (Singapore)" },
  minimax: { zh: "MiniMax", en: "MiniMax" },
  "minimax-cn": { zh: "MiniMax（国内）", en: "MiniMax (China)" },
  openai: { zh: "OpenAI", en: "OpenAI" },
  "openai-codex": { zh: "OpenAI Codex", en: "OpenAI Codex" },
  anthropic: { zh: "Anthropic", en: "Anthropic" },
  xai: { zh: "xAI", en: "xAI" },
  opencode: { zh: "OpenCode", en: "OpenCode" },
  "opencode-go": { zh: "OpenCode Go", en: "OpenCode Go" },
  "qwen-token-plan": { zh: "千问 Qwen Token Plan（新加坡）", en: "Qwen Token Plan (Singapore)" },
  "qwen-token-plan-cn": { zh: "千问 Qwen Token Plan（北京）", en: "Qwen Token Plan (Beijing)" },
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

/** 「快速添加」的厂商（按主流程度排；点一个即带出该提供方的填 Key 流程）。 */
export const QUICK_ADD_PROVIDERS: readonly string[] = [
  "deepseek-official",
  "moonshotai-cn",
  "zai",
  "xiaomi-token-plan-cn",
  "minimax",
  "openai",
  "anthropic",
  "xai",
  "opencode",
  "qwen-token-plan-cn",
];


/** 用户点名不要列出的提供方（小米另外两个区域的同一 Token Plan）。
    已经配置过的不在此列 —— 否则配好的那条会在列表里消失，连删都删不掉。 */
export const HIDDEN_PROVIDERS: readonly string[] = [
  "xiaomi-token-plan-ams",
  "xiaomi-token-plan-sgp",
];

/** 目录给的 displayName 就是 provider id 本身（全小写）；能认的换成人读的正式名。
    未收录的原样回退 —— 不认识的厂商编不出名字。 */
export function providerLabel(provider: string, fallback: string): string {
  const known = VENDOR_NAMES[provider];
  return known ? tt(known.zh, known.en) : fallback;
}
