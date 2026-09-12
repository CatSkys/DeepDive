// 定时任务编辑器：新建与编辑共用一张表单（标题 / 调度 / 指令 + 运行选项），
// 配「设置 / 历史」两个页签。字段写入统一经「保存」一次提交；「立即运行」
// 先落盘再跑，跑完直接跳到那次会话。状态胶囊改的是草稿（随保存生效），
// ⋯ 菜单里的继续/暂停与删除是立即生效的动作用语。

import { useEffect, useRef, useState } from "react";
import { ChevronRight, CirclePause, CirclePlay, Ellipsis, Folder, Gauge, Hand, MessagesSquare, Play, Trash2 } from "lucide-react";
import { Dropdown, type DropdownOption } from "../components/controls";
import { confirmDialog } from "../components/DialogHost";
import { t, useT } from "../i18n";
import { Seg } from "../stats/Seg";
import { useStore } from "../store";
import type { AutomationTask, RunTarget, Schedule, TaskDraft, TaskStatus } from "./model";
import { RunHistory } from "./RunHistory";
import { ScheduleRow } from "./ScheduleRow";
import type { AutomationProposal } from "./protocol";
import type { TaskTemplate } from "./templates";
import { useAutomation } from "./useAutomation";
import { useRunOptions } from "./useRunOptions";
import css from "./Automation.module.css";

interface Draft {
  title: string;
  instruction: string;
  schedule: Schedule | null;
  workspaceId: string | null;
  /** 引擎 permission 预设键；"" = 跟随会话默认。 */
  permission: string;
  model: AutomationTask["model"];
  target: RunTarget;
  sessionId: string | null;
  status: TaskStatus;
}

/** 初始草稿：编辑取任务现值；新建按 建议（会话里提出的）→ 模板 → 空白 取值，
 *  工作空间取匹配结果或当前空间。 */
function initialDraft(opts: {
  task: AutomationTask | null;
  template: TaskTemplate | null;
  proposal: AutomationProposal | null;
  workspaceId: string | null;
  proposalWorkspaceId: string | null;
}): Draft {
  const { task, template, proposal, workspaceId, proposalWorkspaceId } = opts;
  if (task !== null) {
    return {
      title: task.title, instruction: task.instruction, schedule: task.schedule,
      workspaceId: task.workspaceId, permission: task.permission ?? "", model: task.model,
      target: task.target, sessionId: task.sessionId, status: task.status,
    };
  }
  if (proposal !== null) {
    return {
      title: proposal.title,
      instruction: proposal.instruction,
      schedule: proposal.schedule,
      workspaceId: proposalWorkspaceId ?? workspaceId,
      permission: proposal.permission ?? "",
      model: null,
      target: "new",
      sessionId: null,
      status: "enabled",
    };
  }
  return {
    title: template === null ? t("未命名定时任务") : t(template.name),
    instruction: template === null ? "" : t(template.instruction),
    schedule: template?.schedule ?? null,
    workspaceId,
    permission: "",
    model: null,
    target: "new",
    sessionId: null,
    status: "enabled",
  };
}

export function TaskEditorPage({ taskId, template, proposal, onBack, onOpenSession }: {
  taskId: string | null;
  template: TaskTemplate | null;
  /** 会话里提出的建议（有则优先于模板/空白预填）。 */
  proposal: AutomationProposal | null;
  onBack: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const { t, tt } = useT();
  const auto = useAutomation();
  const store = useStore();
  const options = useRunOptions();
  const task = taskId === null ? null : auto.tasks.find((x) => x.id === taskId) ?? null;
  const [tab, setTab] = useState<"settings" | "history">("settings");
  const [draft, setDraft] = useState<Draft>(() => initialDraft({
    task,
    template,
    proposal,
    workspaceId: store.activeWorkspaceId ?? store.workspaces[0]?.workspaceId ?? null,
    proposalWorkspaceId: proposal?.workspace === null || proposal === null
      ? null
      : store.workspaces.find((w) => w.title === proposal.workspace)?.workspaceId ?? null,
  }));
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 点空白收起 ⋯ 菜单（开菜单那一下在按钮里 stopPropagation）
  useEffect(() => {
    if (!menuAt) return;
    const close = () => setMenuAt(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuAt]);

  // 指令框随内容长高（textarea 高度 = scrollHeight），不出内滚条
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft.instruction, tab]);

  const fields = {
    title: draft.title.trim() === "" ? t("未命名定时任务") : draft.title.trim(),
    instruction: draft.instruction.trim(),
    workspaceId: draft.workspaceId,
    permission: draft.permission === "" ? null : draft.permission,
    model: draft.model,
    target: draft.target,
    sessionId: draft.sessionId,
    status: draft.status,
  };
  const canSave = draft.schedule !== null && fields.instruction !== "";

  const save = () => {
    const schedule = draft.schedule;
    if (schedule === null || fields.instruction === "") return; // 由按钮禁用态兜住，这里只为类型收窄
    const payload: TaskDraft = { ...fields, schedule };
    if (task === null) auto.createTask(payload);
    else auto.updateTask(task.id, payload);
    onBack();
  };

  const runNow = async () => {
    const schedule = draft.schedule;
    if (task === null || schedule === null || fields.instruction === "") return;
    const payload: TaskDraft = { ...fields, schedule };
    setBusy(true);
    auto.updateTask(task.id, payload);
    const sessionId = await auto.runNow(task.id, payload);
    setBusy(false);
    if (sessionId !== null) onOpenSession(sessionId);
  };

  const remove = async () => {
    if (task === null) return;
    const ok = await confirmDialog({ message: tt("删除定时任务「{title}」？", "Delete scheduled task “{title}”?", { title: task.title }), danger: true });
    if (!ok) return;
    auto.deleteTask(task.id);
    onBack();
  };

  const dm = draft.model;
  const picked = dm === null ? undefined : options.models.find((m) => m.provider === dm.provider && m.model === dm.model);
  const levels = picked?.efforts ?? [];
  const modelOptions: DropdownOption[] = [
    { v: "", label: t("跟随默认模型") },
    ...options.models.map((m): DropdownOption => ({ v: `${m.provider}/${m.model}`, label: m.label })),
  ];
  const permissionOptions: DropdownOption[] = [
    { v: "", label: t("跟随会话默认"), icon: Hand },
    ...options.permissions.map((p): DropdownOption => ({ v: p.value, label: p.label, icon: Hand })),
  ];

  return (
    <>
      <div className={css.crumb}>
        <button className={css.crumbLink} onClick={onBack}>{t("自动化")}</button>
        <ChevronRight size={12} />
        <span className={css.crumbNow}>{task === null ? t("新建任务") : task.title}</span>
      </div>
      <div className={css.editorHead}>
        <div className={css.h1}>{task === null ? t("新建定时任务") : t("编辑定时任务")}</div>
        <div className={css.sub}>{task === null ? t("配置任务的执行时间、指令和运行方式。") : t("调整此任务的执行时间、指令和运行方式。")}</div>
      </div>
      <div className={css.tabsRow}>
        <Seg
          value={tab}
          options={[{ v: "settings", label: "设置" }, { v: "history", label: "历史" }]}
          onChange={(v) => setTab(v)}
        />
        <span className={css.spacer} />
        {task === null ? (
          <button className={`${css.btn} ${css.btnPrimary}`} disabled={!canSave} data-tip={canSave ? undefined : t("先填指令并添加计划")} onClick={save}>
            {t("创建定时任务")}
          </button>
        ) : (
          <>
            <button className={`${css.btn} ${css.btnPrimary}`} onClick={save}>{t("保存")}</button>
            <button className={css.btn} disabled={busy} onClick={() => void runNow()}>
              <Play size={13} /> {t("立即运行")}
            </button>
            <button
              className={`${css.btn} ${css.iconBtn}`}
              data-tip={t("更多")}
              aria-label={t("更多")}
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                setMenuAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - 190, window.innerWidth - 200)) });
              }}
            >
              <Ellipsis size={15} />
            </button>
          </>
        )}
      </div>

      {tab === "history" ? (
        <RunHistory taskId={taskId} onOpenSession={onOpenSession} />
      ) : (
        <>
          {task !== null && (
            <div className={css.field}>
              <span className={css.fieldLabel}>{t("状态")}</span>
              <button
                className={css.statusBtn}
                data-status={draft.status}
                data-tip={t("点击切换启用 / 暂停")}
                onClick={() => setDraft({ ...draft, status: draft.status === "paused" ? "enabled" : "paused" })}
              >
                {draft.status === "paused" ? <CirclePause size={12} /> : <CirclePlay size={12} />}
                {draft.status === "paused" ? t("已暂停") : t("已启用")}
              </button>
            </div>
          )}
          <div className={css.field}>
            <label className={css.fieldLabel} htmlFor="automation-title">{t("任务标题")}</label>
            <input
              id="automation-title"
              className={css.input}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </div>
          <div className={css.field}>
            <span className={css.fieldLabel}>{t("调度")}</span>
            <ScheduleRow value={draft.schedule} onChange={(schedule) => setDraft({ ...draft, schedule })} />
          </div>
          <div className={css.field}>
            <span className={css.fieldLabel}>{t("指令")}</span>
            <div className={css.instrBox}>
              <textarea
                ref={taRef}
                className={css.instrInput}
                rows={1}
                placeholder={t("例如：Review 最近 24 小时的提交，总结可能引入的 bug 和修复建议")}
                value={draft.instruction}
                onChange={(e) => setDraft({ ...draft, instruction: e.target.value })}
              />
              <div className={css.instrFoot}>
                {options.workspaces.length > 0 && (
                  <Dropdown
                    variant="bare"
                    options={[
                      { v: "", label: t("跟随当前工作空间"), icon: Folder },
                      ...options.workspaces.map((w): DropdownOption => ({ v: w.workspaceId, label: w.title, icon: Folder })),
                    ]}
                    value={draft.workspaceId ?? ""}
                    onChange={(v) => setDraft({ ...draft, workspaceId: v === "" ? null : v })}
                  />
                )}
                {options.permissions.length > 0 && (
                  <Dropdown
                    variant="bare"
                    options={permissionOptions}
                    value={draft.permission}
                    onChange={(v) => setDraft({ ...draft, permission: v })}
                  />
                )}
                <Dropdown
                  variant="bare"
                  options={[
                    { v: "new", label: t("每次新建会话"), icon: MessagesSquare },
                    { v: "session", label: t("复用同一会话"), icon: MessagesSquare },
                  ]}
                  value={draft.target}
                  onChange={(v) => setDraft({ ...draft, target: v as RunTarget })}
                />
                <span className={css.spacer} />
                <Dropdown
                  variant="bare"
                  options={modelOptions}
                  value={dm === null ? "" : `${dm.provider}/${dm.model}`}
                  onChange={(v) => {
                    const m = options.models.find((x) => `${x.provider}/${x.model}` === v);
                    setDraft({ ...draft, model: m === undefined ? null : { provider: m.provider, model: m.model } });
                  }}
                />
                {levels.length > 0 && dm !== null && (
                  <Dropdown
                    variant="bare"
                    options={[
                      { v: "", label: t("默认"), icon: Gauge },
                      ...levels.map((l): DropdownOption => ({ v: l.id, label: l.name, icon: Gauge })),
                    ]}
                    value={dm.reasoningEffort ?? ""}
                    onChange={(v) => setDraft({ ...draft, model: v === "" ? { provider: dm.provider, model: dm.model } : { provider: dm.provider, model: dm.model, reasoningEffort: v } })}
                  />
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {menuAt && task !== null && (
        <div className="ctx-menu" style={{ top: menuAt.top, left: menuAt.left }} onClick={(e) => e.stopPropagation()}>
          <div
            className="ctx-item"
            onClick={() => {
              setMenuAt(null);
              const status: TaskStatus = draft.status === "paused" ? "enabled" : "paused";
              auto.updateTask(task.id, { status });
              setDraft({ ...draft, status });
            }}
          >
            {draft.status === "paused" ? <CirclePlay size={13} /> : <CirclePause size={13} />}
            {draft.status === "paused" ? t("继续") : t("暂停")}
          </div>
          <div className="ctx-sep" />
          <div className="ctx-item danger" onClick={() => { setMenuAt(null); void remove(); }}>
            <Trash2 size={13} /> {t("删除")}
          </div>
        </div>
      )}
    </>
  );
}
