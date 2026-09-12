// 自动化（设置页分区）：列表 ↔ 新建/编辑 两态路由。任务状态与调度在
// useAutomation（App 级挂载——设置页关掉照样到点触发）；历史里跳会话要先离开
// 设置页，所以外壳把 onOpenSession 透传进来。

import { useState } from "react";
import { TaskEditorPage } from "./TaskEditorPage";
import { TaskListPage } from "./TaskListPage";
import type { TaskTemplate } from "./templates";
import css from "./Automation.module.css";

type Route = { kind: "list" } | { kind: "new"; template: TaskTemplate | null } | { kind: "edit"; id: string };

export function AutomationSection({ onOpenSession }: { onOpenSession: (sessionId: string) => void }) {
  const [route, setRoute] = useState<Route>({ kind: "list" });
  return (
    <div className={css.col}>
      {route.kind === "list" ? (
        <TaskListPage
          onCreate={(template) => setRoute({ kind: "new", template })}
          onEdit={(id) => setRoute({ kind: "edit", id })}
          onOpenSession={onOpenSession}
        />
      ) : (
        <TaskEditorPage
          taskId={route.kind === "edit" ? route.id : null}
          template={route.kind === "new" ? route.template : null}
          onBack={() => setRoute({ kind: "list" })}
          onOpenSession={onOpenSession}
        />
      )}
    </div>
  );
}
