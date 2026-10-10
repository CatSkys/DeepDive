// 流式提交合帧节流器（useSessionEvents 的热路径）：handler 内的 log.push/ingest
// 是 O(1) 即时执行，React 提交（items 全列表 slice + commit）合并成至多每
// intervalMs 一次——逐字 delta 的逐条全列表提交不再发生。
// 计时器用 setTimeout 而非 rAF：rAF 可被窗口完全隐藏/最小化暂停，暂停流式提交
// 会让界面停在上一次内容且无别的事件把它推醒。

export interface CommitScheduler {
  /** 合并一次提交：窗口内再次调用只是续约，不重复排。 */
  schedule: () => void;
  /** 撤掉未到期的合并（卸载/切流时清理）。 */
  cancel: () => void;
}

export function makeCommitScheduler(flush: () => void, intervalMs = 32): CommitScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(): void {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, intervalMs);
    },
    cancel(): void {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    },
  };
}
