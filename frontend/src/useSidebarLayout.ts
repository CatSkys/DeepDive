// 侧栏开合布局（AUD-063 从 store.tsx 拆出）：窄窗口自动收起、手动开合
// 在同断点内优先、跨越断点时重置。只管布局折叠态，不管列表内容与宽度
// （宽度在 prefs.ts 的 sidebarWidth）。
import { useCallback, useEffect, useState } from "react";

export function useSidebarLayout() {
  // 响应式侧栏：窄窗口自动收起，手动开合在同断点内优先；跨越断点时重置。
  const [sidebarOverride, setSidebarOverride] = useState<boolean | null>(null);
  const [narrowViewport, setNarrowViewport] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const onChange = () => {
      setNarrowViewport(mq.matches);
      setSidebarOverride(null);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const sidebarCollapsed = sidebarOverride ?? narrowViewport;
  const toggleSidebar = useCallback(() => {
    setSidebarOverride(!(sidebarOverride ?? narrowViewport));
  }, [sidebarOverride, narrowViewport]);
  return { sidebarCollapsed, toggleSidebar, sidebarOverride, narrowViewport };
}
