// Widget 沙箱的宿主侧运行时：媒体 URL 改写 + 通信桥。
//
// 媒体：srcdoc iframe 是不透明源，模型写的 `/api/file?path=<绝对路径>` 补上
// SPA origin 才可达（桌面桥/移动远程面同 origin；认证由桥在转发侧注入，
// 引擎 cookie 是 SameSite=Strict，沙箱页带不动它）。
//
// 桥（对齐 OpenIntelligentUI 的最小受控回调面）：只暴露 sendPrompt 与
// openLink 两个动作 + 有界 resize。iframe 里模型脚本经注入的 bootstrap 以
// postMessage 上行，父侧**逐条校验**后才执行——event.source 必须是本 iframe、
// sendPrompt 文本限长、openLink 仅 https、resize 有界。契约全文见
// docs/DUI-SPEC.md；本文件是桥的唯一实现。
import { useEffect, useState, type RefObject } from "react";
import { openExternalUrl } from "../host";

/** 注入沙箱的 bootstrap（我们的代码，非模型产出）：暴露 window.dshui 两个
 *  受控入口 + 周期上报内容高度。postMessage 目标一律 "*"——沙箱页本就是
 *  不透明源，父侧按 event.source 而不是 origin 认身份。 */
const BRIDGE_SCRIPT = `<script>(function(){
"use strict";
function post(m){ try { parent.postMessage(m, "*"); } catch (e) {} }
window.dshui = {
  sendPrompt: function(text){ if (typeof text === "string" && text.length > 0 && text.length <= 2000) post({ dsh: "sendPrompt", text: text }); },
  openLink: function(url){ if (typeof url === "string") post({ dsh: "openLink", url: url }); }
};
var last = -1;
function tick(){
  var h = Math.max(
    document.documentElement ? document.documentElement.scrollHeight : 0,
    document.body ? document.body.scrollHeight : 0
  );
  if (h > 0 && h !== last) { last = h; post({ dsh: "resize", height: h }); }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tick);
else tick();
setInterval(tick, 400);
})();</script>`;

const HEAD_RE = /<head[^>]*>/i;
const HTML_RE = /<html[^>]*>/i;

/** 媒体 URL 改写：只认以 `/api/` 开头的引用；远程 https 与 data: 原样保留。
 *  DOMParser 解析不执行脚本；无匹配时原串返回（保持片段形态）。 */
export function resolveWidgetUrls(html: string, origin: string): string {
  if (!html.includes("/api/")) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  let changed = false;
  for (const el of doc.querySelectorAll("[src],[href],[poster]")) {
    for (const attr of ["src", "href", "poster"] as const) {
      const value = el.getAttribute(attr);
      if (value !== null && value.startsWith("/api/")) {
        el.setAttribute(attr, `${origin}${value}`);
        changed = true;
      }
    }
  }
  return changed ? doc.documentElement.outerHTML : html;
}

/** 组装 srcDoc：媒体改写 + 桥注入。注入位置确定（head/html 后、否则串首），
 *  同一输入永远得到同一输出——srcDoc 引用稳定，iframe 不会因重渲重载。 */
export function prepareWidgetHtml(html: string, origin: string): string {
  const resolved = resolveWidgetUrls(html, origin);
  const head = HEAD_RE.exec(resolved);
  if (head !== null) {
    const at = head.index + head[0].length;
    return resolved.slice(0, at) + BRIDGE_SCRIPT + resolved.slice(at);
  }
  const htmlTag = HTML_RE.exec(resolved);
  if (htmlTag !== null) {
    const at = htmlTag.index + htmlTag[0].length;
    return resolved.slice(0, at) + BRIDGE_SCRIPT + resolved.slice(at);
  }
  return BRIDGE_SCRIPT + resolved;
}

// resize 上下界：低于 40 的上报是 bootstrap 异常或页面塌缩，高于 4000 的
// 会把消息流撑爆——都按异常丢弃，保持默认高度。
const MIN_HEIGHT = 40;
const MAX_HEIGHT = 4000;
const MAX_PROMPT = 2000;

export interface WidgetBridgeHandlers {
  onSend?: (text: string) => void;
}

/** 父侧监听：逐条校验 iframe 上行消息。返回当前上报高度（无上报为 null，
 *  调用方保留默认高度）。 */
export function useWidgetBridge(iframeRef: RefObject<HTMLIFrameElement | null>, handlers: WidgetBridgeHandlers): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as { dsh?: string; text?: unknown; url?: unknown; height?: unknown } | null;
      if (typeof data !== "object" || data === null) return;
      if (data.dsh === "sendPrompt") {
        if (typeof data.text === "string" && data.text.length > 0 && data.text.length <= MAX_PROMPT) {
          handlers.onSend?.(data.text);
        }
      } else if (data.dsh === "openLink") {
        // 只放行 https（外链出口与 Markdown 链接同一条 openExternalUrl）；
        // javascript:/file:/data: 等一律丢弃，这是显式决定不是遗漏。
        if (typeof data.url === "string" && data.url.startsWith("https://")) {
          openExternalUrl(data.url);
        }
      } else if (data.dsh === "resize") {
        if (typeof data.height === "number" && Number.isFinite(data.height)) {
          setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(data.height))));
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [iframeRef, handlers]);
  return height;
}
