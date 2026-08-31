import { useEffect, useRef, useState } from "react";
import { ArrowDown, ChevronDown, ChevronUp, Hammer, ShieldCheck, X } from "lucide-react";
import { ModelMenu, type ModelOption } from "./ModelMenu";
import { api } from "../api";
import { useStore } from "../store";
import { Composer } from "./Composer";
import { Markdown } from "./Markdown";
import type { HistoryEntry, SessionEvent } from "../types";

interface RenderItem {
  key: string;
  kind: "user" | "assistant" | "tool-call" | "tool-result" | "approval" | "system" | "chunk";
  event?: SessionEvent;
  toolName?: string;
  toolCallId?: string;
  output?: string;
  failed?: boolean;
  pendingApproval?: boolean;
}

export function SessionView({ sessionId }: { sessionId: string }) {
  const { approvals, subscribeMux, openSession, sessions } = useStore();
  const [items, setItems] = useState<RenderItem[]>([]);
  const [streaming, setStreaming] = useState("");
  const [modelName, setModelName] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [showModels, setShowModels] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const summary = sessions.find((s) => s.sessionId === sessionId);
  const title = summary
    ? (summary.projections?.values?.title as string) || (summary.blank ? "新会话" : "会话")
    : "会话";

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
    setItems([]);
    api
      .history({ sessionId })
      .then(({ events }) => {
        if (!alive) return;
        const rendered: RenderItem[] = [];
        for (const entry of events) {
          pushRenderable(rendered, entry);
        }
        setItems(rendered);
        const last = events[events.length - 1];
        if (last) seqFloor = last.event.seq + 1;
      })
      .catch(() => void 0);

    const off = subscribeMux((frame: any) => {
      if (frame.type !== "session/event" || frame.sessionId !== sessionId) return;
      const seq = frame.event?.seq ?? -1;
      if (seq >= 0 && seq < seqFloor) return;
      setItems((prev) => {
        const next = prev.slice();
        pushRenderable(next, { event: frame.event });
        return next;
      });
      if (seq >= 0) seqFloor = seq + 1;
    });

    return () => {
      alive = false;
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
      </div>
      <div className="flow" ref={scrollRef} onScroll={(e) => {
        const el = e.currentTarget;
        setFollow(el.scrollTop + el.clientHeight >= el.scrollHeight - 32);
      }}>
        <div className="flow-inner">
          {items.map((item) => (
            <Item key={item.key} item={item} />
          ))}
          {streaming && (
            <div className="msg assistant">
              <div className="text">{streaming}</div>
            </div>
          )}
          {pending.map((a) => (
            <ApprovalCard key={a.approvalId} approvalId={a.approvalId} sessionId={sessionId} toolName={a.toolName} reason={a.reason} />
          ))}
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

function Item({ item }: { item: RenderItem }) {
  if (item.kind === "user") {
    return <UserBubble text={textOf(item.event)} />;
  }
  if (item.kind === "assistant") {
    const t = textOf(item.event);
    return t ? <AgentMessage text={t} /> : null;
  }
  if (item.kind === "tool-call" || item.kind === "tool-result") {
    return <ToolCardItem item={item} />;
  }
  if (item.kind === "system" || item.kind === "chunk") {
    return item.kind === "chunk" && item.output ? (
      <div className="msg assistant"><div className="text">{item.output}</div></div>
    ) : null;
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

function ToolCardItem({ item }: { item: RenderItem }) {
  const [open, setOpen] = useState(false);
  const failed = item.failed;
  return (
    <div className={`tool-card${failed ? " bad" : ""}`}>
      <button className="tool-card-head" onClick={() => setOpen((v) => !v)}>
        <Hammer size={14} />
        <span className="name">{item.toolName ?? "tool"}</span>
        <span>{item.pendingApproval ? <ShieldCheck size={13} /> : null}</span>
        {open ? <ChevronUp className="chev" size={14} /> : <ChevronDown className="chev" size={14} />}
      </button>
      {open && item.output && <pre className="tool-card-body">{item.output}</pre>}
    </div>
  );
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

function textOf(event?: SessionEvent): string {
  if (!event) return "";
  const d = event.data ?? {};
  if (Array.isArray(d.message?.content)) return contentText(d.message.content);
  if (Array.isArray(d.content)) return contentText(d.content);
  if (typeof d.text === "string") return d.text;
  return "";
}

/// Only real text blocks (type === "text"); never reasoning / tool blocks.
function contentText(content: any): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((b: any) => (b?.type === "text" && typeof b.text === "string" ? b.text : ""))
    .join("");
}

function pushRenderable(out: RenderItem[], entry: { event: SessionEvent; output?: string }) {
  const ev = entry.event;
  const data = ev.data ?? {};
  const base = { key: `${ev.seq}:${ev.type}`, event: ev };
  switch (ev.type) {
    case "user/message": {
      // Engine injects runtime context / skill catalog as user-messages with
      // source.kind = "plugin" | "skill-catalog" | … These are system payloads,
      // NOT chat content: rendering them as bubbles paints giant cards into the
      // flow. Only genuine user input (source.kind === "user") gets a bubble.
      const kind = (data.source as any)?.kind;
      if (kind === "user" || kind === undefined) {
        out.push({ ...base, kind: "user" });
      }
      break;
    }
    case "assistant/chunk": {
      // Stream frames carry text under data.chunk → {type, text}. Only text
      // deltas are appendable; reasoning deltas / block-start / usage / finish
      // are not content and would render as empty bubbles.
      const ct = (data as any).chunk ?? {};
      const ctype = ct.type ?? (data as any).type;
      const t = typeof ct.text === "string" ? ct.text : "";
      if (ctype !== "text-delta" || t === "") break;
      const prev = out[out.length - 1];
      if (prev && prev.kind === "chunk") prev.output = (prev.output ?? "") + t;
      else out.push({ ...base, kind: "chunk", output: t });
      break;
    }
    case "assistant/message": {
      // Full message text lives under data.message.content (delivery of the
      // streamed reply). Replaces the merged chunk item so text isn't doubled.
      const msg: any = (data as any).message ?? data;
      const txt = Array.isArray(msg.content) ? contentText(msg.content) : "";
      const last = out[out.length - 1];
      if (txt) {
        if (last && last.kind === "chunk") out[out.length - 1] = { ...base, kind: "assistant" };
        else out.push({ ...base, kind: "assistant" });
      }
      break;
    }
    case "tool/call":
      out.push({ ...base, kind: "tool-call", toolName: data.name ?? data.toolName ?? "tool", toolCallId: data.id ?? data.callId });
      break;
    case "tool/result": {
      const ok = data.ok !== false;
      const callId = data.toolCallId ?? data.callId ?? data.id;
      const output =
        typeof data.output === "string"
          ? data.output
          : data.text
          ? String(data.text)
          : data.result
          ? JSON.stringify(data.result)
          : truncate(JSON.stringify(data));
      const last = out[out.length - 1];
      if (last && last.kind === "tool-call" && callId && last.toolCallId === callId) {
        last.output = output;
        last.failed = !ok;
      } else {
        out.push({ ...base, kind: "tool-result", toolName: data.name ?? "tool", output, failed: !ok });
      }
      break;
    }
    default:
      break;
  }
}

function truncate(s: string, n = 400): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}
