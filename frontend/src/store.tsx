import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  refresh: () => Promise<void>;
  openSession: (id: string | null) => void;
  createSession: (presetId?: string) => Promise<string | null>;
  forceRefreshSessions: () => Promise<void>;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
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

  const forceRefreshSessions = async () => {
    try {
      const ss = await api.sessions();
      setSessions(ss.items.sort((a, b) => b.updatedAt - a.updatedAt));
    } catch { /* engine restarting; ignore */ }
  };
  const forceRefreshSessionsRef = useRef(forceRefreshSessions);
  forceRefreshSessionsRef.current = forceRefreshSessions;

  const refresh = async () => {
    try {
      const [ws, ss] = await Promise.all([api.workspaces(), api.sessions()]);
      const sorted = ss.items.sort((a, b) => b.updatedAt - a.updatedAt);
      setWorkspaces(ws.items);
      setSessions(sorted);
      setEngineUp(true);
      // Boot policy: always land on a chat — reuse an existing blank session,
      // otherwise create one. No separate "default page" exists.
      setActiveSessionId((cur) => {
        if (cur) return cur;
        const blank = sorted.find((x) => x.blank);
        if (blank) return blank.sessionId;
        const recent = sorted.find((x) => !x.blank);
        if (recent) return recent.sessionId;
        void (async () => {
          const res = await api.createSession({ workspaceId: ws.items[0]?.workspaceId });
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
        setActiveSessionId((cur) => cur ?? sessions2[0] ?? cur);
      }
    };
    const sessions2: any[] = [];
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
    await forceRefreshSessions();
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
      forceRefreshSessions,
      sidebarCollapsed,
      toggleSidebar: () => setSidebarCollapsed((v) => !v),
      subscribeMux: (h) => {
        muxHandlers.add(h);
        return () => muxHandlers.delete(h);
      },
    }),
    [workspaces, sessions, engineUp, activeSessionId, approvals, sidebarCollapsed]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
