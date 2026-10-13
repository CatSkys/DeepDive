// 壳的 Tooltip 窗口那一页（`?tooltip=1`）：只渲染一条注释本体。位置、尺寸、材质全归壳
// ——窗口按这一页报上来的实测尺寸贴着锚点摆，底是系统液态玻璃
// （`WindowGlassView(surface: .floating)`，与命令中心卡、右上胶囊同一档）。所以这一页里
// `.tip` 不画自己的底/模糊/描边/投影（见 theme.css 的 `html[data-tooltip]` 作用域）；
// 页内那份（浏览器调试）照旧自带材质。
//
// 收 `tooltipContent {seq, text, caps}` 渲染，量完回报 `tooltip-size {seq, w, h, radius}`：
// 壳拿到尺寸才摆窗口，所以回报必须带上同一个 seq（连着换两次内容时，旧尺寸不能顶替新内容）。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TooltipChip } from "../components/Tooltip";
import { installHostBridge, sendRects } from "../host";

interface TipContent {
  seq: number;
  text: string;
  caps: string[];
}

export function TooltipApp() {
  const [content, setContent] = useState<TipContent | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // 明暗的本地基准（prefs.ts 同一条，丢不掉）：壳把窗口外观设成应用的主题，WebKit 因此
  // 把它报成本地媒体查询——这一页没有 store，自己把 `data-theme` 写上，浅色下材质层的
  // tint（`--composer-bg` 的浅色档在 `:root[data-theme="light"]` 里）才跟着换。
  useEffect(() => {
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = scheme.matches ? "dark" : "light";
    };
    apply();
    scheme.addEventListener("change", apply);
    return () => scheme.removeEventListener("change", apply);
  }, []);

  // 桥只装这一条（installHostBridge 幂等；这一页没有别的消费者）
  useEffect(
    () =>
      installHostBridge({
        tooltipContent: (payload) => setContent(payload),
      }),
    [],
  );

  // 渲染后量一次报给壳：窗口按这个尺寸摆（圆角与材质都在 CSS 上，壳不需要）。
  const report = useCallback(() => {
    if (!content || !boxRef.current) return;
    const box = boxRef.current.getBoundingClientRect();
    sendRects({ type: "tooltip-size", seq: content.seq, w: box.width, h: box.height });
  }, [content]);
  useLayoutEffect(report, [report]);

  return (
    <div className="tip-page">{content && <TooltipChip text={content.text} caps={content.caps} boxRef={boxRef} />}</div>
  );
}
