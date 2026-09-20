// 运行历史（编辑器的「历史」页签）：该任务的历次运行——失败带原因，
// 成功的可以跳去那次会话看转录。记录由 useAutomation 在每次执行时落。

import { useT } from "../i18n";
import { lateText, runTimeText } from "./model";
import { useAutomation } from "./useAutomation";
import css from "./Automation.module.css";

export function RunHistory({ taskId, onOpenSession }: { taskId: string | null; onOpenSession: (sessionId: string) => void }) {
  const { t, tt, lang } = useT();
  const runs = useAutomation().runs.filter((r) => r.taskId === taskId);
  if (taskId === null || runs.length === 0) return <div className={css.empty}>{t("暂无运行记录")}</div>;

  return (
    <div>
      {runs.map((run) => {
        const sid = run.sessionId;
        return (
          <div key={run.id} className={css.runRow}>
            <span className={css.runTime}>
              {runTimeText(run.startedAt, lang)}
              {lateText(run.lateMs, lang) !== "" && <span className={css.runLate}> · {lateText(run.lateMs, lang)}</span>}
            </span>
            <span className={css.runStatus} data-status={run.status}>
              {run.status === "running" ? t("运行中…")
                : run.status === "done" ? t("已完成")
                : tt("失败：{m}", "Failed: {m}", { m: run.error ?? "" })}
            </span>
            <span className={css.spacer} />
            {sid !== null && (
              <button className={css.link} onClick={() => onOpenSession(sid)}>{t("打开会话")}</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
