// 交互组件围栏：模型写的 HTML 进 sandbox iframe 真跑（用户 2026-09-16 拍板：允许执行，
// 但必须严格沙箱）。只给 allow-scripts——没有 allow-same-origin 就是独立不透明源：读不到
// SPA 的 DOM / localStorage / cookie，也没有弹窗、表单提交、顶层跳转能力。
// 桥（widgetBridge.ts）：srcDoc 组装时注入 bootstrap，模型脚本经 window.dshui 拿到
// sendPrompt/openLink 两个受控入口，内容高度周期上报、父侧有界采纳（自适应高度）。
import { useRef, useState } from "react";
import { t } from "../i18n";
import { RICH_FENCE_MAX_CHARS, WIDGET_FENCE } from "./fences";
import { prepareWidgetHtml, useWidgetBridge, widgetSandboxAttr } from "./widgetBridge";
import { RichFallback } from "./RichFallback";

export function WidgetBlock({ html, unclosed, onSend, onWidgetError }: {
  html: string;
  unclosed: boolean;
  /** 沙箱内 sendPrompt 动作的落点（作为用户下一轮发出），与 ui 围栏同一发送路径。 */
  onSend?: (text: string) => void;
  /** 沙箱内运行时错误的回传：返回 true = 已自动告知模型（运行中插队）；
   *  false/undefined = 界面出「告知 AI」按钮，发不发由用户决定。 */
  onWidgetError?: (message: string) => boolean | undefined;
}) {
  // hooks 全在条件返回之前（React 规则）：桥监听在围栏未闭合期间同样活着，
  // 无害——unclosed 分支根本没挂 iframe，event.source 对不上即丢弃。
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // 回调经 ref 转发：监听器只挂一次（useEffect 依赖 handlers 引用稳定），
  // 闭包不能焊死挂载那刻的 onSend。
  const cb = useRef({ onSend, onWidgetError });
  cb.current.onSend = onSend;
  cb.current.onWidgetError = onWidgetError;
  const [errors, setErrors] = useState<string[]>([]);
  const reportedRef = useRef(false);
  const handlers = useRef({
    onSend: (text: string) => cb.current.onSend?.(text),
    onWidgetError: (message: string) => {
      setErrors((prev) => (prev.includes(message) || prev.length >= 3 ? prev : [...prev, message]));
      // 首条错误自动回传：运行中插队告知模型；空闲由界面出「告知 AI」按钮
      if (!reportedRef.current && cb.current.onWidgetError?.(message) === true) {
        reportedRef.current = true;
      }
    },
  }).current;
  const height = useWidgetBridge(iframeRef, handlers);
  // Agent 自声明权限（dsh-perms meta）→ 沙箱旗标；allow-same-origin 结构性剥除
  const sandbox = widgetSandboxAttr(html);
  // 围栏还没写完不挂 iframe：半截 HTML 跑起来等于让模型边写边执行，且会反复重挂
  if (unclosed) return <p className="md-rich-pending">{t("正在读取组件…")}</p>;
  if (html.length > RICH_FENCE_MAX_CHARS) {
    return (
      <RichFallback lines={html.split("\n")} lang={WIDGET_FENCE} note={t("内容过大，已按源码显示")} />
    );
  }
  return (
    <div className="md-widget">
      <iframe
        ref={iframeRef}
        className="md-widget-frame"
        title={t("交互组件")}
        sandbox={sandbox}
        srcDoc={prepareWidgetHtml(html, window.location.origin)}
        style={height !== null ? { height } : undefined}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
      {errors.length > 0 && (
        <div className="md-widget-errors">
          <span className="md-widget-error-label">{t("组件运行报错")}{errors.length > 1 ? ` ×${errors.length}` : ""}</span>
          <span className="md-widget-error-msg">{errors[0]}</span>
          {!reportedRef.current && (
            <button type="button" className="md-ui-btn" onClick={() => onSend?.(errors.join("\n"))}>
              {t("告知 AI")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
