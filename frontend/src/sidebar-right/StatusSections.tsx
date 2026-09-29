// 面板「会话」页的分区：目标 / 任务与计划 / 产物 / 子智能体 / Git 工具 / 提醒 / 后台任务。
// 前六区原样来自状态胶囊（组件未改，只换了宿主），产物区是面板新增的一区——它把消息流里
// 逐轮的产物收成一份会话级清单（派生在 sessionArtifacts）。

import { useEffect, useState } from "react";
import { CalendarClock, ChevronDown, RefreshCw, Share2, SquareTerminal } from "lucide-react";
import { t, tt } from "../i18n";
import { useStore } from "../store";
import { basename } from "../session/format";
import { formatElapsed } from "../session/format";
import { FileIcon } from "../session/FileIcon";
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

/** 产物区收起时摆几条（参考图是 3 条 + 「查看全部」；超过就把余下的折进去）。 */
const ARTIFACT_PREVIEW = 3;

/** 活动区收起态的时长摘要（照 ZCode 的 collapsed trailing）：取**最长运行**的那条，
 *  与计数拼成「19小时16分30秒 · 1 后台」；一条都没有就只给计数。 */
function longestLiveLabel(live: JobView[], now: number): string {
  const count = tt("{n} 个后台运行", "{n} running in background", { n: live.length });
  const longest = live.reduce((max, j) => Math.max(max, now - j.startedAt), 0);
  if (longest <= 0) return count;
  return `${formatElapsed(longest)} · ${count}`;
}

/** 后台任务一行（照 ZCode RunningStatusItem）：前导终端图标 + 两行标题 + 一行
 *  时长与状态——不是"状态点 + 名称 + 右边一串元信息"。已结束的用 finishedAt 定格。 */
function JobRow({ job, now }: { job: JobView; now: number }) {
  return (
    <div className="capsule-row">
      <SquareTerminal size={16} className="capsule-row-icon" aria-hidden="true" />
      <div className="capsule-row-main">
        <span className="capsule-row-text">{job.label}</span>
        <span className="capsule-row-sub">
          <span className="tabular">{formatElapsed((job.finishedAt ?? now) - job.startedAt)}</span>
          <span>{job.kind} · {tt(...(JOB_STATUS[job.status] ?? JOB_STATUS.running!))}{job.detail ? ` · ${job.detail}` : ""}</span>
        </span>
      </div>
    </div>
  );
}

/** 产物一行：前导文件图标 + 单行文件名（参考图口径）。描述不进行内——一行放不下
 *  两件事，完整描述与路径都走原生 tooltip。图片仍给缩略图（它是内容，不是装饰）。 */
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
        : <FileIcon file={item.path} size={15} />}
      <span className="panel-artifact-name">{basename(item.path)}</span>
    </button>
  );
}

/** 会话状态分区组（面板正文）。 */
export function StatusSections({ sessionId, data, scheduleRecords, artifacts, onPreview, onOpenReview }: {
  sessionId: string;
  data: CapsuleData;
  scheduleRecords: ScheduleRecord[];
  artifacts: ArtifactItem[];
  onPreview?: (path: string) => void;
  onOpenReview?: () => void;
}) {
  const [showEndedJobs, setShowEndedJobs] = useState(false);
  // 产物清单的展开态：收起时只给前几条 + 「查看全部」（参考图口径）。
  // 默认跟会话走——切会话回关，和活动区那套状态机同一纪律。
  const [artifactsExpanded, setArtifactsExpanded] = useState(false);
  const { openSession, refresh } = useStore();
  // 活动区的开合由本组件持有（ZCode 放在 SessionPane：那边 model 在宿主手里；
  // 本仓这些数据是自己取的，所以标记跟着数据走）
  const [agentOpen, setAgentOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);

  // 活动区开合的状态机（照 ZCode：切会话回关、在跑数归零自动收起）
  useEffect(() => { setAgentOpen(false); setJobsOpen(false); setArtifactsExpanded(false); }, [sessionId]);
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
  // 收起态只摆前几条：产物可以有几十上百条，占满面板不如给一行「查看全部」
  // （参考图口径；点击就地展开，不跳转）。
  const shownArtifacts = artifactsExpanded ? artifacts : artifacts.slice(0, ARTIFACT_PREVIEW);
  return (
    <>
      {artifacts.length > 0 && (
        <CapsuleSection title={t("产物")} trailing={String(artifacts.length)} scroll="normal">
          {shownArtifacts.map((it) => <ArtifactRow key={it.key} item={it} onPreview={onPreview} />)}
          {!artifactsExpanded && artifacts.length > ARTIFACT_PREVIEW && (
            <button type="button" className="panel-artifact-more" onClick={() => setArtifactsExpanded(true)}>
              <Share2 size={15} />
              <span>{t("查看全部")}</span>
            </button>
          )}
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
          /* 区标题走 tt 内联（Subagents 复数），词典里的「子智能体」是工具行标题
             （Subagent 单数）——一词两面，不在词典里挤同一个键 */
          title={tt("子智能体", "Subagents")}
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
          <CapsuleGitSection wsPath={wsPath} git={git} onRefresh={data.reloadGit} onOpenReview={onOpenReview} />
        </CapsuleSection>
      )}
      {scheduleRecords.length > 0 && (
        <CapsuleSection title={tt("提醒", "Reminders")}>
          {scheduleRecords.map((r) => (
            <div key={r.id} className="capsule-row">
              <CalendarClock size={16} className="capsule-row-icon" aria-hidden="true" />
              <span className="capsule-row-text">{r.prompt}</span>
              <span className="capsule-row-meta">{fmtScheduleWhen(r)}</span>
            </div>
          ))}
        </CapsuleSection>
      )}
      {/* 后台任务独立成区：它是"活动区"，与 ZCode 的 terminals 区同位——受控开合、
          计数归零自动收起；提醒是静态区，不参与那套状态机。
          收起态的 trailing 照 ZCode：**最长运行时长 · N 个后台运行**（不是只给个数字），
          展开后换成 ZCode 的「N 个后台运行」。 */}
      {data.jobs.length > 0 && (
        <CapsuleSection
          title={t("后台任务")}
          open={jobsOpen}
          onOpenChange={setJobsOpen}
          trailing={(isOpen) => (isOpen
            ? <span>{tt("{n} 个后台运行", "{n} running in background", { n: jobSplit.live.length })}</span>
            : <span>{longestLiveLabel(jobSplit.live, data.now)}</span>)}
        >
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
