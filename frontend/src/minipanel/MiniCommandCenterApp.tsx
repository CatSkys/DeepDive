// 命令中心卡的**宿主页**（壳用 `?minicc=1` 打开同一个包的另一块透明 webview，垫在面板页
// 之上、那块原生玻璃之上）。它只干一件事：听壳推来的模式，把卡片画满整个视口。
//
// 为什么要单独一块 webview：那块原生玻璃（真 Liquid Glass）垫在 webview **之下**，玻璃能糊到
// 的只有它下面的东西。卡片内容若与面板页同处一块 webview，面板页的正文会盖在玻璃上——
// 卡片看着就是透明的（2026-10-13 用户报"面板透明啦"）。分成两块之后，玻璃正下方是面板页
// 正文（该被糊掉的正是它），卡片内容在玻璃之上。
//
// 数据走这一页自己的 store（与壳里其它叠加层同源：各自连引擎，互不共享 JS 上下文）；
// 开合状态的事实源在面板页（它才是胶囊按钮的所在），这一页只上报"用户要关"。
import { useEffect, useState } from "react";
import { installHostBridge, sendToShell } from "../host";
import { DialogHost } from "../components/DialogHost";
import { TooltipHost } from "../components/Tooltip";
import { MiniCommandCenter, type MiniOverlayMode } from "./MiniCommandCenter";

export function MiniCommandCenterApp() {
  const [face, setFace] = useState<{ mode: MiniOverlayMode; sessionId: string | null } | null>(null);
  useEffect(() => {
    installHostBridge({
      // 壳每次开卡/换脸都推一条（含会话 id：设置那排行集按脸给，草稿脸与会话脸不同）。
      miniCCFace: ({ mode, sessionId }: { mode?: string; sessionId?: string | null }) => {
        if (mode !== "history" && mode !== "settings") { setFace(null); return; }
        setFace({ mode, sessionId: sessionId ?? null });
      },
      miniCCClosed: () => setFace(null),
    });
  }, []);
  if (face === null) return null;
  return (
    <div className="app mini-panel mini-cc-page">
      <TooltipHost />
      <DialogHost />
      <MiniCommandCenter
        mode={face.mode}
        sessionId={face.sessionId}
        onClose={() => sendToShell({ type: "mini-cc-close" })}
      />
    </div>
  );
}
