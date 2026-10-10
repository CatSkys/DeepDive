// 单条渲染项的分流组件（R-007 从 SessionView 搬出）：RenderItem.kind →
// 用户气泡/agent 文本/流式思考/工具行/turn-tail/命令/工作流/压缩卡。
// 不管摄取与分组（renderModel/turnGroups 的下游）。

import { memo } from "react";
import { t } from "../i18n";
import { ThinkingState } from "../components/ThinkingState";
import { UserAttachments, messageContentOf } from "../components/AttachmentImage";
import { blocksOf, textOf } from "./eventText";
import type { RenderItem } from "./renderModel";
import { UserBubble, AgentMessage, StreamingAgentMessage, MessageMeta, CompactionCard, StateDot } from "./MessageRow";
import { ToolRow, CommandCard, WorkflowCard, ArtifactsRow } from "./ToolRow";

export interface ItemProps {
  onPreviewFile?: (path: string, line?: number) => void;
  /** 工作区根（相对产物路径 → 绝对解析用）。 */
  wsPath?: string;
  /** 会话工作目录：present 交付文件的相对路径按它解析（引擎口径，与工作区路径
   *  可能不同）；老会话摘要缺 cwd 时退回工作区路径。 */
  cwd?: string;
  item: RenderItem;
  /** 本项是否仍在流式写入（会话在跑 且 本项是列表最后一项）。思考块据此自动
   *  展开/收起——只按会话级 running 判，早已结束的思考会一直摊着不折叠。 */
  running: boolean;
  onBranch?: (forkSeq: number) => void;
  onContinue?: () => void;
  sessionId: string;
  /** 过程折叠收起时：最终回答的内嵌思考一并隐藏（官方 inlineReasoning 口径）。 */
  hideThinking?: boolean;
}

function ItemBody({ item, running, onBranch, onContinue, sessionId, hideThinking, onPreviewFile, wsPath, cwd }: ItemProps) {
  if (item.kind === "user") {
    return (
      <div className="msg-block user">
        <UserBubble text={textOf(item.event)} />
        <UserAttachments sessionId={sessionId} content={messageContentOf(item.event)} />
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
        {blocks.think && !hideThinking && <ThinkingState reasoning={blocks.think} running={false} ms={item.thinkMs} />}
        <AgentMessage text={t} onOpenFile={onPreviewFile} />
      </div>
    );
  }
  if (item.kind === "reasoning") {
    // Live reasoning-delta accumulation; exists only mid-turn until the final
    // assistant message replaces it with the settled trace.
    // 注意 running 不是会话级：这一条思考后面一旦出现别的东西（工具行、下一段
    // 思考、答案），它就不再是直播项，自动收起成「已思考」。
    const text = item.output ?? "";
    if (!text) return null;
    return <ThinkingState reasoning={text} running={running} ms={item.thinkMs} />;
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
        <ArtifactsRow produced={item.produced ?? []} presented={item.presented ?? []} root={cwd ?? wsPath} onPreview={onPreviewFile} />
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
        cwd={cwd}
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
    // 流式正文与落定后走**同一条渲染链**（AgentMessage → Markdown）：边输出边带格式，
    // 而不是等 assistant/message 落定才排版。此前这里是纯文本 div，结果是"打字期间
    // 没有格式、落定瞬间整段重排"（用户报障）；同一组件也让两段之间不跳版式。
    // 揭示节奏与块级对焦动画见 StreamingAgentMessage / useFocusStream。
    return (
      <StreamingAgentMessage output={item.output} running={running} onOpenFile={onPreviewFile} />
    );
  }
  return null;
}

/** 流式期间每条 delta 都会重渲整份会话流，未变的行整棵跳过是体感收益大头。
 *  比较器两条裁定（就地修改的语义见 renderModel 的 `v` 戳）：
 *  · item 是**不同的对象** → 重渲（回灌重建/新增项）；
 *  · item 是**同一对象** → 对象字段可能已被就地写脏（chunk 增量、tool/result
 *    落定…），按版本戳分辨。其余原语 prop 参与比较；
 *  onBranch/onPreviewFile/onContinue 不进比较：三个回调的契约就是引用稳定
 *  （useSessionActions 头注），其依赖（sessionId/wsPath）已逐项入表。 */
function areItemPropsEqual(prev: ItemProps, next: ItemProps): boolean {
  if (prev.item !== next.item) return false;
  if ((prev.item.v ?? 0) !== (next.item.v ?? 0)) return false;
  return prev.running === next.running
    && prev.hideThinking === next.hideThinking
    && prev.sessionId === next.sessionId
    && prev.wsPath === next.wsPath
    && prev.cwd === next.cwd;
}

export const Item = memo(ItemBody, areItemPropsEqual);
