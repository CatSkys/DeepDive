import { useCallback, useEffect, useRef, useState } from "react";
import { PanelLeft, Search } from "lucide-react";
import { api } from "./api";
import { alertDialog, confirmDialog } from "./components/DialogHost";
import { installHostBridge, copyText } from "./host";
import { mux } from "./mux";
import { StoreProvider, useStore } from "./store"
import { useT } from "./i18n";
import { comboFor, comboOf, isOff, KEYBIND_DEFS } from "./keybinds";
import { DD_EVENTS, dispatchAppEvent, onAppEvent } from "./events";
import { Sidebar } from "./components/Sidebar";
import { AutomationProvider } from "./automation/useAutomation";
import type { AutomationProposal } from "./automation/protocol";
import { Composer } from "./components/Composer";
import { SessionView } from "./components/SessionView";
import { SessionHeader, type ModelFace } from "./session/SessionHeader";
import { HeroPanel, HeroPanelTrigger } from "./sidebar-right/HeroPanel";
import { HeroBrand } from "./components/HeroBrand";
import { SettingsPage } from "./components/SettingsPage";
import { BootSkeleton } from "./components/BootSkeleton";
import { OnboardingWizard } from "./onboarding/OnboardingWizard";
import { useAutoArchive } from "./useAutoArchive";
import { useBrowserPermissionAsk } from "./sidebar-right/useBrowserPermissionAsk";
import { useBrowserLibraryBridge } from "./sidebar-right/browserHistory";
import { effortDisplayName, type ModelOption } from "./components/ModelMenu";
import { heroModelFace } from "./draftModel";
import { TooltipHost } from "./components/Tooltip";
import { DialogHost } from "./components/DialogHost";
import { NewProjectDialogHost } from "./components/NewProjectDialog";
import { EditProjectDialogHost } from "./components/EditProjectDialog";
import { IconPickerHost } from "./components/IconPicker";
import { CommandPaletteHost, openCommandPalette, toggleCommandPalette } from "./components/CommandPalette";
import { routeWorkspacePicked } from "./components/workspacePicker";
import { SelectionActions } from "./components/SelectionActions";
import "./theme.css";

/** 引擎失败详情里展示/复制的日志行数：壳最多推 400 行，弹窗只看得下末尾这几行。 */
const FAILURE_TAIL_LINES = 40;

function failureTailLines(text: string | null): string {
  return (text ?? "").trim().split("\n").slice(-FAILURE_TAIL_LINES).join("\n");
}

function Shell({ settingsOpen, settingsSection, openSettings, closeSettings, automationDraft, onAutomationDraftUsed, onOpenOnboarding }: {
  onOpenOnboarding: () => void;
  settingsOpen: boolean;
  settingsSection: string;
  openSettings: (section?: string) => void;
  closeSettings: () => void;
  automationDraft: AutomationProposal | null;
  onAutomationDraftUsed: () => void;
}) {
  const store = useStore();
  const { t, tt } = useT();
  useAutoArchive();
  // 网页要摄像头/麦克风：应用自己的弹窗问一次（面板关着也可能有页面在问）
  useBrowserPermissionAsk();
  // 壳推来的浏览历史/书签收进模块缓存（地址栏补全与设置页那张表都读它）
  useBrowserLibraryBridge();
  const active = store.activeSessionId;
  const [modelName, setModelName] = useState("DeepSeek");
  const [models, setModels] = useState<ModelOption[]>([]);
  // 引擎默认模型（modelCatalog 的 default）：草稿无选择/草稿失效时 hero 头部
  // 的显示口径——真会话走 modelSelection 投影（next ?? lastUsed），hero 与它对齐。
  const [engineDefault, setEngineDefault] = useState<{ provider: string; model: string } | undefined>(undefined);
  const [showModels, setShowModels] = useState(false);
  /** 草稿页的右侧边栏卡（只有会话设置，无会话可读所以没有状态分区）。 */
  const [heroPanelOpen, setHeroPanelOpen] = useState(false);

  // Deferred native navigation: a navigateToSession push (notification /
  // bubble) can arrive before the session list has loaded — hold it until the
  // list is in, then navigate only if the id is a live session (dropped/
  // archived ones must not resurrect as ghost conversations).
  const [deferredNav, setDeferredNav] = useState<string | null>(null);
  useEffect(() => {
    if (!deferredNav) return;
    const hit = store.sessions.find((s) => s.sessionId === deferredNav);
    if (hit) {
      store.openSession(hit.sessionId);
      setDeferredNav(null);
    } else if (store.sessions.length > 0) {
      // List is loaded and the id isn't in it — stale push, drop it.
      setDeferredNav(null);
    }
    // An empty list means "not loaded yet" — keep waiting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredNav, store.sessions]);

  // Shell→frontend bridge mount (SPEC-NOTIFICATIONS §3.1): native pushes
  // navigateToSession/navigateToSettings/themeChanged here; mounted once,
  // reports host-ready.
  useEffect(() => {
    installHostBridge({
      navigateToSession: (sessionId) => {
        closeSettings();
        const listed = store.sessions.some((s) => s.sessionId === sessionId);
        if (listed) store.openSession(sessionId);
        else setDeferredNav(sessionId);
      },
      navigateToSettings: () => openSettings(),
      themeChanged: (dark) => {
        document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
      },
      workspacePicked: (path) => {
        // 新建项目弹窗开着时，目录选择器结果归弹窗（表单流程接管）
        if (routeWorkspacePicked(path)) return;
        void store.createWorkspace(path).then((r) => {
          if (r.error) void alertDialog({ message: tt("添加工作空间失败：{m}", "Add workspace failed: {m}", { m: r.error }) });
        });
      },
      // 系统唤醒：WS 可能已假死（PITFALLS §4.7），弃掉重建让直播流自愈。
      systemWake: () => mux.recycle(),
      // 菜单「文件 → 新建会话」：与侧栏入口/⌘N 同一条路径（切草稿页）。
      newSession: () => {
        closeSettings();
        store.openSession(null);
      },
      // 菜单「帮助 → 新手引导」：强制把卡片请出来（关闭时只收起，不改自动出现的判据）。
      openOnboarding: () => onOpenOnboarding(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Model catalog: reloaded every time the picker opens — the catalog changes
  // when keys/providers are configured in settings, and a boot-time-only load
  // would stay empty forever after an early failure (user report).
  // 显示名跟「草稿选择」走：引擎 default 只是初始值，草稿页每次开菜单都
  // 重拉目录，若无视草稿会把已选模型重置回默认，表现为"无法切换"。
  const loadModels = useCallback(async () => {
    // 启动期引擎常未就绪（bridge 503）：目录留空降级，picker 打开时重拉
    //（上方注释的既有策略）；不捕获会成为 unhandledrejection 污染诊断通道。
    const { options, default: def } = await api.modelOptions()
      .catch(() => ({ options: [] as ModelOption[], default: undefined }));
    setModels(options);
    setEngineDefault(def);
    const want = store.draftModel ?? def;
    if (want) {
      const hit = options.find((m) => m.provider === want.provider && m.model === want.model);
      if (hit) setModelName(hit.label);
    } else if (options[0]) setModelName(options[0].label);
  }, [store.draftModel]);
  useEffect(() => { void loadModels(); }, [loadModels]);
  // 冷启动挂载时常撞引擎 503（上方降级路径留空）：engineUp 翻真后补拉一次，
  // hero 头部的模型名/思考档位不必等用户开菜单才纠正（重启后显示默认模型）。
  useEffect(() => {
    if (store.engineUp) void loadModels();
  }, [store.engineUp, loadModels]);
  useEffect(() => {
    if (showModels) void loadModels();
  }, [showModels, loadModels]);
  // 传给草稿面板的同一个加载器：**必须是稳定引用**——面板把 identity 放进 effect
  // 依赖，每次渲染新建箭头会变成 fetch → setState → 重渲 → 再 fetch 的死循环
  // （i18n.ts 的 t/tt 缓存注释记过同型事故）。
  const reloadModels = useCallback(() => void loadModels(), [loadModels]);

  // 草稿页生效模型（草稿 ?? 引擎默认的口径在 draftModel.ts）：hero 头部显示
  // 与菜单共用，档位元数据来自目录里的 efforts（modelCatalog 透传）。
  const heroModel = heroModelFace(models, store.draftModel, engineDefault);

  const pickModel = async (m: ModelOption, reasoningEffort?: string) => {
    setModelName(m.label);
    // 菜单关闭由 ModelMenu 决定（与 useSessionModels 同一口径）：无档位模型
    // 选完即关；带档位的留在档位选择页，点选后经 applyModelEffort 一次提交。
    // 草稿页（hero）选模型：会话还没真正创建，暂存草稿，首条消息创建会话时
    // 由 store.createSession 随新会话 selectModel 带走——这里不建会话。
    if (!store.activeSessionId) {
      store.setDraftModel({ provider: m.provider, model: m.model, ...(reasoningEffort ? { reasoningEffort } : {}) });
      return;
    }
    try {
      await api.selectModel({ sessionId: store.activeSessionId, provider: m.provider, model: m.model, ...(reasoningEffort ? { reasoningEffort } : {}) });
    } catch { /* engine may be booting */ }
  };

  // 草稿页的模型面：头部那一行与会话设置卡共用同一份（同一目录、同一草稿选择，
  // 两处各写一遍字面量会漂移——其中一处改了 modelName 另一处就不跟着）。
  const heroFace: ModelFace = {
    showModels, setShowModels, modelName, models,
    currentModel: heroModel.currentModel,
    effortLevels: heroModel.efforts,
    effort: heroModel.effort,
    effortLabel: (id) => effortDisplayName(id, heroModel.efforts),
    pickModel, applyModelEffort: pickModel,
  };
  // 应用内快捷键：window 捕获段匹配键位注册表（快捷键页可改/可停用）。
  // 输入框聚焦时仅听写可触发，避免打字误触。
  // 键位处理必须读「当下这一个」store：store 对象按状态重建（toggleSidebar 等
  // 闭包捕获了当时的 sidebarOverride），而这个监听只随 keybinds 重挂——直接闭包
  // store 会拿到旧副本，⌘B 连按只生效一次（收得起、展不开）。
  const storeRef = useRef(store);
  storeRef.current = store;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const store = storeRef.current;
      const combo = comboOf(e);
      if (!combo) return;
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      // ⌥1-9 切换第 N 个项目空间（固定键位，不入改键表）：输入框聚焦时放行
      // ——⌥数字在文本框里是 macOS 特殊字符输入，劫持会打断打字
      if (!typing && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        const ws = store.workspaces[Number(e.key) - 1];
        if (ws) { e.preventDefault(); store.switchWorkspace(ws.workspaceId); }
        return;
      }
      for (const def of KEYBIND_DEFS) {
        if (isOff(def.id, store.keybinds)) continue;
        if (combo !== comboFor(def.id, store.keybinds)) continue;
        // 输入中放行的例外：听写（要在输入框里唤起）、⌘B 侧栏、⌘K 搜索——
        // 三个都不是文本编辑键（⌘B 只在富文本里是加粗，本应用输入面都是纯文本），
        // 且 ⌘K 必须放行才能「开着再按一次收起」（面板自己的输入框一开就抢焦点）
        const typingAllowed =
          def.id === "dictation" || def.id === "toggle-sidebar" || def.id === "command-palette";
        if (typing && !typingAllowed) return;
        e.preventDefault();
        if (def.id === "new-session") store.openSession(null);
        else if (def.id === "toggle-sidebar") store.toggleSidebar();
        else if (def.id === "dictation") dispatchAppEvent(DD_EVENTS.dictationToggle);
        else if (def.id === "cycle-effort") dispatchAppEvent(DD_EVENTS.cycleEffort);
        else if (def.id === "open-settings") openSettings();
        // 搜索面板是开关：开着再按一次收起（⌘K）
        else if (def.id === "command-palette") toggleCommandPalette();
        return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // 真实依赖只有 keybinds；store.openSession/toggleSidebar 按稳定引用约定不入表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.keybinds]);

  // 启动骨架屏的判定**必须发生在首帧**：定时器/effect 都会让首帧先渲染真实界面，
  // 于是"先看到画面再变成占位动画"（用户报的就是这一下）。所以冷启动与否由**文档
  // 自带的 URL 参数**决定——壳在加载时就知道引擎在不在跑：
  //   · 冷启动（应用刚拉起，引擎正在起）→ 不带参数 → 首帧就画骨架屏；
  //   · 热重载（切主题 / 菜单「刷新界面」，引擎已在跑）→ 带 `engine=ready` →
  //     直接渲染真实界面，数据几十毫秒内由 store 补上，不再闪骨架屏。
  const engineReadyAtLoad = new URLSearchParams(window.location.search).get("engine") === "ready";
  const booting = !engineReadyAtLoad && !store.everConnected && store.enginePhase !== "failed";
  // 挂载 / 卸载：首帧即挂（见上）；结束时先淡出（时长在 CSS），由骨架屏自己在
  // transitionend 回报后再卸载——卸载时机不写第二份时长。失败态不算"启动中"
  //（那是横幅的活：有原因、有重试，骨架屏会把它盖成"还在加载"）。
  const [skeletonMounted, setSkeletonMounted] = useState(booting);
  useEffect(() => {
    if (booting) setSkeletonMounted(true);
  }, [booting]);

  // 引擎失败详情：原因 + 日志尾部，可就地复制诊断——原原生恢复窗的两样能力
  // （看原因、复制诊断）搬进应用内。报错一律在应用内呈现，不弹系统窗/系统通知。
  const showEngineFailureDetail = async () => {
    const reason = (store.engineFailureReason ?? "").trim();
    const tail = failureTailLines(store.engineFailureTail);
    const diagnostics = reason && tail ? `${reason}\n\n${tail}` : reason || tail;
    const copy = await confirmDialog({
      title: t("引擎启动失败"),
      message: diagnostics || t("原因见日志"),
      confirmLabel: t("复制诊断"),
      cancelLabel: t("关闭"),
    });
    if (copy) copyText(diagnostics);
  };
  return (
    <div className={`app${store.sidebarCollapsed ? " collapsed" : ""}`}>
      <TooltipHost />
      <DialogHost />
      <NewProjectDialogHost />
      <EditProjectDialogHost />
      <IconPickerHost />
      <CommandPaletteHost />
      {/* 断线横幅：连上后掉线时出现（启动期引擎未起不算），重连即消失。
          但 failed 是**硬失败**，与"掉线"不同：首启就失败（新装机器入口缺失/
          架构不符/连续崩溃）时从没连上过，everConnected 恒 false——不特判就等于
          一个错误都不显示（原生的恢复窗已删，报错一律在这个横幅里）。
          壳的退避重试/放弃只有壳知道，所以文案分三档——旧实现放弃之后还写着
          "正在重试…"，既没有原因也没有重试入口。 */}
      {store.enginePhase === "failed" || (store.everConnected && !store.engineUp) ? (
        <div className="engine-banner" role="status" data-phase={store.enginePhase}>
          <span className="engine-banner-dot" aria-hidden="true" />
          {store.enginePhase === "failed" ? (
            <>
              <span className="engine-banner-text">
                {tt("引擎启动失败：{m}", "Engine failed to start: {m}", { m: store.engineFailureReason || t("原因见日志") })}
              </span>
              <button className="engine-banner-action" onClick={() => void showEngineFailureDetail()}>{t("详情")}</button>
              <button className="engine-banner-action" onClick={() => store.restartEngine()}>{t("重试")}</button>
            </>
          ) : store.enginePhase === "restarting" ? (
            tt("引擎正在重启（第 {n} 次）…", "Restarting the engine (attempt {n})…", { n: String(store.engineRestartingAttempt) })
          ) : (
            t("与引擎的连接已断开，正在重试…")
          )}
        </div>
      ) : null}
      {/* 顶部两钮（⊞收起 / 🔍搜索）：红绿灯旁横排，收起/展开都在顶部。
          搜索钮打开命令面板（与 ⌘K 同一条链路）；「新会话」按钮已按用户要求去掉
          （用得少，草稿页走侧栏会话列的入口即可）。设置页不显示——返回/关闭导航由
          SettingsPage 自带。tooltip 键帽随快捷键页的改键实时同步。 */}
      {!settingsOpen && (
        <div className="window-top">
          <button className="window-top-btn" data-tip={t("收起侧栏")} data-tip-keys={comboFor("toggle-sidebar", store.keybinds)} onClick={() => store.toggleSidebar()}>
            <PanelLeft size={17} />
          </button>
          <button className="window-top-btn" data-tip={t("搜索")} data-tip-keys={comboFor("command-palette", store.keybinds)} onClick={() => openCommandPalette()}>
            <Search size={17} />
          </button>
        </div>
      )}
      {settingsOpen ? (
        <SettingsPage
          key={settingsSection}
          initialSection={settingsSection}
          onClose={closeSettings}
          automationDraft={automationDraft}
          onAutomationDraftUsed={onAutomationDraftUsed}
        />
      ) : (
        <>
      {/* 窄屏（手机远程）遮罩：侧栏在那儿是浮层，展开会盖住顶部那两颗钮——
          点遮罩收回，否则没有关闭路径。宽屏下 CSS 直接 display:none。 */}
      {!store.sidebarCollapsed && (
        <button className="sidebar-scrim" aria-label={t("收起侧栏")} onClick={() => store.toggleSidebar()} />
      )}
      {/* 启动过渡舞台：真实界面层（.boot-shell，启动期压到 0）+ 骨架屏覆盖层。
          两层按 --dur-slowest 交叉淡入淡出，不硬切（用户反馈"闪一下、不够丝滑"）。 */}
      <div className="boot-stage">
      <div className="boot-shell" data-dim={booting ? "1" : "0"}>
      <Sidebar onOpenSettings={() => openSettings()} />
      {/* SessionView key：会话切换必须全新挂载——无 key 时 React 复用实例，
          旧会话的 items/eventLog 残留会在新会话 summary 就位前闪现旧内容。 */}
      <main className="main">
        {active ? (
          <SessionView key={active} sessionId={active} />
        ) : (
          <div className="session-row">
          <div className="hero">
            {/* 草稿页右上角的右边栏入口：会话页那颗 PanelTrigger 的同款同位置
                （绝对定位挂在卡片上，与会话头的右 16 / 上 8 对齐）。 */}
            <HeroPanelTrigger open={heroPanelOpen} onToggle={() => setHeroPanelOpen((v) => !v)} />
            <div className="hero-top">
              {/* 草稿选择（draftModel）派生头部模型与思考档位显示——档位元
                  数据来自 models 里的 efforts（modelOptions 透传）。标题点击 =
                  弹出右侧的会话设置卡（与会话页标题同一条规则）。 */}
              <SessionHeader title={t("新会话")} face={heroFace} onTitleClick={() => setHeroPanelOpen(true)} />
            </div>
            <HeroBrand />
            <div className="hero-composer">
              <Composer sessionId={null} />
            </div>
          </div>
          <HeroPanel
            open={heroPanelOpen}
            onClose={() => setHeroPanelOpen(false)}
            reloadModels={reloadModels}
            face={heroFace}
          />
          </div>
        )}
      </main>
      </div>
      {skeletonMounted && (
        <BootSkeleton fading={!booting} onFadedOut={() => setSkeletonMounted(false)} />
      )}
      </div>
        {/* 全局单例：消息流选中文字的浮条与右键复制菜单（portal 自挂 body） */}
        <SelectionActions />
        </>
      )}
    </div>
  );
}

export default function App() {
  /** 菜单「帮助 → 新手引导」的强制打开（false = 回归自动判据）。 */
  const [onboardingForced, setOnboardingForced] = useState(false);
  // 设置页开合与分节放在 App（始终挂载）：引导卡派发 dd:open-settings
  // 时门还压着 Shell——监听必须住在门外，跳转才不会丢。
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState("general");
  /** 消息流里「定时任务建议」带来的预填（消费一次即清）。 */
  const [automationDraft, setAutomationDraft] = useState<AutomationProposal | null>(null);
  const openSettings = useCallback((section?: string) => {
    if (section) setSettingsSection(section);
    setSettingsOpen(true);
  }, []);
  useEffect(() => onAppEvent(DD_EVENTS.openSettings, (detail) => {
    const section = (detail as { section?: string } | undefined)?.section;
    openSettings(typeof section === "string" ? section : undefined);
  }), [openSettings]);
  // 会话里点了「创建定时任务」：带建议开设置→自动化（表单预填，落库仍由用户点）
  useEffect(() => onAppEvent(DD_EVENTS.automationDraft, (detail) => {
    if (typeof detail !== "object" || detail === null) return;
    setAutomationDraft(detail as AutomationProposal);
    openSettings("automation");
  }), [openSettings]);
  return (
    <StoreProvider>
      <AutomationProvider>
        <OnboardingWizard forced={onboardingForced} onClosed={() => setOnboardingForced(false)}>
          <Shell
            onOpenOnboarding={() => setOnboardingForced(true)}
            settingsOpen={settingsOpen}
            settingsSection={settingsSection}
            openSettings={openSettings}
            closeSettings={() => { setSettingsOpen(false); setAutomationDraft(null); }}
            automationDraft={automationDraft}
            onAutomationDraftUsed={() => setAutomationDraft(null)}
          />
        </OnboardingWizard>
      </AutomationProvider>
    </StoreProvider>
  );
}
