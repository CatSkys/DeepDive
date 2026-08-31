import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp, Square, Plus, Command, Image as ImageIcon, Clipboard, Sparkles,
  Code, NotebookPen, Cpu,
} from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";

interface Attachment {
  data: string; // base64 (no prefix)
  mediaType: string;
  name: string;
}

interface MenuRow {
  id: string;
  icon: any;
  label: string;
  run: () => void;
  section: string;
}

/// base64 in 32k chunks — spreading a whole multi-MB clipboard screenshot
/// into String.fromCharCode overflows the call stack.
function base64Of(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function Composer({ sessionId, onSent }: { sessionId: string | null; onSent?: () => void }) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [menu, setMenu] = useState<"attach" | "command" | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [presets, setPresets] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const store = useStore();
  const running = sessionId ? (store.sessions.find((x) => x.sessionId === sessionId)?.running ?? false) : false;

  useEffect(() => {
    api.agentPresets().then((r) => setPresets(r?.presets ?? [])).catch(() => void 0);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  // ---------- prompt assembly ----------

  const content = useMemo(() => {
    const parts: Array<Record<string, unknown>> = [];
    for (const a of attachments) parts.push({ type: "image", mediaType: a.mediaType, data: a.data, name: a.name });
    if (text.trim()) parts.push({ type: "text", text: text.trim() });
    return parts;
  }, [attachments, text]);

  const submit = async () => {
    if (content.length === 0 || busy) return;
    setBusy(true);
    if (sessionId === null) {
      const create = await store.createSession();
      if (!create) { setBusy(false); return; }
      try {
        await api.prompt({ sessionId: create, mode: "queue", content: content as any });
      } catch { setBusy(false); return; }
    } else {
      try {
        await api.prompt({ sessionId, mode: "queue", content: content as any });
      } catch { setBusy(false); return; }
    }
    setText("");
    setAttachments([]);
    setBusy(false);
    onSent?.();
  };

  // ---------- menu rows ----------

  const attachRows: MenuRow[] = [
    {
      id: "image", icon: ImageIcon, section: "附件", label: "图片…",
      run: () => { setMenu(null); fileRef.current?.click(); },
    },
    {
      id: "clip-image", icon: Clipboard, section: "附件", label: "剪贴板图片…",
      run: async () => {
        setMenu(null);
        try {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            const type = item.types.find((t) => t.startsWith("image/"));
            if (!type) continue;
            const blob = await item.getType(type);
            const buf = await blob.arrayBuffer();
            const base64 = base64Of(buf);
            setAttachments((prev) => [...prev, { data: base64, mediaType: type, name: "剪贴板" }]);
            break;
          }
        } catch { /* permission denied; ignore */ }
      },
    },
    ...presets.map((p) => ({
      id: `preset:${p.id}`, icon: presetIcon(p.id), section: "Agents", label: p.name,
      run: () => { setMenu(null); void store.createSession(p.id); },
    })),
  ];

  const commandRows: MenuRow[] = [
    {
      id: "new", icon: Sparkles, section: "命令", label: "新会话",
      run: () => { setMenu(null); void store.createSession(); },
    },
  ];

  const rows = menu === "attach" ? attachRows : commandRows;
  const filtered = query ? rows.filter((r) => r.label.toLowerCase().includes(query.toLowerCase())) : rows;

  useEffect(() => setActive(0), [query, menu]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataURL = String(reader.result);
      const comma = dataURL.indexOf(",");
      const mediaType = dataURL.slice(5, dataURL.indexOf(";"));
      setAttachments((prev) => [...prev, { data: dataURL.slice(comma + 1), mediaType, name: file.name }]);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  return (
    <div className="composer-wrap" ref={rootRef}>
      {attachments.length > 0 && (
        <div className="composer-chips">
          {attachments.map((a, i) => (
            <span key={i} className="chip">
              <ImageIcon size={12} />
              {a.name}
              <button onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="composer">
        <button className="bar-btn" title="添加附件" onClick={() => setMenu(menu === "attach" ? null : "attach")}>
          <Plus size={17} />
        </button>
        <div className="composer-inner">
          <textarea
            placeholder="输入任务，@ 引用 · / 命令"
            rows={1}
            value={text}
            onChange={(e) => { setText(e.target.value); autoGrow(e.target); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          {menu && (
            <ActionMenu
              rows={filtered}
              query={query}
              setQuery={setQuery}
              active={active}
              setActive={setActive}
              onRun={(r) => r.run()}
              align={menu === "attach" ? "left" : "right"}
            />
          )}
          {running ? (
            <button
              className="send-btn stop"
              title="停止"
              onClick={() => sessionId && void api.cancel({ sessionId }).catch(() => void 0)}
            >
              <Square size={15} fill="currentColor" />
            </button>
          ) : text.trim() ? (
            <button className="send-btn" title="发送" onClick={() => void submit()}>
              <ArrowUp size={16} />
            </button>
          ) : null}
        </div>
        <button className="bar-btn" title="命令" onClick={() => setMenu(menu === "command" ? null : "command")}>
          <Command size={17} />
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
    </div>
  );
}

// ---------- floating action menu (reference: large-radius glass sheet) ----------

function ActionMenu({
  rows, query, setQuery, active, setActive, onRun, align,
}: {
  rows: MenuRow[];
  query: string;
  setQuery: (v: string) => void;
  active: number;
  setActive: (i: number) => void;
  onRun: (r: MenuRow) => void;
  align: "left" | "right";
}) {
  const sections: Array<{ name: string; rows: MenuRow[] }> = [];
  for (const r of rows) {
    const last = sections[sections.length - 1];
    if (last && last.name === r.section) last.rows.push(r);
    else sections.push({ name: r.section, rows: [r] });
  }
  return (
    <div className={`action-menu ${align}`} onKeyDown={(e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(active + 1, rows.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
      if (e.key === "Enter") { e.preventDefault(); const r = rows[active]; if (r) onRun(r); }
    }}>
      <div className="action-sections">
        {sections.map((sec) => (
          <div key={sec.name}>
            {sec.rows.map((r) => {
              const idx = rows.indexOf(r);
              return (
                <button
                  key={r.id}
                  className={`action-row${idx === active ? " active" : ""}`}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => onRun(r)}
                >
                  <r.icon size={16} />
                  <span className="label">{r.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="action-search">
        <input
          autoFocus
          placeholder="搜索动作…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
    </div>
  );
}

function presetIcon(id: string): any {
  switch (id) {
    case "code": return Code;
    case "standard": return Sparkles;
    case "minimal": return Cpu;
    case "cordis": return NotebookPen;
    default: return Sparkles;
  }
}
