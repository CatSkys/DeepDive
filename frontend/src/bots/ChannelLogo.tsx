import { CHANNEL_LOGOS } from "./channelLogos";

// 渠道品牌标记：数据来自随包的 @xmanrui/dsh-im（见 channelLogos.ts 出处），
// 单色渲染（currentColor）与全站黑白体系一致；插件里没有的渠道回退首字母
// monogram——不出现"所有渠道长一样"的通用图标。

export function ChannelLogo({ channel, size = 16 }: { channel: string; size?: number }) {
  const logo = CHANNEL_LOGOS[channel];
  if (!logo) {
    return (
      <span className="provider-monogram" style={{ width: size + 6, height: size + 6, fontSize: Math.max(9, size - 5) }} aria-hidden="true">
        {channel.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <svg
      viewBox={logo.viewBox}
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      style={{ display: "block", flex: "none" }}
    >
      {logo.paths.map((d) => <path key={d.slice(0, 24)} d={d} />)}
    </svg>
  );
}
