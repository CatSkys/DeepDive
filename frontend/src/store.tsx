import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { ApprovalRequestFrame, MuxFrame, SessionSummary, WorkspaceView } from "./types";

// Minimal store: engine lists + the live mux stream. Per-session event log is
// owned by SessionView; the global store keeps list/stream state and relays
// mux frames to subscribers.

type MuxHandler = (frame: MuxFrame) => void;

interface Store {
  workspaces: WorkspaceView[];
  sessions: SessionSummary[];
  engineUp: boolean;
  activeSessionId: string | null;
  approvals: Map<string, ApprovalRequestFrame & { sessionId: string }>;
  openSession: (id: string | null) => void;
  createSession: (presetId?: string) => Promise<string | null>;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  pinned: Set<string>;
  unread: Set<string>;
  togglePin: (id: string) => void;
  markUnread: (id: string) => void;
  clearUnread: (id: string) => void;
  refresh: () => Promise<void>;
  subscribeMux: (handler: MuxHandler) => () => void;
}

const Ctx = createContext<Store>(null as unknown as Store);
export const useStore = () => useContext(Ctx);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [engineUp, setEngineUp] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Map<string, ApprovalRequestFrame & { sessionId: string }>>(new Map());
  const [muxHandlers] = useState<Set<MuxHandler>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // 任务行本地状态:置顶/未读(localStorage 持久化,官方语义)
  const [pinned, setPinned] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem("dsh.pinned") ?? "[]") as string[]));
  const [unread, setUnread] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem("dsh.unread") ?? "[]") as string[]));
  const persist = (key: string, set: Set<string>) => localStorage.setItem(key, JSON.stringify([...set]));
  const togglePin = useCallback((id: string) => setPinned((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    persist("dsh.pinned", next);
    return next;
  }), []);
  const markUnread = useCallback((id: string) => setUnread((prev) => {
    const next = new Set(prev).add(id);
    persist("dsh.unread", next);
    return next;
  }), []);
  const clearUnread = useCallback((id: string) => setUnread((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    persist("dsh.unread", next);
    return next;
  }), []);

  // 未读自动接线：打开（或启动落在）某会话即视为已读。
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = activeSessionId;
    if (activeSessionId) clearUnread(activeSessionId);
  }, [activeSessionId, clearUnread]);

  const forceRefreshSessions = async () => {
    try {
      const ss = await api.sessions();
      setSessions(ss.items.sort((a, b) => b.updatedAt - a.updatedAt));
    } catch { /* engine restarting; ignore */ }
  };
  const forceRefreshSessionsRef = useRef(forceRefreshSessions);
  forceRefreshSessionsRef.current = forceRefreshSessions;

  // session/event arrives once per streaming frame (every text delta); a full
  // session.list per frame hammers the engine and re-renders the whole tree.
  // Leading edge fires immediately (turn/start must flip the Stop button fast),
  // then coalesces to at most one refresh per 500ms while events keep flowing.
  const refreshGate = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null }>({ last: 0, timer: null });
  const throttledRefreshSessions = () => {
    const gate = refreshGate.current;
    if (gate.timer !== null) return;
    const wait = Math.max(0, 500 - (Date.now() - gate.last));
    gate.timer = setTimeout(() => {
      gate.timer = null;
      gate.last = Date.now();
      void forceRefreshSessionsRef.current();
    }, wait);
  };

  const refresh = async () => {
    // workspace.list 面是活的（点号形式，PITFALLS 4.6），且它的
    // archivedSessionIds 是归档的唯一事实源——session.list 不区分已归档，
    // 由客户端过滤。workspace 失败独立降级，绝不拖垮会话列表。
    let archived = new Set<string>();
    try {
      const ws = await api.workspaces();
      setWorkspaces(ws.items ?? []);
      archived = new Set(ws.archivedSessionIds ?? []);
    } catch { /* workspace face absent on this engine */ }
    try {
      const ss = await api.sessions();
      const sorted = ss.items
        .filter((s) => !archived.has(s.sessionId))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      setSessions(sorted);
      setEngineUp(true);
      // Boot policy: always land on a chat — reuse an existing blank session,
      // otherwise create one. No separate "default page" exists.
      setActiveSessionId((cur) => {
        if (cur) return cur;
        // Deep link: ?sid=… opens a specific session on boot (verification aid).
        const sid = new URLSearchParams(location.search).get("sid");
        if (sid && sorted.some((x) => x.sessionId === sid)) return sid;
        const blank = sorted.find((x) => x.blank);
        if (blank) return blank.sessionId;
        const recent = sorted.find((x) => !x.blank);
        if (recent) return recent.sessionId;
        void (async () => {
          const res = await api.createSession({ workspaceId: workspaces[0]?.workspaceId });
          setActiveSessionId(res.sessionId);
          await forceRefreshSessionsRef.current();
        })();
        return null;
      });
    } catch {
      setEngineUp(false);
    }
  };

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (alive) {
        await refresh();
      }
    };
    void tick();
    const iv = setInterval(() => void tick(), 3000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const close = api.openMux(
      (frame: any) => {
        if (frame.type === "session/event") {
          // 非当前会话的新动态 → 未读（当前会话正在看，不打点）。
          const sid = (frame as { sessionId?: string }).sessionId;
          if (sid && sid !== activeIdRef.current) markUnread(sid);
          void applyFrame(frame);
        } else if (frame.type === "approval/requested") {
          setApprovals((prev) => new Map(prev).set(frame.approvalId as string, frame));
        } else if (frame.type === "approval/resolved") {
          setApprovals((prev) => {
            const next = new Map(prev);
            next.delete(frame.approvalId as string);
            return next;
          });
        }
        for (const h of muxHandlers) h(frame);
      },
      () => void 0
    );
    return close;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFrame = async (frame: any) => {
    void frame;
    throttledRefreshSessions();
  };

  const createSession = async (presetId?: string) => {
    const ws = workspaces[0];
    try {
      const res = await api.createSession({ workspaceId: ws?.workspaceId, agentPreset: presetId });
      await forceRefreshSessions();
      setActiveSessionId(res.sessionId);
      return res.sessionId;
    } catch {
      return null;
    }
  };

  const value = useMemo<Store>(
    () => ({
      workspaces,
      sessions,
      engineUp,
      activeSessionId,
      approvals,
      refresh,
      openSession: setActiveSessionId,
      createSession,
      sidebarCollapsed,
      toggleSidebar: () => setSidebarCollapsed((v) => !v),
      pinned,
      unread,
      togglePin,
      markUnread,
      clearUnread,
      subscribeMux: (h) => {
        muxHandlers.add(h);
        return () => muxHandlers.delete(h);
      },
    }),
    [workspaces, sessions, engineUp, activeSessionId, approvals, sidebarCollapsed, pinned, unread, togglePin, markUnread, clearUnread]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
