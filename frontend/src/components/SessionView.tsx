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
import type {
  AssistantMessageData,
  ContentBlock,
  ReasoningBlock,
  StreamChunk,
  TextBlock,
  ToolCallData,
  ToolResultData,
  SessionEvent,
  UserMessageData,
} from "../types";

interface RenderItem {
  key: string;
  kind: "user" | "assistant" | "tool-call" | "approval" | "think" | "chunk" | "turn-tail";
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
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [earliestSeq, setEarliestSeq] = useState<number | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const olderAnchorRef = useRef<HTMLElement | null>(null);
  const summary = sessions.find((s) => s.sessionId === sessionId);
  const title = summary
    ? (summary.projections?.values?.title as string) || (summary.blank ? "新会话" : "会话")
    : "会话";

  // Turn-level aggregations + stable-id indexes, shared by the history replay
  // and live mux passes so the derivations stay identical.
  const ctx = useRef<IngestCtx>({
    timing: new Map(),
    outputs: new Map(),
    produced: new Map(),
    callIndex: new Map(),
    callPaths: new Map(),
    turnText: new Map(),
    turnTime: new Map(),
  });

  useEffect(() => {
    api
      .sessionModels({ sessionId })
      .then((r) => setModelName(r.current?.model ?? ""))
      .catch(() => void 0);
    api
      .llmModels()
      .then((r) => {
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

  // Full event log (ascending seq) backing this session. Most recent page is
  // loaded from history; older pages are prepended on "载入更早". Every render
  // rebuilds `items` from the whole log so ordering/dedup is deterministic —
  // the official append-only log + derived UI model.
  const eventLog = useRef<SessionEvent[]>([]);

  /** Rebuild rendered items from the full asc event log + ctx. */
  const rebuild = useMemo(() => (events: SessionEvent[]) => {
    const rendered: RenderItem[] = [];
    ctx.current = { timing: new Map(), outputs: new Map(), produced: new Map(), callIndex: new Map(), callPaths: new Map(), turnText: new Map(), turnTime: new Map() };
    for (const ev of events) {
      ingest(rendered, { event: ev }, ctx.current);
    }
    finalizeTurns(rendered, ctx.current);
    return rendered;
  }, []);

  useEffect(() => {
    let alive = true;
    let seqFloor = -1;
    eventLog.current = [];
    ctx.current = { timing: new Map(), outputs: new Map(), produced: new Map(), callIndex: new Map(), callPaths: new Map(), turnText: new Map(), turnTime: new Map() };
    setItems([]);
    setStreaming("");
    setHasMore(false);
    setEarliestSeq(undefined);

    api
      .history({ sessionId, maxMessages: 120 })
      .then(({ events, hasMore: more }) => {
        if (!alive) return;
        eventLog.current = events.map((e) => e.event);
        setItems(rebuild(eventLog.current));
        setHasMore(more);
        const first = events[0];
        if (first) setEarliestSeq(first.event.seq);
        const last = events[events.length - 1];
        if (last) seqFloor = last.event.seq + 1;
      })
      .catch(() => void 0);

    // plan projection: DSH PlanChip visibility (active, or pending when folded)
    const tickPlan = () => {
      api.sessions().then((r) => {
        const s = (r.items ?? []).find((x) => x.sessionId === sessionId);
        const planVal = s?.projections?.values?.plan as { active?: boolean; pending?: boolean } | undefined;
        if (planVal) {
          setPlan({ active: !!planVal.active, pending: !!planVal.pending });
        }
      }).catch(() => void 0);
    };
    tickPlan();
    const planIv = setInterval(tickPlan, 3000);

    const off = subscribeMux((frame) => {
      // MuxFrame's catch-all `{ type: string; [k: string]: unknown }` prevents
      // clean narrowing, so pull the event out with an explicit guard.
      if (frame.type !== "session/event") return;
      const ev = (frame as { type: "session/event"; sessionId: string; event: SessionEvent }).event;
      if (ev === undefined || (frame as { sessionId?: string }).sessionId !== sessionId) return;
      const seq = ev.seq ?? -1;
      if (seq >= 0 && seq < seqFloor) return;
      // Append to the log (asc seq) and rebuild. Overlap with history is safe:
      // any already-present seq gets replaced by the identical event, and the
      // rebuild sorts nothing — the log stays ascending.
      setItems((prev) => {
        const log = eventLog.current;
        if (seq >= 0 && log.length && seq <= log[log.length - 1].seq) {
          // duplicate/late frame: drop (log is strictly ascending)
          return prev;
        }
        log.push(ev);
        return rebuild(log);
      });
      if (ev.type === "turn/end" || ev.type === "assistant/message") {
        setStreaming("");
      }
      // running state: turn/start → turn/end window (DSH TurnStatus)
      if (ev.type === "turn/start") {
        setRunning(true);
        setRunningSince(ev.time);
      } else if (ev.type === "turn/end") {
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

  const loadOlder = async () => {
    if (loadingOlder) return;
    const atSeq = earliestSeq;
    if (atSeq === undefined) return;
    setLoadingOlder(true);
    try {
      // Capture the scrollport position of the current first row so we can
      // keep it visually pinned after older rows are prepended.
      const el = olderAnchorRef.current;
      const anchorTop = el ? el.getBoundingClientRect().top - scrollRef.current!.getBoundingClientRect().top : 0;
      const { events, hasMore: more } = await api.history({ sessionId, atSeq, maxMessages: 120 });
      eventLog.current = [...events.map((e) => e.event), ...eventLog.current];
      setItems(rebuild(eventLog.current));
      // After render, restore the anchor row to its captured offset.
      requestAnimationFrame(() => {
        const sc = scrollRef.current;
        const a = olderAnchorRef.current;
        if (sc && a) {
          const delta = a.getBoundingClientRect().top - sc.getBoundingClientRect().top - anchorTop;
          sc.scrollTop += delta;
        }
      });
      setHasMore(more);
      const first = events[0];
      if (first) setEarliestSeq(first.event.seq);
    } catch {
      // engine may be busy; keep current state
    } finally {
      setLoadingOlder(false);
    }
  };

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
          {hasMore && (
            <button
              type="button"
              className="load-older"
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
            >
              {loadingOlder ? "加载中…" : "载入更早"}
            </button>
          )}
          {(() => {
            // DSH data-actions-reveal gate: the latest user row and the latest
            // turn tail hold 'always' (kept visible); earlier rows reveal on
            // hover / focus-within.
            let lastUserIdx = -1;
            let lastTailIdx = -1;
            for (let i = 0; i < items.length; i++) {
              if (items[i].kind === "user") lastUserIdx = i;
              if (items[i].kind === "turn-tail") lastTailIdx = i;
            }
            return items.map((item, idx) => (
              <div
                key={item.key}
                className="chat-anchor-row"
                ref={idx === 0 ? ((el: HTMLDivElement | null) => { olderAnchorRef.current = el; }) : undefined}
              >
                <Item
                  item={item}
                  latestUser={idx === lastUserIdx}
                  latestTurn={idx === lastTailIdx}
                />
              </div>
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

function Item({ item, latestUser, latestTurn }: {
  item: RenderItem;
  latestUser: boolean;
  latestTurn: boolean;
}) {
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
    return (
      <div className="msg-block assistant">
        {blocks.think && <ThinkRow reasoning={blocks.think} />}
        <AgentMessage text={t} />
      </div>
    );
  }
  if (item.kind === "turn-tail") {
    // DSH turn-tail chrome: produced files + copy / branch / clock("end") +
    // usage stats, in its own node so tool-only / interrupted turns keep them.
    const time = item.time;
    const meta = item.meta;
    const copiedText = item.event ? textOf(item.event) : "";
    return (
      <div className="turn-tail" data-actions-reveal={latestTurn ? "always" : "hover"}>
        <ProducedFiles paths={item.produced ?? []} />
        <MessageMeta
          time={time}
          clockSide="end"
          runMs={meta?.runMs}
          ttftMs={meta?.ttftMs ?? undefined}
          tokensPerSecond={meta?.tokensPerSecond ?? undefined}
          copiedText={copiedText}
          branch
        />
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
    const items = todos.map((t: unknown) => {
      const o = (t ?? {}) as Record<string, unknown>;
      const content = typeof o.content === "string" ? o.content : typeof o.todo === "string" ? o.todo : typeof o.description === "string" ? o.description : JSON.stringify(t);
      return { content, status: typeof o.status === "string" ? o.status : "pending" };
    });
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
//
// Payload accessors are typed against SessionEvent's discriminated union, so
// `switch (event.type)` narrows `event.data` — no `as any`. Unknown event
// types fall through the default branch below.

function isTextBlock(b: ContentBlock | undefined): b is TextBlock {
  return !!b && (b as TextBlock).type === "text" && typeof (b as TextBlock).text === "string";
}

/// Plain text of an assistant/user message (text blocks only, never reasoning).
function messageText(content: ContentBlock[] | undefined): string {
  if (!Array.isArray(content)) return "";
  return content.filter(isTextBlock).map((b) => (b as TextBlock).text).join("");
}

/// Reasoning (think) text of an assistant message; null when absent.
function messageReasoning(content: ContentBlock[] | undefined): string | null {
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const b of content) {
    if (b && (b as ReasoningBlock).type === "reasoning" && typeof (b as ReasoningBlock).text === "string" && (b as ReasoningBlock).text) {
      parts.push((b as ReasoningBlock).text);
    }
  }
  return parts.length ? parts.join("\n\n") : null;
}

/// Text of a user/message event, honoring its `source.kind` (only real user
/// input is chat content; injected plugin/skill-catalog context is not).
function userText(d: UserMessageData): string {
  const kind = (d.source as { kind?: string })?.kind;
  if (kind !== "user" && kind !== undefined) return "";
  return messageText(d.content);
}

function textOf(event?: SessionEvent): string {
  if (!event) return "";
  switch (event.type) {
    case "user/message": return userText(event.data as UserMessageData);
    case "assistant/message": return messageText((event.data as AssistantMessageData).message?.content);
    default: return "";
  }
}

/// Text + reasoning split for an assistant message (render-time, from the
/// final event). Folds reasoning into the same assistant container (official
/// AssistantMarkdown) so it is never a separate duplicate row.
function blocksOf(event?: SessionEvent): { text: string; think: string | null } {
  if (!event) return { text: "", think: null };
  const content = event.type === "assistant/message" ? (event.data as AssistantMessageData).message?.content : undefined;
  return { text: messageText(content), think: messageReasoning(content) };
}

function toolCallIdOf(data: ToolCallData): string {
  return data.callId ?? data.id ?? "";
}

/// Read the stored args of a rendered tool-call item (for derived file path).
function extractArgsOf(out: RenderItem[], idx: number | undefined): string {
  return idx !== undefined && out[idx] ? out[idx].args ?? "" : "";
}

/// Derive an openable file path from a mutation tool's arguments (official
/// FILE_PATH_KEYS: path / file_path). Only write/edit/read variants produce one.
function derivePath(toolName: string, args: string): string | undefined {
  if (!/^(write|edit|read|str_replace_editor|file_read|file_write)$/.test(toolName)) return undefined;
  try {
    const p = JSON.parse(args);
    const picked = p?.path ?? p?.file_path;
    if (typeof picked === "string" && picked) return picked.split("\n")[0].trim();
  } catch { /* non-JSON args */ }
  return undefined;
}

function toolArgsString(argumentsField: unknown): string {
  if (typeof argumentsField === "string") return argumentsField;
  if (argumentsField === undefined || argumentsField === null) return "";
  try { return JSON.stringify(argumentsField, null, 2); } catch { return String(argumentsField); }
}

/// Pull the output text + failure + path from a tool/result payload (typed).
function extractToolResult(data: ToolResultData): { callId?: string; output: string; failed: boolean; path?: string } {
  const msg = data.message;
  let output = "";
  const parts: string[] = [];
  const walk = (c: unknown) => {
    if (!c) return;
    if (typeof c === "string") { parts.push(c); return; }
    if (Array.isArray(c)) { c.forEach(walk); return; }
    if (typeof c === "object") {
      const o = c as Record<string, unknown>;
      if (typeof o.text === "string") parts.push(o.text);
      if (o.content !== undefined) walk(o.content);
    }
  };
  walk(msg?.content);
  if (parts.length) output = parts.join("\n");
  if (!output && typeof data.output === "string") output = data.output;
  if (!output && data.text) output = String(data.text);
  if (!output && data.result !== undefined) output = JSON.stringify(data.result);
  if (!output) output = truncate(JSON.stringify(data));
  const failed = data.isError === true || msg?.isError === true || data.ok === false;
  const callId = data.toolCallId ?? data.callId ?? msg?.source?.callId;
  const path = typeof data.path === "string" ? data.path : undefined;
  return { callId, output, failed, path };
}

/**
 * Ingest context passed through the append pass. Holds O(1) indexes keyed by
 * stable business id (call id, turn) instead of scanning the rendered array —
 * the official ConversationAssembler "hot append must not scan the window"
 * rule.
 */
interface IngestCtx {
  timing: Map<number, { start?: number; end?: number; firstToken?: number }>;
  outputs: Map<string, { output: string; failed: boolean }>;
  produced: Map<number, string[]>;
  /** callId → rendered tool-call item index (stable identity). */
  callIndex: Map<string, number>;
  /** callId → derived file path (from tool/call arguments) for produced lanes. */
  callPaths: Map<string, string>;
  /** turn → the latest accumulated assistant text (copy-able tail payload). */
  turnText: Map<number, string>;
  /** turn → tail anchor time (the closing assistant message, if any). */
  turnTime: Map<number, number>;
}

function ingest(out: RenderItem[], entry: { event: SessionEvent; output?: string }, ctx: IngestCtx) {
  const ev = entry.event;
  const base = { key: `${ev.seq}:${ev.type}`, event: ev, time: ev.time };
  // `ev.data` is a union of every event payload (the trailing catch-all is
  // `unknown`), so a `type` switch does not auto-narrow it. Each branch casts
  // to its own payload type — the narrow, exhaustive case union does that work.
  switch (ev.type) {
    case "user/message": {
      const d = ev.data as UserMessageData;
      const txt = userText(d);
      if (txt) out.push({ ...base, kind: "user" });
      break;
    }
    case "turn/start": {
      const d = ev.data as { turn: number };
      ctx.timing.set(d.turn, { start: ev.time, end: undefined, firstToken: undefined });
      break;
    }
    case "turn/end": {
      const d = ev.data as { turn: number; reason: unknown };
      const t = ctx.timing.get(d.turn) ?? {};
      t.end = ev.time;
      ctx.timing.set(d.turn, t);
      break;
    }
    case "assistant/chunk": {
      // Stream frames append a chunk item for text-deltas; reasoning deltas
      // are intentionally not surfaced until the final assistant/message.
      const d = ev.data as { turn: number; step: number; chunk: StreamChunk };
      const chunk = d.chunk;
      if (chunk.type === "text-delta" && typeof chunk.text === "string" && chunk.text) {
        const turn = d.turn;
        const t0 = ctx.timing.get(turn);
        if (t0 && t0.firstToken === undefined) t0.firstToken = ev.time;
        const last = out[out.length - 1];
        if (last && last.kind === "chunk" && last.turn === turn) last.output = (last.output ?? "") + chunk.text;
        else out.push({ ...base, kind: "chunk", output: chunk.text, turn });
      }
      break;
    }
    case "assistant/message": {
      const d = ev.data as AssistantMessageData;
      const turn = d.turn;
      const text = messageText(d.message?.content);
      // Replace the live-streamed chunk item(s) for this step with the final
      // blocks. Discard them — re-appending interleaves stale fragments.
      let cut = out.length - 1;
      while (cut >= 0 && out[cut].kind === "chunk" && out[cut].turn === turn) cut -= 1;
      out.length = cut + 1;
      // Track the accumulated tail payload.
      if (text) out.push({ ...base, kind: "assistant", turn });
      if (text) ctx.turnText.set(turn, text);
      ctx.turnTime.set(turn, ev.time);
      break;
    }
    case "tool/call": {
      const d = ev.data as ToolCallData;
      const callId = toolCallIdOf(d);
      const args = d.arguments !== undefined ? toolArgsString(d.arguments) : d.argsRaw ?? d.command ?? "";
      const prev = ctx.callIndex.get(callId);
      if (prev !== undefined) {
        out[prev].args = args || out[prev].args;
      } else {
        const idx = out.length;
        out.push({
          ...base,
          kind: "tool-call",
          toolName: d.name ?? "tool",
          toolCallId: callId,
          args,
          turn: d.turn,
        });
        if (callId) ctx.callIndex.set(callId, idx);
      }
      const p = derivePath(d.name ?? "tool", args);
      if (callId && p) ctx.callPaths.set(callId, p);
      break;
    }
    case "tool/result": {
      const d = ev.data as ToolResultData;
      const extracted = extractToolResult(d);
      const callId = extracted.callId ?? "";
      ctx.outputs.set(callId, { output: extracted.output, failed: extracted.failed });
      const prevIdx = ctx.callIndex.get(callId);
      if (prevIdx !== undefined) {
        const item = out[prevIdx];
        if (item) { item.output = extracted.output; item.failed = extracted.failed; }
      }
      // produced files: successful mutation calls carrying a derived path
      if (!extracted.failed) {
        const filePath = ctx.callPaths.get(callId) ?? extracted.path ?? derivePath(prevIdx !== undefined ? out[prevIdx]?.toolName ?? "" : "", extractArgsOf(out, prevIdx));
        if (filePath) {
          const turn = d.turn ?? (prevIdx !== undefined ? out[prevIdx]?.turn : undefined) ?? -1;
          const list = ctx.produced.get(turn) ?? [];
          if (!list.includes(filePath)) {
            list.push(filePath);
            ctx.produced.set(turn, list);
          }
        }
      }
      break;
    }
    default:
      break;
  }
}

/**
 * Emit a per-turn tail item (meta + produced files). Official DSH renders a
 * `turn-tail` node per closed turn independent of whether the last block is
 * assistant text, so interrupted / tool-only turns keep their metrics+files.
 * Inserted right after the turn's last assistant item; a turn already having
 * a tail is updated in place.
 */
function finalizeTurns(items: RenderItem[], ctx: IngestCtx) {
  const closed = [...ctx.timing.entries()].filter(([, t]) => t.start !== undefined && t.end !== undefined);
  if (closed.length === 0) return;
  // Build the tail payload per closed turn once.
  const tails = new Map<number, RenderItem>();
  for (const [turn, t] of closed) {
    const runMs = Math.max(0, (t.end ?? 0) - (t.start ?? 0));
    const ttftMs = t.firstToken !== undefined ? Math.max(0, t.firstToken - (t.start ?? 0)) : null;
    const tokensPerSecond = ttftMs !== null && runMs > ttftMs ? Math.round(((runMs - ttftMs) / 1000) * 100) / 100 : null;
    const txt = ctx.turnText.get(turn) ?? "";
    tails.set(turn, {
      key: `tail:${turn}`,
      kind: "turn-tail",
      turn,
      time: ctx.turnTime.get(turn),
      event: txt
        ? ({ type: "assistant/message", seq: -1, time: ctx.turnTime.get(turn) ?? 0, data: { turn, step: 1, message: { role: "assistant", content: [{ type: "text", text: txt }], source: { kind: "model", provider: "", model: "" }, id: `tail:${turn}` } } } as SessionEvent)
        : undefined,
      meta: { runMs, ttftMs, tokensPerSecond },
      produced: ctx.produced.get(turn) ?? [],
    });
  }
  // Insert each turn's tail right after the LAST item belonging to that turn,
  // scanning left-to-right so earlier splices never invalidate a later anchor.
  const order: RenderItem[] = [];
  const emitted = new Set<number>();
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    order.push(item);
    const turn = item.turn;
    if (turn !== undefined) {
      // Is this the last item carrying this turn? (look ahead)
      let j = i + 1;
      while (j < items.length && items[j].turn !== turn) j++;
      const isLastOfTurn = j < items.length && items[j].turn === turn ? false : j >= items.length;
      if (isLastOfTurn && tails.has(turn) && !emitted.has(turn)) {
        order.push(tails.get(turn)!);
        emitted.add(turn);
      }
    }
    i++;
  }
  items.length = 0;
  items.push(...order);
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
