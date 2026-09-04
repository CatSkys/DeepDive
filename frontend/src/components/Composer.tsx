import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp, Square, Plus, Mic, MessageSquare,
  ClipboardList, File as FileIcon, Folder, Route, ShieldCheck, Shrink, TerminalSquare, type LucideIcon,
} from "lucide-react";
import { api } from "../api";
import { onHostEvent, sendToShell, pickAttachments, type PickedAttachment } from "../host";
import { useStore } from "../store";
import { comboFor } from "../keybinds";
import { useT, t as globalT } from "../i18n";
import { activeAtToken, formatMention } from "../atGrammar";
import { useAtCandidates } from "../useAtCandidates";
import { useCompositionGuard } from "../useCompositionGuard";
import { SLASH_COMMANDS } from "../commands";
import { sessionMentionCandidates } from "../session/sessionMention";
import { Lightbox } from "./Lightbox";
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
  /** 当前引擎不可用（命令通道未开放）：禁用态呈现，点击明示原因。 */
  disabled?: boolean;
  section: string;
  run: () => void;
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
  const [dismissed, setDismissed] = useState(false);
  const [composing, setComposing] = useState(false);
  const [active, setActive] = useState(0);
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // 繁忙时 Enter 行为（settings ui-conversation ns，设置页同款；默认排队）
  const [busyEnter, setBusyEnter] = useState<"queue" | "steer">("queue");
  // 听写（壳端 SFSpeechRecognizer）：partial 进 placeholder，final 落入草稿。
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const [hasShell] = useState(() => !!window.webkit?.messageHandlers?.deepdiveHost);
  // 拖拽附件：窗口级监听（会话界面任意处），非 composer 局部
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  // 附件 chip 点击预览（Lightbox）
  const [preview, setPreview] = useState<Attachment | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 中文输入法确认词的回车余波守卫（useCompositionGuard.ts 顶部注释）
  const ime = useCompositionGuard();
  const rootRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  /** textarea 光标位（@ grammar 的 cursorCol）；onSelect 跟随 caret 更新。 */
  const [cursor, setCursorState] = useState(0);
  const store = useStore();
  const { t, tt, lang } = useT();
  const running = sessionId ? (store.sessions.find((x) => x.sessionId === sessionId)?.running ?? false) : false;
  // @ 引用候选：工作空间根目录（无空间面时退化为不提供候选）
  const wsPath = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId)?.path;

  useEffect(() => {
    api.settingsDescribe().then((d) => {
      const ns = (d.namespaces ?? []).find((n) => n.ns === "ui-conversation");
      const v = (ns?.value as { busyEnter?: string } | null)?.busyEnter;
      if (v === "steer" || v === "queue") setBusyEnter(v);
    }).catch(() => void 0); // engine booting: keep default
  }, []);

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

  // 听写快捷键（快捷键页可改）：热键经全局事件转到本组件，状态机单一。
  useEffect(() => {
    const onToggle = () => toggleDictation();
    window.addEventListener("dd:dictation-toggle", onToggle);
    return () => window.removeEventListener("dd:dictation-toggle", onToggle);
  });

  // ---------- prompt assembly ----------

  const content = useMemo(() => {
    const parts: PromptContentPart[] = [];
    for (const a of attachments) parts.push({ type: "image", mediaType: a.mediaType, data: a.data, name: a.name });
    if (text.trim()) parts.push({ type: "text", text: text.trim() });
    return parts;
  }, [attachments, text]);

  // ---------- 草稿持久化（按会话；空稿清除）----------
  // 草稿页（sessionId=null）按工作空间存：新会话页上打的字切走再回来不丢
  // （旧模型每个"新建会话"都是真会话、草稿天然有家；草稿化后 hero 是唯一落点）。
  const draftKey = sessionId
    ? `deepdive.draft.${sessionId}`
    : store.activeWorkspaceId
      ? `deepdive.draft.hero.${store.activeWorkspaceId}`
      : null;
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

  // ---------- 附件摄入（＋ 选择器 / 拖拽 / ⌘V 共用） ----------

  // rc.2 prompt 面只收图片字节附件（PromptContentPart = text|image，imageLimits
  // 准入）；其余文件/文件夹没有上传通道，走 @ 引用（引擎宿主侧读盘，
  // DSH-WIRE §5）——即原生的"传文件"方式，不造假上传入口。
  const IMAGE_MIME: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  };

  /** 路径 → 自闭合的 @ 引用（目录带引号时 formatMention 保持开引用供续层，
   *  选择器/拖拽插入的是完整引用，补收引号）。 */
  const mentionOf = (path: string, isDir: boolean): string | undefined => {
    const m = formatMention({ path, kind: isDir ? "directory" : "file" }, false);
    if (m === undefined) return undefined;
    return m.startsWith(`@"`) && !m.endsWith(`"`) ? `${m}"` : m;
  };

  const appendMentions = (mentions: string[]) => {
    setText((cur) => (cur && !/\s$/.test(cur) ? `${cur} ` : cur) + `${mentions.join(" ")} `);
  };

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

  /** 壳选择器结果：图片→字节 chip，其余→@ 引用。 */
  const ingestPicked = (items: PickedAttachment[]) => {
    const chips: Attachment[] = [];
    const mentions: string[] = [];
    for (const it of items) {
      const mime = IMAGE_MIME[it.name.split(".").pop()?.toLowerCase() ?? ""];
      if (it.isImage && it.base64 && mime) {
        chips.push({ data: it.base64, mediaType: mime, name: it.name });
      } else {
        const m = mentionOf(it.path, it.isDir);
        if (m) mentions.push(m);
      }
    }
    if (chips.length > 0) setAttachments((prev) => [...prev, ...chips]);
    if (mentions.length > 0) appendMentions(mentions);
  };

  /** ＋＝上传附件：壳内 NSOpenPanel（文件+文件夹多选）；纯浏览器降级为
   *  图片选择 input（无路径可引用，非图片明示不可为）。 */
  const addAttachments = () => {
    if (hasShell) {
      void pickAttachments().then((items) => { if (items) ingestPicked(items); });
    } else {
      fileRef.current?.click();
    }
  };

  // 拖拽：窗口级监听——会话界面任意处拖入文件都出虚线框提示；图片收字节
  // chip，其余经 WebKit public.file-url 拿路径转 @ 引用（纯浏览器拿不到
  // 路径，明示不可为）。depth 计数对抗子元素边界的 enter/leave 抖动。
  useEffect(() => {
    const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onDragEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragOver(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (dragDepth.current > 0) e.preventDefault();
    };
    const onDragLeave = () => {
      if (dragDepth.current === 0) return;
      dragDepth.current -= 1;
      if (dragDepth.current === 0) setDragOver(false);
    };
    const fileUrls = (dt: DataTransfer) => new Promise<string[]>((resolve) => {
      const items = Array.from(dt.items).filter((i) => i.kind === "file" && i.type === "public.file-url");
      const out: string[] = [];
      let pending = items.length;
      if (pending === 0) { resolve(out); return; }
      for (const item of items) {
        item.getAsString((s) => {
          if (s?.startsWith("file://")) out.push(decodeURIComponent(s.replace(/^file:\/\//, "")));
          pending -= 1;
          if (pending === 0) resolve(out);
        });
      }
    });
    const onDrop = (e: DragEvent) => {
      dragDepth.current = 0;
      setDragOver(false);
      if (!isFileDrag(e)) return;
      e.preventDefault();
      const dt = e.dataTransfer;
      if (!dt) return;
      let nonImage = 0;
      let urlless = 0;
      for (const f of Array.from(dt.files)) {
        if (f.type.startsWith("image/")) addImageFile(f);
        else nonImage += 1;
      }
      void fileUrls(dt).then((urls) => {
        const mentions = urls.map((p) => mentionOf(p, p.endsWith("/") || !p.split("/").pop()?.includes("."))).filter((m): m is string => m !== undefined);
        if (mentions.length > 0) appendMentions(mentions);
        // WebKit 面非图片文件必带 public.file-url；缺 = 纯浏览器环境
        urlless = nonImage - mentions.length;
        if (urlless > 0) {
          alert(tt("浏览器环境无法引用本地文件，请在桌面端使用", "Local file references need the desktop app"));
        }
      });
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 摄入函数按当前渲染闭包工作，与听写订阅同款
  }, []);

  // ---------- menu rows ----------

  // token 派生：@ 用官方 grammar（光标位置），/ 保持行尾判定。
  const atTok = dismissed || composing ? undefined : activeAtToken(text, cursor);
  const slashTok = dismissed || composing ? null : parseSlashToken(text);

  // 命令菜单对齐 DSH 原生五命令（docs/DSH-WIRE.md §4，引擎无 commands.list，
  // 目录静态内置）。rc.2 浏览器面只有 /goal 可客户端派发（goal.create RPC）；
  // 其余命令执行走宿主 commands/execute 通道，rc.2 不可达（DSH-WIRE §6 三门
  // 实证）——行以禁用态呈现、点击明示原因，通道开放后在各自的 run 换真派发。
  const CMD_ICONS: Record<string, LucideIcon> = {
    compact: Shrink,
    plan: Route,
    permission: ShieldCheck,
    feedback: ClipboardList,
  };
  const slashRows: MenuRow[] = SLASH_COMMANDS.map((cmd) => {
    if (cmd.name === "goal") {
      return {
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
      };
    }
    return {
      id: `cmd:${cmd.name}`,
      icon: CMD_ICONS[cmd.name] ?? TerminalSquare,
      label: `/${cmd.name}`,
      detail: [tt(cmd.zh, cmd.en), cmd.hint].filter(Boolean).join(" "),
      section: t("命令"),
      disabled: true,
      run: () =>
        alert(tt(
          `当前引擎版本不支持 /${cmd.name}，引擎升级开放命令通道后可用`,
          `/${cmd.name} is not available on this engine build yet`,
        )),
    };
  });

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

  // 会话引用（官方 @ 源的第二支：文件 + 会话合源）。插入规范 mention，
  // 宿主 pre-step 据此注入被引用会话的只读快照；quoted（目录续层）不出
  // 会话候选——与官方一致。
  const sessionDateFmt = useMemo(
    () => new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    }),
    [lang],
  );
  const sessionRows: MenuRow[] = (atTok && !atTok.quoted
    ? sessionMentionCandidates(store.sessions, sessionId, atTok.query, lang)
    : []
  ).map((c) => ({
    id: `ref-session:${c.sessionId}`,
    icon: MessageSquare,
    label: c.label,
    detail: sessionDateFmt.format(c.updatedAt ?? 0),
    section: tt("会话", "Sessions"),
    run: () => {
      if (!atTok) return;
      setText(text.slice(0, cursor - atTok.prefix.length) + c.mention);
    },
  }));

  const menu: "at" | "slash" | null = atTok
    ? "at"
    : slashTok
      ? "slash"
      : null;
  const query = menu === "slash" ? slashTok?.query ?? "" : "";
  const allRows = menu === "at" ? [...atRows, ...sessionRows] : slashRows;
  const rows = query ? allRows.filter((r) => r.label.toLowerCase().includes(query)) : allRows;

  useEffect(() => setActive(0), [menu, query]);

  // a single highlight glides to the active row instead of each row
  // toggling its own background (reference PromptBar)
  useLayoutEffect(() => {
    const el = rowRefs.current[active];
    if (el) {
      setRowBox({ top: el.offsetTop, height: el.offsetHeight });
      // 候选超限高内滚后，高亮行移出可视区时容器跟随（nearest 只滚必要距离）
      el.scrollIntoView({ block: "nearest" });
    }
  }, [menu, query, active, rows.length]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) addImageFile(file);
    e.target.value = "";
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const pick = (row: MenuRow) => {
    row.run();
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
            <span key={i} className="chip att-chip" onClick={() => setPreview(a)} title={a.name}>
              <img className="att-chip-thumb" src={`data:${a.mediaType};base64,${a.data}`} alt={a.name} />
              <button onClick={(e) => { e.stopPropagation(); setAttachments((prev) => prev.filter((_, j) => j !== i)); }}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className={`composer${wide ? " wide" : ""}${showCtx ? " has-ctx" : ""}`}>
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
                        data-disabled={r.disabled ? "true" : undefined}
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
              {rows.length === 0 && <div className="menu-empty">{tt("没有匹配「{q}」", "No matches for “{q}”", { q: query })}</div>}
            </div>
          );
        })()}
        <button
          type="button"
          className="composer-icon"
          data-tip={t("上传附件")}
          onClick={addAttachments}
        >
          <Plus size={16} strokeWidth={2} />
        </button>
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          placeholder={listening ? (partial || t("正在听写…")) : running ? t("继续输入以排队后续修改") : t("输入任务，@ 引用 · / 命令")}
          onChange={(e) => { setText(e.target.value); setCursorState(e.target.selectionStart ?? 0); setDismissed(false); autoGrow(e.target); }}
          onSelect={(e) => setCursorState(e.currentTarget.selectionStart ?? 0)}
          onCompositionStart={() => { ime.onCompositionStart(); setComposing(true); }}
          onCompositionEnd={(e) => { ime.onCompositionEnd(); setComposing(false); autoGrow(e.currentTarget); }}
          onPaste={(e) => {
            // 剪贴板图片按 macOS 惯例走 ⌘V（＋ 菜单不再设剪贴板项）；纯文本走默认粘贴
            const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
            if (files.length === 0) return;
            e.preventDefault();
            for (const f of files) addImageFile(f);
          }}
          onKeyDown={(e) => {
            if (ime.swallow(e)) return;
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
              if (menu) { e.preventDefault(); setDismissed(true); }
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
            data-tip={t("停止")}
            onClick={() => sessionId && void api.cancel({ sessionId }).catch(() => void 0)}
          >
            <Square size={13} fill="currentColor" />
          </button>
        ) : canSend ? (
          <button type="button" className="composer-send" data-tip={t("发送")} data-tip-keys="Enter" onClick={() => void submit()}>
            <ArrowUp size={15} strokeWidth={2.4} />
          </button>        ) : hasShell ? (
          <button
            type="button"
            className={`composer-mic${listening ? " live" : ""}`}
            data-tip={listening ? t("停止听写") : t("听写")}
            data-tip-keys={comboFor("dictation", store.keybinds)}
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
      {preview && (
        <Lightbox
          src={`data:${preview.mediaType};base64,${preview.data}`}
          alt={preview.name}
          onClose={() => setPreview(null)}
        />
      )}
      {dragOver && createPortal(
        // 会话界面级拖拽提示：虚线框 + 一句提示；pointer-events 放行事件，
        // enter/leave 计数与 drop 都由窗口级监听接管
        <div className="drop-overlay" aria-hidden>
          <div className="drop-frame">{tt("松开以添加附件", "Release to attach")}</div>
        </div>,
        document.body,
      )}
    </div>
  );
}
