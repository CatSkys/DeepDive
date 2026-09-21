// 会话动作回调（唯一入口）：三个回调都以**引用稳定**为契约——Markdown 的 memo 只做
// 浅比较，调用点逐项新建的内联箭头会让它永远不等价，流式期间每条落定消息都要重新
// parseBlocks（契约的钉子见 __tests__/streaming-memo.test.tsx）。
// 放在这里是为了让 SessionView 只做编排，新逻辑不再往上堆。
import { useCallback } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { uuid } from "../uuid";
import { useStore } from "../store";
import type { FilePreview } from "../components/preview/useFilePreview";

export interface SessionActions {
  /** 正文/产物里的本地文件链接落点：交预览窗口打开并落到该行。 */
  openPreviewFile: (path: string, line?: number) => void;
  /** branch（官方 forkAt）：从轮收尾 seq 分叉子会话并切入。 */
  branchFrom: (atSeq: number) => void;
  /** turn-tail 的「继续」（max-tokens 截断后接着跑）。 */
  continueTurn: () => void;
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
  return { openPreviewFile, branchFrom, continueTurn };
}
