// 交互组件围栏：模型写的 HTML 进 sandbox iframe 真跑（用户 2026-09-16 拍板：允许执行，
// 但必须严格沙箱）。只给 allow-scripts——没有 allow-same-origin 就是独立不透明源：读不到
// SPA 的 DOM / localStorage / cookie，也没有弹窗、表单提交、顶层跳转能力。
// 组件与正文之间没有通信协议，所以高度固定，不做自适应（要自适应得先定 postMessage 协议，
// 那是另一件事）。
import { t } from "../i18n";
import { RICH_FENCE_MAX_CHARS, WIDGET_FENCE } from "./fences";
import { RichFallback } from "./RichFallback";

export function WidgetBlock({ html }: { html: string }) {
  if (html.length > RICH_FENCE_MAX_CHARS) {
    return (
      <RichFallback lines={html.split("\n")} lang={WIDGET_FENCE} note={t("内容过大，已按源码显示")} />
    );
  }
  return (
    <div className="md-widget">
      <div className="md-widget-head">
        <span>{t("交互组件")}</span>
        <span className="md-widget-hint">{t("沙箱内运行")}</span>
      </div>
      <iframe
        className="md-widget-frame"
        title={t("交互组件")}
        sandbox="allow-scripts"
        srcDoc={html}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
