// 自进化状态（App 级单例）：提案队列、采集、落库交办。
// 采集跟着"当前打开的会话"走——会话里零 UI（SPEC §8）；落库交办给一条专属会话
// （首次创建、之后复用，复用前确认它还在引擎列表里）。
// 标准与红线不在代码里：什么值得提/能写到哪里/怎么算有效归 `docs/EVOLUTION-POLICY.md`
// （仓库内、可演进），触发判据与输出格式归引擎技能 `deepdive-evolution`。

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { blocksOf } from "../session/eventText";
import { useStore } from "../store";
import { lessonBlocks, parseLesson, type LessonProposal } from "./protocol";
import { loadApplySession, loadProposals, saveApplySession, saveProposals } from "./store";

/** 待审上限（政策默认值）：到顶不再堆积。 */
const PENDING_CAP = 100;

export interface EvolutionStats {
  total: number;
  pending: number;
  applied: number;
  dismissed: number;
}

interface EvolutionApi {
  /** 提案队列（新→旧）。 */
  proposals: LessonProposal[];
  stats: EvolutionStats;
  /** 丢弃一条待审提案（留档，避免反复提）。 */
  dismiss: (id: string) => void;
  /** 采纳：把落库交办给一条会话；回传那次会话的 id（失败回 null）。 */
  apply: (id: string) => Promise<string | null>;
}

const Ctx = createContext<EvolutionApi | null>(null);

export function useEvolution(): EvolutionApi {
  const apiValue = useContext(Ctx);
  if (!apiValue) throw new Error("useEvolution outside EvolutionProvider");
  return apiValue;
}

export function EvolutionProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const [proposals, setProposals] = useState<LessonProposal[]>(loadProposals);
  const [applySessionId, setApplySessionId] = useState<string | null>(loadApplySession);
  const proposalsRef = useRef(proposals);
  proposalsRef.current = proposals;

  // 已入队的采集键（会话:事件序号:块序号）：mux 重连重发也不会重复入队
  const seenRef = useRef<Set<string>>(new Set());
  useEffect(() => { saveProposals(proposals); }, [proposals]);
  useEffect(() => { saveApplySession(applySessionId); }, [applySessionId]);

  // 采集：跟随当前打开的会话，扫助手消息里的 lesson 块。
  // 只看新增事件（不重扫快照）——重开旧会话不该把历史提案再入队一次。
  const activeId = store.activeSessionId;
  useEffect(() => {
    if (activeId === null) return;
    return api.followSession({ kind: "session", sessionId: activeId }, {
      onSnapshot: () => { /* 历史不入队 */ },
      onEvent: (ev) => {
        if (ev.type !== "assistant/message") return;
        const text = blocksOf(ev).text;
        if (!text.includes("lesson")) return;
        const turn = (ev.data as { turn?: number }).turn ?? -1;
        lessonBlocks(text).forEach((body, i) => {
          const key = `${activeId}:${ev.seq}:${i}`;
          if (seenRef.current.has(key)) return;
          seenRef.current.add(key);
          const proposal = parseLesson(body, { sessionId: activeId, turn, eventSeq: ev.seq });
          if (proposal === null) return; // 不合形状：显示端按普通代码块渲染，不入队
          setProposals((prev) => (
            prev.filter((p) => p.status === "pending").length >= PENDING_CAP ? prev : [proposal, ...prev]
          ));
        });
      },
    });
  }, [activeId]);

  const patch = useCallback((id: string, next: Partial<LessonProposal>) => {
    setProposals((prev) => prev.map((p) => (p.id === id ? { ...p, ...next, updatedAt: Date.now() } : p)));
  }, []);

  const dismiss = useCallback((id: string) => {
    patch(id, { status: "dismissed" });
  }, [patch]);

  const apply = useCallback(async (id: string): Promise<string | null> => {
    const proposal = proposalsRef.current.find((p) => p.id === id);
    if (!proposal) return null;
    // 落库会话：优先复用（还在引擎列表里），否则新建
    const known = new Set(storeRef.current.allSessions.map((s) => s.sessionId));
    let sessionId = applySessionId;
    if (sessionId === null || !known.has(sessionId)) {
      const workspaceId = storeRef.current.activeWorkspaceId;
      const created = await api.createSession(workspaceId === null ? {} : { workspaceId });
      sessionId = created.sessionId;
      setApplySessionId(sessionId);
    }
    await api.prompt({
      requestId: crypto.randomUUID(),
      sessionId,
      mode: "queue",
      content: [{ type: "text", text: applyPrompt(proposal) }],
    });
    patch(id, { status: "applied", appliedSessionId: sessionId });
    void storeRef.current.refresh();
    return sessionId;
  }, [applySessionId, patch]);

  const value = useMemo<EvolutionApi>(() => ({
    proposals,
    stats: {
      total: proposals.length,
      pending: proposals.filter((p) => p.status === "pending").length,
      applied: proposals.filter((p) => p.status === "applied").length,
      dismissed: proposals.filter((p) => p.status === "dismissed").length,
    },
    dismiss,
    apply,
  }), [proposals, dismiss, apply]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const HOME_LABEL: Record<LessonProposal["home"], string> = {
  agents: "AGENTS.md（规则区）",
  pitfalls: "docs/PITFALLS.md",
  spec: "docs/SPEC-*.md（设计段）",
  skill: "引擎技能正文 SKILL.md",
  policy: "docs/EVOLUTION-POLICY.md",
};

/** 落库交办提示：正文原样写、只改一处、提交引用提案 id（见 EVOLUTION-POLICY §3）。
 *  export 只为单测钉住这份"与 agent 的落库契约"。 */
export function applyPrompt(p: LessonProposal): string {
  const evidence = p.evidence.map((e) => `- ${e.excerpt}${e.note === undefined ? "" : `（${e.note}）`}`).join("\n");
  const predict = p.predict === null
    ? "（风格类：不设校验）"
    : `${p.predict.metric} · 签名 ${p.predict.signature} · 窗口 ${p.predict.windowDays} 天`;
  return [
    "把下面这条经验落进仓库。先读 docs/EVOLUTION-POLICY.md 与目标文件已有的写法，按那一家的格式落。",
    "",
    `- 落点：${HOME_LABEL[p.home]} 的「${p.anchor}」一节末尾`,
    `- 类别：${p.category}`,
    `- 效果主张：${predict}`,
    "",
    "正文（原样写入，不要改写措辞）：",
    p.content,
    "",
    "证据（逐字，供提交信息引用）：",
    evidence,
    "",
    `要求：只改这一处、不顺手动别的地方；git 提交一次，提交信息写明因果并引用提案 id ${p.id}；完成后回一句：改了哪个文件、提交号是多少。`,
  ].join("\n");
}
