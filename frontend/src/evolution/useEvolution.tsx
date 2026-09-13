// 自进化状态（App 级单例）：零人审自动管线（SPEC-SELF-EVOLUTION v3）。
//
// 数据流：会话内 lesson 块 / 后台复盘 → 待处理台账 → 机械门（壳直跑
// lesson-gate.mjs：证据逐字+锚点存在，模型不在环内）→ 自动落地（限速，
// 会话按落点作用域创建：仓库家 cwd=工作区、DSH_HOME 家 cwd=引擎目录——
// 沙箱 workspaceRoot 即会话 cwd，是引擎原生的机械写边界）→ 落地确认
// （lesson-land.mjs：git 提交+允许清单+文件回读，不采信 agent 口头"完成"）
// → 到期校验（lesson-verify.mjs 壳直跑，应用按政策阈值判有效/无效）
// → 无效自动撤销（git 回滚）。人的角色只有两个：开关处一次性批准政策、
// 事后在设置页审计（丢弃/撤销/查看原文）。
// 选择逻辑（下一步做什么）在 pipeline.ts（纯函数）；这里只执行。

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { evolutionEnv, lessonTool } from "../host";
import { usePrefs } from "../prefs";
import { blocksOf } from "../session/eventText";
import { extractToolResult } from "../session/renderModel";
import { useStore } from "../store";
import type { SessionEvent } from "../types";
import { applyPrompt, consolidatePrompt, reviewPrompt, revokePrompt, type ReviewTarget } from "./prompts";
import { APPLY_RETRY_MAX, dayKey, nextAction } from "./pipeline";
import {
  GLOBAL_ANCHOR, homeScope, judgeVerdict, lastJsonLine, lessonBlocks, parseGateReceipt, parseLandReceipt,
  parseLesson, parseVerdictValue, type LessonProposal,
} from "./protocol";
import {
  loadAppliedToday, loadApplySession, loadHomeSession, loadLastConsolidate, loadLastReview, loadOwnSessions,
  loadProposals, loadRuns, saveAppliedToday, saveApplySession, saveHomeSession, saveLastConsolidate,
  saveLastReview, saveOwnSessions, saveProposals, saveRuns, type AppliedToday, type EvolutionRun,
} from "./store";

export interface EvolutionStats {
  total: number;
  pending: number;
  applied: number;
  landed: number;
  effective: number;
  ineffective: number;
  dismissed: number;
}

interface EvolutionApi {
  /** 台账（新→旧）。 */
  proposals: LessonProposal[];
  /** 运行历史（新→旧）。 */
  runs: EvolutionRun[];
  stats: EvolutionStats;
  /** 上次复盘时间（毫秒）；null = 还没跑过。 */
  lastReviewAt: number | null;
  /** 有模型会话交办在途。 */
  busy: boolean;
  /** 自进化开关（壳持久化；关 = 不采集、不落地、不校验、不整理）。 */
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  /** 审计动作：丢弃（不落地/不再校验）。 */
  dismiss: (id: string) => void;
  /** 审计动作：撤销一条已落库的经验（git 回滚或删节）。 */
  revoke: (id: string) => Promise<string | null>;
}

const Ctx = createContext<EvolutionApi | null>(null);

export function useEvolution(): EvolutionApi {
  const value = useContext(Ctx);
  if (!value) throw new Error("useEvolution outside EvolutionProvider");
  return value;
}

/** 会话级摩擦计数：复盘挑靶子的依据（"无感"的那一半）。 */
interface Friction { turns: number; failed: number; corrections: number; sawAssistant: boolean }

export function EvolutionProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const prefs = usePrefs();
  const enabled = prefs.evolutionEnabled;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const storeRef = useRef(store);
  storeRef.current = store;
  const [proposals, setProposals] = useState<LessonProposal[]>(loadProposals);
  const [runs, setRuns] = useState<EvolutionRun[]>(loadRuns);
  const [repoSessionId, setRepoSessionId] = useState<string | null>(loadApplySession);
  const [homeSessionId, setHomeSessionId] = useState<string | null>(loadHomeSession);
  const [lastReviewAt, setLastReviewAt] = useState<number | null>(loadLastReview);
  const [lastConsolidateAt, setLastConsolidateAt] = useState<number | null>(loadLastConsolidate);
  const [ownSessions, setOwnSessions] = useState<string[]>(loadOwnSessions);
  const [appliedToday, setAppliedToday] = useState<AppliedToday>(loadAppliedToday);
  const [busy, setBusy] = useState(false);
  /** 引擎目录（壳桥一次取回；纯浏览器为 null——home 作用域交办显式降级）。 */
  const [harnessHome, setHarnessHome] = useState<string | null>(null);
  const proposalsRef = useRef(proposals);
  proposalsRef.current = proposals;
  const repoSessionRef = useRef(repoSessionId);
  repoSessionRef.current = repoSessionId;
  const homeSessionRef = useRef(homeSessionId);
  homeSessionRef.current = homeSessionId;
  const lastReviewRef = useRef(lastReviewAt);
  lastReviewRef.current = lastReviewAt;
  const ownSessionsRef = useRef(ownSessions);
  ownSessionsRef.current = ownSessions;
  const harnessHomeRef = useRef(harnessHome);
  harnessHomeRef.current = harnessHome;
  const seenRef = useRef<Set<string>>(new Set());
  const frictionRef = useRef<Map<string, Friction>>(new Map());
  /** 本应用开出的一次性运行会话（复盘/整理）：跟着收结果直到 turn/end。 */
  const [runSessions, setRunSessions] = useState<string[]>([]);
  const runSessionsRef = useRef(runSessions);
  runSessionsRef.current = runSessions;
  const busyRef = useRef(false);
  busyRef.current = busy;
  /** 本机脚本在途（gate/land/verify），与模型会话互不占。 */
  const gateInFlight = useRef<Set<string>>(new Set());
  const landInFlight = useRef<Set<string>>(new Set());
  const verifyInFlight = useRef<Set<string>>(new Set());
  const pumpingRef = useRef(false);

  useEffect(() => { saveProposals(proposals); }, [proposals]);
  useEffect(() => { saveRuns(runs); }, [runs]);
  useEffect(() => { saveApplySession(repoSessionId); }, [repoSessionId]);
  useEffect(() => { saveHomeSession(homeSessionId); }, [homeSessionId]);
  useEffect(() => { saveLastReview(lastReviewAt); }, [lastReviewAt]);
  useEffect(() => { saveLastConsolidate(lastConsolidateAt); }, [lastConsolidateAt]);
  useEffect(() => { saveAppliedToday(appliedToday); }, [appliedToday]);
  useEffect(() => { void evolutionEnv().then((env) => setHarnessHome(env?.harnessHome ?? null)); }, []);

  const addRun = useCallback((kind: EvolutionRun["kind"], sessionId: string, note?: string) => {
    const run: EvolutionRun = { id: crypto.randomUUID(), kind, at: Date.now(), sessionId, ...(note === undefined ? {} : { note }) };
    setRuns((prev) => [run, ...prev].slice(0, 50));
  }, []);

  const patch = useCallback((id: string, next: Partial<LessonProposal>) => {
    setProposals((prev) => prev.map((p) => (p.id === id ? { ...p, ...next, updatedAt: Date.now() } : p)));
  }, []);

  /** 一次性会话（复盘/整理）：判定要独立，不继承交办会话的历史；记进"自己开的
   *  会话"，复盘挑靶子时排除。 */
  const freshSession = useCallback(async (title: string): Promise<string> => {
    const workspaceId = storeRef.current.activeWorkspaceId;
    const created = await api.createSession(workspaceId === null ? {} : { workspaceId });
    await api.sessionRename({ sessionId: created.sessionId, title }).catch(() => { /* 改名失败不影响运行 */ });
    setOwnSessions((prev) => {
      const next = [...prev, created.sessionId];
      saveOwnSessions(next);
      return next;
    });
    setRunSessions((prev) => (prev.includes(created.sessionId) ? prev : [...prev, created.sessionId]));
    void storeRef.current.refresh();
    return created.sessionId;
  }, []);

  /** 交办会话（复用，按作用域各一条）：repo 家 cwd=工作区；dsh-home 家
   *  cwd=$DSH_HOME——沙箱边界即会话 cwd（引擎 sandbox-policy：workspaceRoot
   *  取会话 cwd），落点写边界由此机械生效。 */
  const ensureJobSession = useCallback(async (scope: "repo" | "dsh-home"): Promise<string> => {
    const current = scope === "repo" ? repoSessionRef.current : homeSessionRef.current;
    const known = new Set(storeRef.current.allSessions.map((s) => s.sessionId));
    if (current !== null && known.has(current)) return current;
    const created = scope === "dsh-home"
      ? await (async () => {
          const home = harnessHomeRef.current;
          if (home === null) throw new Error("harness home unknown");
          return api.createSession({ cwd: home });
        })()
      : await (async () => {
          const workspaceId = storeRef.current.activeWorkspaceId;
          return api.createSession(workspaceId === null ? {} : { workspaceId });
        })();
    if (scope === "repo") setRepoSessionId(created.sessionId);
    else setHomeSessionId(created.sessionId);
    setOwnSessions((prev) => {
      const next = [...prev, created.sessionId];
      saveOwnSessions(next);
      return next;
    });
    void storeRef.current.refresh();
    return created.sessionId;
  }, []);

  /** 会话级权限预设：只能经 /permission 命令写（automation runner 同款先例）。
   *  无人值守的会话必须显式设——引擎 defaultPreset 的 workspace-write 审批=ask，
   *  没人看着的审批卡会永远挂起。 */
  const setPermission = useCallback(async (sessionId: string, preset: "read-only" | "workspace-write") => {
    const res = await api.commandExecute({ agentId: sessionId, line: `/permission ${preset}` });
    if (res?.result.kind === "error") throw new Error(res.result.text);
  }, []);

  /** 模型会话交办（落库/撤销/复盘/整理）。本机脚本（gate/land/verify）不在这。 */
  const handoff = useCallback(async (kind: EvolutionRun["kind"], text: string, opts: { note?: string; freshTitle?: string; scope?: "repo" | "dsh-home" } = {}): Promise<string | null> => {
    if (busyRef.current) return null;
    setBusy(true);
    try {
      const sessionId = opts.freshTitle !== undefined
        ? await freshSession(opts.freshTitle)
        : await ensureJobSession(opts.scope ?? "repo");
      await setPermission(sessionId, "workspace-write");
      await api.prompt({ requestId: crypto.randomUUID(), sessionId, mode: "queue", content: [{ type: "text", text }] });
      addRun(kind, sessionId, opts.note);
      void storeRef.current.refresh();
      return sessionId;
    } finally {
      setBusy(false);
    }
  }, [addRun, ensureJobSession, freshSession, setPermission]);

  /** 自动落地：派发即置 applied（语义=已交办），attempts+1、当日计数+1。 */
  const apply = useCallback(async (id: string): Promise<string | null> => {
    const proposal = proposalsRef.current.find((p) => p.id === id);
    if (!proposal) return null;
    const sessionId = await handoff("apply", applyPrompt(proposal), { note: proposal.id, scope: homeScope(proposal.home) });
    if (sessionId !== null) {
      patch(id, {
        status: "applied",
        appliedSessionId: sessionId,
        appliedAt: Date.now(),
        applyAttempts: (proposal.applyAttempts ?? 0) + 1,
      });
      setAppliedToday((prev) => {
        const today = dayKey(Date.now());
        const count = prev.day === today ? prev.count + 1 : 1;
        return { day: today, count };
      });
    }
    return sessionId;
  }, [handoff, patch]);

  /** 撤销（自动+审计共用）：派发成功才盖 revokeAt——busy 时返回 null，下轮管线
   *  会重试（verdict 无效 + 未盖戳的还会被选中）。 */
  const revoke = useCallback(async (id: string): Promise<string | null> => {
    const proposal = proposalsRef.current.find((p) => p.id === id);
    if (!proposal) return null;
    const sessionId = await handoff("revoke", revokePrompt(proposal), { note: proposal.id, scope: homeScope(proposal.home) });
    if (sessionId !== null) patch(id, { revokeAt: Date.now(), status: "expired" });
    return sessionId;
  }, [handoff, patch]);

  const review = useCallback(async (): Promise<string | null> => {
    // 靶子＝距上次复盘后有更新的会话（不再依赖"你正看着"）；摩擦计数仅在观察过时附上。
    const since = lastReviewRef.current ?? 0;
    const own = new Set(ownSessionsRef.current);
    const targets: ReviewTarget[] = storeRef.current.allSessions
      .filter((s) => s.origin !== "subagent"
        && !storeRef.current.removed.has(s.sessionId)
        && !own.has(s.sessionId)
        && s.updatedAt > since)
      .slice(0, 8)
      .map((s) => {
        const f = frictionRef.current.get(s.sessionId);
        return {
          sessionId: s.sessionId, logHint: s.sessionId, updatedAt: s.updatedAt,
          turns: f?.turns ?? null, failed: f?.failed ?? null, corrections: f?.corrections ?? null,
        };
      });
    if (targets.length === 0) return null; // 上次复盘以来没有新会话：不起这一轮
    const known = proposalsRef.current
      .filter((p) => p.predict !== null && p.status !== "dismissed")
      .map((p) => `${p.predict!.signature}（${p.home} · ${p.status}）`);
    const sessionId = await handoff("review", reviewPrompt(targets, known), { freshTitle: "自进化·复盘" });
    if (sessionId !== null) {
      frictionRef.current.clear();
      setLastReviewAt(Date.now());
    }
    return sessionId;
  }, [handoff]);

  /** 整理环（MiMo Dream）：按沙箱作用域拆两轮——仓库知识文件、引擎目录。 */
  const consolidate = useCallback(async (): Promise<void> => {
    await handoff("consolidate", consolidatePrompt("repo"), { freshTitle: "自进化·整理" });
    if (harnessHomeRef.current !== null) {
      await handoff("consolidate", consolidatePrompt("dsh-home"), { freshTitle: "自进化·整理（引擎目录）" });
    }
    setLastConsolidateAt(Date.now());
  }, [handoff]);

  /** 机械门（本机）：证据逐字 + 锚点存在。回执拿不到就留在原地（下轮重试）；
   *  任一不过直接退役留档（dsh-evolve-modes 的 expired 语义）。 */
  const runGate = useCallback(async (p: LessonProposal): Promise<void> => {
    gateInFlight.current.add(p.id);
    try {
      const res = await lessonTool("gate", [
        p.origin.sessionId,
        JSON.stringify(p.evidence.map((e) => e.excerpt)),
        p.home,
        JSON.stringify(p.home === "global" ? GLOBAL_ANCHOR : p.anchor),
        repoPath() ?? "-",
      ]);
      const receipt = res !== null && res.ok ? parseGateReceipt(res.output) : null;
      if (receipt === null) return;
      const pass = receipt.verbatim && receipt.anchorFound;
      addRun("gate", "", pass ? p.id : p.id + " · " + (!receipt.verbatim ? "证据不符" : "锚点不存在"));
      patch(p.id, { gate: { ...receipt, at: Date.now() }, ...(pass ? {} : { status: "expired" }) });
    } finally {
      gateInFlight.current.delete(p.id);
    }
  }, [addRun, patch]);

  /** 落地确认（本机）：仓库家查 git 提交+允许清单+文件回读；DSH_HOME 家查文件回读。
   *  失败的处理：files 出了允许清单 → 自动撤销（写错了地方的东西必须撤）；
   *  其余失败在重试额度内打回 pending 重落，超限退役。 */
  const runLand = useCallback(async (p: LessonProposal): Promise<void> => {
    landInFlight.current.add(p.id);
    try {
      patch(p.id, { lastLandAt: Date.now() });
      const res = await lessonTool("land", [
        p.id, p.home, homeScope(p.home) === "dsh-home" ? "-" : repoPath() ?? "-", JSON.stringify(p.content),
        JSON.stringify(p.home === "global" ? GLOBAL_ANCHOR : p.anchor),
      ]);
      const receipt = res !== null && res.ok ? parseLandReceipt(res.output) : null;
      if (receipt === null) return;
      addRun("land", "", receipt.landed ? p.id : p.id + " · " + (receipt.reason ?? "未落地"));
      if (receipt.landed) {
        patch(p.id, { landing: { ...receipt, at: Date.now() } });
        return;
      }
      if (receipt.reason === "files-outside-allowlist") {
        patch(p.id, { landing: { ...receipt, at: Date.now() } });
        void revoke(p.id);
        return;
      }
      if ((p.applyAttempts ?? 0) >= APPLY_RETRY_MAX) {
        patch(p.id, { landing: { ...receipt, at: Date.now() }, status: "expired" });
      } else {
        patch(p.id, { landing: { ...receipt, at: Date.now() }, status: "pending" });
      }
    } finally {
      landInFlight.current.delete(p.id);
    }
  }, [addRun, patch, revoke]);

  /** 到期校验（本机）：壳直跑 lesson-verify.mjs，应用按政策阈值判（模型只出数）。 */
  const runVerify = useCallback(async (p: LessonProposal): Promise<void> => {
    if (p.predict === null) return;
    verifyInFlight.current.add(p.id);
    try {
      patch(p.id, { lastVerifyAt: Date.now() });
      const landedISO = new Date(p.appliedAt ?? p.createdAt).toISOString();
      const res = await lessonTool("verify", [
        p.id, p.predict.signature, String(p.predict.windowDays), landedISO, p.predict.metric,
      ]);
      const receipt = res !== null && res.ok ? parseVerdictValue(lastJsonLine(res.output)) : null;
      if (receipt === null || receipt.id !== p.id) return;
      const verdict = judgeVerdict(p.predict.metric, receipt.before, receipt.after);
      addRun("verify", "", p.id + " · " + receipt.before + " → " + receipt.after + " · " + verdict);
      patch(p.id, { verdict: { before: receipt.before, after: receipt.after, verdict, at: Date.now() } });
    } finally {
      verifyInFlight.current.delete(p.id);
    }
  }, [addRun, patch]);

  /** 当前工作区路径（仓库家的门/确认都在它上面跑）。 */
  function repoPath(): string | null {
    const wsId = storeRef.current.activeWorkspaceId;
    return storeRef.current.workspaces.find((w) => w.workspaceId === wsId)?.path ?? null;
  }

  /** 管线泵：选择器给一步、执行一步，直到没有动作。模型动作被 busy 挡住后自然停。 */
  const pump = useCallback(async (): Promise<void> => {
    const now = Date.now();
    const today = dayKey(now);
    const appliedCount = appliedToday.day === today ? appliedToday.count : 0;
    for (let i = 0; i < 12; i += 1) {
      const action = nextAction(proposalsRef.current, {
        now, busy: busyRef.current,
        lastReviewAt: lastReviewRef.current,
        lastConsolidateAt: lastConsolidateAt,
        appliedToday: appliedCount,
        sessionsTouched: storeRef.current.allSessions.some((s) => s.updatedAt > (lastReviewRef.current ?? 0)),
        gateInFlight: gateInFlight.current,
        landInFlight: landInFlight.current,
        verifyInFlight: verifyInFlight.current,
      });
      if (action === null) break;
      if (action.kind === "gate") { const p = proposalsRef.current.find((x) => x.id === action.id); if (p) await runGate(p); }
      else if (action.kind === "apply") await apply(action.id);
      else if (action.kind === "land") { const p = proposalsRef.current.find((x) => x.id === action.id); if (p) await runLand(p); }
      else if (action.kind === "verify") { const p = proposalsRef.current.find((x) => x.id === action.id); if (p) await runVerify(p); }
      else if (action.kind === "revoke") await revoke(action.id);
      else if (action.kind === "review") await review();
      else if (action.kind === "consolidate") await consolidate();
    }
  }, [appliedToday, apply, consolidate, lastConsolidateAt, review, revoke, runGate, runLand, runVerify]);

  // 采集：跟随"当前打开的会话"、两条交办会话与一次性运行会话。
  // （复盘的 lesson 块从这些流里收；落库/校验/门/确认都不经模型。）
  const activeId = store.activeSessionId;
  useEffect(() => {
    if (!enabled) return; // 开关关着：什么都不采集
    const ids = [activeId, repoSessionId, homeSessionId, ...runSessionsRef.current]
      .filter((v, i, a): v is string => v !== null && a.indexOf(v) === i);
    if (ids.length === 0) return;
    const closes = ids.map((sessionId) => api.followSession({ kind: "session", sessionId }, {
      onSnapshot: () => { /* 历史不入队：重开旧会话不该把旧提案再收一遍 */ },
      onEvent: (ev: SessionEvent) => {
        collectFriction(frictionRef.current, sessionId, ev);
        // 一次性运行会话的轮末即回收（EverOS 插件同款边界——capture 到轮停为止）。
        if (ev.type === "turn/end") {
          setRunSessions((prev) => (prev.includes(sessionId) ? prev.filter((s) => s !== sessionId) : prev));
        }
        if (ev.type !== "assistant/message") return;
        const text = blocksOf(ev).text;
        if (!text.includes("lesson")) return;
        const turn = (ev.data as { turn?: number }).turn ?? -1;
        lessonBlocks(text).forEach((body, i) => {
          const key = `${sessionId}:${ev.seq}:${i}`;
          if (seenRef.current.has(key)) return;
          seenRef.current.add(key);
          const proposal = parseLesson(body, { sessionId, turn, eventSeq: ev.seq });
          if (proposal === null) return; // 不合形状：显示端按普通代码块渲染，不入队
          setProposals((prev) => (
            prev.filter((p) => p.status === "pending").length >= 100 ? prev : [proposal, ...prev]
          ));
        });
      },
    }));
    return () => { for (const close of closes) close(); };
  }, [enabled, activeId, repoSessionId, homeSessionId, runSessions]);

  // 无感路径：一分钟一拍，管线泵自选下一步（复盘/落地/校验/整理全部自动）。
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (!enabledRef.current || pumpingRef.current) return;
      pumpingRef.current = true;
      void pump().finally(() => { pumpingRef.current = false; });
    }, 60_000);
    return () => window.clearInterval(iv);
  }, [pump]);

  const value = useMemo<EvolutionApi>(() => ({
    proposals,
    runs,
    stats: {
      total: proposals.length,
      pending: proposals.filter((p) => p.status === "pending").length,
      applied: proposals.filter((p) => p.status === "applied").length,
      landed: proposals.filter((p) => p.landing?.landed === true).length,
      effective: proposals.filter((p) => p.verdict?.verdict === "effective").length,
      ineffective: proposals.filter((p) => p.verdict?.verdict === "ineffective").length,
      dismissed: proposals.filter((p) => p.status === "dismissed").length,
    },
    lastReviewAt,
    busy,
    enabled,
    setEnabled: prefs.setEvolutionEnabled,
    dismiss: (id: string) => patch(id, { status: "dismissed" }),
    revoke,
  }), [proposals, runs, lastReviewAt, busy, enabled, prefs.setEvolutionEnabled, patch, revoke]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 摩擦信号：完成的轮数 / 失败的工具调用 / 助手之后紧跟的用户消息（纠正）。 */
function collectFriction(map: Map<string, Friction>, sessionId: string, ev: SessionEvent): void {
  const cur = map.get(sessionId) ?? { turns: 0, failed: 0, corrections: 0, sawAssistant: false };
  if (ev.type === "turn/end") cur.turns += 1;
  else if (ev.type === "tool/result" && extractToolResult(ev.data as never).failed) cur.failed += 1;
  else if (ev.type === "user/message" && cur.sawAssistant) { cur.corrections += 1; cur.sawAssistant = false; }
  if (ev.type === "assistant/message") cur.sawAssistant = true;
  map.set(sessionId, cur);
}
