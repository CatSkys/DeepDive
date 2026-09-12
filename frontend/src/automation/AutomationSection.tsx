// 自动化（设置页分区）：列表 ↔ 新建/编辑 两态路由。任务状态与调度在
// useAutomation（App 级挂载——设置页关掉照样到点触发）；历史里跳会话要先离开
// 设置页，所以外壳把 onOpenSession 透传进来。

import { useEffect, useState } from "react";
import { TaskEditorPage } from "./TaskEditorPage";
import { TaskListPage } from "./TaskListPage";
import type { AutomationProposal } from "./protocol";
import type { TaskTemplate } from "./templates";
import css from "./Automation.module.css";

type Route =
  | { kind: "list" }
  | { kind: "new"; template: TaskTemplate | null; proposal: AutomationProposal | null }
  | { kind: "edit"; id: string };

export function AutomationSection({ onOpenSession, initialDraft, onDraftUsed }: {
  onOpenSession: (sessionId: string) => void;
  /** 消息流里的「定时任务建议」：进来直接开新建表单并预填。 */
  initialDraft?: AutomationProposal | null;
  onDraftUsed?: () => void;
}) {
  const [route, setRoute] = useState<Route>(() => initialDraft
    ? { kind: "new", template: null, proposal: initialDraft }
    : { kind: "list" });

  // 建议只消费一次：表单已开就不能在下次进分区时再弹一遍
  useEffect(() => {
    if (initialDraft) onDraftUsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={css.col}>
      {route.kind === "list" ? (
        <TaskListPage
          onCreate={(template) => setRoute({ kind: "new", template, proposal: null })}
          onEdit={(id) => setRoute({ kind: "edit", id })}
          onOpenSession={onOpenSession}
        />
      ) : (
        <TaskEditorPage
          taskId={route.kind === "edit" ? route.id : null}
          template={route.kind === "new" ? route.template : null}
          proposal={route.kind === "new" ? route.proposal : null}
          onBack={() => setRoute({ kind: "list" })}
          onOpenSession={onOpenSession}
        />
      )}
    </div>
  );
}
