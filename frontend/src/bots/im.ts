/** Bot Channel 的渠道目录与状态文案（纯数据 + 纯函数，不碰 RPC）。
 *
 *  列的是插件真的挂了路由的渠道（12 个，全部经 `/api/dsh-im/<渠道>` 实测 ok）。
 *  参考图里「飞书 中国」「Lark 全球」两行在插件里是同一个 `feishu` 渠道
 *  （Lark 是它的国际域名品牌），所以只有一行，不造两行驱动同一个机器人。
 */
export const IM_CHANNELS = [
  { id: "weixin", label: "微信" },
  { id: "feishu", label: "飞书" },
  { id: "dingtalk", label: "钉钉" },
  { id: "wecom", label: "企业微信" },
  // 企业微信应用是同一个品牌的另一种接入方式，标记复用 wecom
  { id: "wecom-app", label: "企业微信应用", logo: "wecom" },
  { id: "qq", label: "QQ" },
  { id: "slack", label: "Slack" },
  { id: "telegram", label: "Telegram" },
  { id: "discord", label: "Discord" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "imessage", label: "iMessage" },
  { id: "office", label: "AI Office" },
] as const;

export type ImChannelId = (typeof IM_CHANNELS)[number]["id"];

/** 渠道 → 品牌标记的键（默认与渠道 id 同名）。 */
export function channelLogoKey(channel: string): string {
  const entry = IM_CHANNELS.find((c) => c.id === channel) as { logo?: string } | undefined;
  return entry?.logo ?? channel;
}

export function channelLabel(id: string): string {
  return IM_CHANNELS.find((c) => c.id === id)?.label ?? id;
}

/** 机器人状态 → 展示档位（壳/插件给的是 connected|connecting|offline|error）。 */
export function botStateTone(state: string): "on" | "warn" | "off" {
  if (state === "connected") return "on";
  if (state === "connecting") return "warn";
  return "off";
}

/** 一次配对尝试的状态 → 是否还在进行中（决定要不要继续轮询）。 */
export function provisionPending(status: string): boolean {
  return status === "starting" || status === "pending" || status === "scanned"
    || status === "needs_verification" || status === "connecting";
}
