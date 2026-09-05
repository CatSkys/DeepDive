import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, Square, Plus, Mic } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { comboFor } from "../keybinds";
import { useT } from "../i18n";
import { useCompositionGuard } from "../useCompositionGuard";
import { Lightbox } from "./Lightbox";
import { ContextRing, hasContextData, type ContextData } from "./UsageMeter";
import type { PromptContentPart } from "../types";
import { useComposerDraft } from "./composer/useComposerDraft";
import { useComposerAttachments, type Attachment } from "./composer/useComposerAttachments";
import { useComposerDictation } from "./composer/useComposerDictation";
import { useComposerMenu, type MenuRow } from "./composer/useComposerMenu";
import { ComposerMenu } from "./composer/ComposerMenu";

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
 *
 * 编排：草稿持久化/附件摄入/听写/菜单行四个 hook 各管一事，
 * 本组件持键盘导航与发送（排队/插话）状态机。
 * ───────────────────────────────────────────────────────── */

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

export function Composer({ sessionId, onSent, ctx }: { sessionId: string | null; onSent?: () => void; ctx?: ContextData }) {
  const [dismissed, setDismissed] = useState(false);
  const [composing, setComposing] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  // 繁忙时 Enter 行为（settings ui-conversation ns，设置页同款；默认排队）
  const [busyEnter, setBusyEnter] = useState<"queue" | "steer">("queue");
  const [hasShell] = useState(() => !!window.webkit?.messageHandlers?.deepdiveHost);
  // 附件 chip 点击预览（Lightbox）
  const [preview, setPreview] = useState<Attachment | null>(null);
  // 中文输入法确认词的回车余波守卫（useCompositionGuard.ts 顶部注释）
  const ime = useCompositionGuard();
  const rootRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  /** textarea 光标位（@ grammar 的 cursorCol）；onSelect 跟随 caret 更新。 */
  const [cursor, setCursorState] = useState(0);
  const store = useStore();
  const { t, tt } = useT();
  const running = sessionId ? (store.sessions.find((x) => x.sessionId === sessionId)?.running ?? false) : false;

  const { text, setText, draftKey } = useComposerDraft(sessionId, store.activeWorkspaceId);
  const { attachments, setAttachments, addAttachments, addImageFile, dragOver, fileRef, onFile } =
    useComposerAttachments({ setText, hasShell });
  // 听写 final 落稿后回焦并按新内容重新长高（原 dictation 订阅内的 rAF）
  const refocusDraft = () => requestAnimationFrame(() => {
    if (taRef.current) autoGrow(taRef.current);
    taRef.current?.focus();
  });
  const { listening, partial, toggleDictation } = useComposerDictation({ setText, refocus: refocusDraft });
  const { menu, query, rows } = useComposerMenu({ text, cursor, dismissed, composing, sessionId, setText });

  useEffect(() => {
    api.settingsDescribe().then((d) => {
      const ns = (d.namespaces ?? []).find((n) => n.ns === "ui-conversation");
      const v = (ns?.value as { busyEnter?: string } | null)?.busyEnter;
      if (v === "steer" || v === "queue") setBusyEnter(v);
    }).catch(() => void 0); // engine booting: keep default
  }, []);

  // ---------- prompt assembly ----------

  const content = useMemo(() => {
    const parts: PromptContentPart[] = [];
    for (const a of attachments) parts.push({ type: "image", mediaType: a.mediaType, data: a.data, name: a.name });
    if (text.trim()) parts.push({ type: "text", text: text.trim() });
    return parts;
  }, [attachments, text]);

  // ---------- 发送 / 排队 / 插话 ----------

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
      } catch { /* 发送失败：解除 busy、输入保留供重试（不弹错） */ setBusy(false); return; }
    } else {
      try {
        await api.prompt({ sessionId, mode, content });
      } catch { /* 发送失败：解除 busy、输入保留供重试（不弹错） */ setBusy(false); return; }
    }
    setText("");
    setAttachments([]);
    if (draftKey) localStorage.removeItem(draftKey);
    setBusy(false);
    onSent?.();
  };

  useEffect(() => setActive(0), [menu, query]);

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
            <span key={a.id} className="chip att-chip" onClick={() => setPreview(a)} data-tip={a.name}>
              <img className="att-chip-thumb" src={`data:${a.mediaType};base64,${a.data}`} alt={a.name} />
              <button onClick={(e) => { e.stopPropagation(); setAttachments((prev) => prev.filter((_, j) => j !== i)); }}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className={`composer${wide ? " wide" : ""}${showCtx ? " has-ctx" : ""}`}>
        {menu && (
          <ComposerMenu menu={menu} query={query} rows={rows} active={active} setActive={setActive} onPick={pick} />
        )}
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
            onClick={() => sessionId && void api.cancel({ sessionId }).catch(() => void 0) /* 停止请求失败：吞掉不弹错，运行态随事件流收敛 */}
          >
            <Square size={13} fill="currentColor" />
          </button>
        ) : canSend ? (
          <button type="button" className="composer-send" data-tip={t("发送")} data-tip-keys="Enter" onClick={() => void submit()}>
            <ArrowUp size={15} strokeWidth={2.4} />
          </button>
        ) : hasShell ? (
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
