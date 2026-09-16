// 应用当前生效明暗。唯一判据是 html[data-theme]（`prefs.ts` 落值、`App.tsx` 首帧兜底），
// 而 `theme.css` 的 :root 默认就是暗色——所以只有显式的 "light" 算亮。
//
// 用 useDarkTheme 而不是在渲染里读一次：把颜色烘进产物的组件（mermaid 图示）必须自己
// 订阅明暗变化，不能赌"父组件会重渲染"——`Markdown` 是 memo 的，主题切换不一定会走到它
// （PITFALLS §8.6 同源纪律：依赖渲染节奏的接线必须自愈，不能只靠 React 生命周期）。
import { useEffect, useState } from "react";

function readDark(): boolean {
  return document.documentElement.dataset.theme !== "light";
}

export function useDarkTheme(): boolean {
  const [dark, setDark] = useState(readDark);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(readDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}
