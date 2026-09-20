import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, type ControlFrame, type WorkspaceFollowFrame } from "./api";
import { DEFAULT_RETENTION, RETENTIONS, type ArchiveRetention } from "./autoArchive";
import { converged, visibleArchived, visibleSessions } from "./sessionOverrides";
import { backgroundTier, isHiddenSession, isSidebarSession } from "./session/backgroundSession";
import { onHostEvent, sendToShell, sessionAdminSync, setQuietSessions } from "./host";
import type { AgentPreset } from "./api";
import { mux } from "./mux";
import { usePrefs } from "./prefs";
import type { KeybindOverrides } from "./keybinds";
import type { ApprovalPending, QuestionItem, QuestionPending, SessionQueuedItem, SessionSummary, WorkspaceView } from "./types";

// Minimal store: engine lists + the live event stream (0.1.2: $events 转发流 +
// session/control + workspace/follow，全部复用 mux.ts 的单条 remote.mux 连接)。
// Per-session event log is owned by SessionView（自开 session/follow 流）；
// the global store keeps list/stream state and relays control frames to
// subscribers.

type ControlHandler = (frame: ControlFrame) => void;

/** sessionId → workspaceId 归属表。workspace follow 的 sessionIds 为准；不在任何
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

interface Store {
  workspaces: WorkspaceView[];
  /** 归档会话全集（workspace follow 的 archivedSessionIds；归档唯一事实源）。 */
  archived: Set<string>;
  /** 当前工作空间（侧栏内容 = 新会话落点）；null = 未解析（引擎无 workspace
   *  面或首拉未回）。持久化 key：dsh.workspace（§2.1 记住最后使用的空间）。 */
  activeWorkspaceId: string | null;
  /** sessionId → workspaceId 归属表（workspace follow 的 sessionIds 摊平）。
   *  无工作空间面时为空表，此时全部会话视为"当前空间"。 */
  wsOfSession: Map<string, string>;
  sessions: SessionSummary[];
  /** 用户列表这一层：`sessions` 再去掉子代理派生会话（侧栏/搜索/切换空间/自动归档
   *  共用一份口径——各处自己 filter 一遍就是漏一处的开始）。 */
  sidebarSessions: SessionSummary[];
  /** 引擎 Agent 会话预设（agentPresets/list 一次性拉取；失败为空 = 隐藏入口）。 */
  presets: AgentPreset[];
  /** hero 页选中的会话模式；createSession 未显式传参时作为 agentPreset。 */
  heroPreset: string | undefined;
  setHeroPreset: (id: string) => void;
  engineUp: boolean;
  /** 壳给的引擎状态（退避重试/放弃只有壳知道）：banner 文案与重试入口的依据。 */
  enginePhase: "idle" | "launching" | "ready" | "restarting" | "failed";
  engineFailureReason: string | null;
  /** 失败时随状态推来的引擎日志尾部（诊断用；原生恢复窗的「复制诊断」搬到内置面）。 */
  engineFailureTail: string | null;
  /** 壳正在退避重试的第几次（0 = 不在重试中）。 */
  engineRestartingAttempt: number;
  /** 请壳重启引擎（失败态下的「重试」）。 */
  restartEngine: () => void;
  /** 曾成功连上引擎。启动期引擎未起不算断线——横幅只在「掉过线」时出现。 */
  everConnected: boolean;
  activeSessionId: string | null;
  approvals: Map<string, ApprovalPending>;
  questions: Map<string, QuestionPending>;
  /** 应答/取消成功后的本地结算清卡（审批/提问共用）：网关不给应答者回
   *  cancel 帧（应答时该客户端的 delivery 已先摘除，gateway
   *  receiveRemoteEventResult → finishRemoteEvent），卡片移除以本地结算
   *  为准——官方客户端 answer().then(clear) 同款；cancel 帧仍保留，兜
   *  多端与引擎侧撤销。 */
  settleEvent: (eventId: string) => void;
  /** 各会话的排队消息（session/control 帧，全量 items）。 */
  queues: Map<string, SessionQueuedItem[]>;
  /** 各会话的后台任务快照（session/control 帧，5.3）。 */
  jobsBySession: Map<string, import("./types").JobView[]>;
  openSession: (id: string | null) => void;
  /** 切换工作空间：持久化 + 主区跟随——目标空间最近的一个会话（sessions 已按
   *  updatedAt 降序，blank 也算：渲染即欢迎页头）；空空间 → 欢迎页（id=null）。
   *  opts.keepDraft：切完留在草稿页（hero 项目菜单用——继续写新会话，不跳进
   *  目标空间的历史会话）。 */
  switchWorkspace: (id: string, opts?: { keepDraft?: boolean }) => void;
  /** 新建（注册）工作空间：目录选择器回传的绝对路径 → workspace/create，
   *  成功后刷新列表并切入该空间。失败经 error 带出，弹窗归调用方（词典键
   *  「添加工作空间失败：{m}」），store 自身不碰 UI 文案。 */
  createWorkspace: (path: string) => Promise<{ workspaceId: string | null; error?: string }>;
  /** 建会话。activate=false：建好但**不切过去**（草稿页首条消息专用——发送真正
   *  成功才切，失败时草稿与附件留在原地可重试）。 */
  createSession: (presetId?: string, opts?: { activate?: boolean }) => Promise<string | null>;
  /** 草稿模型：新会话页（hero）上选的模型。此时会话尚未真正创建，先暂存；
   *  首条消息触发 createSession 时随新会话 selectModel 一次性带走并清空。 */
  draftModel: { provider: string; model: string; reasoningEffort?: string } | null;
  setDraftModel: (m: { provider: string; model: string; reasoningEffort?: string } | null) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /** 侧栏宽（px，200–320，token sidebarMin/Max）。初始值经壳 prefs 推送
   *  （NSUserDefaults 持久化，跨重启保留——localStorage 会因端口轮换丢），
   *  拖拽中由 Sidebar 直接写 CSS 变量，落点才回写这里。 */
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
  /** 应用内快捷键覆盖（id → {combo?, off?}），壳偏好持久化 JSON 串。 */
  keybinds: KeybindOverrides;
  setKeybinds: (next: KeybindOverrides) => void;
  /** 全局热键（唤起面板）启用开关，壳偏好持久化；关 = 系统级注销。 */
  hotkeyOn: boolean;
  /** 自进化总开关（壳持久化；设置→自进化 的开关就是它，管线消费同一份状态）。 */
  evolutionEnabled: boolean;
  setEvolutionEnabled: (v: boolean) => void;
  /** 会话记忆开关（壳持久化；设置→记忆）。 */
  sessionMemoryEnabled: boolean;
  /** 会话记忆开着却没生效时的原因（壳给）；空 = 正常。 */
  sessionMemoryBlocked: string | null;
  setSessionMemoryEnabled: (v: boolean) => void;
  /** 后台会话的处置判据（标题即判据，见 session/backgroundSession.ts）：allSessions 保留。 */
  backgroundTier: typeof backgroundTier;
  setHotkeyOn: (v: boolean) => void;
  /** 自动归档开关（客户端偏好，localStorage；默认关——归档单向不可撤销）。 */
  autoArchive: boolean;
  setAutoArchive: (v: boolean) => void;
  /** 归档保留时长档。 */
  archiveRetention: ArchiveRetention;
  setArchiveRetention: (v: ArchiveRetention) => void;
  /** 引擎原始会话列表（**含已归档**）：仅使用统计这类"全量历史"视图用，
   *  常规列表请用 `sessions`（已按归档与本地删除过滤）。 */
  allSessions: SessionSummary[];
  /** 本地取消归档 / 本地删除的会话（视图即时生效；引擎状态在下次启动空窗期收敛）。 */
  unarchived: Set<string>;
  removed: Set<string>;
  unarchiveSession: (id: string) => void;
  /** 删除会话（不可逆）：只接受既没在跑、也不是当前打开的那个。
   *  拒绝原因回给调用方去说人话（store 不碰 UI 文案）。 */
  removeSession: (id: string) => { ok: true } | { ok: false; reason: "running" | "active" };
  /** 引擎侧归档落地时清掉本地"已取消归档"覆盖。 */
  clearUnarchiveOverride: (id: string) => void;
  /** 归档会话（侧栏行/右键/命令面板唯一入口）：引擎落账 + 清掉本地"已取消
   *  归档"覆盖 + 刷新。失败回引擎错误文本（调用方弹窗），成功回 null。 */
  archiveSession: (id: string) => Promise<string | null>;
  pinned: Set<string>;
  unread: Set<string>;
  togglePin: (id: string) => void;
  markUnread: (id: string) => void;
  clearUnread: (id: string) => void;
  refresh: () => Promise<void>;
  /** 订阅 session/control 帧（投影实时整值——goal/plan 等；队列/任务已由
   *  store 自身消费，订阅方收到的是同一帧流）。 */
  subscribeControl: (handler: ControlHandler) => () => void;
}

// 任务行本地状态:置顶/未读/覆盖集(localStorage 持久化,官方语义)；值损坏回退空集
// （与 deepdive.workspace 键的 corrupt 防护同策略）
function readIdSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch { /* corrupt localStorage value → 空集 */ }
  return new Set();
}
function persistIdSet(key: string, set: Set<string>): void {
  localStorage.setItem(key, JSON.stringify([...set]));
}

const Ctx = createContext<Store>(null as unknown as Store);
export const useStore = () => useContext(Ctx);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([]);
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const [heroPreset, setHeroPreset] = useState<string | undefined>(undefined);
  const [engineUp, setEngineUp] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [enginePhase, setEnginePhase] = useState<Store["enginePhase"]>("idle");
  const [engineFailureReason, setEngineFailureReason] = useState<string | null>(null);
  const [engineFailureTail, setEngineFailureTail] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Map<string, ApprovalPending>>(new Map());
  const [questions, setQuestions] = useState<Map<string, QuestionPending>>(new Map());
  const [queues, setQueues] = useState<Map<string, SessionQueuedItem[]>>(new Map());
  const [jobsBySession, setJobsBySession] = useState<Map<string, import("./types").JobView[]>>(new Map());
  const [controlHandlers] = useState<Set<ControlHandler>>(new Set());
  // 响应式侧栏：窄窗口自动收起，手动开合在同断点内优先；跨越断点时重置。
  const [sidebarOverride, setSidebarOverride] = useState<boolean | null>(null);
  const [narrowViewport, setNarrowViewport] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  );
  const [engineRestartingAttempt, setEngineRestartingAttempt] = useState(0);
  const restartEngine = useCallback(() => sendToShell({ type: "restart-engine" }), []);
  /** 立即取一次数（不等 3s 轮询）——引擎就绪那一刻要用；refresh 定义在后，经 ref 传递。 */
  const refreshRef = useRef<(() => void) | null>(null);
  // 壳的引擎状态推送（退避重试/放弃只有壳知道）→ banner 文案与重试入口。
  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd !== "engineState") return;
    const p = payload as { phase?: string; attempt?: number; reason?: string; tail?: string } | undefined;
    const phase = p?.phase;
    if (phase !== "idle" && phase !== "launching" && phase !== "ready" && phase !== "restarting" && phase !== "failed") return;
    setEnginePhase(phase);
    setEngineFailureReason(phase === "failed" ? (p?.reason ?? "") : null);
    setEngineFailureTail(phase === "failed" ? (p?.tail ?? "") : null);
    setEngineRestartingAttempt(phase === "restarting" ? (p?.attempt ?? 0) : 0);
    // 就绪即立刻取数：轮询是 3s 一跳，等下一跳会让骨架屏在引擎已好之后还挂几秒
    //（交接要跟手）。壳不再因引擎就绪整页重载 SPA（那样交接处会白屏断一下）。
    if (phase === "ready") {
      const kick = refreshRef.current;
      if (kick) kick();
    }
  }), []);

  // Agent 会话预设目录（失败 = 引擎无预设面，选择器/胶囊显式不渲染）。启动期引擎
  // 还没起（RPC 503），就绪后补取一次——这是原来靠"就绪即重载整页"掩盖掉的那批
  // 一次性取数之一，重载去掉后必须自己补上。
  useEffect(() => {
    if (!engineUp) return;
    api.agentPresets().then((r) => setPresets(r?.presets ?? [])).catch(() => void 0);
  }, [engineUp]);
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
  const prefs = usePrefs();
  const {
    sidebarWidth, setSidebarWidth,
    lang, setLang,
    schemeDark,
    appearance, setAppearance,
    keybinds, setKeybinds,
    hotkeyOn, setHotkeyOn,
    evolutionEnabled, setEvolutionEnabled,
    sessionMemoryEnabled, setSessionMemoryEnabled,
    sessionMemoryBlocked,
  } = prefs;
  /** 单值偏好读取：无 localStorage（受限环境）或值非法一律回退默认。 */
  const readPref = <T,>(key: string, fallback: T, parse: (raw: string) => T | null): T => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : (parse(raw) ?? fallback);
    } catch { /* 无 localStorage（测试/受限环境）→ 默认 */ }
    return fallback;
  };
  const [autoArchive, setAutoArchiveState] = useState(() =>
    readPref("deepdive.autoArchive", false, (raw) => raw === "1"));
  const [archiveRetention, setArchiveRetentionState] = useState<ArchiveRetention>(() =>
    readPref("deepdive.archiveRetention", DEFAULT_RETENTION, (raw) =>
      (RETENTIONS.some((r) => r.id === raw) ? (raw as ArchiveRetention) : null)));
  const setAutoArchive = useCallback((v: boolean) => {
    localStorage.setItem("deepdive.autoArchive", v ? "1" : "0");
    setAutoArchiveState(v);
  }, []);
  const setArchiveRetention = useCallback((v: ArchiveRetention) => {
    localStorage.setItem("deepdive.archiveRetention", v);
    setArchiveRetentionState(v);
  }, []);
  const [unarchived, setUnarchived] = useState<Set<string>>(() => readIdSet("deepdive.unarchived"));
  const [removedLocal, setRemovedLocal] = useState<Set<string>>(() => readIdSet("deepdive.removed"));
  const [pinned, setPinned] = useState<Set<string>>(() => readIdSet("deepdive.pinned"));
  const [unread, setUnread] = useState<Set<string>>(() => readIdSet("deepdive.unread"));

  /** 覆盖集变动：落盘 + 同步壳（壳只在引擎未起的空窗期落到引擎状态文件）。
   *  副作用全部在调用处完成，setState 只收快照（PITFALLS §8.3）。 */
  const overridesRef = useRef({ unarchived, removed: removedLocal });
  overridesRef.current = { unarchived, removed: removedLocal };
  const applyOverrides = useCallback((nextUnarchived: Set<string>, nextRemoved: Set<string>) => {
    setUnarchived(nextUnarchived);
    setRemovedLocal(nextRemoved);
    persistIdSet("deepdive.unarchived", nextUnarchived);
    persistIdSet("deepdive.removed", nextRemoved);
    sessionAdminSync({ unarchived: [...nextUnarchived], removed: [...nextRemoved] });
  }, []);
  /** 取消归档：本地即时生效（引擎状态在下次启动空窗期收敛）。 */
  const unarchiveSession = useCallback((id: string) => {
    const cur = overridesRef.current;
    applyOverrides(new Set(cur.unarchived).add(id), cur.removed);
  }, [applyOverrides]);
  /** 删除：本地即时摘掉（日志目录由壳同步删除，见 bridge 调用方）。
   *  不可逆，所以只认"既没在跑、也没正开着"的会话——运行中删日志目录，引擎
   *  会继续往一个已删的会话里写；删掉正开着的那个，用户就对着空气打字了。 */
  const removeSession = useCallback((id: string) => {
    if (id === activeIdRef.current) return { ok: false as const, reason: "active" as const };
    if (sessionsRef.current.some((s) => s.sessionId === id && s.running)) return { ok: false as const, reason: "running" as const };
    const cur = overridesRef.current;
    const nextUnarchived = new Set(cur.unarchived);
    nextUnarchived.delete(id);
    applyOverrides(nextUnarchived, new Set(cur.removed).add(id));
    return { ok: true as const };
  }, [applyOverrides]);
  /** 引擎侧归档落地时，清掉本地的"已取消归档"覆盖（同一会话不能再被本地视图放出来）。 */
  const clearUnarchiveOverride = useCallback((id: string) => {
    const cur = overridesRef.current;
    if (!cur.unarchived.has(id)) return;
    const next = new Set(cur.unarchived);
    next.delete(id);
    applyOverrides(next, cur.removed);
  }, [applyOverrides]);
  /** 归档：三个入口（侧栏行 / 右键菜单 / 命令面板）共用——旧写法各抄一遍，
   *  漏了清覆盖集的那两处看起来像"归档点了没反应"。 */
  const archiveSession = useCallback(async (id: string) => {
    try {
      await api.workspaceArchiveSession({ sessionId: id });
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    clearUnarchiveOverride(id);
    await forceRefreshSessionsRef.current();
    return null;
  }, [clearUnarchiveOverride]);
  // 覆盖项收敛：引擎（下次启动后）不再报告某会话已归档 / 不再列出某会话时，
  // 本地覆盖就没用了——丢掉它，避免覆盖集无限增长。
  /** 收敛的前提是"真值到了"：归档集要等 workspace follow 的基线、会话列表要
   *  等首次刷新。缺了这道门，挂载瞬间（archived/removed 覆盖集已从 localStorage
   *  读回、archived 与 sessions 还是空集）会把**所有**覆盖项判成"引擎已不报告"
   *  而整批抹掉——连壳里待落账的登记一起（2026-09 修的：取消归档活不过一次
   *  应用内引擎重启）。 */
  const truthArrivedRef = useRef({ archived: false, sessions: false });
  useEffect(() => {
    if (unarchived.size === 0 && removedLocal.size === 0) return;
    if (!truthArrivedRef.current.archived || !truthArrivedRef.current.sessions) return;
    const liveArchive = archivedRef.current;
    const liveIds = new Set(sessions.map((s) => s.sessionId));
    const gone = converged(liveArchive, liveIds, unarchived, removedLocal);
    if (gone.unarchived.length === 0 && gone.removed.length === 0) return;
    const nextU = new Set(unarchived);
    for (const id of gone.unarchived) nextU.delete(id);
    const nextR = new Set(removedLocal);
    for (const id of gone.removed) nextR.delete(id);
    applyOverrides(nextU, nextR);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archived, sessions, unarchived, removedLocal]);

  const togglePin = useCallback((id: string) => setPinned((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    persistIdSet("deepdive.pinned", next);
    return next;
  }), []);
  const markUnread = useCallback((id: string) => setUnread((prev) => {
    const next = new Set(prev).add(id);
    persistIdSet("deepdive.unread", next);
    return next;
  }), []);
  const clearUnread = useCallback((id: string) => setUnread((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    persistIdSet("deepdive.unread", next);
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
  // 手法）；归属表摊平自 workspace follow 的 sessionIds。
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

  // workspace follow 的 archivedSessionIds 是归档的唯一事实源（基线+增量全量
  // 集）；缓存供会话列表过滤——流断档期间也继续过滤，已归档会话才不会在
  // 轮询路径整批涌回列表（2026-09 用户报告的周期性闪现即此因）。
  const archivedRef = useRef<Set<string>>(new Set());
  const syncArchived = (ids: string[]) => {
    const next = new Set(ids);
    archivedRef.current = next;
    setArchived(next);
  };
  // 工作空间解析（持久化的"最后使用空间"已不存在则回退第一个空间）只在
  // 尚未解析时执行一次，流增量不覆盖用户的即时切换。
  const resolveActiveWs = (items: WorkspaceView[]) => {
    if (activeWsRef.current || items.length === 0) return;
    let stored: string | null = null;
    try { stored = JSON.parse(localStorage.getItem("deepdive.workspace") ?? "null"); } catch { /* corrupt */ }
    const resolved = (items.find((w) => w.workspaceId === stored) ?? items[0])?.workspaceId ?? null;
    if (resolved) {
      activeWsRef.current = resolved;
      setActiveWorkspaceId(resolved);
    }
  };
  useEffect(() => {
    return api.openWorkspaces((frame: WorkspaceFollowFrame) => {
      if (frame.type === "baseline") {
        workspacesRef.current = frame.value.items;
        setWorkspaces(frame.value.items);
        syncArchived(frame.value.archivedSessionIds ?? []);
        truthArrivedRef.current.archived = true;
        resolveActiveWs(frame.value.items);
        return;
      }
      const items = workspacesRef.current;
      if (frame.type === "upsert") {
        const next = items.filter((w) => w.workspaceId !== frame.workspace.workspaceId).concat(frame.workspace);
        workspacesRef.current = next;
        setWorkspaces(next);
      } else if (frame.type === "remove") {
        const next = items.filter((w) => w.workspaceId !== frame.workspaceId);
        workspacesRef.current = next;
        setWorkspaces(next);
      } else if (frame.type === "order") {
        const byId = new Map(items.map((w) => [w.workspaceId, w]));
        const next = frame.workspaceIds.map((id) => byId.get(id)).filter((w): w is WorkspaceView => w !== undefined);
        workspacesRef.current = next;
        setWorkspaces(next);
      } else if (frame.type === "archived") {
        syncArchived(frame.archivedSessionIds ?? []);
      }
    });
  }, []);

  /** 视图侧的归档集：摘掉本地取消归档与已删除（轮询过滤与导出共用同一口径）。 */
  const archivedVisible = () => visibleArchived(archivedRef.current, overridesRef.current.unarchived, overridesRef.current.removed);

  const forceRefreshSessions = async () => {
    try {
      const ss = await api.sessions();
      setSessions(
        ss.items.slice().sort((a, b) => b.updatedAt - a.updatedAt),
      );
    } catch { /* engine restarting; ignore */ }
  };
  const forceRefreshSessionsRef = useRef(forceRefreshSessions);
  forceRefreshSessionsRef.current = forceRefreshSessions;

  // $events 的会话活动通知每条都到；一次全量 session/list 刷新会敲引擎并整树
  // 重渲染。前沿立即触发（turn 起止要快翻 Stop 按钮），随后在事件持续期间
  // 合并为至多每 500ms 一次。
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
  // 哨兵必须是 null 而非 ""：全部会话归档/删除时可见签名恒为 ""，与 ""
  // 初始值相等会让 setSessions 一次都不执行、allSessions 永远为空
  // （使用统计的取数清单被饿死而全 0，2026-09-13）。
  const sessionsSigRef = useRef<string | null>(null);

  const refresh = async () => {
    // session/list 轮询负责列表元数据与投影（workspace 面由 follow 流驱动，
    // 不在轮询里重复拉）；归档过滤用流缓存的 archived 集。
    try {
      const ss = await api.sessions();
      const sorted = ss.items.slice().sort((a, b) => b.updatedAt - a.updatedAt);
      // 归档过滤不在写入时做：本列表是**引擎原始列表**，归档/删除的本地覆盖在
      // 导出层过滤（否则取消归档后会话不在内存里，要等下一次轮询才回侧栏）。
      const sig = visibleSessions(sorted.filter((s) => !archivedVisible().has(s.sessionId)), overridesRef.current.removed)
        .map((s) => `${s.sessionId}:${s.updatedAt}:${s.running ? 1 : 0}:${(s.projections?.values as { title?: string } | undefined)?.title ?? ""}`)
        .join("|");
      if (sig !== sessionsSigRef.current) {
        sessionsSigRef.current = sig;
        setSessions(sorted);
      }
      // 直播期望看门狗（PITFALLS §4.10 变种）：任一会话在跑（引擎确实在产出
      // 事件）而整条 mux 连接静默超窗——连接或桥中继已哑（实测：中继被误杀后
      // WS 表面健康、快照后一帧不再到达）。无条件弃旧重建：重连各流重发快照，
      // 健康连接误杀代价仅为一次全量替换；静默计时在重连时复位（mux.connect），
      // 哑火连接不会被每个 tick 连环重建。长工具静默会误触发，但重建无副作用。
      if (sorted.some((s) => s.running) && mux.stalled) {
        mux.recycle();
      }
      setEngineUp(true);
      setEverConnected(true);
      truthArrivedRef.current.sessions = true;
      resolveActiveWs(workspacesRef.current);
      // 会话→空间归属：用本 tick 的数据现算（wsOfSession 的 memo 镜像要等
      // 重渲染才更新，boot 策略等不得），并同步回 ref 供即时读取。
      const wsMap = buildWsMap(workspacesRef.current, sorted);
      wsOfRef.current = wsMap;
      // 深链：?sid=… 打开指定会话（Playwright 验证 / 通知落地备用路径）。
      // 只消费一次——导航成功即从地址栏剥掉参数，否则用户此后每次回到草稿页
      // （active=null）都会被 3s 轮询按残留参数拉回这个旧会话。
      const sid = new URLSearchParams(location.search).get("sid");
      if (sid && sorted.some((x) => x.sessionId === sid)) {
        const wid = wsMap.get(sid) ?? workspacesRef.current[0]?.workspaceId;
        if (wid && wid !== activeWsRef.current) persistActiveWs(wid);
        if (!activeIdRef.current) {
          history.replaceState(null, "", location.pathname);
          setActiveSessionId(sid);
        }
      }
      // Boot policy：落在草稿页（hero，active=null）。真实会话只在首条消息
      // 发出时经 createSession 创建（新会话语义：点「新建会话」只是切页，
      // 不发消息不产生会话——旧策略"复用/自动建 blank 会话"每次冷启动都会
      // 在侧栏堆一条空"新会话"）。也绝不自动打开历史会话（旧"最近非空"
      // 回退会在每次重启复活被遗忘的会话，用户报告）。
    } catch {
      setEngineUp(false);
      // 引擎不可达时"运行中"是陈旧的：这条轮询失败说明读不到状态，而引擎退出
      // 意味着正在跑的那一轮已经不在了。留着 running 会让侧栏一直转圈、停止按钮
      // 点了也没用（旧实现：停止请求被静默吞掉）。重连后引擎给回真值。
      setSessions((prev) => (prev.some((s) => s.running)
        ? prev.map((s) => (s.running ? { ...s, running: false } : s))
        : prev));
    }
  };

  // ref 镜像（副作用只在 handler/effect 里跑，渲染期只做这次赋值）：上面的
  // engineState 「ready」分支要能立刻取一次数，而 refresh 定义在此处之后。
  refreshRef.current = refresh;

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

  // $events 转发流（0.1.2）：emit 通知 + 审批/提问 waterfall + 取消。
  const settleEvent = useCallback((eventId: string) => {
    const drop = <T,>(prev: Map<string, T>): Map<string, T> => {
      if (!prev.has(eventId)) return prev;
      const next = new Map(prev);
      next.delete(eventId);
      return next;
    };
    setApprovals(drop);
    setQuestions(drop);
  }, []);
  useEffect(() => {
    return api.onEvents({
      onEmit: (event, args) => {
        if (event === "api-session/activity" || event === "api-session/status"
          || event === "api-session/added" || event === "api-session/removed" || event === "api-session/error") {
          // 非当前会话的新动态 → 未读（当前会话正在看，不打点）。
          const sid = typeof args[0] === "string" ? args[0] : undefined;
          if (sid && sid !== activeIdRef.current && event !== "api-session/status") markUnread(sid);
          throttledRefreshSessions();
        }
      },
      onWaterfall: (frame) => {
        if (frame.event === "approval/request") {
          const request = frame.request as { toolName?: string; callId?: string; reason?: string };
          setApprovals((prev) => new Map(prev).set(frame.eventId, {
            eventId: frame.eventId,
            sessionId: frame.agentId,
            toolName: request.toolName ?? "工具调用",
            ...(request.callId === undefined ? {} : { callId: request.callId }),
            ...(request.reason === undefined ? {} : { reason: request.reason }),
          }));
        } else if (frame.event === "user-questions/request") {
          const request = frame.request as { questions?: QuestionItem[] };
          setQuestions((prev) => new Map(prev).set(frame.eventId, {
            eventId: frame.eventId,
            sessionId: frame.agentId,
            questions: request.questions ?? [],
          }));
        }
      },
      onCancel: (eventId) => {
        // 引擎侧撤销挂起交互：按 eventId 配对移除（审批/提问共用）。
        settleEvent(eventId);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // session/control 流（0.1.2）：全 host 队列/后台任务/投影的实时面（基线
  // + 逐会话增量，每代先全量后增量）。
  useEffect(() => {
    return api.openControl((frame: ControlFrame) => {
      if (frame.type === "baseline") {
        setQueues(new Map(Object.entries(frame.value.queues ?? {})));
        setJobsBySession(new Map(Object.entries(frame.value.jobs ?? {})));
      } else if (frame.type === "queue") {
        setQueues((prev) => new Map(prev).set(frame.sessionId, frame.items ?? []));
      } else if (frame.type === "jobs") {
        setJobsBySession((prev) => new Map(prev).set(frame.sessionId, frame.jobs ?? []));
      }
      for (const h of controlHandlers) h(frame);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // keepDraft：切完留在草稿页（hero 项目菜单用——继续写新会话，不跳进
  // 目标空间的历史会话）。
  const switchWorkspace = useCallback((id: string, opts?: { keepDraft?: boolean }) => {
    if (id === activeWsRef.current) return;
    persistActiveWs(id);
    if (opts?.keepDraft) {
      setActiveSessionId(null);
      return;
    }
    const list = workspacesRef.current;
    // 落点必须是用户在侧栏看得见的那一层：归档/本地删/隐藏的后台运行/子代理
    // 会话都可能是"该空间最近更新的那条"，跟进去了就是对着机器会话发呆。
    const target = sidebarSessionsRef.current.find(
      (s) => (wsOfRef.current.get(s.sessionId) ?? list[0]?.workspaceId) === id,
    );
    setActiveSessionId(target?.sessionId ?? null);
  }, []);

  // 草稿模型（见 Store 接口注释）；ref 镜像供 createSession 闭包读取。
  const [draftModel, setDraftModel] = useState<{ provider: string; model: string; reasoningEffort?: string } | null>(null);
  const draftModelRef = useRef(draftModel);
  draftModelRef.current = draftModel;
  const heroPresetRef = useRef(heroPreset);
  heroPresetRef.current = heroPreset;

  const createSession = async (presetId?: string, opts?: { activate?: boolean }) => {
    const activate = opts?.activate ?? true;
    const wsId = activeWsRef.current ?? workspacesRef.current[0]?.workspaceId;
    // Optimistic switch: leave the current session immediately so the
    // create round-trip never lingers on (and looks like a flash-back of)
    // the old conversation. App renders its hero while active is null.
    // activate=false（草稿页首条消息）不切：切了就没得重试了——见 Composer.ensureSession。
    if (activate) setActiveSessionId(null);
    try {
      const res = await api.createSession({ workspaceId: wsId, agentPreset: presetId ?? heroPresetRef.current });
      const dm = draftModelRef.current;
      if (dm) {
        setDraftModel(null);
        try {
          await api.selectModel({ sessionId: res.sessionId, ...dm });
        } catch { /* engine may be busy */ }
      }
      await forceRefreshSessions();
      if (activate) setActiveSessionId(res.sessionId);
      return res.sessionId;
    } catch {
      // 创建失败：留在草稿页，草稿模型保留，重新发送即再试。
      return null;
    }
  };

  // 注册（新建）工作空间：workspace/create 对已有目录幂等（created:false
  // 表示本就注册过）。follow 流会推送 upsert 增量，这里只负责切入新空间。
  // 失败经 error 字段带出（store 不做 UI 呈现，也不 import i18n——那会重建
  // i18n→store 的环）；弹窗由调用方（App/Sidebar/ProjectMenu）用词典负责。
  const createWorkspace = useCallback(async (path: string): Promise<{ workspaceId: string | null; error?: string }> => {
    try {
      const res = await api.workspaceCreate({ path });
      await forceRefreshSessionsRef.current();
      const wsId = res.workspace?.workspaceId;
      if (wsId) switchWorkspace(wsId);
      return { workspaceId: wsId ?? null };
    } catch (err) {
      return { workspaceId: null, error: (err as Error).message };
    }
  }, [switchWorkspace]);

  /** 视图层（已按归档与本地删除过滤）：Store.sessions 与 sidebarSessions 共用
   *  这一份，别再各 filter 一遍。 */
  const visibleList = useMemo(() => visibleSessions(
    sessions.filter((s) => !isHiddenSession(s)
      && !visibleArchived(archived, unarchived, removedLocal).has(s.sessionId)),
    removedLocal,
  ), [sessions, archived, unarchived, removedLocal]);
  /** 用户列表层（见 Store.sidebarSessions）。留 ref 供 switchWorkspace 同步挑落点。 */
  const sidebarSessions = useMemo(() => visibleList.filter(isSidebarSession), [visibleList]);
  const sidebarSessionsRef = useRef(sidebarSessions);
  sidebarSessionsRef.current = sidebarSessions;
  // 机器会话集推给壳：自动化的运行会话/自进化的落库会话"完成"时不该弹通知、
  // 不该点亮悬浮球（待审批照旧——那是真有人在等）。只推变化，别每轮刷。
  const quietKey = sessions.filter(isHiddenSession).map((s) => s.sessionId).sort().join(",");
  const quietKeyRef = useRef("");
  useEffect(() => {
    if (quietKey === quietKeyRef.current) return;
    quietKeyRef.current = quietKey;
    setQuietSessions(quietKey === "" ? [] : quietKey.split(","));
  }, [quietKey]);

  const value = useMemo<Store>(
    () => ({
      workspaces,
      archived: visibleArchived(archived, unarchived, removedLocal),
      activeWorkspaceId,
      wsOfSession,
      allSessions: sessions,
      sidebarSessions,
      sessions: visibleList,
      presets,
      heroPreset,
      setHeroPreset,
      engineUp,
      everConnected,
      enginePhase,
      engineFailureReason,
      engineFailureTail,
      engineRestartingAttempt,
      restartEngine,
      activeSessionId,
      approvals,
      questions,
      settleEvent,
      queues,
      jobsBySession,
      refresh,
      openSession,
    keybinds,
    setKeybinds,
    hotkeyOn,
    evolutionEnabled, setEvolutionEnabled,
    sessionMemoryEnabled, setSessionMemoryEnabled,
    sessionMemoryBlocked,
    backgroundTier,
    setHotkeyOn,
      switchWorkspace,
      createWorkspace,
      createSession,
      draftModel,
      setDraftModel,
      sidebarCollapsed,
      sidebarWidth,
      setSidebarWidth,
      lang,
      setLang,
      schemeDark,
      appearance,
      setAppearance,
      toggleSidebar: () => setSidebarOverride(!(sidebarOverride ?? narrowViewport)),
      autoArchive,
      setAutoArchive,
      archiveRetention,
      setArchiveRetention,
      unarchived,
      removed: removedLocal,
      unarchiveSession,
      removeSession,
      archiveSession,
      clearUnarchiveOverride,
      pinned,
      unread,
      togglePin,
      markUnread,
      clearUnread,
      subscribeControl: (h) => {
        controlHandlers.add(h);
        return () => controlHandlers.delete(h);
      },
    }),
    // AUD-027 约定：refresh/createSession 是渲染期函数（全部可变量经 ref 读取），
    // 进 deps 会让 value 每次渲染重建——ref 镜像约定下显式排除，P2-6 snapshot
    // store 决策时一并处理；其余稳定标识（useCallback/useState）如实入表。
    // keybinds/hotkeyOn 必须入表（AUD-061）：缺了它们，运行中改键后 value 不
    // 重建，消费者拿到旧键位——启动期被 prefs 批量下发掩盖，只在改键时复现。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaces, archived, activeWorkspaceId, wsOfSession, sessions, sidebarSessions, presets, heroPreset, engineUp, everConnected, enginePhase, engineFailureReason, engineFailureTail, engineRestartingAttempt, restartEngine, activeSessionId, approvals, questions, settleEvent, queues, jobsBySession, openSession, switchWorkspace, createWorkspace, draftModel, controlHandlers, sidebarCollapsed, sidebarWidth, setSidebarWidth, lang, setLang, schemeDark, appearance, setAppearance, keybinds, setKeybinds, hotkeyOn, setHotkeyOn, evolutionEnabled, setEvolutionEnabled, sessionMemoryEnabled, setSessionMemoryEnabled, sessionMemoryBlocked, sidebarOverride, narrowViewport, autoArchive, setAutoArchive, archiveRetention, setArchiveRetention, sessions, unarchived, removedLocal, unarchiveSession, removeSession, archiveSession, clearUnarchiveOverride, pinned, unread, togglePin, markUnread, clearUnread]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
