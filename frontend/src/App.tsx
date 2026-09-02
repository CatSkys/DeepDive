import { useCallback, useEffect, useState } from "react";
import { PanelLeft } from "lucide-react";
import { api } from "./api";
import { installHostBridge } from "./host";
import { StoreProvider, useStore } from "./store"
import { useT } from "./i18n";
import heroLogo from "./assets/deepdive-logo-ascii-black-256.png";
import { Sidebar, WorkspacePill } from "./components/Sidebar";
import { IconNewChatOutline16 } from "./components/Icons";
import { Composer } from "./components/Composer";
import { SessionView } from "./components/SessionView";
import { SettingsPage } from "./components/SettingsPage";
import { ModelMenu, type ModelOption } from "./components/ModelMenu";
import "./theme.css";

function Shell() {
  const store = useStore();
  const { t } = useT();
  const active = store.activeSessionId;
  const [modelName, setModelName] = useState("DeepSeek");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [showModels, setShowModels] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
        setSettingsOpen(false);
        const listed = store.sessions.some((s) => s.sessionId === sessionId);
        if (listed) store.openSession(sessionId);
        else setDeferredNav(sessionId);
      },
      navigateToSettings: () => setSettingsOpen(true),
      themeChanged: (dark) => {
        document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
      },
      workspacePicked: (path) => {
        void store.createWorkspace(path);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Model catalog: reloaded every time the picker opens — the catalog changes
  // when keys/providers are configured in settings, and a boot-time-only load
  // would stay empty forever after an early failure (user report).
  const loadModels = useCallback(async () => {
    const { options, default: def } = await api.modelOptions();
    setModels(options);
    if (def) {
      const hit = options.find((m) => m.provider === def.provider && m.model === def.model);
      setModelName(hit?.label ?? `${def.provider} / ${def.model}`);
    } else if (options[0]) setModelName(options[0].label);
  }, []);
  useEffect(() => { void loadModels(); }, [loadModels]);
  useEffect(() => {
    if (showModels) void loadModels();
  }, [showModels, loadModels]);

  const pickModel = async (m: ModelOption, reasoningEffort?: string) => {
    setShowModels(false);
    setModelName(m.label);
    let sid = store.activeSessionId ?? (await store.createSession());
    if (!sid) return;
    try {
      await api.selectModel({ sessionId: sid, provider: m.provider, model: m.model, ...(reasoningEffort ? { reasoningEffort } : {}) });
    } catch { /* engine may be booting */ }
  };
  return (
    <div className={`app${store.sidebarCollapsed ? " collapsed" : ""}`}>
      {/* 顶部两钮（＋新会话 / ⊞收起）：红绿灯旁横排，收起/展开都在顶部。 */}
      <div className="window-top">
        <button className="window-top-btn" title={t("新会话")} onClick={() => void store.createSession()}>
          <IconNewChatOutline16 size={17} />
        </button>
        <button className="window-top-btn" title={t("收起侧栏")} onClick={() => store.toggleSidebar()}>
          <PanelLeft size={17} />
        </button>
      </div>
      {settingsOpen ? (
        <SettingsPage onClose={() => setSettingsOpen(false)} />
      ) : (
        <>
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
      {/* SessionView key：会话切换必须全新挂载——无 key 时 React 复用实例，
          旧会话的 items/eventLog 残留会在新会话 summary 就位前闪现旧内容。 */}
      <main className="main">
        {active ? (
          <SessionView key={active} sessionId={active} />
        ) : (
          <div className="hero">
            <div className="hero-top">
              <div className="left">
                <div className="title-row">
                  <div className="title">{t("新会话")}</div>
                  <WorkspacePill />
                </div>
                <button className="model" title={t("更换模型")} onClick={() => setShowModels((v) => !v)}>
                  {modelName}
                </button>
                {showModels && (
                  <ModelMenu
                    options={models}
                    current={modelName}
                    effortValue={undefined}
                    onPick={(m) => void pickModel(m)}
                    onApplyEffort={(m, effort) => void pickModel(m, effort)}
                    onClose={() => setShowModels(false)}
                  />
                )}
              </div>
            </div>
            <div className="hero-brand">
              <img className="hero-logo" src={heroLogo} alt="DeepDive" />
              <div className="hero-title">{t("做点什么？")}</div>
            </div>
            <div className="hero-composer">
              <Composer sessionId={null} />
            </div>
          </div>
        )}
      </main>
        </>
      )}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
