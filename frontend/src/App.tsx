import { useEffect, useState } from "react";
import { PanelLeft } from "lucide-react";
import { api } from "./api";
import { StoreProvider, useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { Composer } from "./components/Composer";
import { SessionView } from "./components/SessionView";
import { ModelMenu, type ModelOption } from "./components/ModelMenu";
import "./theme.css";

function Shell() {
  const store = useStore();
  const active = store.activeSessionId;
  const [modelName, setModelName] = useState("DeepSeek");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [showModels, setShowModels] = useState(false);
  useEffect(() => {
    api
      .llmModels()
      .then((r: any) => {
        const flat: ModelOption[] = [];
        for (const g of r?.groups ?? []) {
          for (const m of g?.models ?? []) {
            flat.push({ provider: g.id, model: m.id, label: m.name ?? m.id, providerLabel: g.name ?? g.id });
          }
        }
        setModels(flat);
        if (flat[0]) setModelName(flat[0].label);
      })
      .catch(() => void 0);
  }, []);

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
    <div className="app">
      {!store.sidebarCollapsed && <Sidebar />}
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
              <button className="right" title="面板" onClick={() => store.toggleSidebar()}>
                <PanelLeft size={18} />
              </button>
            </div>
            <div className="hero-title">做点什么？</div>
            <div className="hero-sub">用 DeepSeek 智能体开始任何工作。</div>
            <div className="hero-composer">
              <Composer sessionId={null} />
            </div>
          </div>
        )}
      </main>
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
