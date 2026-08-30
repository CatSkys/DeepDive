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
            <div className="composer-wrap">
              <Composer sessionId={null} />
            </div>
            <div className="hero-hint">⌥Space 唤起 · ⌘K 命令（即将）</div>
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
