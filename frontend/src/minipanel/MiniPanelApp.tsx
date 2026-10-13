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
import { MiniCommandCenter, type MiniOverlayMode } from "./MiniCommandCenter";
import { MiniDraft } from "./MiniDraft";
import { MiniPanelControls } from "./MiniPanelControls";
import { MiniRunningGlow } from "./MiniRunningGlow";

/** 面板该显示哪张脸：会话**有内容**（summary 非 blank）才交给 SessionView；
 *  刚建出来、内容还没落盘（summary 未到或仍 blank）的会话留在本页自己的草稿页——
 *  SessionView 对空白会话渲染的是主窗那套「头部 + hero 整页」，在面板里是另一张脸，
 *  闪一帧就是用户报的"发送后中间跳一下"（主窗不报，因为它那份草稿页就是那张 hero）。
 *  纯函数：单测锁住这条判定（__tests__/mini-panel-face）。 */
export function miniPanelFace(
  activeSessionId: string | null,
  sessions: ReadonlyArray<{ sessionId: string; blank?: boolean }>,
): "draft" | "session" {
  if (activeSessionId === null) return "draft";
  const summary = sessions.find((s) => s.sessionId === activeSessionId);
  return summary && !summary.blank ? "session" : "draft";
}

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

  // 命令中心的开关：null = 没有浮层；"history"/"settings" = 那张卡片开着（用户 2026-10-13
  // 定稿：历史与设置都是**浮在页面之上**的命令中心，不换页；再点那颗钮收回）。
  const [overlay, setOverlay] = useState<MiniOverlayMode | null>(null);

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
  // 桥装好后再**主动要一次偏好**：壳的 prefs 只在主窗 host-ready / 设置页 get-prefs
  // 时推，面板页自己不发 host-ready，那次推送与面板挂载之间是一场竞速（暂存位只有
  // 一条、flush 只在 didFinish 后跑一遍）——错过就是永远没有，quickWorkspacePath
  // 为 null，历史列表的空锚点、openQuickSession 的切空间都跟着落空（2026-10-13 用户
  // 报"历史是空的"）。这里自己问一次，确定性拿回。
  useEffect(() => {
    installHostBridge({
      openQuickSession: () => {
        // 壳命令"新任务"总回草稿：命令中心先收（不然新会话页被它挡着）
        setOverlay(null);
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
    sendToShell({ type: "get-prefs" });
  }, []);

  const active = store.activeSessionId;
  const face = miniPanelFace(active, store.sessions);
  const sessionFace = face === "session" && active !== null;
  // 会话在跑 → 整面板辉光（信号与 Composer 的停止按钮同一条：sessions[].running）。
  const activeRunning = active
    ? (store.sessions.find((s) => s.sessionId === active)?.running ?? false)
    : false;
  // 控件簇的齿轮：开设置那张命令中心（草稿/会话同一张卡片，行集按脸给，见 MiniSettingsRows）。
  // 面板里不再开主窗那张右侧卡——产物/状态/浏览器归主窗（用户 2026-10-13 定稿）。
  const openSettings = () => setOverlay((o) => (o === "settings" ? null : "settings"));
  // 控件簇的「新建会话」：落快捷空间新草稿（SPEC §6.1——与药丸那颗「新建会话」同一落点；
  // 壳命令 openQuickSession 那条路多推一次 quickPanel-show，是给"面板还没露脸"的召唤用的，
  // 面板里点这颗不需要）。命令中心先收，不然新草稿页被它挡着。
  const newSession = () => {
    setOverlay(null);
    storeRef.current.openQuickSession();
  };
  return (
    <div className="app mini-panel">
      <TooltipHost />
      <DialogHost />
      {activeRunning && <MiniRunningGlow />}
      <MiniPanelControls
        historyOpen={overlay === "history"}
        onNewSession={newSession}
        onToggleHistory={() => setOverlay((o) => (o === "history" ? null : "history"))}
        onOpenSettings={openSettings}
      />
      <main className="main">
        {sessionFace && active !== null ? (
          /* rightSidebar=false：面板里不出主窗那张右侧卡与它的座位（产物/状态/浏览器归主窗，
             用户 2026-10-13 定稿）；设置入口是上面的控件簇与标题点击 → 命令中心。 */
          <SessionView
            key={active}
            sessionId={active}
            rightSidebar={false}
            showModel={false}
            onOpenSettings={openSettings}
          />
        ) : (
          <MiniDraft onOpenSettings={openSettings} />
        )}
      </main>
      {overlay !== null && (
        <MiniCommandCenter
          mode={overlay}
          sessionId={sessionFace && active !== null ? active : null}
          onClose={() => setOverlay(null)}
        />
      )}
    </div>
  );
}
