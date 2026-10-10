// 未读合并冲账器（从 store.tsx 拆出）：后台会话每条 api-session/activity 都会
// 打一次 markUnread，逐条 = new Set + 全量 localStorage 序化 + context 换值
// （全树重渲）。合并到 500ms 一批；冲账前剔除这期间已被点开的会话，未读点
// 不落在正在看的会话上。纯机制，不持有 React 依赖——冲账的应用由调用方给。

/** 冲账窗口；markUnread 的批边界。 */
const UNREAD_BATCH_MS = 500;

export interface UnreadBatcher {
  /** 打一条未读（合并进下一批）。 */
  mark: (id: string) => void;
}

export function createUnreadBatcher(deps: {
  /** 批的应用：把合并后的集合交调用方落 state 与 localStorage。 */
  persist: (next: Set<string>) => void;
  /** "正在看的会话"取值（冲账那一刻读）： недавно 点开的会话不打点。 */
  activeId: () => string | null;
  /** React 的 setState（接受 updater 的那个形态）。 */
  setUnread: (update: (prev: Set<string>) => Set<string>) => void;
}): UnreadBatcher {
  let pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const ids = pending;
    pending = new Set(ids); // 冲账期间新到的 id 留给下一批
    if (ids.size === 0) return;
    const active = deps.activeId();
    if (active !== null) ids.delete(active);
    if (ids.size === 0) return;
    deps.setUnread((prev) => {
      let touched = false;
      for (const id of ids) if (!prev.has(id)) touched = true;
      if (!touched) return prev;
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      deps.persist(next);
      return next;
    });
  };

  return {
    mark(id: string): void {
      pending.add(id);
      if (timer === null) timer = setTimeout(flush, UNREAD_BATCH_MS);
    },
  };
}
