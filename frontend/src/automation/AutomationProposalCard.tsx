// 消息流里的「定时任务建议」卡：模型按协议（automation/protocol.ts）输出围栏块时，
// Markdown 解析成功后渲染它。点「创建定时任务」派发应用内事件，由 App 打开
// 设置→自动化并把这份建议填进新建表单——落库与否由用户在表单里决定。

import { CalendarClock } from "lucide-react";
import { dispatchAppEvent, DD_EVENTS } from "../events";
import { useT } from "../i18n";
import { describeSchedule } from "./model";
import type { AutomationProposal } from "./protocol";

export function AutomationProposalCard({ proposal }: { proposal: AutomationProposal }) {
  const { t } = useT();
  const sched = describeSchedule(proposal.schedule);
  return (
    <div className="auto-proposal">
      <div className="head">
        <CalendarClock size={14} />
        {t("定时任务建议")}
      </div>
      <div className="auto-proposal-main">
        <div className="auto-proposal-title">{proposal.title}</div>
        <div className="auto-proposal-meta">
          {sched.prefix}
          {sched.time ? `, ${sched.time}` : ""}
          {proposal.workspace !== null ? ` · ${proposal.workspace}` : ""}
        </div>
        <div className="auto-proposal-desc">{proposal.instruction}</div>
      </div>
      <div className="actions">
        <button
          className="btn-primary"
          onClick={() => dispatchAppEvent(DD_EVENTS.automationDraft, proposal)}
        >
          {t("创建定时任务")}
        </button>
      </div>
    </div>
  );
}
