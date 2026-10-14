import { siXiaomi, type SimpleIcon } from "simple-icons";
// 单色 SVG 资产：lobe 覆盖绝大多数提供方；lobe 没有的（commandcode）用随仓自持的官方符号
import commandcodeSvgRaw from "../assets/commandcode.svg?raw";
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

// 模型提供方图标：单色 SVG + 反白（currentColor 随主题，亮暗通用）。三类来源合计
// 覆盖全部提供方，无裸图标：① lobe 资产（多数）；② 随仓自持的官方符号（lobe 没有
// 的那家，如 commandcode）；③ Simple Icons（小米）；④ 首字母 monogram 兜底。

/** provider id → 内联单色 SVG（lobe 资产与自持符号同住一处：查找只此一张表）。 */
const MARKS: Record<string, string> = {
  commandcode: commandcodeSvgRaw,
  "commandcode-anthropic": commandcodeSvgRaw,
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

const markFor = (provider: string | undefined): string | undefined =>
  provider ? MARKS[provider] ?? Object.entries(MARKS).find(([id]) => provider.startsWith(`${id}-`) || provider.startsWith(`${id}_`))?.[1] : undefined;

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
  const lobe = markFor(provider);
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
