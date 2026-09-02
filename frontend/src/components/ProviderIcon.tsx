import { Cpu } from "lucide-react";
import {
  siDeepseek, siAnthropic, siCloudflare, siGooglegemini, siGithubcopilot,
  siOpenrouter, siHuggingface, siMinimax, siMistralai, siNvidia,
  siQwen, siXiaomi, siKimi, siMoonshotai, siOpencode, siVercel,
  type SimpleIcon,
} from "simple-icons";

// 模型提供方品牌图标（Simple Icons 单色矢量，currentColor 随主题反色）。
// 引擎路由 id 与 Simple Icons slug 的映射；覆盖不到的提供方回退通用图标。
// 注：OpenAI/Azure/Bedrock/Groq/xAI 等因商标原因已从 Simple Icons 下架。

const BY_EXACT: Record<string, SimpleIcon> = {
  deepseek: siDeepseek,
  "deepseek-official": siDeepseek,
  anthropic: siAnthropic,
  "cloudflare-ai-gateway": siCloudflare,
  "cloudflare-workers-ai": siCloudflare,
  google: siGooglegemini,
  "google-vertex": siGooglegemini,
  "github-copilot": siGithubcopilot,
  openrouter: siOpenrouter,
  huggingface: siHuggingface,
  minimax: siMinimax,
  "minimax-cn": siMinimax,
  mistral: siMistralai,
  nvidia: siNvidia,
  "qwen-token-plan": siQwen,
  "qwen-token-plan-cn": siQwen,
  xiaomi: siXiaomi,
  "xiaomi-token-plan-ams": siXiaomi,
  "xiaomi-token-plan-cn": siXiaomi,
  "xiaomi-token-plan-sgp": siXiaomi,
  "kimi-coding": siKimi,
  moonshotai: siMoonshotai,
  "moonshotai-cn": siMoonshotai,
  opencode: siOpencode,
  "opencode-go": siOpencode,
  "vercel-ai-gateway": siVercel,
};

/** 提供方 id → 品牌图标；未知提供方回退通用芯片图标。 */
export function providerIconFor(provider: string | undefined): SimpleIcon | undefined {
  if (!provider) return undefined;
  if (BY_EXACT[provider]) return BY_EXACT[provider];
  // 前缀匹配：同一厂商的变体路由（xx-cn / xx-token-plan 等）自动跟随
  const hit = Object.entries(BY_EXACT).find(([id]) => provider.startsWith(`${id}-`) || provider.startsWith(`${id}_`));
  return hit ? hit[1] : undefined;
}

export function ProviderIcon({
  provider,
  size = 15,
  className,
}: {
  provider: string | undefined;
  size?: number;
  className?: string;
}) {
  const icon = providerIconFor(provider);
  if (!icon) return <Cpu size={size} className={className} />;
  // 品牌原色（icon.hex）+ 白色小圆角底：深色 logo（如 Anthropic）在暗色
  // 主题下也能保持可读，亮色主题下与卡片同为白底不突兀。
  return (
    <span className="provider-chip" style={{ width: size + 8, height: size + 8 }}>
      <svg
        role="img"
        aria-label={icon.title}
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill={`#${icon.hex}`}
        className={className}
        style={{ display: "block" }}
      >
        <path d={icon.path} />
      </svg>
    </span>
  );
}
