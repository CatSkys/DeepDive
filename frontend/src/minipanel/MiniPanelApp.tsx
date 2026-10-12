// 迷你面板页：壳 QuickPanelWindow 载同一 SPA 的 #/mini 分支——无侧栏的简洁会话面，
// 52pt 拖拽顶条 + 快捷会话内容/草稿 + 输入区（窗体形制见 QuickPanelController）。
// 数据与导航全走共享 store：openQuickSession 切快捷空间，草稿键与建会话落点才对；
// 会话流、审批卡、排队/后台任务都复用 SessionView 的既有链，不开第二份。
// 设置页/引导/命令面板/侧栏是主窗的面，这里不开。壳命令 openQuickSession /
// runQuickCommand / quickPanelFocus 只推给迷你面板页，桥在这里装（主窗桥不装）。

import { useEffect, useRef, useState } from "react";
import { installHostBridge, sendToShell } from "../host";
import { DD_EVENTS, dispatchAppEvent } from "../events";
import { usePrefs } from "../prefs";
import { useStore } from "../store";
import { DialogHost } from "../components/DialogHost";
import { TooltipHost } from "../components/Tooltip";
import { SessionView } from "../components/SessionView";
import { MiniDraft } from "./MiniDraft";

export function MiniPanelApp() {
  const store = useStore();
  const { quickWorkspacePath } = usePrefs();
  // 壳命令只装一次（installHostBridge 幂等），回调取实时状态经 ref 镜像——
  // 闭包里 store.workspaces 是首渲染的空表，快捷空间会找不到（store.tsx 的
  // refreshRef 镜像同款纪律）。
  const storeRef = useRef(store);
  storeRef.current = store;
  const quickPathRef = useRef(quickWorkspacePath);
  quickPathRef.current = quickWorkspacePath;

  // Boot 落点：数据一到切到快捷空间（switchWorkspace 自带「侧栏可见层最近
  // 会话」语义，空空间落草稿页）；引擎失败不再等——横幅自己会出来。
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    if (booted) return;
    if (store.engineUp && store.workspaces.length > 0) {
      setBooted(true);
      const quick = storeRef.current.workspaces.find((w) => w.path === quickPathRef.current);
      if (quick) storeRef.current.switchWorkspace(quick.workspaceId);
    } else if (store.enginePhase === "failed") {
      setBooted(true);
    }
  }, [booted, store.engineUp, store.enginePhase, store.workspaces]);

  // 壳命令三条（QuickPanelController 专属推送）：
  // · openQuickSession → 快捷空间新草稿；视图切好、画出首帧再回 quickPanel-show，
  //   壳才把窗口带到前台——用户看到的永远是新会话页，绝不闪旧视图（Atd task.new
  //   的编排）。页面 boot 时**不发**：常驻隐身页自己画好就行，召唤前不打扰。
  // · runQuickCommand → 命令行预填当前输入框（整段替换，防抖照落草稿），按回车
  //   即执行——执行链仍走 Composer/引擎既有路，不这里直接 commandExecute。
  // · quickPanelFocus → 输入框拿键盘（壳 makeKey 后 0.15s 推来）。
  useEffect(() => {
    installHostBridge({
      openQuickSession: () => {
        storeRef.current.openQuickSession();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          sendToShell({ type: "quickPanel-show" });
        }));
      },
      runQuickCommand: ({ name }) => {
        if (!name) return;
        dispatchAppEvent(DD_EVENTS.composerPrefill, { text: `/${name}` });
      },
      quickPanelFocus: () => {
        dispatchAppEvent(DD_EVENTS.composerFocus);
      },
    });
  }, []);

  const active = store.activeSessionId;
  return (
    <div className="app mini-panel">
      <TooltipHost />
      <DialogHost />
      <main className="main">
        {active ? (
          <SessionView key={active} sessionId={active} />
        ) : (
          <MiniDraft />
        )}
      </main>
    </div>
  );
}
