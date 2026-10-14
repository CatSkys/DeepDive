// 单个定时任务卡：标题 + 指令摘要 + 状态/计划/已运行次数，右上 ⋯ 菜单
//（立即运行 / 继续·暂停 / 编辑定时任务 / 删除）。点卡片本体进编辑器。

import { useEffect, useState } from "react";
import { CirclePause, CirclePlay, Clock, Ellipsis, Pencil, Play, Trash2 } from "lucide-react";
import { confirmDialog } from "../components/DialogHost";
import { GlassLayer } from "../components/GlassLayer";
import { useT } from "../i18n";
import { describeSchedule, type AutomationTask } from "./model";
import { useAutomation } from "./useAutomation";
import css from "./Automation.module.css";

export function TaskCard({ task, onEdit, onOpenSession }: {
  task: AutomationTask;
  onEdit: (id: string) => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const { t, tt } = useT();
  const auto = useAutomation();
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null);
  const paused = task.status === "paused";
  const running = auto.running.has(task.id);
  const sched = describeSchedule(task.schedule);

  // 点空白处收起菜单（与侧栏右键菜单同款）；开菜单那一下在按钮里 stopPropagation
  useEffect(() => {
    if (!menuAt) return;
    const close = () => setMenuAt(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuAt]);

  /** 立即运行一次，成行就直接跳到那次会话（失败原因在运行历史里）。 */
  const runOnce = async () => {
    const sessionId = await auto.runNow(task.id);
    if (sessionId !== null) onOpenSession(sessionId);
  };

  const remove = async () => {
    const ok = await confirmDialog({ message: tt("删除定时任务「{title}」？", "Delete scheduled task “{title}”?", { title: task.title }), danger: true });
    if (ok) auto.deleteTask(task.id);
  };

  return (
    <div
      className={css.card}
      role="button"
      tabIndex={0}
      onClick={() => onEdit(task.id)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onEdit(task.id);
      }}
    >
      <div className={css.cardHead}>
        <span className={css.cardTitle}>{task.title}</span>
        <button
          className={css.cardMenuBtn}
          data-open={menuAt ? "" : undefined}
          data-tip={t("任务操作")}
          aria-label={t("任务操作")}
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            setMenuAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - 190, window.innerWidth - 200)) });
          }}
        >
          <Ellipsis size={15} />
        </button>
      </div>
      <div className={css.cardDesc}>{task.instruction}</div>
      <div className={css.cardFoot}>
        <span className={css.statusPill} data-status={task.status}>
          {paused ? <CirclePause size={12} /> : <CirclePlay size={12} />}
          {paused ? t("已暂停") : t("已启用")}
        </span>
        <span className={css.schedChip}>
          <Clock size={12} />
          {sched.prefix}
          {sched.time && <span className={css.schedTime}>{sched.time}</span>}
        </span>
        <span className={css.cardMeta}>{running ? t("运行中…") : tt("已运行 {n} 次", "Ran {n}×", { n: task.runCount })}</span>
      </div>
      {menuAt && (
        <div className="ctx-menu" style={{ top: menuAt.top, left: menuAt.left }} onClick={(e) => e.stopPropagation()}>
          <GlassLayer />
          <div className="ctx-item" onClick={() => { setMenuAt(null); void runOnce(); }}>
            <Play size={13} /> {t("立即运行")}
          </div>
          <div className="ctx-item" onClick={() => { setMenuAt(null); auto.updateTask(task.id, { status: paused ? "enabled" : "paused" }); }}>
            {paused ? <CirclePlay size={13} /> : <CirclePause size={13} />} {paused ? t("继续") : t("暂停")}
          </div>
          <div className="ctx-item" onClick={() => { setMenuAt(null); onEdit(task.id); }}>
            <Pencil size={13} /> {t("编辑定时任务")}
          </div>
          <div className="ctx-sep" />
          <div className="ctx-item danger" onClick={() => { setMenuAt(null); void remove(); }}>
            <Trash2 size={13} /> {t("删除")}
          </div>
        </div>
      )}
    </div>
  );
}
