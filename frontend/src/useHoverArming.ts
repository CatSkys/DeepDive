import { useEffect } from "react";
import { disarmHoverArming } from "./hoverArming";

// 换视图时的悬停复位（React 侧接线）。三样值是"视图身份"，任一个变了都说明内容整个
// 换了一批：指针可能正停在原处，新列表里那一行一亮就成了"指针选的"。
// 机制、容差与其余复位时机（滚动、⌘K 命令面板）见 hoverArming.ts。
export function useHoverArmingDisarm(view: {
  session: string | null;
  settings: boolean;
  workspace: string | null;
}): void {
  const { session, settings, workspace } = view;
  useEffect(() => {
    disarmHoverArming();
  }, [session, settings, workspace]);
}
