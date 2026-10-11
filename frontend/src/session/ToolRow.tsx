// 工具行家族（R-007 从 SessionView 搬出）：ToolRow/TerminalBlock/TodoList/
// ProducedFiles 与命令卡、工作流卡——tool-call 及其衍生 kind 的呈现。

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { t, tt } from "../i18n";
import { openPath } from "../host";
import { useStore } from "../store";
import { DiffBlock } from "../components/DiffBlock";
import { AttachmentThumb } from "../components/AttachmentImage";
import { IconCheckOutline16, IconChecklistOutline14, IconCopyOutline16 } from "../components/Icons";
import { askSummary, basename, bashSummary, browserSummary, commandOf, prettyArgs, relativizePath, summarizeArgs } from "./format";
import { derivePath, parseTodos, type WorkflowMember } from "./renderModel";
import { isBrowserTool, toolDisplayName } from "./toolKind";
import { presetLabel } from "../settings/permissionPreset";
import { fileUrlOf } from "../components/preview/previewModel";
import { mergeArtifacts } from "../sidebar-right/sessionArtifacts";
import { StateDot } from "./MessageRow";
import { ToolIcon } from "./ToolIcon";
import { FileIcon } from "./FileIcon";
/// One-line tool row — DSH ToolRow port: icon + summary + chevron（用户定稿
/// 2026-10-11：类别名与分隔点不摆——图标即类别；摘要为空才落回名字/状态文案），
/// expandable to reveal terminal output or raw arguments.
export function ToolRow({ toolName, args, output, failed, diffs, resultImages, sessionId, cwd }: {
  toolName: string;
  args: string;
  output?: string;
  failed?: boolean;
  diffs?: import("../types").FileDiff[];
  /** read_image 等结果图片（attachment 引用，直出缩略图）。 */
  resultImages?: import("./renderModel").ResultImage[];
  sessionId: string;
  /** 会话工作目录：行内摘要的绝对路径按它相对化为项目内路径（用户定稿）。 */
  cwd?: string;
}) {
  const [open, setOpen] = useState(false);
  const todo = parseTodos(args);
  const isTodo = toolName === "todo_write" || toolName === "todos" || todo !== null;
  const isAsk = toolName === "ask_user_question" || toolName === "ask_user";
  // 终端族（bash/pwsh）共用命令摘要与终端展开体；摘要走 bashSummary
  // （引擎 bash/pwsh 的必填 description 优先）
  const isShell = toolName === "bash" || toolName === "terminal-bash" || toolName === "pwsh";
  const summary = (() => {
    const raw = isAsk ? askSummary(args) : todo !== null ? tt("{done}/{total} 已完成 · {active} 进行中 · {pending} 待处理", "{done}/{total} done · {active} in progress · {pending} pending", { done: todo.done, total: todo.total, active: todo.active, pending: todo.pending }) : isShell ? bashSummary(args) : isBrowserTool(toolName) ? browserSummary(args) : summarizeArgs(args);
    return relativizePath(raw, cwd);
  })();
  const filePath = derivePath(toolName, args);
  const state = failed ? "error" : output !== undefined ? "done" : "running";
  const title = isTodo ? t("任务") : isAsk && state === "running" ? t("等待回答") : state === "running" ? t("正在执行") : toolDisplayName(toolName, t);
  const expandable = (output !== undefined && output !== "") || args !== "" || isTodo || (!!diffs && diffs.length > 0);
  return (
    <div className={`tool-row${state === "error" ? " bad" : ""}`} data-state={state} data-tool={toolName}>
      <button
        className="tool-row-main"
        onClick={() => (expandable ? setOpen((v) => !v) : undefined)}
        aria-expanded={expandable ? open : undefined}
      >
        <span className="tool-leading">
          {state === "error" ? <StateDot state="error" /> : isTodo ? <IconChecklistOutline14 /> : <ToolIcon name={toolName} />}
        </span>
        {summary ? (
          <>
            {filePath && <FileIcon file={filePath} />}
            <span className="tool-summary">{summary}</span>
          </>
        ) : (
          <span className="tool-title">{title}</span>
        )}
        {/* 箭头槽**常驻**：这一行没什么可展时只藏起来（visibility，仍占位）。缺了它的
            后果是行右端那条箭头竖线在这里断掉——同一列里几行没有箭头，用户看到的
            就是"没有对齐"（2026-10-08）。 */}
        <span
          className="tool-chevron"
          data-open={open ? "true" : "false"}
          data-empty={expandable ? undefined : ""}
          aria-hidden={expandable ? undefined : true}
        >
          <ChevronDown size={14} />
        </span>
      </button>
      {/* read_image 直出（0.1.5）：结果图片在折叠态即展示，点击 Lightbox 放大 */}
      {!!resultImages && resultImages.length > 0 && (
        <div className="tool-result-images">
          {resultImages.map((img) => (
            <AttachmentThumb key={img.attachmentId} sessionId={sessionId} att={img} />
          ))}
        </div>
      )}
      {expandable && (
        <div className="tool-collapse" data-open={open ? "true" : "false"}>
          <div className="tool-body">
            {isTodo && todo !== null ? (
              <TodoList todos={todo.items} />
            ) : isShell ? (
              <TerminalBlock command={commandOf(args)} output={output ?? ""} failed={failed} />
            ) : (
              <>
                {diffs && diffs.length > 0 && <DiffBlock diffs={diffs} />}
                {args && <div className="tool-io-label">{t("输入")}</div>}
                {args && <pre className="tool-io-text">{prettyArgs(args)}</pre>}
                {output !== undefined && output !== "" && (
                  <>
                    <div className="tool-io-label">{t("输出")}</div>
                    <pre className="tool-io-text">{output}</pre>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


/** 命令卡的正式说法（用户定稿）：引擎内部命令不摆 `/名 引擎内名` 原样——
    已知的那几条翻成人话，未知命令照旧 `/name args`（用户自己敲的命令语言）。 */
function commandSpoken(name: string, args: string): { title: string; args: string } {
  if (name === "permission") {
    return { title: t("会话权限"), args: presetLabel(args.trim(), t) };
  }
  return { title: `/${name}`, args };
}

/** 命令卡：`/name args` 单行 + 状态点 + 结果文本（success 提示/error 展开）。
 *  对照官方 ui-conversation command 节点：命令是 log-only 的静默行，不抢消息流的戏。 */
export function CommandCard({ name, args, status, text }: {
  name: string;
  args: string;
  status: "running" | "success" | "error";
  text?: string;
}) {
  const [open, setOpen] = useState(false);
  const hasBody = !!text;
  const spoken = commandSpoken(name, args);
  return (
    <div className="command-card" data-status={status}>
      <button
        type="button"
        className="command-main"
        onClick={() => (hasBody ? setOpen((v) => !v) : undefined)}
        aria-expanded={open}
      >
        <span className="command-leading">
          {status === "running" ? <StateDot state="running" /> : status === "error" ? <StateDot state="error" /> : <IconCheckOutline16 size={13} />}
        </span>
        <span className="command-name">{spoken.title}</span>
        {spoken.args && <span className="command-args">{spoken.args}</span>}
        {status === "success" && !text && <span className="command-hint">{t("已完成")}</span>}
      </button>
      {hasBody && open && <div className="command-body">{text}</div>}
    </div>
  );
}


/** 工作流运行卡（5.4）：tool-workflow/* 事件驱动的嵌套成员卡。
 *  成员行=状态点+标签（+阶段），点击切入成员子会话；run-end 后定格终止原因。 */
export function WorkflowCard({ name, members, status, stopReason }: {
  name: string;
  members: WorkflowMember[];
  status?: "running" | "success" | "error";
  stopReason?: string;
}) {
  const { openSession } = useStore();
  const [open, setOpen] = useState(true);
  const done = members.filter((m) => m.outcome).length;
  const failed = members.filter((m) => m.outcome === "failed").length;
  return (
    <div className="workflow-card" data-status={status ?? "running"}>
      <button type="button" className="workflow-main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="workflow-leading">
          {status === "success" ? <IconCheckOutline16 size={13} /> : status === "error" ? <StateDot state="error" /> : <StateDot state="running" />}
        </span>
        <span className="workflow-name">{name}</span>
        <span className="workflow-count">
          {tt("{done}/{total} 成员", "{done}/{total} members", { done, total: members.length })}
          {failed > 0 ? ` · ${tt("{n} 失败", "{n} failed", { n: failed })}` : ""}
        </span>
        {status === "error" && stopReason && <span className="workflow-reason">{stopReason}</span>}
        <ChevronDown size={13} className="injection-chev" data-open={open ? "true" : "false"} />
      </button>
      {open && (
        <div className="workflow-members">
          {members.map((m) => (
            <button
              key={m.seq}
              type="button"
              className="workflow-member"
              onClick={() => (m.childId ? openSession(m.childId) : undefined)}
              disabled={!m.childId}
            >
              <span className={`state-dot ${m.outcome === "failed" || m.outcome === "cancelled" ? "error" : m.outcome === "completed" ? "ok" : "running"}`} aria-hidden="true" />
              <span className="workflow-member-label">{m.label}</span>
              {m.phase && <span className="workflow-phase">{m.phase}</span>}
              <span className="workflow-outcome">{m.outcome ? tt(...(MEMBER_OUTCOME[m.outcome] ?? ["", ""])) : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}



/** 工作流成员结果文案。 */
const MEMBER_OUTCOME: Record<string, [string, string]> = {
  completed: ["完成", "done"],
  failed: ["失败", "failed"],
  cancelled: ["已取消", "cancelled"],
};


/// Task list panel inside the todo row — DSH todo body list.
function TodoList({ todos }: { todos: Array<{ content: string; status: string }> }) {  return (
    <div className="todo-list">
      {todos.map((t, i) => (
        <div key={i} className={`todo-item ${t.status}`}>
          <span className="todo-bullet" aria-hidden="true">
            {t.status === "completed" ? <IconCheckOutline16 size={12} /> : <span className="todo-dot" />}
          </span>
          <span className="todo-content">{t.content}</span>
          <span className="todo-status">{t.status === "completed" ? tt("已完成", "Done") : t.status === "in_progress" ? tt("进行中", "In progress") : tt("待处理", "Pending")}</span>
        </div>
      ))}
    </div>
  );
}



/// Terminal port of DSH TerminalBlock (bash execution state).
function TerminalBlock({ command, output, failed }: { command: string; output: string; failed?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const MAX_LINES = 16;
  const lines = useMemo(() => output.split("\n"), [output]);
  const hidden = lines.length - MAX_LINES;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch { /* clipboard may be unavailable */ }
  };
  return (
    <div className="terminal-block" data-terminal="">
      <div className="terminal-header">
        <code className="terminal-command">$ {command}</code>
        <span className={`terminal-status${failed ? " error" : ""}`}>
          {failed ? t("退出码 非 0") : output && lines.length > MAX_LINES ? tt("{n} 行", "{n} lines", { n: hidden }) : ""}
        </span>
        <button type="button" className="terminal-copy" onClick={() => void copy()}>
          {copied ? <IconCheckOutline16 size={13} /> : <IconCopyOutline16 size={13} />}
          {copied ? t("复制成功") : t("复制")}
        </button>
      </div>
      {output !== "" && (
        <pre className="terminal-output">
          {(hidden > 0 && !expanded ? lines.slice(0, MAX_LINES) : lines).map((l, i) => (
            <span key={i} className="terminal-line">{l}{"\n"}</span>
          ))}
        </pre>
      )}
      {hidden > 0 && (
        <button className="terminal-expand" onClick={() => setExpanded((v) => !v)}>
          {expanded ? t("收起") : tt("… 其余 {n} 行", "… {n} more lines", { n: hidden })}
        </button>
      )}
    </div>
  );
}


/// 产物/交付合并行（用户定稿：单一「产物」行、单行不换）：present 交付与
/// 工具产物按绝对路径去重后合成一条 chip 行，超出容量的以 +n 收尾；交付
/// 描述降为 chip tooltip，交付图片仍出缩略图。原 ProducedFiles/PresentedFiles
/// 两行由此替代。
/// chip 上限照官方 ProducedFiles 的 SHOWN_LIMIT=6：那一行 nowrap + 裁剪，
/// 给多了后面的 chip 会被切掉看不全，"还有几个"也失去意义。
const ARTIFACT_CHIP_LIMIT = 6;

export function ArtifactsRow({ produced, presented, root, onPreview }: {
  produced: string[];
  presented: import("../types").PresentedFile[];
  /** 相对路径的解析根（引擎口径：会话工作目录，缺省退回工作区路径由调用方并好）。 */
  root?: string;
  onPreview?: (path: string) => void;
}) {
  const open = (path: string) => (onPreview ? onPreview(path) : openPath(path));
  const items = mergeArtifacts(produced, presented, root);
  if (items.length === 0) return null;
  const shown = items.slice(0, ARTIFACT_CHIP_LIMIT);
  const hidden = items.length - shown.length;
  return (
    <div className="produced">
      <span className="produced-label">{t("产物")}</span>
      <div className="produced-row">
        {shown.map((it) => (
          <button
            key={it.key}
            type="button"
            className={it.image ? "delivered-card delivered-image" : "produced-file"}
            title={it.desc ?? it.path}
            data-file-ctx={it.path}
            onClick={() => open(it.path)}
          >
            {it.image ? (
              <img className="delivered-thumb" src={fileUrlOf(it.path)} alt={it.desc ?? basename(it.path)} loading="lazy" />
            ) : (
              basename(it.path)
            )}
          </button>
        ))}
        {hidden > 0 && <span className="produced-more">{tt("+ {n} 个文件", "+{n} files", { n: hidden })}</span>}
      </div>
    </div>
  );
}


