// 消息反馈对象层（官方 ui-message-feedback controller 的 hook 化移植）：
// 一次 list 读种整份会话视图；写操作串行化（promise 队列）并按已观察的
// version 做 CAS——version-conflict 回复携带权威 item，就地和解不重拉。
// 语义要点（对照 controller.ts）：toggle 读**已提交**的 item 决定撤销/改判，
// 冷视图上的点击也按存储值翻转而非空视图。
import { useCallback, useRef, useState } from "react";
import { api } from "../api";

export interface FeedbackItem {
  messageId: string;
  rating: "positive" | "negative";
  note?: string;
  /** 引擎侧不透明等值 token（实测为字符串），每次实质写换新；仅回传比对。 */
  version: string;
}

export type FeedbackResult = { ok: true } | { ok: false; code: string };

export interface FeedbackView {
  status: "cold" | "loading" | "ready" | "error";
  items: Map<string, FeedbackItem>;
}

const INITIAL: FeedbackView = { status: "cold", items: new Map() };

export function useFeedback(sessionId: string) {
  const [view, setView] = useState<FeedbackView>(INITIAL);
  // 异步队列闭包读的同步镜像（status/items 皆然——避免 stale 渲染闭包）。
  const statusRef = useRef(view.status);
  const itemsRef = useRef(view.items);
  const sessionRef = useRef(sessionId);
  /** 串行写队列：先等 list 读落地再执行，决策读到的是已提交值。 */
  const tailRef = useRef(Promise.resolve());

  if (sessionRef.current !== sessionId) {
    sessionRef.current = sessionId;
    statusRef.current = INITIAL.status;
    itemsRef.current = INITIAL.items;
    tailRef.current = Promise.resolve();
    setView(INITIAL);
  }

  const commit = (status: FeedbackView["status"], next: Map<string, FeedbackItem>) => {
    statusRef.current = status;
    itemsRef.current = next;
    setView({ status, items: next });
  };

  const load = useCallback(async (): Promise<FeedbackResult> => {
    statusRef.current = "loading";
    setView({ status: "loading", items: itemsRef.current });
    try {
      const r = await api.feedbackList(sessionId);
      const next = new Map<string, FeedbackItem>();
      for (const it of r.items ?? []) next.set(it.messageId, it);
      commit("ready", next);
      return { ok: true };
    } catch {
      commit("error", itemsRef.current);
      return { ok: false, code: "load" };
    }
  }, [sessionId]);

  /** 冷 → 惰性种入（首次 hover/focus 触发）；已就绪则空转。 */
  const ensure = useCallback(() => {
    if (statusRef.current !== "cold") return;
    void load();
  }, [load]);

  /** RPC 业务级结果 → 提交 item / 和解冲突。 */
  const settle = (res: { ok: boolean; value?: FeedbackItem | null; error?: { code: string; current: FeedbackItem | null } }): FeedbackResult => {
    if (res.ok) {
      if (res.value) {
        const next = new Map(itemsRef.current);
        next.set(res.value.messageId, res.value);
        commit("ready", next);
      }
      return { ok: true };
    }
    if (res.error?.code === "version-conflict" && res.error.current) {
      const next = new Map(itemsRef.current);
      next.set(res.error.current.messageId, res.error.current);
      commit("ready", next);
    }
    return { ok: false, code: res.error?.code ?? "unknown" };
  };

  const putCommitted = async (messageId: string, rating: FeedbackItem["rating"], note: string | undefined, observed: FeedbackItem | undefined): Promise<FeedbackResult> =>
    settle(await api.feedbackPut({
      sessionId, messageId, rating,
      ...(note === undefined ? {} : { note }),
      ifVersion: observed?.version ?? null,
    }));

  const deleteCommitted = async (messageId: string, observed: FeedbackItem): Promise<FeedbackResult> => {
    const res = settle(await api.feedbackDelete({ sessionId, messageId, ifVersion: observed.version }));
    if (res.ok) {
      const next = new Map(itemsRef.current);
      next.delete(messageId);
      commit("ready", next);
    }
    return res;
  };

  /** 串行化包装：排队等前一写完成 + 首写前先落 list 读。 */
  const mutate = (job: () => Promise<FeedbackResult>): Promise<FeedbackResult> => {
    const run = tailRef.current.then(async () => {
      if (statusRef.current === "cold" || statusRef.current === "error") await load();
      return job();
    });
    tailRef.current = run.then(() => undefined, () => undefined);
    return run;
  };

  /** 改判或新建（note 省略=保留存储值，见官方 rate 语义）。 */
  const rate = useCallback((messageId: string, rating: FeedbackItem["rating"], note?: string) =>
    mutate(async () => {
      const observed = itemsRef.current.get(messageId);
      return putCommitted(messageId, rating, note ?? observed?.note, observed);
    }),
  // mutate/tail 只依赖 ref 与 load（sessionId 已入 load deps）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [load]);

  /** 清备注保评分（空存语义；rate 的 note 省略=保留，表达不了删除）。 */
  const clearNote = useCallback((messageId: string) =>
    mutate(async () => {
      const observed = itemsRef.current.get(messageId);
      if (observed === undefined || observed.note === undefined) return { ok: true as const };
      return putCommitted(messageId, observed.rating, undefined, observed);
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [load]);

  /** 同评再点=撤销，异评=改判（读已提交值决策）。 */
  const toggle = useCallback((messageId: string, rating: FeedbackItem["rating"]) =>
    mutate(async () => {
      const observed = itemsRef.current.get(messageId);
      if (observed?.rating === rating) return deleteCommitted(messageId, observed);
      return putCommitted(messageId, rating, observed?.note, observed);
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [load]);

  return { view, ensure, rate, toggle, clearNote };
}
