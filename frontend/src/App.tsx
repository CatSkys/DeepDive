import { useCallback, useEffect, useState } from "react";
import { Plus, PanelLeft } from "lucide-react";
import { api } from "./api";
import { installHostBridge } from "./host";
import { StoreProvider, useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { Composer } from "./components/Composer";
import { SessionView } from "./components/SessionView";
import { SettingsPage } from "./components/SettingsPage";
import { ModelMenu, type ModelOption } from "./components/ModelMenu";
import "./theme.css";

function Shell() {
  const store = useStore();
  const active = store.activeSessionId;
  const [modelName, setModelName] = useState("DeepSeek");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [showModels, setShowModels] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Shell→frontend bridge mount (SPEC-NOTIFICATIONS §3.1): native pushes
  // navigateToSession/navigateToSettings/themeChanged here; mounted once,
  // reports host-ready.
  useEffect(() => {
    installHostBridge({
      navigateToSession: (sessionId) => {
        setSettingsOpen(false);
        store.openSession(sessionId);
      },
      navigateToSettings: () => setSettingsOpen(true),
      themeChanged: (dark) => {
        document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
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

  const pickModel = async (m: ModelOption) => {
    setShowModels(false);
    setModelName(m.label);
    let sid = store.activeSessionId ?? (await store.createSession());
    if (!sid) return;
    try {
      await api.selectModel({ sessionId: sid, provider: m.provider, model: m.model });
    } catch { /* engine may be booting */ }
  };
  return (
    <div className={`app${store.sidebarCollapsed ? " collapsed" : ""}${settingsOpen ? " settings-mode" : ""}`}>
      <div className={`window-top${store.sidebarCollapsed ? " collapsed" : ""}`}>
        <button className="window-top-btn" title="新会话" onClick={() => void store.createSession()}>
          <Plus size={17} />
        </button>
        <button className="window-top-btn" title="边栏收起" onClick={() => store.toggleSidebar()}>
          <PanelLeft size={17} />
        </button>
      </div>
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
      <main className="main">
        {active ? (
          <SessionView sessionId={active} />
        ) : (
          <div className="hero">
            <div className="hero-top">
              <div className="left">
                <div className="title">新会话</div>
                <button className="model" title="更换模型" onClick={() => setShowModels((v) => !v)}>
                  {modelName}
                </button>
                {showModels && (
                  <ModelMenu
                    options={models}
                    current={modelName}
                    onPick={(m) => void pickModel(m)}
                    onClose={() => setShowModels(false)}
                  />
                )}
              </div>

            </div>
            <div className="hero-title">做点什么？</div>
            <div className="hero-sub">用 DeepSeek 智能体开始任何工作。</div>
            <div className="hero-composer">
              <Composer sessionId={null} />
            </div>
          </div>
        )}
      </main>
      {settingsOpen && <SettingsPage onClose={() => setSettingsOpen(false)} />}
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
