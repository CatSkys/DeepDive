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
import type { MiniOverlayMode } from "./MiniCommandCenter";
import { pushCardFrame } from "./miniCardAnchor";
import { initMiniGlassBridge } from "./miniGlassPieces";
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
  // 卡片本身**不在这一页**：它是壳里另一块透明 webview（`?minicc=1` 那一页），垫在面板页
  // 之上的原生玻璃之上——这一页只负责开合、落点与"用户点了别处"（见 pushCardFrame 与
  // MiniCommandCenterApp 的注释：分两块才可能糊到面板正文）。
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
  // 胶囊与输入框那两块原生玻璃的矩形表（壳按它摆位；网页侧那两个元素不画材质）。
  useEffect(() => initMiniGlassBridge(), []);
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
      // 卡那一页按 Esc（它拿着键盘）→ 壳转回来：开合的事实源在本页（胶囊按钮在这儿）。
      miniCCClosed: () => setOverlay(null),
    });
    sendToShell({ type: "get-prefs" });
  }, []);

  const active = store.activeSessionId;
  const face = miniPanelFace(active, store.sessions);
  // 会话在跑 → 整面板辉光（信号与 Composer 的停止按钮同一条：sessions[].running）。
  const activeRunning = active
    ? (store.sessions.find((s) => s.sessionId === active)?.running ?? false)
    : false;
  const sessionFace = face === "session" && active !== null;
  // 卡片那张脸（模式 + 会话 id）：设置行集按脸给，会话 id 由壳转给卡那一页。
  const cardFaceRef = useRef<{ mode: MiniOverlayMode; sessionId: string | null } | null>(null);
  cardFaceRef.current = overlay === null ? null : { mode: overlay, sessionId: sessionFace ? active : null };
  const overlayOpen = overlay !== null;
  const cardPush = useRef<{ pushNow: () => void } | null>(null);
  useEffect(() => {
    if (!overlayOpen) return;
    const handle = pushCardFrame(() => cardFaceRef.current);
    cardPush.current = handle;
    return () => {
      cardPush.current = null;
      handle.stop();
    };
  }, [overlayOpen]);
  // 换脸（历史 ↔ 设置、切会话）立刻推一次：等下一个节拍会有小半秒的旧内容。
  useEffect(() => {
    cardPush.current?.pushNow();
  }, [overlay, sessionFace, active]);
  // 点面板任意处（胶囊自己除外）＝ 点在卡片外：收卡。卡片在另一块 webview 里，
  // 落在这一页的点击天然都是"外面"。
  useEffect(() => {
    if (!overlayOpen) return;
    const onDoc = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest(".mini-controls")) return;
      setOverlay(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [overlayOpen]);

  // Esc 收卡：卡片页拿着键盘时由它自己上报（miniCCClosed），面板页这类只在"焦点其实还在
  // 本页"时兜底——输入框/菜单里的 Esc 是它们自己的语义，不抢。
  useEffect(() => {
    if (!overlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") setOverlay(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [overlayOpen]);


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
    </div>
  );
}
