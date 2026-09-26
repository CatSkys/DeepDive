// 浏览器全屏时的**悬浮输入框**（壳侧透明叠加层里渲染的那一页）。
//
// 为什么是"壳里再叠一个 webview"而不是把 HTML 浮上去：浏览器页是壳的原生 WKWebView，
// **恒画在 SPA 之上**（缩略图那层蒙层看不见就是这个原因），HTML 浮不到它上面。壳在浏览器
// 视图之上再叠一层**透明** WKWebView，那一层里跑的仍是这份 SPA（同一入口、同一个 Composer
// 组件），所以输入能力（@ 引用 / 命令 / 附件 / 听写 / 排队 / 多行卡片）与配色都不会出现
// 第二份实现——这正是用户要的"原样复用会话输入框"。
//
// 这一页只做三件事：透明背景、输入框上方一条「已工作 x」、下面原样的 Composer；并把
// **可点区域**（那颗胶囊）的 rect 报给壳——胶囊之外要透传点击/滚轮给底下的网页。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ContextData } from "../components/UsageMeter";
import { Composer } from "../components/Composer";
import { sendToShell } from "../host";
import { inShell } from "../host";
import { useStore, StoreProvider } from "../store";
import { useT } from "../i18n";
import { turnWorkLabel } from "../session/turnProcess";

/** 「已工作 x」的显示：会话在跑时按引擎给的 lastPromptAt 起算，否则整条不出现。 */
function ElapsedRow({ since }: { since: number | null }) {
  const { tt } = useT();
  const [, tick] = useState(0);
  useEffect(() => {
    if (since === null) return;
    const timer = window.setInterval(() => tick((v) => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, [since]);
  if (since === null) return null;
  return <div className="composer-float-elapsed">{turnWorkLabel(Date.now() - since, tt)}</div>;
}

function ComposerOverlayRoot({ sessionId }: { sessionId: string }) {
  const store = useStore();
  const summary = store.sessions.find((s) => s.sessionId === sessionId) ?? store.allSessions.find((s) => s.sessionId === sessionId);
  const proj = (summary?.projections?.values ?? {}) as {
    tokenUsage?: ContextData["usage"];
    contextPressure?: { projectedTokens?: number; contextWindow?: number };
    contextBreakdown?: ContextData["breakdown"];
    sessionStats?: ContextData["stats"];
    sessionListMetadata?: { lastPromptAt?: number };
  };
  const ctx: ContextData = {
    projected: proj.contextPressure?.projectedTokens,
    window: proj.contextPressure?.contextWindow,
    usage: proj.tokenUsage,
    stats: proj.sessionStats,
    breakdown: proj.contextBreakdown,
  };
  const running = summary?.running === true;
  const since = running ? (proj.sessionListMetadata?.lastPromptAt ?? null) : null;
  const rootRef = useRef<HTMLDivElement>(null);

  // 可点区域 = 这颗胶囊（含上方那条浮条）。壳按它做 hitTest：之外的点透传给网页，
  // 否则透明区会吞掉页面的点击与滚轮。
  useLayoutEffect(() => {
    if (!inShell()) return;
    const push = () => {
      const el = rootRef.current?.querySelector(".composer") as HTMLElement | null;
      const row = rootRef.current;
      const target = el ?? row;
      if (!target) return;
      const r = target.getBoundingClientRect();
      const full = row?.getBoundingClientRect();
      // 以"浮条 + 胶囊"的整体为准（两者都要能点）
      const top = Math.min(r.top, full?.top ?? r.top);
      sendToShell({ type: "composer-pill", rect: { x: r.left, y: top, w: r.width, h: (r.bottom - top) + 8 } });
    };
    push();
    const timer = window.setInterval(push, 300);
    window.addEventListener("resize", push);
    return () => { window.clearInterval(timer); window.removeEventListener("resize", push); };
  }, []);

  return (
    <div className="composer-float" ref={rootRef}>
      <ElapsedRow since={since} />
      <Composer sessionId={sessionId} ctx={ctx} />
    </div>
  );
}

/** 叠加层入口（main.tsx 在 `?composer=<sid>` 时只挂这一支）。 */
export function ComposerOverlayApp({ sessionId }: { sessionId: string }) {
  return (
    <StoreProvider>
      <ComposerOverlayRoot sessionId={sessionId} />
    </StoreProvider>
  );
}
