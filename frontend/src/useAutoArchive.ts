// 自动归档的驱动（用户定稿功能）：开关打开时，挂载后立即扫一次、此后每
// SCAN_INTERVAL_MS 扫一次；候选逐个调引擎 workspace/archiveSession，全部结束后
// 刷新会话列表。候选判定在 autoArchive.ts（纯函数），本文件只管时序与错误口径。

import { useEffect, useRef } from "react";
import { api } from "./api";
import { useStore } from "./store";
import { SCAN_INTERVAL_MS, archiveCandidates, retentionMs } from "./autoArchive";

export function useAutoArchive(): void {
  const store = useStore();
  // 扫描期间 store 会随会话列表更新换引用；用 ref 取最新快照，避免 effect 反复重挂
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    if (!store.autoArchive) return;
    let alive = true;
    const scan = async () => {
      const s = storeRef.current;
      const ids = archiveCandidates(s.sessions, {
        pinned: s.pinned,
        unread: s.unread,
        activeSessionId: s.activeSessionId,
        retentionMs: retentionMs(s.archiveRetention),
        now: Date.now(),
      });
      if (ids.length === 0) return;
      let archived = 0;
      for (const sessionId of ids) {
        if (!alive) return;
        try {
          await api.workspaceArchiveSession({ sessionId });
          s.clearUnarchiveOverride(sessionId);
          archived += 1;
        } catch { /* 引擎忙/网络抖动：留给下一轮扫描重试 */ }
      }
      if (alive && archived > 0) await s.refresh();
    };
    void scan();
    const timer = window.setInterval(() => void scan(), SCAN_INTERVAL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [store.autoArchive, store.archiveRetention]);
}
