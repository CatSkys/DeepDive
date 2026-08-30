import { useEffect, useMemo, useState } from "react";
import { Search, Settings, Sparkles, Code, Gem, NotebookPen, Cpu } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import type { SessionSummary } from "../types";

const presetIcons: Record<string, any> = {
  standard: Sparkles,
  code: Code,
  minimal: Cpu,
  cordis: NotebookPen,
};

function bucketLabel(updatedAt: number): string {
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const diff = now - updatedAt;
  if (diff < day) {
    const d = new Date(updatedAt);
    const t = new Date(now);
    return d.getDate() === t.getDate() ? "今天" : "昨天";
  }
  if (diff < 7 * day) return "上周";
  const d = new Date(updatedAt);
  return `${d.getMonth() + 1} 月`;
}

export function StatusDot({ s }: { s: SessionSummary }) {
  const cls = s.running ? "running" : "failed";
  return <span className={`dot ${cls}`} />;
}

export function Sidebar() {
  const store = useStore();
  const [query, setQuery] = useState("");
  const [presets, setPresets] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    api
      .agentPresets()
      .then((r) => setPresets((r?.presets ?? []).slice(0, 3)))
      .catch(() => void 0);
  }, []);

  const groups = useMemo(() => {
    const list = query
      ? store.sessions
      : store.sessions.filter((s) => !s.blank);
    const byBucket = new Map<string, SessionSummary[]>();
    for (const s of list) {
      const key = bucketLabel(s.updatedAt);
      if (!byBucket.has(key)) byBucket.set(key, []);
      byBucket.get(key)!.push(s);
    }
    return [...byBucket.entries()];
  }, [store.sessions, query]);

  return (
    <aside className="sidebar">
      <div className="search-row">
        <Search size={14} />
        <input
          placeholder="搜索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {presets.length > 0 && (
        <div>
          <div className="section-label">Pinned</div>
          {presets.map((p) => {
            const Icon = presetIcons[p.id] ?? Sparkles;
            return (
              <button key={p.id} className="task-row pinned" onClick={() => void store.createSession(p.id)}>
                <Icon size={14} />
                <span className="title">{p.name}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="sessions">
        {groups.map(([label, items]) => (
          <div key={label}>
            <div className="section-label">{label}</div>
            {items.map((s) => (
              <button
                key={s.sessionId}
                className={`task-row${s.sessionId === store.activeSessionId ? " selected" : ""}${s.running ? " running" : ""}`}
                onClick={() => store.openSession(s.sessionId)}
              >
                <span className="title">{titleOf(s)}</span>
              </button>
            ))}
          </div>
        ))}
        {groups.length === 0 && <div className="empty-state">暂无会话</div>}
      </div>
      <div className="sidebar-foot">
        <Settings size={13} />
        设置
      </div>
    </aside>
  );
}

let titleCache = new Map<string, string>();

export function titleOf(s: SessionSummary): string {
  if (s.blank) return "New Chat";
  const proj: any = (s.projections as any)?.values ?? {};
  if (typeof proj.title === "string" && proj.title.trim()) return proj.title;
  const cached = titleCache.get(s.sessionId);
  if (cached) return cached;
  return "任务 " + s.sessionId.slice(0, 6);
}

export function rememberTitle(sessionId: string, title: string) {
  titleCache.set(sessionId, title);
}
