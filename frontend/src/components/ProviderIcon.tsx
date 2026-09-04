import { siXiaomi, type SimpleIcon } from "simple-icons";
// lobe 单色 SVG 资产（覆盖全部主流 AI 提供方）
import alibabaSvgRaw from "@lobehub/icons-static-svg/icons/alibaba.svg?raw";
import anthropicSvgRaw from "@lobehub/icons-static-svg/icons/anthropic.svg?raw";
import azureSvgRaw from "@lobehub/icons-static-svg/icons/azure.svg?raw";
import bedrockSvgRaw from "@lobehub/icons-static-svg/icons/bedrock.svg?raw";
import cerebrasSvgRaw from "@lobehub/icons-static-svg/icons/cerebras.svg?raw";
import cloudflareSvgRaw from "@lobehub/icons-static-svg/icons/cloudflare.svg?raw";
import deepseekSvgRaw from "@lobehub/icons-static-svg/icons/deepseek.svg?raw";
import fireworksSvgRaw from "@lobehub/icons-static-svg/icons/fireworks.svg?raw";
import githubSvgRaw from "@lobehub/icons-static-svg/icons/github.svg?raw";
import googleSvgRaw from "@lobehub/icons-static-svg/icons/google.svg?raw";
import groqSvgRaw from "@lobehub/icons-static-svg/icons/groq.svg?raw";
import huggingfaceSvgRaw from "@lobehub/icons-static-svg/icons/huggingface.svg?raw";
import kimiSvgRaw from "@lobehub/icons-static-svg/icons/kimi.svg?raw";
import minimaxSvgRaw from "@lobehub/icons-static-svg/icons/minimax.svg?raw";
import mistralSvgRaw from "@lobehub/icons-static-svg/icons/mistral.svg?raw";
import moonshotSvgRaw from "@lobehub/icons-static-svg/icons/moonshot.svg?raw";
import nvidiaSvgRaw from "@lobehub/icons-static-svg/icons/nvidia.svg?raw";
import openaiSvgRaw from "@lobehub/icons-static-svg/icons/openai.svg?raw";
import opencodeSvgRaw from "@lobehub/icons-static-svg/icons/opencode.svg?raw";
import openrouterSvgRaw from "@lobehub/icons-static-svg/icons/openrouter.svg?raw";
import qwenSvgRaw from "@lobehub/icons-static-svg/icons/qwen.svg?raw";
import togetherSvgRaw from "@lobehub/icons-static-svg/icons/together.svg?raw";
import vercelSvgRaw from "@lobehub/icons-static-svg/icons/vercel.svg?raw";
import xaiSvgRaw from "@lobehub/icons-static-svg/icons/xai.svg?raw";
import zaiSvgRaw from "@lobehub/icons-static-svg/icons/zai.svg?raw";

// 模型提供方图标：@lobehub/icons-static-svg 单色 SVG + CSS mask 反白
// （currentColor 随主题，亮暗通用）；lobe 缺失的（小米）回退 Simple Icons
// 单色；再缺则首字母 monogram——三种来源合计覆盖全部提供方，无裸图标。

const LOBE: Record<string, string> = {
  "deepseek-official": deepseekSvgRaw,
  deepseek: deepseekSvgRaw,
  anthropic: anthropicSvgRaw,
  openai: openaiSvgRaw,
  "openai-codex": openaiSvgRaw,
  "azure-openai-responses": azureSvgRaw,
  "amazon-bedrock": bedrockSvgRaw,
  groq: groqSvgRaw,
  cerebras: cerebrasSvgRaw,
  together: togetherSvgRaw,
  fireworks: fireworksSvgRaw,
  xai: xaiSvgRaw,
  zai: zaiSvgRaw,
  "zai-coding-cn": zaiSvgRaw,
  moonshotai: moonshotSvgRaw,
  "moonshotai-cn": moonshotSvgRaw,
  "kimi-coding": kimiSvgRaw,
  "qwen-token-plan": qwenSvgRaw,
  "qwen-token-plan-cn": qwenSvgRaw,
  minimax: minimaxSvgRaw,
  "minimax-cn": minimaxSvgRaw,
  mistral: mistralSvgRaw,
  nvidia: nvidiaSvgRaw,
  huggingface: huggingfaceSvgRaw,
  openrouter: openrouterSvgRaw,
  "vercel-ai-gateway": vercelSvgRaw,
  "cloudflare-ai-gateway": cloudflareSvgRaw,
  "cloudflare-workers-ai": cloudflareSvgRaw,
  opencode: opencodeSvgRaw,
  "opencode-go": opencodeSvgRaw,
  google: googleSvgRaw,
  "google-vertex": googleSvgRaw,
  "github-copilot": githubSvgRaw,
  "ant-ling": alibabaSvgRaw,
};

const SI: Record<string, SimpleIcon> = {
  xiaomi: siXiaomi,
  "xiaomi-token-plan-ams": siXiaomi,
  "xiaomi-token-plan-cn": siXiaomi,
  "xiaomi-token-plan-sgp": siXiaomi,
};

const lobeRawFor = (provider: string | undefined): string | undefined =>
  provider ? LOBE[provider] ?? Object.entries(LOBE).find(([id]) => provider.startsWith(`${id}-`) || provider.startsWith(`${id}_`))?.[1] : undefined;

const siFor = (provider: string | undefined): SimpleIcon | undefined => {
  if (!provider) return undefined;
  if (SI[provider]) return SI[provider];
  const hit = Object.entries(SI).find(([id]) => provider.startsWith(`${id}-`) || provider.startsWith(`${id}_`));
  return hit ? hit[1] : undefined;
};

export function ProviderIcon({
  provider,
  size = 15,
  className,
}: {
  provider: string | undefined;
  size?: number;
  className?: string;
}) {
  const lobe = lobeRawFor(provider);
  if (lobe) {
    return (
      <span
        className="provider-logo"
        style={{ width: size + 2, height: size + 2 }}
        dangerouslySetInnerHTML={{ __html: lobe }}
      />
    );
  }
  const si = siFor(provider);
  if (si) {
    return (
      <svg
        role="img"
        aria-label={si.title}
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="currentColor"
        className={className}
        style={{ display: "block" }}
      >
        <path d={si.path} />
      </svg>
    );
  }
  // 首字母 monogram：兜底（单色、随主题）
  const letter = (provider ?? "?").replace(/[^a-zA-Z]/g, "").charAt(0).toUpperCase() || "?";
  return (
    <span
      className="provider-monogram"
      style={{ width: size + 6, height: size + 6, fontSize: Math.max(9, size - 5) }}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}
