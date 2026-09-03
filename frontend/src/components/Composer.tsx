import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp, Square, Plus, Mic, Image as ImageIcon, Clipboard, Sparkles,
  Code, NotebookPen, Cpu, File as FileIcon, Folder, TerminalSquare, type LucideIcon,
} from "lucide-react";
import { api } from "../api";
import { onHostEvent, sendToShell } from "../host";
import { useStore } from "../store";
import { useT, t as globalT } from "../i18n";
import { activeAtToken, formatMention } from "../atGrammar";
import { useAtCandidates } from "../useAtCandidates";
import { ContextRing, hasContextData, type ContextData } from "./UsageMeter";
import type { PromptContentPart } from "../types";

interface Attachment {
  data: string; // base64 (no prefix)
  mediaType: string;
  name: string;
}

interface MenuRow {
  id: string;
  icon: LucideIcon;
  label: string;
  /** 次要说明（命令描述/参数提示/路径），随行展示。 */
  detail?: string;
  section: string;
  run: () => void;
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

/** 旧式 parseToken 已由官方 activeAtToken grammar 取代（引号路径/空白触发）；
 *  斜杠触发保持整词行首/空白后判定，CJK 查询可过滤中文标签。
 *  /goal 特例：行首 "/goal [目标]" 整体保持斜杠上下文——菜单在输入目标时
 *  不消失，回车即客户端派发（goal.create）。 */
function parseSlashToken(text: string): { query: string; start: number } | null {
  const match = /(^|\s)\/([\w\u4e00-\u9fff-]*)$/.exec(text);
  if (match) return { query: match[2].toLowerCase(), start: match.index + match[1].length };
  const trimmed = text.replace(/^\s+/, "");
  if (/^\/goal(\s[\s\S]*)?$/.test(trimmed)) return { query: "goal", start: text.length - trimmed.length };
  return null;
}

/* ─────────────────────────────────────────────────────────
 * COMPOSER — single glass pill: [＋] [textarea] [容量圈] [发送]
 *
 * Menus are keyboard-first, no dedicated buttons: typing "@"
 * opens 附件/引用, typing "/" opens 命令; the ＋ button forces
 * the @ menu for discoverability. ↑↓ + Enter/Tab pick, Esc
 * dismisses until the next edit, click-outside closes. The
 * send control is always visible — tactile when it can send,
 * a stop button while the turn is running. 容量圈 hover 出弹层，
 * 无投影数据时不渲染也不占网格位。
 * ───────────────────────────────────────────────────────── */

export function Composer({ sessionId, onSent, ctx }: { sessionId: string | null; onSent?: () => void; ctx?: ContextData }) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [plusOpen, setPlusOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [composing, setComposing] = useState(false);
  const [active, setActive] = useState(0);
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(null);
  const [presets, setPresets] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  // 繁忙时 Enter 行为（settings ui-conversation ns，设置页同款；默认排队）
  const [busyEnter, setBusyEnter] = useState<"queue" | "steer">("queue");
  // 听写（壳端 SFSpeechRecognizer）：partial 进 placeholder，final 落入草稿。
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const [hasShell] = useState(() => !!window.webkit?.messageHandlers?.deepdiveHost);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  /** textarea 光标位（@ grammar 的 cursorCol）；onSelect 跟随 caret 更新。 */
  const [cursor, setCursorState] = useState(0);
  const store = useStore();
  const { t, tt } = useT();
  const running = sessionId ? (store.sessions.find((x) => x.sessionId === sessionId)?.running ?? false) : false;
  // @ 引用候选：工作空间根目录（无空间面时退化为不提供候选）
  const wsPath = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId)?.path;

  useEffect(() => {
    api.agentPresets().then((r) => setPresets(r?.presets ?? [])).catch(() => void 0);
    api.settingsDescribe().then((d) => {
      const ns = (d.namespaces ?? []).find((n) => n.ns === "ui-conversation");
      const v = (ns?.value as { busyEnter?: string } | null)?.busyEnter;
      if (v === "steer" || v === "queue") setBusyEnter(v);
    }).catch(() => void 0); // engine booting: keep default
  }, []);

  // clicking anywhere outside closes whatever menu is open
  useEffect(() => {
    if (!plusOpen) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) { setPlusOpen(false); setDismissed(true); }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [plusOpen]);

  // 听写事件：partial 进占位文案；final 拼接到草稿末尾；error 弹提示。
  // 模块级 globalT 读最新 currentLang（useT 的闭包随渲染重建，订阅只挂一次）。
  useEffect(() => onHostEvent((cmd, payload) => {
    const text = (payload as { text?: string } | undefined)?.text ?? "";
    if (cmd === "dictation-partial") {
      setListening(true);
      setPartial(text);
    } else if (cmd === "dictation-final") {
      setListening(false);
      setPartial("");
      setText((current) => (current.trim() ? `${current.trimEnd()} ${text}`.trim() : text));
      requestAnimationFrame(() => { if (taRef.current) autoGrow(taRef.current); taRef.current?.focus(); });
    } else if (cmd === "dictation-error") {
      setListening(false);
      setPartial("");
      alert(text || globalT("听写失败"));
    }
  }), []);

  const toggleDictation = () => {
    if (listening) {
      sendToShell({ type: "dictation-stop" });
      setListening(false);
      setPartial("");
    } else {
      setPartial("");
      setListening(true);
      sendToShell({ type: "dictation-start" });
    }
  };

  // ---------- prompt assembly ----------

  const content = useMemo(() => {
    const parts: PromptContentPart[] = [];
    for (const a of attachments) parts.push({ type: "image", mediaType: a.mediaType, data: a.data, name: a.name });
    if (text.trim()) parts.push({ type: "text", text: text.trim() });
    return parts;
  }, [attachments, text]);

  // ---------- 草稿持久化（按会话；空稿清除）----------
  const draftKey = sessionId ? `deepdive.draft.${sessionId}` : null;
  useEffect(() => {
    if (draftKey) setText(localStorage.getItem(draftKey) ?? "");
  }, [draftKey]);
  useEffect(() => {
    if (!draftKey) return;
    const timer = setTimeout(() => {
      if (text) localStorage.setItem(draftKey, text);
      else localStorage.removeItem(draftKey);
    }, 250);
    return () => clearTimeout(timer);
  }, [text, draftKey]);

  const submit = async (modeOverride?: "queue" | "steer") => {
    if (content.length === 0 || busy) return;
    setBusy(true);
    // 空闲会话两键等价（引擎直接开轮）；运行中按设置分流，修饰键取另一行为
    //（设置页文案："仅在智能体运行时生效;Cmd/Ctrl+Enter 使用另一行为"）。
    const mode = running
      ? (modeOverride ?? busyEnter)
      : "queue";
    if (sessionId === null) {
      const create = await store.createSession();
      if (!create) { setBusy(false); return; }
      try {
        await api.prompt({ sessionId: create, mode, content });
      } catch { setBusy(false); return; }
    } else {
      try {
        await api.prompt({ sessionId, mode, content });
      } catch { setBusy(false); return; }
    }
    setText("");
    setAttachments([]);
    if (draftKey) localStorage.removeItem(draftKey);
    setBusy(false);
    onSent?.();
  };

  // ---------- menu rows ----------

  const readClipboardImage = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        const buf = await blob.arrayBuffer();
        setAttachments((prev) => [...prev, { data: base64Of(buf), mediaType: type, name: "剪贴板" }]);
        break;
      }
    } catch { /* permission denied; ignore */ }
  };

  const attachRows: MenuRow[] = [
    { id: "image", icon: ImageIcon, label: t("图片…"), section: t("附件"), run: () => fileRef.current?.click() },
    { id: "clip-image", icon: Clipboard, label: t("剪贴板图片…"), section: t("附件"), run: () => void readClipboardImage() },
  ];

  // token 派生：@ 用官方 grammar（光标位置），/ 保持行尾判定。
  const atTok = dismissed || composing ? undefined : activeAtToken(text, cursor);
  const slashTok = dismissed || composing ? null : parseSlashToken(text);

  // 命令行（2.1）：rc.2 浏览器面不做斜杠命令派发（DSH-WIRE §4）——菜单只收
  // 客户端可派发的 /goal（goal.create RPC）；其余命令升 alpha.2 后恢复。
  const slashRows: MenuRow[] = [{
    id: "cmd:goal",
    icon: TerminalSquare,
    label: "/goal",
    detail: `${tt("设定/查看长任务的 Goal", "Set or view the goal for a long-running task")} ${tt("（输入目标后回车）", "(enter an objective then Enter)")}`,
    section: t("命令"),
    run: () => {
      if (!slashTok) return;
      const typed = text.slice(slashTok.start).trim();
      const objective = typed.replace(/^\/goal\b/i, "").trim();
      if (sessionId && objective) {
        void api.goalCreate({ sessionId, objective }).catch(() => void 0);
        setText("");
      } else {
        setText(text.slice(0, slashTok.start) + "/goal ");
      }
    },
  }];

  const atEntries = useAtCandidates(atTok && !atTok.quoted ? atTok.query : "", wsPath);
  const atRows: MenuRow[] = atEntries.map((e) => ({
    id: e.path,
    icon: e.isDir ? Folder : FileIcon,
    label: e.name,
    detail: e.path,
    section: t("引用"),
    run: () => {
      if (!atTok) return;
      const mention = formatMention({ path: e.path, kind: e.isDir ? "directory" : "file" }, atTok.quoted);
      if (mention === undefined) return;
      setText(text.slice(0, cursor - atTok.prefix.length) + mention);
    },
  }));

  const agentRows: MenuRow[] = [
    { id: "new", icon: Sparkles, label: t("新会话"), section: t("命令"), run: () => void store.createSession() },
    ...presets.map((p) => ({
      id: `preset:${p.id}`, icon: presetIcon(p.id), label: p.name, section: "Agents",
      run: () => void store.createSession(p.id),
    })),
  ];

  const menu: "attach" | "at" | "slash" | null = plusOpen
    ? "attach"
    : atTok
      ? "at"
      : slashTok
        ? "slash"
        : null;
  const query = menu === "slash" ? slashTok?.query ?? "" : "";
  const allRows = menu === "attach" ? attachRows : menu === "at" ? atRows : [...slashRows, ...agentRows];
  const rows = query ? allRows.filter((r) => r.label.toLowerCase().includes(query)) : allRows;

  useEffect(() => setActive(0), [menu, query]);

  // a single highlight glides to the active row instead of each row
  // toggling its own background (reference PromptBar)
  useLayoutEffect(() => {
    const el = rowRefs.current[active];
    if (el) setRowBox({ top: el.offsetTop, height: el.offsetHeight });
  }, [menu, query, active, rows.length]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) addImageFile(file);
    e.target.value = "";
  };

  /** 图片附件入列（文件选择/拖放共用）；非图片忽略——引擎 imageLimits
   *  只收 png/jpeg/webp/gif。 */
  const addImageFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataURL = String(reader.result);
      const comma = dataURL.indexOf(",");
      const mediaType = dataURL.slice(5, dataURL.indexOf(";"));
      setAttachments((prev) => [...prev, { data: dataURL.slice(comma + 1), mediaType, name: file.name }]);
    };
    reader.readAsDataURL(file);
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const pick = (row: MenuRow) => {
    row.run();
    if (plusOpen) { setPlusOpen(false); setDismissed(false); }
    taRef.current?.focus();
  };

  const canSend = content.length > 0 && !busy;
  const wide = text.includes("\n");
  const showCtx = hasContextData(ctx);
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
      <div
        className={`composer${wide ? " wide" : ""}${dragOver ? " drag-over" : ""}${showCtx ? " has-ctx" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          for (const f of Array.from(e.dataTransfer.files)) addImageFile(f);
        }}
      >
        {menu && (() => {
          // 分组渲染（参考图 3：小节标题 + 图标行），行索引取自过滤后的扁平列表
          const sections: Array<{ name: string; rows: MenuRow[] }> = [];
          for (const r of rows) {
            const last = sections[sections.length - 1];
            if (last && last.name === r.section) last.rows.push(r);
            else sections.push({ name: r.section, rows: [r] });
          }
          return (
            <div className="composer-menu" onMouseLeave={() => setRowBox(null)}>
              <span
                aria-hidden
                className="menu-glide"
                style={{ top: rowBox?.top ?? 0, height: rowBox?.height ?? 0, opacity: rowBox && rows.length > 0 ? 1 : 0 }}
              />
              {sections.map((sec) => (
                <div key={sec.name} className="menu-section">
                  <div className="menu-section-name">{sec.name}</div>
                  {sec.rows.map((r) => {
                    const i = rows.indexOf(r);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        ref={(el) => { rowRefs.current[i] = el; }}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => pick(r)}
                        className="menu-row"
                        title={r.detail}
                      >
                        <r.icon size={15} />
                        <span className="label">{r.label}</span>
                        {r.detail && <span className="menu-detail">{r.detail}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
              {rows.length === 0 && <div className="menu-empty">{tt(`没有匹配「${query}」`, `No matches for “${query}”`)}</div>}
            </div>
          );
        })()}
        <button
          type="button"
          className="composer-icon"
          title={t("添加附件（输入 @）")}
          aria-expanded={plusOpen}
          onClick={() => { setPlusOpen((v) => !v); setDismissed(false); taRef.current?.focus(); }}
        >
          <Plus size={16} strokeWidth={2} />
        </button>
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          placeholder={listening ? (partial || t("正在听写…")) : running ? t("继续输入以排队后续修改") : t("输入任务，@ 引用 · / 命令")}
          onChange={(e) => { setText(e.target.value); setCursorState(e.target.selectionStart ?? 0); setPlusOpen(false); setDismissed(false); autoGrow(e.target); }}
          onSelect={(e) => setCursorState(e.currentTarget.selectionStart ?? 0)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(e) => { setComposing(false); autoGrow(e.currentTarget); }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (menu && rows.length > 0) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setActive((current) => (current + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
                return;
              }
              if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                e.preventDefault();
                const r = rows[active];
                if (r) pick(r);
                return;
              }
            }
            if (e.key === "Escape") {
              if (menu) { e.preventDefault(); setPlusOpen(false); setDismissed(true); }
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              // 修饰键取另一行为：设置 queue 时 Cmd/Ctrl+Enter=steer，反之亦然
              const other = busyEnter === "queue" ? "steer" : "queue";
              void submit(e.metaKey || e.ctrlKey ? other : undefined);
            }
          }}
        />
        {/* 容量圈在右钮（发送/停止/听写）左侧，hover 出容量面板 */}
        {showCtx && <ContextRing ctx={ctx} />}
        {/* 右侧单槽位：空=听写 → 有内容=发送 → 运行中=停止（参考图 1-4） */}
        {running ? (
          <button
            type="button"
            className="composer-send stop"
            title={t("停止")}
            onClick={() => sessionId && void api.cancel({ sessionId }).catch(() => void 0)}
          >
            <Square size={13} fill="currentColor" />
          </button>
        ) : canSend ? (
          <button type="button" className="composer-send" title={t("发送")} onClick={() => void submit()}>
            <ArrowUp size={15} strokeWidth={2.4} />
          </button>        ) : hasShell ? (
          <button
            type="button"
            className={`composer-mic${listening ? " live" : ""}`}
            title={listening ? t("停止听写") : t("听写")}
            onClick={toggleDictation}
          >
            {listening ? (
              <span className="eq">
                {[0, 1, 2].map((i) => (
                  <span key={i} style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </span>
            ) : (
              <Mic size={15} strokeWidth={2} />
            )}
          </button>
        ) : null}
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
    </div>
  );
}

function presetIcon(id: string): LucideIcon {
  switch (id) {
    case "code": return Code;
    case "standard": return Sparkles;
    case "minimal": return Cpu;
    case "cordis": return NotebookPen;
    default: return Sparkles;
  }
}
