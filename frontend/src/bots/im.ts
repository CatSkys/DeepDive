/** Bot Channel 的渠道目录与状态文案（纯数据 + 纯函数，不碰 RPC）。
 *
 *  只列插件真的实现了的渠道。参考图里「飞书 中国」「Lark 全球」两行在插件里
 *  是同一个 `feishu` 渠道（Lark 是它的国际域名品牌），不重复列以免两行驱动
 *  同一个机器人。
 */
export const IM_CHANNELS = [
  { id: "weixin", label: "微信" },
  { id: "feishu", label: "飞书" },
  { id: "dingtalk", label: "钉钉" },
  { id: "telegram", label: "Telegram" },
] as const;

export type ImChannelId = (typeof IM_CHANNELS)[number]["id"];

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
