import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Hammer, ShieldCheck, X } from "lucide-react";
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
      <div className="flow" ref={scrollRef} onScroll={() => setFollow(false)}>
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
      <div className="session-bottom">
        <Composer sessionId={sessionId} />
      </div>
    </>
  );
}

function Item({ item }: { item: RenderItem }) {
  if (item.kind === "user") {
    return (
      <div className="msg user">
        <div className="bubble">{textOf(item.event)}</div>
      </div>
    );
  }
  if (item.kind === "assistant") {
    const t = textOf(item.event);
    return t ? (
      <div className="msg assistant">
        <Markdown text={t} />
      </div>
    ) : null;
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
  if (Array.isArray(d.content)) {
    return d.content
      .map((b: any) => (typeof b?.text === "string" ? b.text : b?.type ? `[${b.type}]` : ""))
      .join("");
  }
  if (typeof d.text === "string") return d.text;
  if (typeof d.name === "string") return "";
  return "";
}

function pushRenderable(out: RenderItem[], entry: { event: SessionEvent; output?: string }) {
  const ev = entry.event;
  const data = ev.data ?? {};
  const base = { key: `${ev.seq}:${ev.type}`, event: ev };
  switch (ev.type) {
    case "user/message":
      out.push({ ...base, kind: "user" });
      break;
    case "assistant/chunk": {
      const text = data.text ?? "";
      const prev = out[out.length - 1];
      // merge consecutive chunks into the last assistant item
      if (prev && prev.kind === "chunk") prev.output = (prev.output ?? "") + text;
      else out.push({ ...base, kind: "chunk", output: text });
      break;
    }
    case "assistant/message":
      out.push({ ...base, kind: "assistant" });
      break;
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
