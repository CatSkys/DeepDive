// 自动化列表页：说明 + 创建入口 + 保持唤醒开关 + 已创建任务卡 + 模板卡。
// 模板点击只把示例填进新建表单（不直接建任务）——无人值守的任务该先看一眼。

import { Clock, Plus, Timer } from "lucide-react";
import { Toggle } from "../components/controls";
import { useT } from "../i18n";
import { describeSchedule } from "./model";
import { TEMPLATES, type TaskTemplate } from "./templates";
import { TaskCard } from "./TaskCard";
import { useAutomation } from "./useAutomation";
import css from "./Automation.module.css";

export function TaskListPage({ onCreate, onEdit, onOpenSession }: {
  onCreate: (template: TaskTemplate | null) => void;
  onEdit: (id: string) => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const { t } = useT();
  const auto = useAutomation();
  return (
    <>
      <div className={css.head}>
        <div>
          <div className={css.h1}>{t("自动化")}</div>
          <div className={css.sub}>{t("按计划运行任务，或在需要时随时执行。")}</div>
        </div>
        <button className={`${css.btn} ${css.btnPrimary}`} onClick={() => onCreate(null)}>
          <Plus size={14} /> {t("创建定时任务")}
        </button>
      </div>
      <div className={css.notice}>
        <Timer size={14} />
        <span className={css.noticeText}>{t("运行会话时保持电脑唤醒。")}</span>
        <Toggle on={auto.keepAwake} onChange={auto.setKeepAwake} />
      </div>

      <div className={css.sectionLabel}>{t("已创建任务")}</div>
      {auto.tasks.length === 0 ? (
        <div className={css.empty}>{t("暂无定时任务")}</div>
      ) : (
        <div className={css.grid}>
          {auto.tasks.map((task) => <TaskCard key={task.id} task={task} onEdit={onEdit} onOpenSession={onOpenSession} />)}
        </div>
      )}

      <div className={css.sectionLabel}>{t("定时任务模板")}</div>
      <div className={css.grid}>
        {TEMPLATES.map((tpl) => {
          const sched = describeSchedule(tpl.schedule);
          return (
            <button key={tpl.id} type="button" className={css.card} onClick={() => onCreate(tpl)}>
              <div className={css.cardHead}>
                <tpl.icon size={13} className={css.tplIcon} />
                <span className={css.cardTitle}>{t(tpl.name)}</span>
              </div>
              <div className={css.cardDesc}>{t(tpl.description)}</div>
              <div className={css.cardFoot}>
                <span className={css.schedChip}>
                  <Clock size={12} />
                  {sched.prefix}
                  <span className={css.schedTime}>{sched.time}</span>
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
