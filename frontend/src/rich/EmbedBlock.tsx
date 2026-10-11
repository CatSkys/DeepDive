// 外链直嵌围栏（` ```embed <https URL> `）：storage/cookie 依赖的跨源页面
// （B站播放器等）在 srcdoc 沙箱里必死（不透明源，见 DUI-SPEC 已知边界）——
// 这类内容走独立 URL iframe：跨源文档保留**其自身 origin**，storage/cookie
// 是它自己的（WebKit 分区），结构上碰不到宿主；不是 srcdoc，无同源逃逸面。
// 加载策略（用户 2026-10-11 定稿）：**直接加载**，无点击闸——隔离靠结构性
// 的跨源边界，不靠人工确认。
import { memo } from "react";
import { t } from "../i18n";
import { RichFallback } from "./RichFallback";

function httpsUrlOf(body: string): string | null {
  const raw = body.trim();
  if (/\s/.test(raw)) return null; // 一条围栏一个 URL，多余的当残渣退回源码
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.host !== "" ? u.toString() : null;
  } catch {
    return null;
  }
}

export const EmbedBlock = memo(function EmbedBlock({ url, unclosed }: {
  url: string;
  unclosed: boolean;
}) {
  if (unclosed) return <p className="md-rich-pending">{t("正在读取嵌入…")}</p>;
  const httpsUrl = httpsUrlOf(url);
  if (httpsUrl === null) {
    return <RichFallback lines={url.split("\n")} lang="embed" note={t("仅支持 https 链接，已按源码显示")} />;
  }
  return (
    <div className="md-embed">
      <iframe
        className="md-embed-frame"
        title={new URL(httpsUrl).host}
        src={httpsUrl}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerPolicy="no-referrer"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      />
    </div>
  );
});
