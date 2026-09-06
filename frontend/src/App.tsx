import { useCallback, useEffect, useState } from "react";
import { PanelLeft } from "lucide-react";
import { api } from "./api";
import { installHostBridge } from "./host";
import { StoreProvider, useStore } from "./store"
import { useT } from "./i18n";
import { comboFor, comboOf, isOff, KEYBIND_DEFS } from "./keybinds";
import { DD_EVENTS, dispatchAppEvent, onAppEvent } from "./events";
import { Sidebar } from "./components/Sidebar";
import { IconNewChatOutline16 } from "./components/Icons";
import { Composer } from "./components/Composer";
import { SessionView } from "./components/SessionView";
import { SessionHeader } from "./session/SessionHeader";
import { HeroBrand } from "./components/HeroBrand";
import { AgentModePicker } from "./components/AgentMode";
import { SettingsPage } from "./components/SettingsPage";
import { FirstRunGate } from "./settings/FirstRunGate";
import type { ModelOption } from "./components/ModelMenu";
import { TooltipHost } from "./components/Tooltip";
import { SelectionActions } from "./components/SelectionActions";
import "./theme.css";

function Shell({ settingsOpen, settingsSection, openSettings, closeSettings }: {
  settingsOpen: boolean;
  settingsSection: string;
  openSettings: (section?: string) => void;
  closeSettings: () => void;
}) {
  const store = useStore();
  const { t, tt } = useT();
  const active = store.activeSessionId;
  const [modelName, setModelName] = useState("DeepSeek");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [showModels, setShowModels] = useState(false);

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
        void store.createWorkspace(path).then((r) => {
          if (r.error) alert(tt("添加工作空间失败：{m}", "Add workspace failed: {m}", { m: r.error }));
        });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Model catalog: reloaded every time the picker opens — the catalog changes
  // when keys/providers are configured in settings, and a boot-time-only load
  // would stay empty forever after an early failure (user report).
  // 显示名跟「草稿选择」走：引擎 default 只是初始值，草稿页每次开菜单都
  // 重拉目录，若无视草稿会把已选模型重置回默认，表现为"无法切换"。
  const loadModels = useCallback(async () => {
    const { options, default: def } = await api.modelOptions();
    setModels(options);
    const want = store.draftModel ?? def;
    if (want) {
      const hit = options.find((m) => m.provider === want.provider && m.model === want.model);
      if (hit) setModelName(hit.label);
    } else if (options[0]) setModelName(options[0].label);
  }, [store.draftModel]);
  useEffect(() => { void loadModels(); }, [loadModels]);
  useEffect(() => {
    if (showModels) void loadModels();
  }, [showModels, loadModels]);

  const pickModel = async (m: ModelOption, reasoningEffort?: string) => {
    setModelName(m.label);
    // 菜单关闭由 ModelMenu 决定（与 useSessionModels 同一口径）：无档位模型
    // 选完即关；带档位的留在滑杆页，松手经 applyModelEffort 一次提交。
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
  // 应用内快捷键：window 捕获段匹配键位注册表（快捷键页可改/可停用）。
  // 输入框聚焦时仅听写可触发，避免打字误触。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = comboOf(e);
      if (!combo) return;
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      for (const def of KEYBIND_DEFS) {
        if (isOff(def.id, store.keybinds)) continue;
        if (combo !== comboFor(def.id, store.keybinds)) continue;
        if (typing && def.id !== "dictation") return;
        e.preventDefault();
        if (def.id === "new-session") store.openSession(null);
        else if (def.id === "search") dispatchAppEvent(DD_EVENTS.focusSearch);
        else if (def.id === "toggle-sidebar") store.toggleSidebar();
        else if (def.id === "dictation") dispatchAppEvent(DD_EVENTS.dictationToggle);
        else if (def.id === "cycle-effort") dispatchAppEvent(DD_EVENTS.cycleEffort);
        else if (def.id === "open-settings") openSettings();
        return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // 真实依赖只有 keybinds；store.openSession/toggleSidebar 按稳定引用约定不入表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.keybinds]);
  return (
    <div className={`app${store.sidebarCollapsed ? " collapsed" : ""}`}>
      <TooltipHost />
      {/* 断线横幅：只在连上后掉线时出现（启动期引擎未起不算），重连即消失 */}
      {store.everConnected && !store.engineUp && (
        <div className="engine-banner" role="status">
          <span className="engine-banner-dot" aria-hidden="true" />
          {t("与引擎的连接已断开，正在重试…")}
        </div>
      )}
      {/* 顶部两钮（＋新会话 / ⊞收起）：红绿灯旁横排，收起/展开都在顶部。
          ＋只切到草稿页（hero）——真实会话在首条消息发出时才创建。
          设置页不显示——返回/关闭导航由 SettingsPage 自带。
          tooltip 键帽随快捷键页的改键实时同步。 */}
      {!settingsOpen && (
        <div className="window-top">
          <button className="window-top-btn" data-tip={t("收起侧栏")} data-tip-keys={comboFor("toggle-sidebar", store.keybinds)} onClick={() => store.toggleSidebar()}>
            <PanelLeft size={17} />
          </button>
          <button className="window-top-btn" data-tip={t("新会话")} data-tip-keys={comboFor("new-session", store.keybinds)} onClick={() => store.openSession(null)}>
            <IconNewChatOutline16 size={17} />
          </button>
        </div>
      )}
      {settingsOpen ? (
        <SettingsPage key={settingsSection} initialSection={settingsSection} onClose={closeSettings} />
      ) : (
        <>
      <Sidebar onOpenSettings={() => openSettings()} />
      {/* SessionView key：会话切换必须全新挂载——无 key 时 React 复用实例，
          旧会话的 items/eventLog 残留会在新会话 summary 就位前闪现旧内容。 */}
      <main className="main">
        {active ? (
          <SessionView key={active} sessionId={active} />
        ) : (
          <div className="hero">
            <div className="hero-top">
              <SessionHeader title={t("新会话")} face={{
                showModels, setShowModels, modelName, models,
                currentModel: undefined, effortLevels: [], effort: undefined, effortLabel: () => "",
                pickModel, applyModelEffort: pickModel,
              }} />
            </div>
            <HeroBrand>
              <AgentModePicker />
            </HeroBrand>
            <div className="hero-composer">
              <Composer sessionId={null} />
            </div>
          </div>
        )}
      </main>
        {/* 全局单例：消息流选中文字的浮条与右键复制菜单（portal 自挂 body） */}
        <SelectionActions />
        </>
      )}
    </div>
  );
}

export default function App() {
  // 设置页开合与分节放在 App（始终挂载）：FirstRunGate 派发 dd:open-settings
  // 时门还压着 Shell——监听必须住在门外，跳转才不会丢。
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState("general");
  const openSettings = useCallback((section?: string) => {
    if (section) setSettingsSection(section);
    setSettingsOpen(true);
  }, []);
  useEffect(() => onAppEvent(DD_EVENTS.openSettings, (detail) => {
    const section = (detail as { section?: string } | undefined)?.section;
    openSettings(typeof section === "string" ? section : undefined);
  }), [openSettings]);
  return (
    <StoreProvider>
      <FirstRunGate>
        <Shell
          settingsOpen={settingsOpen}
          settingsSection={settingsSection}
          openSettings={openSettings}
          closeSettings={() => setSettingsOpen(false)}
        />
      </FirstRunGate>
    </StoreProvider>
  );
}
