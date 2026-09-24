// 面板「会话」页的分区：目标 / 任务与计划 / 产物 / 子智能体 / Git 工具 / 提醒 / 后台任务。
// 前六区原样来自状态胶囊（组件未改，只换了宿主），产物区是面板新增的一区——它把消息流里
// 逐轮的产物收成一份会话级清单（派生在 sessionArtifacts）。

import { useEffect, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { t, tt } from "../i18n";
import { useStore } from "../store";
import { basename } from "../session/format";
import { formatElapsed } from "../session/format";
import { fileUrlOf } from "../components/preview/previewModel";
import { CapsuleGitSection } from "../components/CapsuleGitSection";
import { CapsuleGoalSection } from "../components/CapsuleGoalSection";
import { CapsuleSection } from "../components/CapsuleSection";
import { CapsuleSubagentSection } from "../components/CapsuleSubagentSection";
import { CapsuleTodoSection } from "../components/CapsuleTodoSection";
import { sectionOpenOnCountChange, sectionOpenOnForceExpand } from "../components/capsuleModel";
import type { JobView, ScheduleRecord } from "../types";
import type { CapsuleData } from "./useCapsuleData";
import { fmtScheduleWhen } from "./useCapsuleData";
import type { ArtifactItem } from "./sessionArtifacts";

const JOB_STATUS: Record<string, [string, string]> = {
  running: ["运行中", "running"],
  stopping: ["停止中", "stopping"],
  completed: ["已完成", "completed"],
  killed: ["已终止", "killed"],
  failed: ["失败", "failed"],
};

/** 后台任务一行：状态点 + 名称 + 类型/状态 + 运行时长（已结束的用 finishedAt 定格）。 */
function JobRow({ job, now }: { job: JobView; now: number }) {
  return (
    <div className="capsule-row">
      <span className={`state-dot ${job.status === "failed" ? "error" : job.status === "running" ? "running" : "ok"}`} aria-hidden="true" />
      <span className="capsule-row-text">{job.label}</span>
      <span className="capsule-row-meta">
        {job.kind} · {tt(...(JOB_STATUS[job.status] ?? JOB_STATUS.running!))}
        {job.detail ? ` · ${job.detail}` : ""}
      </span>
      <span className="capsule-row-meta">{formatElapsed((job.finishedAt ?? now) - job.startedAt)}</span>
    </div>
  );
}

/** 产物一行：图片给缩略图，其余给文件名；描述降为 tooltip。 */
function ArtifactRow({ item, onPreview }: { item: ArtifactItem; onPreview?: (path: string) => void }) {
  return (
    <button
      type="button"
      className="panel-artifact"
      title={item.desc ?? item.path}
      onClick={() => onPreview?.(item.path)}
    >
      {item.image
        ? <img className="delivered-thumb" src={fileUrlOf(item.path)} alt={basename(item.path)} loading="lazy" />
        : <span className="panel-artifact-name">{basename(item.path)}</span>}
      <span className="panel-artifact-meta">{item.desc ?? item.path}</span>
    </button>
  );
}

/** 会话状态分区组（面板正文）。 */
export function StatusSections({ sessionId, data, scheduleRecords, artifacts, onPreview }: {
  sessionId: string;
  data: CapsuleData;
  scheduleRecords: ScheduleRecord[];
  artifacts: ArtifactItem[];
  onPreview?: (path: string) => void;
}) {
  const [showEndedJobs, setShowEndedJobs] = useState(false);
  const { openSession, refresh } = useStore();
  // 活动区的开合由本组件持有（ZCode 放在 SessionPane：那边 model 在宿主手里；
  // 本仓这些数据是自己取的，所以标记跟着数据走）
  const [agentOpen, setAgentOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);

  // 活动区开合的状态机（照 ZCode：切会话回关、在跑数归零自动收起）
  useEffect(() => { setAgentOpen(false); setJobsOpen(false); }, [sessionId]);
  useEffect(() => { setAgentOpen((v) => sectionOpenOnCountChange(v, data.runningChildren)); }, [data.runningChildren]);
  useEffect(() => { setJobsOpen((v) => sectionOpenOnCountChange(v, data.jobSplit.live.length)); }, [data.jobSplit.live.length]);

  // 面板这一页出现时把"有料的活动区"一并展开（官方是点活动徽标做这件事；入口不同，意图一致）
  const runningChildren = data.runningChildren;
  const liveJobs = data.jobSplit.live.length;
  useEffect(() => {
    setAgentOpen(sectionOpenOnForceExpand(runningChildren));
    setJobsOpen(sectionOpenOnForceExpand(liveJobs));
    // 只在挂载/切会话时定一次：之后的增减交给上面两条状态机
  }, [sessionId, runningChildren, liveJobs]);

  const { todo, goal, git, wsPath, jobSplit } = data;
  return (
    <>
      {artifacts.length > 0 && (
        <CapsuleSection title={t("产物")} trailing={String(artifacts.length)} scroll="tall">
          {artifacts.map((it) => <ArtifactRow key={it.key} item={it} onPreview={onPreview} />)}
        </CapsuleSection>
      )}
      {goal && (
        <CapsuleSection title={t("目标")}>
          <CapsuleGoalSection goal={goal} sessionId={sessionId} onChange={refresh} />
        </CapsuleSection>
      )}
      {todo.total > 0 && (
        <CapsuleSection title={t("任务与计划")} trailing={`${todo.done}/${todo.total}`} scroll="tall">
          <CapsuleTodoSection todo={todo} />
        </CapsuleSection>
      )}
      {data.children.length > 0 && (
        <CapsuleSection
          title={t("子智能体")}
          open={agentOpen}
          onOpenChange={setAgentOpen}
          trailing={
            <button type="button" className="capsule-refresh" data-tip={t("刷新")} onClick={data.reloadChildren}>
              <RefreshCw size={11} />
            </button>
          }
        >
          <CapsuleSubagentSection
            children={data.children}
            runningIds={data.runningChildIds}
            diag={data.diag}
            busy={data.busy}
            onOpen={(childId) => openSession(childId)}
            onInterrupt={(childId) => void data.interrupt(childId)}
          />
        </CapsuleSection>
      )}
      {git && git.files > 0 && (
        <CapsuleSection
          title={t("Git 工具")}
          scroll="none"
          trailing={(isOpen) => (isOpen ? null : (
            <span><b className="capsule-add">+{git.additions}</b> <b className="capsule-del">−{git.deletions}</b></span>
          ))}
        >
          <CapsuleGitSection wsPath={wsPath} git={git} onRefresh={data.reloadGit} />
        </CapsuleSection>
      )}
      {scheduleRecords.length > 0 && (
        <CapsuleSection title={tt("提醒", "Reminders")}>
          {scheduleRecords.map((r) => (
            <div key={r.id} className="capsule-row">
              <span className="state-dot running" aria-hidden="true" />
              <span className="capsule-row-text">{r.prompt}</span>
              <span className="capsule-row-meta">{fmtScheduleWhen(r)}</span>
            </div>
          ))}
        </CapsuleSection>
      )}
      {/* 后台任务独立成区：它是"活动区"，与 ZCode 的 terminals 区同位——受控开合、
          计数归零自动收起；提醒是静态区，不参与那套状态机。 */}
      {data.jobs.length > 0 && (
        <CapsuleSection title={t("后台任务")} open={jobsOpen} onOpenChange={setJobsOpen}>
          {jobSplit.live.map((j) => <JobRow key={j.id} job={j} now={data.now} />)}
          {jobSplit.ended.length > 0 && (
            <>
              <button type="button" className="capsule-sec-toggle" onClick={() => setShowEndedJobs((v) => !v)}>
                <ChevronDown size={12} style={showEndedJobs ? undefined : { transform: "rotate(-90deg)" }} />
                {tt("已结束 {n} 项", "Ended {n}", { n: jobSplit.ended.length })}
              </button>
              {showEndedJobs && jobSplit.ended.map((j) => <JobRow key={j.id} job={j} now={data.now} />)}
            </>
          )}
        </CapsuleSection>
      )}
      {artifacts.length === 0 && !goal && todo.total === 0 && data.children.length === 0
        && (git === null || git.files === 0) && scheduleRecords.length === 0 && data.jobs.length === 0 && (
        <div className="panel-empty">{t("这个会话还没有可展示的状态")}</div>
      )}
    </>
  );
}
