// 自进化状态（App 级单例）：提案队列、采集、复盘/校验/落库交办，以及运行历史。
//
// 两条来源都在这：① 会话里顺手记——跟随打开的会话，扫助手消息里的 lesson 块；
// ② 后台复盘——按"摩擦信号"（失败的工具调用、用户纠正、完成的轮数）攒批次，
// 到期或手动触发一次复盘运行。会话里零 UI（SPEC §8）；标准与红线在仓库的
// `docs/EVOLUTION-POLICY.md`，触发判据与输出格式在技能 `deepdive-evolution`。

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { blocksOf } from "../session/eventText";
import { extractToolResult } from "../session/renderModel";
import { useStore } from "../store";
import type { SessionEvent } from "../types";
import { applyPrompt, reviewPrompt, revokePrompt, verifyPrompt, type ReviewTarget } from "./prompts";
import { lessonBlocks, parseLesson, parseVerdict, verdictBlocks, type LessonProposal } from "./protocol";
import {
  loadApplySession, loadLastReview, loadProposals, loadRuns, saveApplySession, saveLastReview, saveProposals, saveRuns,
  type EvolutionRun,
} from "./store";

/** 待审上限（政策默认值）：到顶不再堆积。 */
const PENDING_CAP = 100;
/** 攒够多少轮完成回复才值得起一次复盘（政策默认 3）；外面再套一个日节流——我们的
 *  复盘是一整轮 agent（要自己挖日志），比参考里那种无工具的廉价调用贵得多，所以
 *  默认按天跑，不按 3 轮就跑（偏离参考的默认批次，理由记在 SPEC §9.0）。 */
const REVIEW_MIN_TURNS = 3;
const REVIEW_INTERVAL_MS = 24 * 3600_000;
/** 巡检间隔：到期的提案每次挑一条交出去校验。 */
const VERIFY_TICK_MS = 10 * 60_000;

export interface EvolutionStats {
  total: number;
  pending: number;
  applied: number;
  effective: number;
  ineffective: number;
  dismissed: number;
}

interface EvolutionApi {
  /** 提案队列（新→旧）。 */
  proposals: LessonProposal[];
  /** 运行历史（新→旧）。 */
  runs: EvolutionRun[];
  stats: EvolutionStats;
  /** 上次复盘时间（毫秒）；null = 还没跑过。 */
  lastReviewAt: number | null;
  /** 有交办正在发出（按钮禁用，避免连点）。 */
  busy: boolean;
  dismiss: (id: string) => void;
  apply: (id: string) => Promise<string | null>;
  /** 撤销一条已落库的经验（靠 git 回滚，见 EVOLUTION-POLICY §5）。 */
  revoke: (id: string) => Promise<string | null>;
  /** 手动跑一次复盘（无感路径之外的手动入口）。 */
  review: () => Promise<string | null>;
  /** 手动校验一条（到期后巡检也会自动跑）。 */
  verify: (id: string) => Promise<string | null>;
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
  const storeRef = useRef(store);
  storeRef.current = store;
  const [proposals, setProposals] = useState<LessonProposal[]>(loadProposals);
  const [runs, setRuns] = useState<EvolutionRun[]>(loadRuns);
  const [jobSessionId, setJobSessionId] = useState<string | null>(loadApplySession);
  const [lastReviewAt, setLastReviewAt] = useState<number | null>(loadLastReview);
  const [busy, setBusy] = useState(false);
  const proposalsRef = useRef(proposals);
  proposalsRef.current = proposals;
  const jobSessionRef = useRef(jobSessionId);
  jobSessionRef.current = jobSessionId;
  const lastReviewRef = useRef(lastReviewAt);
  lastReviewRef.current = lastReviewAt;
  const seenRef = useRef<Set<string>>(new Set());
  const frictionRef = useRef<Map<string, Friction>>(new Map());
  const busyRef = useRef(false);
  busyRef.current = busy;

  useEffect(() => { saveProposals(proposals); }, [proposals]);
  useEffect(() => { saveRuns(runs); }, [runs]);
  useEffect(() => { saveApplySession(jobSessionId); }, [jobSessionId]);
  useEffect(() => { saveLastReview(lastReviewAt); }, [lastReviewAt]);

  const addRun = useCallback((kind: EvolutionRun["kind"], sessionId: string, note?: string) => {
    const run: EvolutionRun = { id: crypto.randomUUID(), kind, at: Date.now(), sessionId, ...(note === undefined ? {} : { note }) };
    setRuns((prev) => [run, ...prev].slice(0, 50));
  }, []);

  const patch = useCallback((id: string, next: Partial<LessonProposal>) => {
    setProposals((prev) => prev.map((p) => (p.id === id ? { ...p, ...next, updatedAt: Date.now() } : p)));
  }, []);

  /** 交办会话：落库 / 复盘 / 校验 / 撤销都走同一条会话，首次创建、之后复用。 */
  const ensureJobSession = useCallback(async (): Promise<string> => {
    const known = new Set(storeRef.current.allSessions.map((s) => s.sessionId));
    const current = jobSessionRef.current;
    if (current !== null && known.has(current)) return current;
    const workspaceId = storeRef.current.activeWorkspaceId;
    const created = await api.createSession(workspaceId === null ? {} : { workspaceId });
    setJobSessionId(created.sessionId);
    void storeRef.current.refresh();
    return created.sessionId;
  }, []);

  const handoff = useCallback(async (kind: EvolutionRun["kind"], text: string, note?: string): Promise<string | null> => {
    if (busyRef.current) return null;
    setBusy(true);
    try {
      const sessionId = await ensureJobSession();
      await api.prompt({ requestId: crypto.randomUUID(), sessionId, mode: "queue", content: [{ type: "text", text }] });
      addRun(kind, sessionId, note);
      void storeRef.current.refresh();
      return sessionId;
    } finally {
      setBusy(false);
    }
  }, [addRun, ensureJobSession]);

  const apply = useCallback(async (id: string): Promise<string | null> => {
    const proposal = proposalsRef.current.find((p) => p.id === id);
    if (!proposal) return null;
    const sessionId = await handoff("apply", applyPrompt(proposal), proposal.id);
    if (sessionId !== null) patch(id, { status: "applied", appliedSessionId: sessionId });
    return sessionId;
  }, [handoff, patch]);

  const revoke = useCallback(async (id: string): Promise<string | null> => {
    const proposal = proposalsRef.current.find((p) => p.id === id);
    if (!proposal) return null;
    const sessionId = await handoff("revoke", revokePrompt(proposal), proposal.id);
    if (sessionId !== null) patch(id, { status: "expired" });
    return sessionId;
  }, [handoff, patch]);

  const verify = useCallback(async (id: string): Promise<string | null> => {
    const proposal = proposalsRef.current.find((p) => p.id === id);
    if (!proposal || proposal.predict === null) return null;
    return handoff("verify", verifyPrompt(proposal), proposal.id);
  }, [handoff]);

  const review = useCallback(async (): Promise<string | null> => {
    const targets: ReviewTarget[] = [];
    for (const [sessionId, f] of frictionRef.current) {
      if (f.turns === 0 && f.failed === 0 && f.corrections === 0) continue;
      targets.push({ sessionId, logHint: sessionId, turns: f.turns, failed: f.failed, corrections: f.corrections });
    }
    if (targets.length === 0) return null; // 这段时间什么都没观察到：不起这一轮
    const sessionId = await handoff("review", reviewPrompt(targets));
    if (sessionId !== null) {
      frictionRef.current.clear();
      setLastReviewAt(Date.now());
    }
    return sessionId;
  }, [handoff]);

  // 采集：跟随"当前打开的会话"与"交办会话"（复盘/校验的输出也从那条流里收）。
  const activeId = store.activeSessionId;
  useEffect(() => {
    const ids = [activeId, jobSessionId].filter((v, i, a): v is string => v !== null && a.indexOf(v) === i);
    if (ids.length === 0) return;
    const closes = ids.map((sessionId) => api.followSession({ kind: "session", sessionId }, {
      onSnapshot: () => { /* 历史不入队：重开旧会话不该把旧提案再收一遍 */ },
      onEvent: (ev: SessionEvent) => {
        collectFriction(frictionRef.current, sessionId, ev);
        if (ev.type !== "assistant/message") return;
        const text = blocksOf(ev).text;
        if (text.includes("lesson-verify")) {
          verdictBlocks(text).forEach((body, i) => {
            const key = `${sessionId}:${ev.seq}:v${i}`;
            if (seenRef.current.has(key)) return;
            seenRef.current.add(key);
            const v = parseVerdict(body);
            if (v === null) return;
            setProposals((prev) => prev.map((p) => (p.id === v.id
              ? {
                  ...p,
                  verdict: { recurrences: v.recurrences, verdict: v.verdict, at: Date.now() },
                  status: v.verdict === "ineffective" ? "expired" : p.status,
                  updatedAt: Date.now(),
                }
              : p)));
          });
        }
        if (!text.includes("lesson")) return;
        const turn = (ev.data as { turn?: number }).turn ?? -1;
        lessonBlocks(text).forEach((body, i) => {
          const key = `${sessionId}:${ev.seq}:${i}`;
          if (seenRef.current.has(key)) return;
          seenRef.current.add(key);
          const proposal = parseLesson(body, { sessionId, turn, eventSeq: ev.seq });
          if (proposal === null) return; // 不合形状：显示端按普通代码块渲染，不入队
          setProposals((prev) => (
            prev.filter((p) => p.status === "pending").length >= PENDING_CAP ? prev : [proposal, ...prev]
          ));
        });
      },
    }));
    return () => { for (const close of closes) close(); };
  }, [activeId, jobSessionId]);

  // 无感路径：复盘节流（按天 + 攒够轮数）与到期校验巡检，用户什么都不用做。
  useEffect(() => {
    const tick = () => {
      const since = lastReviewRef.current === null ? Number.POSITIVE_INFINITY : Date.now() - lastReviewRef.current;
      const turns = [...frictionRef.current.values()].reduce((n, f) => n + f.turns, 0);
      if (since >= REVIEW_INTERVAL_MS && turns >= REVIEW_MIN_TURNS) void review();
      const due = proposalsRef.current.find((p) => (
        p.status === "applied" && p.predict !== null && p.verdict === undefined
        && Date.now() - p.createdAt >= p.predict.windowDays * 86_400_000
      ));
      if (due) void verify(due.id);
    };
    const iv = window.setInterval(tick, VERIFY_TICK_MS);
    return () => window.clearInterval(iv);
  }, [review, verify]);

  const value = useMemo<EvolutionApi>(() => ({
    proposals,
    runs,
    stats: {
      total: proposals.length,
      pending: proposals.filter((p) => p.status === "pending").length,
      applied: proposals.filter((p) => p.status === "applied").length,
      effective: proposals.filter((p) => p.verdict?.verdict === "effective").length,
      ineffective: proposals.filter((p) => p.verdict?.verdict === "ineffective").length,
      dismissed: proposals.filter((p) => p.status === "dismissed").length,
    },
    lastReviewAt,
    busy,
    dismiss: (id: string) => patch(id, { status: "dismissed" }),
    apply,
    revoke,
    review,
    verify,
  }), [proposals, runs, lastReviewAt, busy, patch, apply, revoke, review, verify]);

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
