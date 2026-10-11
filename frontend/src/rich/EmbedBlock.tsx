// 外链直嵌围栏（` ```embed <https URL> `）：storage/cookie 依赖的跨源页面
// （B站播放器等）在 srcdoc 沙箱里必死（不透明源，见 DUI-SPEC 已知边界）——
// 这类内容走独立 URL iframe：跨源文档保留**其自身 origin**，storage/cookie
// 是它自己的（WebKit 分区），结构上碰不到宿主；不是 srcdoc，无同源逃逸面。
//
// 安全闸门是**用户的点击**：默认只出封面卡（host + URL），点击才加载——
// 模型不能自动内嵌任意站点。URL 只收 https；沙箱旗标对跨源页面只是恢复
// 其自身能力（allow-same-origin 让它拿回自己的 origin，不是我们的）。
import { memo, useState } from "react";
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
  const [loaded, setLoaded] = useState(false);
  if (unclosed) return <p className="md-rich-pending">{t("正在读取嵌入…")}</p>;
  const httpsUrl = httpsUrlOf(url);
  if (httpsUrl === null) {
    return <RichFallback lines={url.split("\n")} lang="embed" note={t("仅支持 https 链接，已按源码显示")} />;
  }
  const host = new URL(httpsUrl).host;
  if (!loaded) {
    return (
      <div className="md-embed">
        <div className="md-embed-cover">
          <span className="md-embed-host">{host}</span>
          <span className="md-embed-url" title={httpsUrl}>{httpsUrl}</span>
          <span className="md-embed-note">{t("外部内容，点击后在其自身源内运行")}</span>
          <button type="button" className="md-embed-load" onClick={() => setLoaded(true)}>
            {t("加载外部内容")}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="md-embed">
      <iframe
        className="md-embed-frame"
        title={host}
        src={httpsUrl}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerPolicy="no-referrer"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      />
    </div>
  );
});
