// 子会话只读说明（origin==='subagent' 的会话视图 composer 替代）。
// 从原 StatusCapsule 文件搬出：它和状态胶囊无关，只是同一个文件里放了太久。

import { t } from "../i18n";
import { useStore } from "../store";

export function SubagentReadOnlyNotice({ parentSessionId }: { parentSessionId?: string }) {
  const { sessions, openSession } = useStore();
  const parentTitle = (sessions.find((s) => s.sessionId === parentSessionId)?.projections?.values?.title as string | undefined)
    ?? t("打开父会话");
  return (
    <div className="subagent-readonly" role="status">
      <strong>{t("这是子智能体会话")}</strong>
      <span>{t("目录寻址的子会话在此只读；继续对话请回到父会话。")}</span>
      {parentSessionId && (
        <button type="button" className="subagent-parent-link" onClick={() => openSession(parentSessionId)}>
          {parentTitle}
        </button>
      )}
    </div>
  );
}
