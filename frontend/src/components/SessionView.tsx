import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ChevronDown, ChevronUp, Hammer, ShieldCheck, X } from "lucide-react";
import { ModelMenu, type ModelOption } from "./ModelMenu";
import { api } from "../api";
import { useStore } from "../store";
import { Composer } from "./Composer";
import { Markdown } from "./Markdown";
import {
  IconApiOutline14,
  IconBrowseOutline16,
  IconBranchOutline16,
  IconCheckOutline16,
  IconChecklistOutline14,
  IconCodeOutline16,
  IconCopyOutline16,
  IconEditOutline16,
  IconQuestionOutline14,
  IconSearchOutline16,
  IconThinkOutline16,
} from "./Icons";
import type { HistoryEntry, SessionEvent } from "../types";

interface RenderItem {
  key: string;
  kind: "user" | "assistant" | "tool-call" | "approval" | "think" | "chunk";
  event?: SessionEvent;
  toolName?: string;
  toolCallId?: string;
  args?: string;
  output?: string;
  failed?: boolean;
  pendingApproval?: boolean;
  reasoning?: string;
  time?: number;
  turn?: number;
  // attached turn-level stats for the closing assistant message meta row
  meta?: TurnMeta;
  // turn-local produced file paths (attached during finalizeTurns)
  produced?: string[];
}

interface TurnMeta {
  runMs: number;
  ttftMs: number | null;
  tokensPerSecond: number | null;
}

export function SessionView({ sessionId }: { sessionId: string }) {
  const { approvals, subscribeMux, sessions } = useStore();
  const [items, setItems] = useState<RenderItem[]>([]);
  const [streaming, setStreaming] = useState("");
  const [running, setRunning] = useState(false);
  const [runningSince, setRunningSince] = useState<number | undefined>(undefined);
  const [plan, setPlan] = useState<{ active: boolean; pending: boolean } | undefined>(undefined);
  const [modelName, setModelName] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [showModels, setShowModels] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const summary = sessions.find((s) => s.sessionId === sessionId);
  const title = summary
    ? (summary.projections?.values?.title as string) || (summary.blank ? "新会话" : "会话")
    : "会话";

  // Turn-level aggregations and produced-file lanes, keyed by seq scope.
  // History replay + live mux share one pass, so the derivations are identical.
  const turnTiming = useRef(new Map<number, { start?: number; end?: number; firstToken?: number }>());
  const callOutputs = useRef(new Map<string, { output: string; failed: boolean }>());
  const produced = useRef(new Map<number, string[]>());

  useEffect(() => {
    api
      .sessionModels({ sessionId })
      .then((r) => setModelName(r.current?.model ?? ""))
      .catch(() => void 0);
    api
      .llmModels()
      .then((r: any) => {
        const flat: ModelOption[] = [];
        for (const g of r?.groups ?? []) for (const m of g?.models ?? []) {
          flat.push({ provider: g.id, model: m.id, label: m.name ?? m.id, providerLabel: g.name ?? g.id });
        }
        setModels(flat);
      })
      .catch(() => void 0);
  }, [sessionId]);

  const pickModel = async (m: ModelOption) => {
    setShowModels(false);
    setModelName(m.label);
    try {
      await api.selectModel({ sessionId, provider: m.provider, model: m.model });
    } catch { /* engine may be busy */ }
  };

  useEffect(() => {
    let alive = true;
    let seqFloor = -1;
    turnTiming.current = new Map();
    callOutputs.current = new Map();
    produced.current = new Map();
    setItems([]);
    setStreaming("");

    api
      .history({ sessionId })
      .then(({ events }) => {
        if (!alive) return;
        const rendered: RenderItem[] = [];
        for (const entry of events) {
          ingest(rendered, entry, turnTiming.current, callOutputs.current, produced.current);
        }
        finalizeTurns(rendered, turnTiming.current, callOutputs.current, produced.current);
        setItems(rendered);
        const last = events[events.length - 1];
        if (last) seqFloor = last.event.seq + 1;
      })
      .catch(() => void 0);

    // plan projection: DSH PlanChip visibility (active, or pending when folded)
    const tickPlan = () => {
      api.sessions().then((r) => {
        const s = (r.items ?? []).find((x) => x.sessionId === sessionId);
        const planVal = (s?.projections as any)?.values?.plan as { active?: boolean; pending?: boolean } | undefined;
        if (planVal) {
          setPlan({ active: !!planVal.active, pending: !!planVal.pending });
        }
      }).catch(() => void 0);
    };
    tickPlan();
    const planIv = setInterval(tickPlan, 3000);

    const off = subscribeMux((frame: any) => {
      if (frame.type !== "session/event" || frame.sessionId !== sessionId) return;
      const seq = frame.event?.seq ?? -1;
      if (seq >= 0 && seq < seqFloor) return;
      setItems((prev) => {
        const next = prev.slice();
        const before = next.length;
        ingest(next, { event: frame.event }, turnTiming.current, callOutputs.current, produced.current);
        const added = next.length > before;
        if (frame.event?.type === "turn/end" || frame.event?.type === "assistant/message") {
          finalizeTurns(next, turnTiming.current, callOutputs.current, produced.current);
        }
        return added || frame.event?.type === "turn/end" || frame.event?.type === "assistant/message" ? next : prev;
      });
      if (frame.event?.type === "turn/end" || frame.event?.type === "assistant/message") {
        setStreaming("");
      }
      // running state: turn/start → turn/end window (DSH TurnStatus)
      if (frame.event?.type === "turn/start") {
        setRunning(true);
        setRunningSince(frame.event.time as number);
      } else if (frame.event?.type === "turn/end") {
        setRunning(false);
        setRunningSince(undefined);
      }
      if (seq >= 0) seqFloor = seq + 1;
    });

    return () => {
      alive = false;
      clearInterval(planIv);
      off?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items, streaming, follow]);

  const pending = [...approvals.values()].filter((a) => a.sessionId === sessionId);

  const isBlank = !!summary?.blank;

  if (isBlank) {
    return (
      <>
        <div className="session-header">
          <div className="left">
            <div className="title">{title}</div>
            <button className="model" title="更换模型" onClick={() => setShowModels((v) => !v)}>
              {modelName || "Auto"}
            </button>
            {showModels && (
              <ModelMenu
                options={models}
                current={modelName}
                onPick={(m) => void pickModel(m)}
                onClose={() => setShowModels(false)}
              />
            )}
          </div>
        </div>
        <div className="hero">
          <div className="hero-title">做点什么？</div>
          <div className="hero-sub">用 DeepSeek 智能体开始任何工作。</div>
          <div className="hero-composer">
            <Composer sessionId={sessionId} />
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="session">
      <div className="session-header">
        <div className="left">
          <div className="title">{title}</div>
          <button className="model" title="更换模型" onClick={() => setShowModels((v) => !v)}>
            {modelName || "Auto"}
          </button>
          {showModels && (
            <ModelMenu
              options={models}
              current={modelName}
              onPick={(m) => void pickModel(m)}
              onClose={() => setShowModels(false)}
            />
          )}
        </div>
        {plan?.active && !plan?.pending && (
          <span className="plan-wrap">
            <button
              type="button"
              className="plan-chip"
              title="退出计划模式"
              aria-label="退出计划模式"
              onClick={() => {
                api.prompt({
                  sessionId,
                  mode: "queue",
                  content: [{ type: "text", text: "/plan off" }],
                }).catch(() => void 0);
              }}
            >
              Plan ×
            </button>
          </span>
        )}
      </div>
      <div className="flow" ref={scrollRef} onScroll={(e) => {
        const el = e.currentTarget;
        setFollow(el.scrollTop + el.clientHeight >= el.scrollHeight - 32);
      }}>
        <div className="flow-inner">
          {(() => {
            // DSH data-actions-reveal gate: latest of each kind stays visible
            // ('always'); every earlier row reveals on hover / focus-within.
            let lastUserIdx = -1;
            let lastTailIdx = -1;
            for (let i = 0; i < items.length; i++) {
              if (items[i].kind === "user") lastUserIdx = i;
              if (items[i].kind === "assistant" && items[i].meta) lastTailIdx = i;
            }
            return items.map((item, idx) => (
              <Item
                key={item.key}
                item={item}
                latestUser={idx === lastUserIdx}
                latestTurn={idx === lastTailIdx}
              />
            ));
          })()}
          {streaming && (
            <div className="msg assistant">
              <div className="text">{streaming}</div>
            </div>
          )}
          {pending.map((a) => (
            <ApprovalCard key={a.approvalId} approvalId={a.approvalId} sessionId={sessionId} toolName={a.toolName} reason={a.reason} />
          ))}
          {running && <TurnStatus startTime={runningSince} />}
        </div>
      </div>
      {!follow && (
        <button
          className="jump-down"
          title="回到最新"
          onClick={() => {
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
            setFollow(true);
          }}
        >
          <ArrowDown size={16} />
        </button>
      )}
      <div className="session-bottom">
        <Composer sessionId={sessionId} />
      </div>
    </div>
  );
}

function Item({ item, latestUser, latestTurn }: { item: RenderItem; latestUser: boolean; latestTurn: boolean }) {
  if (item.kind === "user") {
    return (
      <div className="msg-block user" data-actions-reveal={latestUser ? "always" : "hover"}>
        <UserBubble text={textOf(item.event)} />
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
    // DSH turn-tail chrome: copy + branch + clock("end") + usage stats.
    // Attaches to the closing message of the turn only.
    const meta = item.meta ? (
      <MessageMeta
        time={item.time}
        clockSide="end"
        runMs={item.meta.runMs}
        ttftMs={item.meta.ttftMs ?? undefined}
        tokensPerSecond={item.meta.tokensPerSecond ?? undefined}
        copiedText={t}
        branch
      />
    ) : null;
    return (
      <div className="msg-block assistant" data-actions-reveal={latestTurn ? "always" : "hover"}>
        {blocks.think && <ThinkRow reasoning={blocks.think} />}
        <AgentMessage text={t} />
        <ProducedFiles paths={item.produced ?? []} />
        {meta}
      </div>
    );
  }
  if (item.kind === "tool-call") {
    return (
      <ToolRow
        toolName={item.toolName ?? "tool"}
        args={item.args ?? ""}
        output={item.output}
        failed={item.failed}
        pendingApproval={item.pendingApproval}
      />
    );
  }
  if (item.kind === "think") {
    return <ThinkRow reasoning={item.reasoning ?? ""} />;
  }
  if (item.kind === "chunk" && item.output) {
    return <div className="msg assistant"><div className="text">{item.output}</div></div>;
  }
  return null;
}

/// User message: down-scaled bubble (deliberately quiet, weak layer).
function UserBubble({ text }: { text: string }) {
  return (
    <div className="user-bubble">{text}</div>
  );
}

/// Agent reply: pure text — NO bubble, NO element background (design rule).
function AgentMessage({ text }: { text: string }) {
  return (
    <div className="agent-message">
      <Markdown text={text} />
    </div>
  );
}

/// One-line tool row — DSH ToolRow port: icon + name · summary + chevron,
/// expandable to reveal terminal output or raw arguments.
function ToolRow({ toolName, args, output, failed, pendingApproval, turn, sessionId }: {
  toolName: string;
  args: string;
  output?: string;
  failed?: boolean;
  pendingApproval?: boolean;
  turn?: number;
  sessionId?: string;
}) {
  const [open, setOpen] = useState(false);
  const todo = parseTodos(args);
  const isTodo = toolName === "todo_write" || toolName === "todos" || todo !== null;
  const summary = todo !== null ? `${todo.done}/${todo.total} 已完成 · ${todo.active} 进行中 · ${todo.pending} 待处理` : summarizeArgs(toolName, args);
  const isBash = toolName === "bash" || toolName === "terminal-bash";
  const state = failed ? "error" : output !== undefined ? "done" : "running";
  const expandable = (output !== undefined && output !== "") || args !== "" || isTodo;
  return (
    <div className={`tool-row${state === "error" ? " bad" : ""}`} data-state={state} data-tool={toolName}>
      <button
        className="tool-row-main"
        onClick={() => (expandable ? setOpen((v) => !v) : undefined)}
        aria-expanded={open}
      >
        <span className="tool-leading">
          {state === "error" ? <StateDot state="error" /> : state === "running" ? <StateDot state="running" /> : isTodo ? <IconChecklistOutline14 /> : <ToolIcon name={toolName} />}
        </span>
        <span className="tool-title">{isTodo ? "任务" : state === "running" ? "正在执行" : toolName}</span>
        {summary && (
          <>
            <span className="tool-sep" aria-hidden="true" />
            <span className="tool-summary">{summary}</span>
          </>
        )}
        {pendingApproval && <ShieldCheck size={13} className="tool-shield" />}
        {expandable && (
          <span className="tool-chevron">{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
        )}
      </button>
      {open && (
        <div className="tool-body">
          {isTodo && todo !== null ? (
            <TodoList todos={todo.items} />
          ) : isBash ? (
            <TerminalBlock command={commandOf(args)} output={output ?? ""} failed={failed} />
          ) : (
            <>
              {args && <div className="tool-io-label">输入</div>}
              {args && <pre className="tool-io-text">{prettyArgs(args)}</pre>}
              {output !== undefined && output !== "" && (
                <>
                  <div className="tool-io-label">输出</div>
                  <pre className="tool-io-text">{output}</pre>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/// Task list panel inside the todo row — DSH todo body list.
function TodoList({ todos }: { todos: Array<{ content: string; status: string }> }) {
  return (
    <div className="todo-list">
      {todos.map((t, i) => (
        <div key={i} className={`todo-item ${t.status}`}>
          <span className="todo-bullet" aria-hidden="true">
            {t.status === "completed" ? <IconCheckOutline16 size={12} /> : <span className="todo-dot" />}
          </span>
          <span className="todo-content">{t.content}</span>
          <span className="todo-status">{t.status === "completed" ? "已完成" : t.status === "in_progress" ? "进行中" : "待处理"}</span>
        </div>
      ))}
    </div>
  );
}

function parseTodos(args: string): { done: number; total: number; active: number; pending: number; items: Array<{ content: string; status: string }> } | null {
  if (!args) return null;
  try {
    const p = JSON.parse(args);
    const todos = p?.todos ?? (Array.isArray(p) ? p : null);
    if (!Array.isArray(todos) || todos.length === 0) return null;
    const items = todos.map((t: any) => ({
      content: typeof t?.content === "string" ? t.content : typeof t?.todo === "string" ? t.todo : t?.description ? String(t.description) : JSON.stringify(t),
      status: typeof t?.status === "string" ? t.status : "pending",
    }));
    const done = items.filter((x) => x.status === "completed").length;
    const active = items.filter((x) => x.status === "in_progress").length;
    return { done, total: items.length, active, pending: items.length - done - active, items };
  } catch {
    return null;
  }
}

/// Terminal port of DSH TerminalBlock (bash execution state).
function TerminalBlock({ command, output, failed }: { command: string; output: string; failed?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const MAX_LINES = 16;
  const lines = useMemo(() => output.split("\n"), [output]);
  const hidden = lines.length - MAX_LINES;
  const head = lines.slice(0, MAX_LINES);
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
          {failed ? "退出码 非 0" : output && lines.length > MAX_LINES ? `${hidden} 行` : ""}
        </span>
        <button type="button" className="terminal-copy" onClick={() => void copy()}>
          {copied ? <IconCheckOutline16 size={13} /> : <IconCopyOutline16 size={13} />}
          {copied ? "复制成功" : "复制"}
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
          {expanded ? "收起" : `… 其余 ${hidden} 行`}
        </button>
      )}
    </div>
  );
}

/// Collapsible reasoning row — DSH Think summary.
function ThinkRow({ reasoning }: { reasoning: string }) {
  const [open, setOpen] = useState(false);
  const first = reasoning.split("\n")[0].trim();
  const summary = first.length > 120 ? first.slice(0, 120) + "…" : first;
  return (
    <div className="think-row">
      <button className="think-row-main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="think-leading"><IconThinkOutline16 size={16} /></span>
        <span className="think-title">Think</span>
        <span className="tool-sep" aria-hidden="true" />
        <span className="think-summary">{summary || "思考中…"}</span>
        <span className="tool-chevron">{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
      </button>
      {open && <div className="think-body">{reasoning}</div>}
    </div>
  );
}

/// Produced files lane — DSH ProducedFiles port (label + file chips).
function ProducedFiles({ paths }: { paths: string[] }) {
  if (paths.length === 0) return null;
  const shown = paths.slice(0, 6);
  const hidden = paths.length - shown.length;
  return (
    <div className="produced">
      <span className="produced-label">产物</span>
      <div className="produced-row">
        {shown.map((p) => (
          <button type="button" key={p} className="produced-file" title={p}>
            {basename(p)}
          </button>
        ))}
        {hidden > 0 && <span className="produced-more">+ {hidden} 个文件</span>}
      </div>
    </div>
  );
}

/// Message foot row — copy [+ branch] + clock · [用时 · 首 token · tok/s].
/// Mirrors DSH MessageIconActions: user chrome = copy + clock("start");
/// assistant turn tail = copy + branch + clock("end") + usage stats.
/// Quiet by default: reveals on hover (DSH actions affordance).
function MessageMeta({ time, runMs, ttftMs, tokensPerSecond, copiedText, clockSide = "end", branch = false }: {
  time?: number;
  runMs?: number;
  ttftMs?: number;
  tokensPerSecond?: number;
  copiedText: string;
  clockSide?: "start" | "end";
  branch?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copiedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch { /* ignore */ }
  };
  const hasStats = runMs !== undefined || ttftMs !== undefined || tokensPerSecond !== undefined;
  const clock = time ? formatClock(time) : undefined;
  if (!clock && !hasStats && !branch) return null;
  const clockEl = (
    <span className="meta-clock">
      {clock}
      {runMs !== undefined && (
        <>
          <span className="meta-dot" aria-hidden="true">·</span>
          用时 {formatRunDuration(runMs)}
        </>
      )}
      {ttftMs !== undefined && (
        <>
          <span className="meta-dot" aria-hidden="true">·</span>
          首 token {formatLatencySeconds(ttftMs)}
        </>
      )}
      {tokensPerSecond !== undefined && (
        <>
          <span className="meta-dot" aria-hidden="true">·</span>
          {formatTokensPerSecond(tokensPerSecond)} tok/s
        </>
      )}
    </span>
  );
  return (
    <div className="meta-actions">
      {clockSide === "start" ? clockEl : null}
      <button className="meta-action" title={copied ? "复制成功" : "复制"} aria-label={copied ? "复制成功" : "复制"} onClick={() => void copy()}>
        {copied ? <IconCheckOutline16 size={16} /> : <IconCopyOutline16 size={16} />}
      </button>
      {branch && (
        <button
          className="meta-action"
          title="分支"
          aria-label="分支"
        >
          <IconBranchOutline16 size={16} />
        </button>
      )}
      {clockSide === "end" ? clockEl : null}
    </div>
  );
}

/// Running-turn status row — DSH TurnStatus port ("Deep diving..." + clock).
function TurnStatus({ startTime }: { startTime?: number }) {
  const [mountedAt] = useState(() => Date.now());
  const anchor = startTime ?? mountedAt;
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - anchor));
  useEffect(() => {
    if (startTime === undefined) return;
    const tick = () => setElapsedMs(Math.max(0, Date.now() - (startTime as number)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime]);
  const showClock = elapsedMs >= 15000;
  return (
    <div className="turn-status" role="status" aria-live="polite">
      Deep diving...
      {showClock && <span className="turn-status-clock" aria-hidden="true">{formatRunDuration(elapsedMs)}</span>}
    </div>
  );
}

function StateDot({ state }: { state: "running" | "error" | "warning" | "ok" }) {
  return <span className={`state-dot ${state}`} aria-hidden="true" />;
}

/// Variant leading icons — DSH figma table (all glyphs render at 14 inside the
/// 16px leading box): search / read(browse) / bash(api) / write-edit(edit) /
/// code / question for unknown. Ported from ui-tool GenericToolCard.
function ToolIcon({ name }: { name: string }) {
  switch (name) {
    case "bash":
    case "terminal-bash":
    case "pwsh":
      return <IconApiOutline14 size={14} />;
    case "write":
    case "edit":
    case "str_replace_editor":
    case "patch":
      return <IconEditOutline16 size={14} />;
    case "read":
    case "read_file":
    case "file_read":
      return <IconBrowseOutline16 size={14} />;
    case "search":
    case "web_search":
    case "grep":
      return <IconSearchOutline16 size={14} />;
    case "code":
    case "code_execute":
      return <IconCodeOutline16 size={14} />;
    default:
      return <IconQuestionOutline14 size={14} />;
  }
}

function ApprovalCard({ approvalId, sessionId, toolName, reason }: { approvalId: string; sessionId: string; toolName: string; reason?: string }) {
  const [done, setDone] = useState(false);
  const answer = async (outcome: "allowed-once" | "rejected") => {
    try {
      await api.answerApproval({ approvalId, outcome });
      setDone(true);
    } catch {
      // ignore; card stays until approval/resolved
    }
  };
  return (
    <div className="approval-card">
      <div className="head">
        <ShieldCheck size={15} />
        请求授权
      </div>
      <div className="cmd">{reason || toolName}</div>
      <div className="actions">
        <button className="btn-plain" disabled={done} onClick={() => void answer("rejected")}>
          <X size={13} style={{ verticalAlign: -2 }} /> 拒绝
        </button>
        <button className="btn-primary" disabled={done} onClick={() => void answer("allowed-once")}>
          允许一次
        </button>
      </div>
    </div>
  );
}

// ---------- derivations ----------

function textOf(event?: SessionEvent): string {
  if (!event) return "";
  const d = event.data ?? {};
  if (Array.isArray(d.message?.content)) return contentText(d.message.content);
  if (Array.isArray(d.content)) return contentText(d.content);
  if (typeof d.text === "string") return d.text;
  return "";
}

/// Text + reasoning split of an assistant message content.
function blocksOf(event?: SessionEvent): { text: string; think: string | null } {
  if (!event) return { text: "", think: null };
  const d = event.data ?? {};
  const content = Array.isArray(d.message?.content) ? d.message.content : Array.isArray(d.content) ? d.content : null;
  if (!content) return { text: textOf(event), think: null };
  let text = "";
  let think: string[] = [];
  for (const b of content as any[]) {
    if (b?.type === "text" && typeof b.text === "string") text += b.text;
    else if (b?.type === "reasoning" && typeof b.text === "string" && b.text) think.push(b.text);
  }
  return { text, think: think.length ? think.join("\n\n") : null };
}

function contentText(content: any): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((b: any) => (b?.type === "text" && typeof b.text === "string" ? b.text : ""))
    .join("");
}

function ingest(
  out: RenderItem[],
  entry: { event: SessionEvent; output?: string },
  timing: Map<number, { start?: number; end?: number; firstToken?: number }>,
  outputs: Map<string, { output: string; failed: boolean }>,
  produced: Map<number, string[]>
) {
  const ev = entry.event;
  const data: any = ev.data ?? {};
  const base = { key: `${ev.seq}:${ev.type}`, event: ev, time: ev.time as number | undefined };
  switch (ev.type) {
    case "user/message": {
      const kind = (data.source as any)?.kind;
      if (kind === "user" || kind === undefined) {
        out.push({ ...base, kind: "user" });
      }
      break;
    }
    case "turn/start": {
      const turn = data.turn as number;
      timing.set(turn, { start: ev.time as number, end: undefined, firstToken: undefined });
      break;
    }
    case "turn/end": {
      const turn = data.turn as number;
      const t = timing.get(turn) ?? {};
      t.end = ev.time as number;
      timing.set(turn, t);
      break;
    }
    case "assistant/chunk": {
      const ct: any = data.chunk ?? {};
      const ctype = ct.type ?? data.type;
      const t = typeof ct.text === "string" ? ct.text : "";
      if (ctype === "text-delta" && t !== "") {
        const turn = data.turn as number;
        const t0 = timing.get(turn);
        if (t0 && t0.firstToken === undefined) t0.firstToken = ev.time as number;
        const prev = out[out.length - 1];
        if (prev && prev.kind === "chunk") prev.output = (prev.output ?? "") + t;
        else out.push({ ...base, kind: "chunk", output: t, turn: data.turn });
      }
      break;
    }
    case "assistant/message": {
      const msg: any = data.message ?? data;
      const content: any[] = Array.isArray(msg.content) ? msg.content : [];
      const turn = data.turn as number;
      // Replace the live-streamed chunk item (this turn) with the final
      // blocks. The superseded chunk(s) are DISCARDED — re-appending them
      // interleaves stale stream fragments between steps of a multi-step turn.
      let cut = out.length - 1;
      while (cut >= 0 && out[cut].kind === "chunk" && out[cut].turn === turn) cut -= 1;
      out.length = cut + 1;

      const pushed: RenderItem[] = [];
      let text = "";
      for (const b of content) {
        if (b?.type === "reasoning" && typeof b.text === "string" && b.text.trim()) {
          // Official DSH renders reasoning inside the same AssistantMarkdown
          // container as the text (a collapsible row), NOT as a separate item.
          // It re-surfaces from the event's blocks in the Item renderer.
          void b;
        } else if (b?.type === "text" && typeof b.text === "string") {
          text += b.text;
        } else if (b?.type === "tool-call") {
          const callId = String(b.id ?? "");
          const callArgs = typeof b.arguments === "string" ? b.arguments : JSON.stringify(b.arguments ?? {});
          // dedupe: a matching tool/call event may already be in the stream
          if (!out.some((x) => x.kind === "tool-call" && x.toolCallId === callId)) {
            const prevOutput = callId ? outputs.get(callId) : undefined;
            pushed.push({
              ...base,
              kind: "tool-call",
              toolName: b.name ?? "tool",
              toolCallId: callId,
              args: callArgs,
              output: prevOutput?.output,
              failed: prevOutput?.failed,
              turn,
            });
          } else if (callId) {
            const prevOutput = outputs.get(callId);
            const existing = out.find((x) => x.kind === "tool-call" && x.toolCallId === callId);
            if (existing && prevOutput) {
              existing.output = prevOutput.output;
              existing.failed = prevOutput.failed;
            }
          }
        }
      }
      if (text) pushed.push({ ...base, kind: "assistant", turn });
      out.push(...pushed);
      break;
    }
    case "tool/call": {
      const callId = data.callId ?? data.id;
      let args = "";
      if (typeof data.arguments === "string") args = data.arguments;
      else if (data.arguments) args = JSON.stringify(data.arguments, null, 2);
      else args = data.argsRaw ?? data.command ?? "";
      const existing = callId ? out.find((x) => x.kind === "tool-call" && x.toolCallId === callId) : undefined;
      if (existing) {
        existing.args = args || existing.args;
      } else {
        out.push({
          ...base,
          kind: "tool-call",
          toolName: data.name ?? data.toolName ?? "tool",
          toolCallId: callId,
          args,
          turn: data.turn,
        });
      }
      break;
    }
    case "tool/result": {
      const extract = extractToolResult(data);
      const callId = extract.callId ?? data.toolCallId ?? data.callId ?? data.id ?? "";
      const failed = extract.failed;
      outputs.set(callId, { output: extract.output, failed });
      const existing = callId ? out.find((x) => x.kind === "tool-call" && x.toolCallId === callId) : undefined;
      if (existing) {
        existing.output = extract.output;
        existing.failed = failed;
      }
      // produced files: successful read/write/edit calls with a path
      if (!failed && extract.path) {
        const turn = (data.turn as number) ?? existing?.turn ?? -1;
        const list = produced.get(turn) ?? [];
        if (!list.includes(extract.path)) {
          list.push(extract.path);
          produced.set(turn, list);
        }
      }
      break;
    }
    default:
      break;
  }
}

/// Derived DSH-style tool summary from arguments (first line of the payload).
function summarizeArgs(toolName: string, args: string): string {
  if (!args) return "";
  try {
    const p = JSON.parse(args);
    if (p && typeof p === "object") {
      for (const key of ["command", "path", "file_path", "url", "query", "prompt", "code", "description", "message", "module"]) {
        if (typeof p[key] === "string" && p[key]) return firstLine(p[key]);
      }
      const keys = Object.keys(p);
      if (keys.length === 0) return "";
      const v = p[keys[0]];
      if (typeof v === "string" && v) return firstLine(v);
      return firstLine(args);
    }
    return typeof p === "string" ? firstLine(p) : "";
  } catch {
    return firstLine(args);
  }
}

function commandOf(args: string): string {
  try {
    const p = JSON.parse(args);
    if (typeof p?.command === "string") return p.command;
  } catch { /* fallthrough */ }
  return args;
}

function prettyArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}

function extractToolResult(data: any): { callId?: string; output: string; failed: boolean; path?: string } {
  const msg = data.message ?? data;
  let output = "";
  const parts: any[] = [];
  const walk = (c: any) => {
    if (!c) return;
    if (typeof c === "string") { parts.push(c); return; }
    if (Array.isArray(c)) { c.forEach(walk); return; }
    if (typeof c === "object") {
      if (typeof c.text === "string") parts.push(c.text);
      const cc = c.content;
      if (cc !== undefined) walk(cc);
    }
  };
  walk(msg);
  if (parts.length) output = parts.join("\n");
  if (!output && typeof data.output === "string") output = data.output;
  if (!output && data.text) output = String(data.text);
  if (!output && data.result) output = JSON.stringify(data.result);
  if (!output) output = truncate(JSON.stringify(data));
  const failed = data.ok === false || msg?.isError === true || data.isError === true;
  // path for produced-files: lookup args of the matching call is done by caller;
  // here we re-read if tool/result carries a path field directly.
  const path = typeof data.path === "string" ? data.path : undefined;
  return { callId: msg?.toolCallId ?? data.toolCallId ?? msg?.source?.callId, output, failed, path };
}

function finalizeTurns(
  items: RenderItem[],
  timing: Map<number, { start?: number; end?: number; firstToken?: number }>,
  outputs: Map<string, { output: string; failed: boolean }>,
  produced: Map<number, string[]>
) {
  void outputs;
  void produced;
  // Attach turn meta to the LAST assistant message of each turn (closing reply),
  // mirroring DSH's per-turn metrics row placement.
  const closed = [...timing.entries()].filter(([, t]) => t.start !== undefined && t.end !== undefined);
  for (const [turn, t] of closed) {
    // find index of last assistant item for this turn
    let last = -1;
    for (let i = 0; i < items.length; i++) {
      if (items[i].turn === turn && items[i].kind === "assistant") last = i;
    }
    if (last === -1) continue;
    const runMs = Math.max(0, (t.end ?? 0) - (t.start ?? 0));
    const ttftMs = t.firstToken !== undefined ? Math.max(0, t.firstToken - (t.start ?? 0)) : null;
    const tokensPerSecond = ttftMs !== null && runMs > ttftMs ? Math.round(((runMs - ttftMs) / 1000) * 100) / 100 : null;
    items[last] = {
      ...items[last],
      meta: { runMs, ttftMs, tokensPerSecond },
      produced: produced.get(turn) ?? [],
    };
  }
}

// ---------- formatting ----------

function basename(p: string): string {
  return p.split(/[/\\]/).pop() ?? p;
}

function firstLine(s: string): string {
  return s.split("\n")[0].trim();
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatRunDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}秒`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}分${s}秒`;
}

function formatLatencySeconds(ms: number): string {
  const s = ms / 1000;
  return s >= 10 ? String(Math.round(s)) : (Math.round(s * 10) / 10).toString().replace(/\.0$/, "");
}

function formatTokensPerSecond(tps: number): string {
  return tps >= 100 ? String(Math.round(tps)) : tps >= 10 ? (Math.round(tps * 10) / 10).toString().replace(/\.0$/, "") : (Math.round(tps * 100) / 100).toString().replace(/\.0$/, "");
}

function truncate(s: string, n = 400): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}
