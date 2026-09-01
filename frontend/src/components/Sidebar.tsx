import { useEffect, useMemo, useState } from "react";
import { Archive, Search, Settings, Sparkles, Code, NotebookPen, Cpu } from "lucide-react";
import { api } from "../api";
import { sendToShell } from "../host";
import { useStore } from "../store";
import type { SessionSummary } from "../types";

declare const __DSH_BUILD_SHA__: string;

const presetIcons: Record<string, any> = {
  standard: Sparkles,
  code: Code,
  minimal: Cpu,
  cordis: NotebookPen,
};

interface CtxMenu { sessionId: string; title: string; cwd?: string; x: number; y: number }

function fmtTime(updatedAt: number): string {
  const diff = Date.now() - updatedAt;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天`;
  return `${Math.floor(d / 7)} 周`;
}

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

export function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const store = useStore();
  const [query, setQuery] = useState("");
  const [presets, setPresets] = useState<Array<{ id: string; name: string }>>([]);
  const [ctx, setCtx] = useState<CtxMenu | null>(null);

  useEffect(() => {
    void api.agentPresets()
      .then((r) => setPresets((r?.presets ?? []).slice(0, 3)))
      .catch(() => void 0);
    const close = () => setCtx(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
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
                className={`task-row${s.sessionId === store.activeSessionId ? " selected" : ""}${s.running ? " running" : ""}${store.unread.has(s.sessionId) ? " unread" : ""}`}
                onClick={() => store.openSession(s.sessionId)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtx({ sessionId: s.sessionId, title: titleOf(s), cwd: s.cwd, x: e.clientX, y: e.clientY });
                }}
              >
                <span className="row-slot" aria-hidden="true">
                  {store.unread.has(s.sessionId) && <span className="unread-dot" />}
                </span>
                <span className="title">{titleOf(s)}</span>
                <span className="row-actions"
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCtx({ sessionId: s.sessionId, title: titleOf(s), cwd: s.cwd, x: e.clientX, y: e.clientY });
                  }}
                >
                  <span className="row-time">{fmtTime(s.updatedAt)}</span>
                  <button
                    className="row-archive"
                    title="归档任务"
                    onClick={async () => {
                      try { await api.workspaceArchiveSession({ sessionId: s.sessionId }); await store.refresh(); } catch { /* surfaced by poll */ }
                    }}
                  >
                    <Archive size={13} />
                  </button>
                </span>
              </button>
            ))}
          </div>
        ))}
        {groups.length === 0 && <div className="empty-state">暂无会话</div>}
      </div>
      <div className="sidebar-foot">
        <button
          className="settings-entry"
          title="设置 ⌘,"
          onClick={() => {
            onOpenSettings();
          }}
        >
          <Settings size={13} />
          设置
        </button>
        <span className="build-tag">v-{__DSH_BUILD_SHA__}</span>
      </div>
      {ctx && (
        <div className="ctx-menu" style={{ top: ctx.y, left: Math.min(ctx.x, window.innerWidth - 220) }} onClick={(e) => e.stopPropagation()}>
          <div className="ctx-item" onClick={() => {
            const title = prompt("重命名任务", ctx.title);
            if (title && title.trim()) {
              void (async () => {
                try { await api.sessionRename({ sessionId: ctx.sessionId, title: title.trim() }); await store.refresh(); } catch (err) { alert(`重命名失败：${(err as Error).message}`); }
              })();
            }
            setCtx(null);
          }}>重命名任务</div>
          <div className="ctx-item" onClick={async () => {
            try { await api.workspaceArchiveSession({ sessionId: ctx.sessionId }); await store.refresh(); } catch (err) { alert(`归档失败：${(err as Error).message}`); }
            setCtx(null);
          }}>归档任务</div>
          <div className="ctx-item" onClick={() => { store.markUnread(ctx.sessionId); setCtx(null); }}>标记为未读</div>
          <div className="ctx-sep" />
          <div className="ctx-item" onClick={() => { sendToShell({ type: "reveal-path", path: ctx.cwd ?? "" }); setCtx(null); }}>在 Finder 中打开</div>
          <div className="ctx-item" onClick={() => { if (ctx.cwd) navigator.clipboard.writeText(ctx.cwd); setCtx(null); }}>复制路径</div>
          <div className="ctx-item" onClick={() => { sendToShell({ type: "copy-log-path" }); setCtx(null); }}>复制日志路径</div>
          <div className="ctx-item" onClick={() => { navigator.clipboard.writeText(ctx.sessionId); setCtx(null); }}>复制会话 ID</div>
          <div className="ctx-item" onClick={() => { setCtx(null); onOpenSettings(); }}>前往配置</div>
        </div>
      )}
    </aside>
  );
}

export function titleOf(s: SessionSummary): string {
  if (s.blank) return "New Chat";
  const proj: any = (s.projections as any)?.values ?? {};
  if (typeof proj.title === "string" && proj.title.trim()) return proj.title;
  return "任务 " + s.sessionId.slice(0, 6);
}
