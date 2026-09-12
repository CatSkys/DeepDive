// 单条渲染项的分流组件（R-007 从 SessionView 搬出）：RenderItem.kind →
// 用户气泡/agent 文本/流式思考/工具行/turn-tail/命令/工作流/压缩卡。
// 不管摄取与分组（renderModel/turnGroups 的下游）。

import { t } from "../i18n";
import { ThinkingState } from "../components/ThinkingState";
import { UserAttachments } from "../components/AttachmentImage";
import { blocksOf, textOf } from "./eventText";
import type { RenderItem } from "./renderModel";
import { UserBubble, AgentMessage, MessageMeta, CompactionCard, StateDot } from "./MessageRow";
import { ToolRow, CommandCard, WorkflowCard, ProducedFiles } from "./ToolRow";
export function Item({ item, turnRunning, onBranch, onContinue, sessionId, hideThinking, onPreviewFile, wsPath }: {
  onPreviewFile?: (path: string, line?: number) => void;
  /** 工作区根（相对产物路径 → 绝对解析用）。 */
  wsPath?: string;
  item: RenderItem;
  turnRunning: boolean;
  onBranch?: (forkSeq: number) => void;
  onContinue?: () => void;
  sessionId: string;
  /** 过程折叠收起时：最终回答的内嵌思考一并隐藏（官方 inlineReasoning 口径）。 */
  hideThinking?: boolean;
}) {
  if (item.kind === "user") {
    return (
      <div className="msg-block user">
        <UserBubble text={textOf(item.event)} />
        <UserAttachments sessionId={sessionId} event={item.event} />
        {/* DSH user chrome: copy + clock only, NO branch, clock="start" */}
        <MessageMeta
          time={item.time}
          clockSide="start"
          copiedText={textOf(item.event)}
        />
      </div>
    );
  }
  if (item.kind === "assistant") {
    const t = textOf(item.event);
    if (!t) return null;
    const blocks = blocksOf(item.event);
    return (
      <div className="msg-block assistant">
        {blocks.think && !hideThinking && <ThinkingState reasoning={blocks.think} running={false} />}
        <AgentMessage text={t} onOpenFile={onPreviewFile} />
      </div>
    );
  }
  if (item.kind === "reasoning") {
    // Live reasoning-delta accumulation; exists only mid-turn until the final
    // assistant message replaces it with the settled trace.
    const text = item.output ?? "";
    if (!text) return null;
    return <ThinkingState reasoning={text} running={turnRunning} />;
  }
  if (item.kind === "turn-tail") {
    // DSH turn-tail chrome: produced files + copy / branch / clock("end"),
    // in its own node so tool-only / interrupted turns keep them.
    const time = item.time;
    const copiedText = item.event ? textOf(item.event) : "";
    const reason = item.endReason;
    // TurnEndReason 各成员均有 kind，直取即可（reason 本身可缺省）
    const reasonKind = reason?.kind;
    const errMsg = reasonKind === "error" ? (reason as { error?: { message?: string; code?: string } }).error?.message : undefined;
    const errCode = reasonKind === "error" ? (reason as { error?: { code?: string } }).error?.code : undefined;
    return (
      <div className="turn-tail">
        {reasonKind === "max-tokens" && (
          <div className="turn-issue">
            <span>{t("本轮达到 max tokens 上限，输出被截断")}</span>
            <button className="turn-issue-btn" onClick={onContinue}>{t("继续")}</button>
          </div>
        )}
        {reasonKind === "error" && (
          <div className="turn-issue" data-code={errCode ?? ""}>
            <span>
              {t("本轮失败")}
              {errMsg ? `：${errMsg}` : ""}
              {errCode === "MISSING_CREDENTIAL" ? `（${t("请在设置中配置 API Key 后重试")}）` : ""}
            </span>
          </div>
        )}
        <ProducedFiles paths={item.produced ?? []} onPreview={onPreviewFile} wsPath={wsPath} />
        <MessageMeta
          time={time}
          clockSide="end"
          copiedText={copiedText}
          branch
          onBranch={item.forkSeq !== undefined ? () => onBranch?.(item.forkSeq!) : undefined}
        />
      </div>
    );
  }
  if (item.kind === "compaction") {
    return <CompactionCard summary={item.output ?? ""} shadowedTokens={item.args} />;
  }
  if (item.kind === "retry") {
    return <div className="retry-row"><StateDot state="warning" />{t("模型请求重试")}<span className="retry-detail">{item.output}</span></div>;
  }
  if (item.kind === "tool-call") {
    return (
      <ToolRow
        toolName={item.toolName ?? "tool"}
        args={item.args ?? ""}
        output={item.output}
        failed={item.failed}
        diffs={item.diffs}
        resultImages={item.resultImages}
        sessionId={sessionId}
      />
    );
  }
  if (item.kind === "command") {
    return <CommandCard name={item.toolName ?? "cmd"} args={item.args ?? ""} status={item.commandStatus ?? "running"} text={item.commandText} />;
  }
  if (item.kind === "workflow") {
    return <WorkflowCard name={item.args ?? t("工作流")} members={item.members ?? []} status={item.commandStatus} stopReason={item.commandText} />;
  }
  if (item.kind === "chunk" && item.output) {
    return <div className="msg assistant"><div className="text">{item.output}</div></div>;
  }
  return null;
}


