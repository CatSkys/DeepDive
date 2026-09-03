import { useEffect, useRef, useState } from "react";
import { AlarmClock, ListTodo } from "lucide-react";
import { useStore } from "../store";
import { t, tt } from "../i18n";
import type { ScheduleRecord } from "../types";

// 5.3 后台任务与提醒（官方 ui-jobs 的会话头目录形态）：
// - Jobs：session/jobs mux 帧全量快照（store 持有），弹层列状态点+标签+实时时长；
//   rc.2 无任务 kill 的浏览器面，目录只读。
// - Schedule：schedule/change 事件折叠出的会话本地提醒目录（只读；会话内投递，
//   无外部通知通道——引擎 docs/subsystems/schedule.md 语义，此处显式标注）。

const STATUS_LABEL: Record<string, [string, string]> = {
  running: ["运行中", "running"],
  stopping: ["停止中", "stopping"],
  completed: ["已完成", "completed"],
  killed: ["已终止", "killed"],
  failed: ["失败", "failed"],
};

function elapsed(startedAt: number, finishedAt: number | undefined, now: number): string {
  const ms = (finishedAt ?? now) - startedAt;
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return tt("{s}秒", "{s}s", { s });
  const m = Math.floor(s / 60);
  if (m < 60) return tt("{m}分{s}秒", "{m}m{s}s", { m, s: s % 60 });
  return tt("{h}小时", "{h}h", { h: Math.floor(m / 60) });
}

/// 会话头后台任务目录按钮 + 弹层。jobs 来自 store（session/jobs 帧）。
export function JobsMenu({ sessionId }: { sessionId: string }) {
  const jobs = useStore().jobsBySession.get(sessionId) ?? [];
  return <JobsMenuInner jobs={jobs} />;
}

function JobsMenuInner({ jobs }: { jobs: import("../types").JobView[] }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const ref = useRef<HTMLDivElement>(null);
  const live = jobs.filter((j) => j.status === "running" || j.status === "stopping");
  useEffect(() => {
    if (!open || live.length === 0) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [open, live.length]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (jobs.length === 0) return null;
  return (
    <div className="jobs-wrap" ref={ref}>
      <button
        type="button"
        className="jobs-trigger"
        data-open={open ? "true" : "false"}
        title={t("后台任务")}
        onClick={() => setOpen((v) => !v)}
      >
        <ListTodo size={14} />
        {live.length > 0 ? live.length : ""}
        {live.length > 0 && <span className="lineage-live" aria-hidden="true" />}
      </button>
      {open && (
        <div className="jobs-menu">
          <div className="lineage-head"><span>{t("后台任务")}</span></div>
          {jobs.map((j) => (
            <div key={j.id} className="jobs-row">
              <span className={`state-dot ${j.status === "failed" ? "error" : j.status === "running" ? "running" : "ok"}`} aria-hidden="true" />
              <span className="jobs-body">
                <span className="jobs-label">{j.label}</span>
                <span className="jobs-meta">
                  {j.kind} · {tt(...STATUS_LABEL[j.status] ?? STATUS_LABEL.running!)}
                  {j.detail ? ` · ${j.detail}` : ""}
                </span>
              </span>
              <span className="jobs-elapsed">{elapsed(j.startedAt, j.finishedAt, now)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/// 会话本地提醒目录（只读折叠）。records 来自 ingest 的 schedule/change 折叠。
export function ScheduleMenu({ records }: { records: ScheduleRecord[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (records.length === 0) return null;
  const fmtWhen = (r: ScheduleRecord): string => {
    if (r.kind === "every") return tt("每 {n} 分钟", "every {n} min", { n: Math.round((r.everySeconds ?? 300) / 60) });
    if (r.scheduledAt) {
      const d = new Date(r.scheduledAt);
      return d.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    }
    return "—";
  };
  return (
    <div className="jobs-wrap" ref={ref}>
      <button
        type="button"
        className="jobs-trigger"
        data-open={open ? "true" : "false"}
        title={t("会话提醒")}
        onClick={() => setOpen((v) => !v)}
      >
        <AlarmClock size={14} />
        {records.length}
      </button>
      {open && (
        <div className="jobs-menu">
          <div className="lineage-head">
            <span>{t("会话提醒")}</span>
            <span className="lineage-mode">{t("会话本地 · 到点经会话内续跑投递")}</span>
          </div>
          {records.map((r) => (
            <div key={r.id} className="jobs-row">
              <span className="state-dot running" aria-hidden="true" />
              <span className="jobs-body">
                <span className="jobs-label">{r.prompt}</span>
                <span className="jobs-meta">{fmtWhen(r)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
