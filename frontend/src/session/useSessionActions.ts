// 会话动作回调（唯一入口）：这些回调都以**引用稳定**为契约——Markdown 的 memo 只做
// 浅比较，调用点逐项新建的内联箭头会让它永远不等价，流式期间每条落定消息都要重新
// parseBlocks（契约的钉子见 __tests__/streaming-memo.test.tsx）。
// 放在这里是为了让 SessionView 只做编排，新逻辑不再往上堆。
import { useCallback, useRef } from "react";
import { api } from "../api";
import { t, tt } from "../i18n";
import { uuid } from "../uuid";
import { useStore } from "../store";
import type { FilePreview } from "../components/preview/useFilePreview";

/** `ui` 围栏动作按钮的发送回调（悬浮对话卡与会话页共用这一份实现）：
 *  运行中插队（steer，点按即生效）、空闲开新轮（queue）——与 Composer 的
 *  空闲分支同一语义。store 经 ref 取值保证**零依赖**（引用稳定的契约面）。 */
export function useSessionSend(sessionId: string): (text: string) => void {
  const store = useStore();
  const ref = useRef(store);
  ref.current = store;
  return useCallback((text: string) => {
    const s = ref.current.sessions.find((x) => x.sessionId === sessionId)
      ?? ref.current.allSessions.find((x) => x.sessionId === sessionId);
    const mode = s?.running ? "steer" : "queue";
    // 发送失败静默：轮次没开成时流里没有可挂错误的位置，与 continueTurn 同一纪律。
    void api.prompt({ requestId: uuid(), sessionId, mode, content: [{ type: "text", text }] }).catch(() => void 0);
  }, [sessionId]);
}

/** widget 运行时错误回传（用户定稿「AI 要能看到沙箱」）：会话**运行中**自动
 *  插队告知模型（自愈即时，模型当场改 HTML）；空闲 → 返回 false——widget 出
 *  错误条 + 「告知 AI」按钮，发不发由用户决定，不自动开新轮。 */
export function useWidgetErrorReport(sessionId: string): (message: string) => boolean {
  const store = useStore();
  const ref = useRef(store);
  ref.current = store;
  return useCallback((message: string) => {
    const s = ref.current.sessions.find((x) => x.sessionId === sessionId)
      ?? ref.current.allSessions.find((x) => x.sessionId === sessionId);
    if (!s?.running) return false;
    void api.prompt({
      requestId: uuid(), sessionId, mode: "steer",
      content: [{ type: "text", text: tt("组件运行报错，请检查：", "Widget runtime error, please check: ") + message }],
    }).catch(() => void 0);
    return true;
  }, [sessionId]);
}

export interface SessionActions {
  /** 正文/产物里的本地文件链接落点：交预览窗口打开并落到该行。 */
  openPreviewFile: (path: string, line?: number) => void;
  /** branch（官方 forkAt）：从轮收尾 seq 分叉子会话并切入。 */
  branchFrom: (atSeq: number) => void;
  /** turn-tail 的「继续」（max-tokens 截断后接着跑）。 */
  continueTurn: () => void;
  /** `ui` 围栏动作按钮：交互文本作为用户下一轮发出。 */
  sendPrompt: (text: string) => void;
}

export function useSessionActions({ sessionId, store, preview, wsPath }: {
  sessionId: string;
  store: ReturnType<typeof useStore>;
  preview: FilePreview;
  /** 工作区根：产物/预览的相对路径按它解析成绝对路径（壳动作要绝对路径）。 */
  wsPath?: string;
}): SessionActions {
  const absPreviewPath = useCallback(
    (p: string) => (p.startsWith("/") || !wsPath ? p : `${wsPath}/${p}`),
    [wsPath],
  );
  // preview.open 自身是空依赖的 useCallback——收成稳定引用，Markdown 的 memo 才命中。
  const openPreview = preview.open;
  const openPreviewFile = useCallback(
    (p: string, line?: number) => openPreview(absPreviewPath(p), line),
    [openPreview, absPreviewPath],
  );
  // fork 失败留在当前会话：无部分状态可回滚。
  const branchFrom = useCallback((atSeq: number) => {
    api.fork({ sessionId, atSeq })
      .then((r) => {
        void store.refresh();
        store.openSession(r.sessionId);
      })
      .catch(() => void 0);
  }, [sessionId, store]);
  const continueTurn = useCallback(() => {
    // 发送失败：max-tokens 卡保留，用户可再点。
    void api.prompt({ requestId: uuid(), sessionId, mode: "queue", content: [{ type: "text", text: t("继续") }] }).catch(() => void 0);
  }, [sessionId]);
  const sendPrompt = useSessionSend(sessionId);
  return { openPreviewFile, branchFrom, continueTurn, sendPrompt };
}
