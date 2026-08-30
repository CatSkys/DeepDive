import { StoreProvider, useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { Composer } from "./components/Composer";
import { SessionView } from "./components/SessionView";
import "./theme.css";

function Shell() {
  const store = useStore();
  const active = store.activeSessionId;
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        {active ? (
          <SessionView sessionId={active} />
        ) : (
          <div className="hero">
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
