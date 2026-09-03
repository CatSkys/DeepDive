import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { onHostEvent, sendToShell } from "./host";
import { setI18nLang } from "./i18n";
import type { ApprovalRequestFrame, MuxFrame, QuestionItem, SessionQueuedItem, SessionSummary, WorkspaceView } from "./types";

// Minimal store: engine lists + the live mux stream. Per-session event log is
// owned by SessionView; the global store keeps list/stream state and relays
// mux frames to subscribers.

type MuxHandler = (frame: MuxFrame) => void;

/** sessionId → workspaceId 归属表。workspace.list.sessionIds 为准；不在任何
 *  空间的会话（引擎未回填的老会话）按 cwd 与空间路径的最长前缀匹配归位；
 *  仍无主 → 第一个空间。无工作空间面时返回空表（全部视为"当前空间"）。 */
function buildWsMap(workspaces: WorkspaceView[], sessions: SessionSummary[]): Map<string, string> {
  const m = new Map<string, string>();
  if (workspaces.length === 0) return m;
  for (const w of workspaces) for (const sid of w.sessionIds ?? []) m.set(sid, w.workspaceId);
  const byPath = (cwd?: string) => {
    if (!cwd) return undefined;
    let hit: WorkspaceView | undefined;
    for (const w of workspaces) {
      const root = w.path.endsWith("/") ? w.path : `${w.path}/`;
      if (cwd === w.path || cwd.startsWith(root)) {
        if (!hit || w.path.length > hit.path.length) hit = w;
      }
    }
    return hit?.workspaceId;
  };
  for (const s of sessions) {
    if (!m.has(s.sessionId)) m.set(s.sessionId, byPath(s.cwd) ?? workspaces[0].workspaceId);
  }
  return m;
}

/** One pending ask_user_question request; rpcId comes from the server-request
 *  envelope and must be echoed back verbatim in the answer. */
export interface PendingQuestion {
  rpcId: string;
  sessionId: string;
  questions: QuestionItem[];
}

interface Store {
  workspaces: WorkspaceView[];
  /** 当前工作空间（侧栏内容 = 新会话落点）；null = 未解析（引擎无 workspace
   *  面或首拉未回）。持久化 key：dsh.workspace（§2.1 记住最后使用的空间）。 */
  activeWorkspaceId: string | null;
  /** sessionId → workspaceId 归属表（workspace.list.sessionIds 摊平）。
   *  无工作空间面时为空表，此时全部会话视为"当前空间"。 */
  wsOfSession: Map<string, string>;
  sessions: SessionSummary[];
  engineUp: boolean;
  activeSessionId: string | null;
  approvals: Map<string, ApprovalRequestFrame & { sessionId: string; rpcId?: string }>;
  questions: Map<string, PendingQuestion>;
  /** 各会话的排队消息（session/queue 帧，全量 items）。 */
  queues: Map<string, SessionQueuedItem[]>;
  openSession: (id: string | null) => void;
  /** 切换工作空间：持久化 + 主区跟随（目标空间最近会话；空空间 → 欢迎页）。 */
  switchWorkspace: (id: string) => void;
  /** 新建（注册）工作空间：目录选择器回传的绝对路径 → workspace.create，
   *  成功后刷新列表并切入该空间。失败弹原生 alert（与右键菜单一致）。 */
  createWorkspace: (path: string) => Promise<string | null>;
  createSession: (presetId?: string) => Promise<string | null>;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /** 侧栏宽（px，200–320，token sidebarMin/Max）。初始值经壳 prefs 推送
   * （NSUserDefaults 持久化，跨重启保留——localStorage 会因端口轮换丢），
   * 拖拽中由 Sidebar 直接写 CSS 变量，落点才回写这里。 */
  sidebarWidth: number;
  setSidebarWidth: (w: number) => void;
  /** 界面语言（壳偏好持久化；默认中文）。 */
  lang: "zh" | "en";
  setLang: (l: "zh" | "en") => void;
  /** 生效明暗（appearance=system 时由壳随系统推送）；驱动 html[data-theme]。 */
  schemeDark: boolean;
  /** 外观模式（跟随系统/亮/暗），壳偏好持久化；壳负责实际生效并推送 schemeDark。 */
  appearance: "system" | "light" | "dark";
  setAppearance: (m: "system" | "light" | "dark") => void;
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
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [engineUp, setEngineUp] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Map<string, ApprovalRequestFrame & { sessionId: string; rpcId?: string }>>(new Map());
  const [questions, setQuestions] = useState<Map<string, PendingQuestion>>(new Map());
  const [queues, setQueues] = useState<Map<string, SessionQueuedItem[]>>(new Map());
  const [muxHandlers] = useState<Set<MuxHandler>>(new Set());
  // 响应式侧栏：窄窗口自动收起，手动开合在同断点内优先；跨越断点时重置。
  const [sidebarOverride, setSidebarOverride] = useState<boolean | null>(null);
  const [narrowViewport, setNarrowViewport] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const onChange = () => {
      setNarrowViewport(mq.matches);
      setSidebarOverride(null);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const sidebarCollapsed = sidebarOverride ?? narrowViewport;
  // 侧栏宽：壳 prefs（host-ready 时推送）为初值；setSidebarWidth 落点持久化。
  const [sidebarWidth, setSidebarWidthState] = useState(240);
  const setSidebarWidth = useCallback((w: number) => {
    const clamped = Math.min(320, Math.max(200, Math.round(w)));
    setSidebarWidthState(clamped);
    sendToShell({ type: "set-pref", key: "sidebarWidth", value: clamped });
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty("--dsh-sidebar-w", `${sidebarWidth}px`);
  }, [sidebarWidth]);
  const [lang, setLangState] = useState<"zh" | "en">("zh");
  const setLang = useCallback((l: "zh" | "en") => {
    setLangState(l);
    sendToShell({ type: "set-pref", key: "language", value: l });
  }, []);
  const [schemeDark, setSchemeDark] = useState(true);
  const [appearance, setAppearanceState] = useState<"system" | "light" | "dark">("dark");
  const setAppearance = useCallback((m: "system" | "light" | "dark") => {
    setAppearanceState(m);
    sendToShell({ type: "set-pref", key: "appearance", value: m });
  }, []);
  // 壳偏好下发（host-ready / get-prefs）：侧栏宽、语言、生效明暗；
  // appearance=system 时系统明暗变化由壳经 themeChanged 实时推送。
  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd === "prefs" && payload) {
      const p = payload as { sidebarWidth?: number; language?: string; schemeDark?: boolean; appearance?: string };
      if (typeof p.sidebarWidth === "number" && p.sidebarWidth >= 200 && p.sidebarWidth <= 320) setSidebarWidthState(p.sidebarWidth);
      if (p.language === "zh" || p.language === "en") setLangState(p.language);
      if (typeof p.schemeDark === "boolean") setSchemeDark(p.schemeDark);
      if (p.appearance === "system" || p.appearance === "light" || p.appearance === "dark") setAppearanceState(p.appearance);
    }
    if (cmd === "themeChanged") {
      const dark = (payload as { dark?: boolean } | undefined)?.dark;
      if (typeof dark === "boolean") setSchemeDark(dark);
    }
  }), []);
  // 生效明暗 → data-theme（代码块等 [data-theme] 规则消费）
  useEffect(() => {
    document.documentElement.dataset.theme = schemeDark ? "dark" : "light";
  }, [schemeDark]);
  useEffect(() => { setI18nLang(lang); }, [lang]);
  // 任务行本地状态:置顶/未读(localStorage 持久化,官方语义)
  const [pinned, setPinned] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem("deepdive.pinned") ?? "[]") as string[]));
  const [unread, setUnread] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem("deepdive.unread") ?? "[]") as string[]));
  const persist = (key: string, set: Set<string>) => localStorage.setItem(key, JSON.stringify([...set]));
  const togglePin = useCallback((id: string) => setPinned((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    persist("deepdive.pinned", next);
    return next;
  }), []);
  const markUnread = useCallback((id: string) => setUnread((prev) => {
    const next = new Set(prev).add(id);
    persist("deepdive.unread", next);
    return next;
  }), []);
  const clearUnread = useCallback((id: string) => setUnread((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    persist("deepdive.unread", next);
    return next;
  }), []);

  // 未读自动接线：打开（或启动落在）某会话即视为已读。
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = activeSessionId;
    if (activeSessionId) clearUnread(activeSessionId);
  }, [activeSessionId, clearUnread]);

  // ── 工作空间状态 ──
  // ref 镜像：refresh 的轮询闭包只捕获首帧，同步读写必须走 ref（同 activeIdRef
  // 手法）；归属表摊平自 workspace.list.sessionIds。
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeWsRef = useRef<string | null>(null);
  useEffect(() => { activeWsRef.current = activeWorkspaceId; }, [activeWorkspaceId]);
  const wsOfSession = useMemo(() => buildWsMap(workspaces, sessions), [workspaces, sessions]);
  const wsOfRef = useRef(wsOfSession);
  wsOfRef.current = wsOfSession;
  const persistActiveWs = (id: string) => {
    activeWsRef.current = id;
    localStorage.setItem("deepdive.workspace", JSON.stringify(id));
    setActiveWorkspaceId(id);
  };

  // workspace.list 的 archivedSessionIds 是归档的唯一事实源。缓存最近一次
  // 成功结果：forceRefresh（点 + / 流式事件节流刷新）和 workspace 请求失败
  // 的降级路径都必须继续过滤归档——否则已归档会话（含用户报告的"不知名
  // 会话"）会在这些路径里整批涌回列表，直到下一次成功的全量刷新才消失，
  // 表现为侧栏/会话池的归档会话周期性闪现。
  const archivedRef = useRef<Set<string>>(new Set());

  const forceRefreshSessions = async () => {
    try {
      const ss = await api.sessions();
      const archived = archivedRef.current;
      setSessions(
        ss.items
          .filter((s) => !archived.has(s.sessionId))
          .sort((a, b) => b.updatedAt - a.updatedAt),
      );
    } catch { /* engine restarting; ignore */ }
    // 同步刷归属表：新会话的 workspace 归属由引擎写回，不刷的话刚建的会话
    // 要等 3s 轮询才归入正确的空间（切空间后列表才见它）。
    try {
      const ws = await api.workspaces();
      workspacesRef.current = ws.items ?? [];
      setWorkspaces(workspacesRef.current);
    } catch { /* keep previous mapping */ }
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

  // 轮询签名：数据没变就不 setState，避免每 3s 一次的全树重渲染
  // （长会话 + 侧栏百余行的场景下这是周期性卡顿的来源）。
  const sessionsSigRef = useRef("");
  const wsSigRef = useRef("");

  const refresh = async () => {
    // workspace.list 面是活的（点号形式，PITFALLS 4.6），且它的
    // archivedSessionIds 是归档的唯一事实源——session.list 不区分已归档，
    // 由客户端过滤。workspace 失败独立降级（用缓存归档集），绝不拖垮会话列表。
    let archived = archivedRef.current;
    let wsItems: WorkspaceView[] = workspacesRef.current;
    try {
      const ws = await api.workspaces();
      wsItems = ws.items ?? [];
      const wsSig = wsItems.map((w) => `${w.workspaceId}:${w.title}:${(w.sessionIds ?? []).length}`).join("|");
      if (wsSig !== wsSigRef.current) {
        wsSigRef.current = wsSig;
        workspacesRef.current = wsItems;
        setWorkspaces(wsItems);
      }
      archived = new Set(ws.archivedSessionIds ?? []);
      archivedRef.current = archived;
    } catch { /* workspace face absent on this engine; keep cached archive set */ }
    try {
      const ss = await api.sessions();
      const sorted = ss.items
        .filter((s) => !archived.has(s.sessionId))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      const sig = sorted
        .map((s) => `${s.sessionId}:${s.updatedAt}:${s.running ? 1 : 0}:${(s.projections?.values as { title?: string } | undefined)?.title ?? ""}`)
        .join("|");
      if (sig !== sessionsSigRef.current) {
        sessionsSigRef.current = sig;
        setSessions(sorted);
      }
      setEngineUp(true);
      // 工作空间解析：持久化的"最后使用空间"已不存在则回退第一个空间；
      // 只在尚未解析时执行一次，之后轮询不覆盖用户的即时切换。
      if (!activeWsRef.current && wsItems.length > 0) {
        let stored: string | null = null;
        try { stored = JSON.parse(localStorage.getItem("deepdive.workspace") ?? "null"); } catch { /* corrupt */ }
        const resolved = (wsItems.find((w) => w.workspaceId === stored) ?? wsItems[0])?.workspaceId ?? null;
        if (resolved) {
          activeWsRef.current = resolved;
          setActiveWorkspaceId(resolved);
        }
      }
      // 会话→空间归属：用本 tick 的数据现算（wsOfSession 的 memo 镜像要等
      // 重渲染才更新，boot 策略等不得），并同步回 ref 供即时读取。
      const wsMap = buildWsMap(wsItems, sorted);
      wsOfRef.current = wsMap;
      const widOf = (sid: string) =>
        wsItems.length === 0 ? undefined : (wsMap.get(sid) ?? wsItems[0].workspaceId);
      // Deep link: ?sid=… opens a specific session on boot (verification aid).
      const sid = new URLSearchParams(location.search).get("sid");
      if (sid && sorted.some((x) => x.sessionId === sid)) {
        const wid = widOf(sid);
        if (wid && wid !== activeWsRef.current) persistActiveWs(wid);
      }
      // Boot policy: always land on a fresh composer — reuse an existing
      // blank session, otherwise create one. Never auto-open a history
      // session: the old "most recent non-blank" fallback resurrected a
      // forgotten session on every relaunch (user report).
      setActiveSessionId((cur) => {
        if (cur) return cur;
        if (sid && sorted.some((x) => x.sessionId === sid)) return sid;
        // 空会话复用限定在当前空间内——别的空间的 blank 不是"我的新会话"。
        const blank = sorted.find((x) => x.blank && widOf(x.sessionId) === activeWsRef.current);
        if (blank) return blank.sessionId;
        void (async () => {
          const res = await api.createSession({ workspaceId: activeWsRef.current ?? wsItems[0]?.workspaceId });
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
      (frame: MuxFrame, rpcId?: string) => {
        if (frame.type === "session/event") {
          // 非当前会话的新动态 → 未读（当前会话正在看，不打点）。
          const sid = (frame as { sessionId?: string }).sessionId;
          if (sid && sid !== activeIdRef.current) markUnread(sid);
          void applyFrame(frame);
        } else if (frame.type === "approval/requested") {
          // rpcId（信封上）必须随帧保存：/api/respond 严格按它查 pending 表。
          const a = frame as ApprovalRequestFrame;
          setApprovals((prev) => new Map(prev).set(a.approvalId, { ...a, rpcId }));
        } else if (frame.type === "approval/resolved") {
          setApprovals((prev) => {
            const next = new Map(prev);
            next.delete((frame as { approvalId: string }).approvalId);
            return next;
          });
        } else if (frame.type === "session/queue") {
          // 排队消息全量快照（engine 每次变化广播）。
          const q = frame as { sessionId: string; items?: SessionQueuedItem[] };
          setQueues((prev) => new Map(prev).set(q.sessionId, q.items ?? []));
        } else if (frame.type === "question/requested") {
          if (rpcId) {
            const q = frame as { sessionId: string; questions: QuestionItem[] };
            setQuestions((prev) => new Map(prev).set(rpcId, { rpcId, sessionId: q.sessionId, questions: q.questions }));
          }
        } else if (frame.type === "question/resolved") {
          const rid = (frame as { questionRpcId?: string }).questionRpcId;
          if (rid) {
            setQuestions((prev) => {
              const next = new Map(prev);
              next.delete(rid);
              return next;
            });
          }
        }
        for (const h of muxHandlers) h(frame);
      },
      () => void 0
    );
    return close;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFrame = async (frame: MuxFrame) => {
    void frame;
    throttledRefreshSessions();
  };

  // 跨空间打开（搜索结果/深链/通知推达）：会话属于哪个空间就同步切过去，
  // 侧栏列表、顶栏胶囊、新会话落点三者才能保持一致。
  const openSession = useCallback((id: string | null) => {
    if (id) {
      const wid = wsOfRef.current.get(id) ?? workspacesRef.current[0]?.workspaceId;
      if (wid && wid !== activeWsRef.current) persistActiveWs(wid);
    }
    setActiveSessionId(id);
  }, []);

  // 切换工作空间：持久化 + 主区跟随——目标空间最近的一个会话（sessions 已按
  // updatedAt 降序，blank 也算：渲染即欢迎页头）；空空间 → hero（id=null）。
  const switchWorkspace = useCallback((id: string) => {
    if (id === activeWsRef.current) return;
    persistActiveWs(id);
    const list = workspacesRef.current;
    const target = sessionsRef.current.find(
      (s) => (wsOfRef.current.get(s.sessionId) ?? list[0]?.workspaceId) === id,
    );
    setActiveSessionId(target?.sessionId ?? null);
  }, []);

  const createSession = async (presetId?: string) => {
    const wsId = activeWsRef.current ?? workspacesRef.current[0]?.workspaceId;
    // Optimistic switch: leave the current session immediately so the
    // create round-trip never lingers on (and looks like a flash-back of)
    // the old conversation. App renders its hero while active is null; the
    // 3s poll's boot policy may also land on any blank session meanwhile —
    // both render the same empty composer, so nothing visibly flickers.
    setActiveSessionId(null);
    try {
      const res = await api.createSession({ workspaceId: wsId, agentPreset: presetId });
      await forceRefreshSessions();
      setActiveSessionId(res.sessionId);
      return res.sessionId;
    } catch {
      // 创建失败：留在 hero，轮询 boot policy 会自动兜底选/建会话。
      return null;
    }
  };

  // 注册（新建）工作空间：workspace.create 对已有目录幂等（created:false
  // 表示本就注册过）。刷新归属表后切入新空间——空空间落欢迎页。
  const createWorkspace = useCallback(async (path: string) => {
    try {
      const res = await api.workspaceCreate({ path });
      await forceRefreshSessionsRef.current();
      const wsId = res.workspace?.workspaceId;
      if (wsId) switchWorkspace(wsId);
      return wsId ?? null;
    } catch (err) {
      alert(`添加工作空间失败：${(err as Error).message}`);
      return null;
    }
  }, [switchWorkspace]);

  const value = useMemo<Store>(
    () => ({
      workspaces,
      activeWorkspaceId,
      wsOfSession,
      sessions,
      engineUp,
      activeSessionId,
      approvals,
      questions,
      queues,
      refresh,
      openSession,
      switchWorkspace,
      createWorkspace,
      createSession,
      sidebarCollapsed,
      sidebarWidth,
      setSidebarWidth,
      lang,
      setLang,
      schemeDark,
      appearance,
      setAppearance,
      toggleSidebar: () => setSidebarOverride(!(sidebarOverride ?? narrowViewport)),
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
    // AUD-027 约定：refresh/createSession 是渲染期函数（全部可变量经 ref 读取），
    // 进 deps 会让 value 每次渲染重建——ref 镜像约定下显式排除，P2-6 snapshot
    // store 决策时一并处理；其余稳定标识（useCallback/useState）如实入表。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaces, activeWorkspaceId, wsOfSession, sessions, engineUp, activeSessionId, approvals, questions, queues, openSession, switchWorkspace, createWorkspace, muxHandlers, sidebarCollapsed, sidebarWidth, setSidebarWidth, lang, setLang, schemeDark, appearance, setAppearance, sidebarOverride, narrowViewport, pinned, unread, togglePin, markUnread, clearUnread]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
