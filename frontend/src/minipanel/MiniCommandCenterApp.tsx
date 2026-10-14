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
    // 开局**自己来要一次脸**：壳的推脸与本页 React 挂载是一场比赛，第一次必输（推的时候桥
    // 还没装），而壳那边"没变就不推"会把同一张脸挡在门外——表现是首次打开卡片整块空白
    // （用户 2026-10-13 报"开机后每次打开都是空的，重新打开就正常"）。面板页的 prefs 当年
    // 是同一型事故，修法同一套。
    sendToShell({ type: "mini-cc-face" });
    // 偏好也**自己来要一次**（与面板页 MiniPanelApp 同一条）：这一页不装 host-ready，而壳的
    // prefs 平时只在 host-ready / get-prefs 推快照——不问这一句，本页 store 的语言与明暗就
    // 永远是默认值，命令中心那张卡会一直停在中文（2026-10-14 用户报"整个浮动面板没有英文"：
    // 面板页跟着走了，只有这张卡不动）。壳侧把这一条转给 AppDelegate 回推，见
    // QuickPanelController 的 get-prefs 分支。
    sendToShell({ type: "get-prefs" });
  }, []);
  // 每次开卡再自己问一次偏好快照：设置那几行（连同它们的 usePrefs 实例）是**随脸重挂**的
  // （face 一归 null 整棵树就卸了），而上面那次 get-prefs 一辈子只发一次——不问这一句，
  // 重开卡片时行上的"当前值"会退回默认（「面板置顶」的标签、「更换进行中动效」的勾选都读它，
  // 2026-10-14）。放在这里而不是 miniCCFace 处理器里：处理器跑在渲染之前，跨进程那一趟回来
  // 时挂载它们的组件还没出现。
  useEffect(() => {
    if (face !== null) sendToShell({ type: "get-prefs" });
  }, [face]);
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
