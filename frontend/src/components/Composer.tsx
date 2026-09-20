import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, Square, Plus, Mic, FileText } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { comboFor } from "../keybinds";
import { useT } from "../i18n";
import { useCompositionGuard } from "../useCompositionGuard";
import { Lightbox } from "./Lightbox";
import { alertDialog } from "./DialogHost";
import { ContextRing, hasContextData, type ContextData } from "./UsageMeter";
import type { CommandSubmitAttachment, PromptContentPart } from "../types";
import { classifyAttachmentRefusal, dropAttachmentParts } from "../attachmentRefusal";
import type { RpcErrorFacts } from "../api";
import { useComposerDraft } from "./composer/useComposerDraft";
import { useComposerAttachments, type ImageAttachment } from "./composer/useComposerAttachments";
import { DD_EVENTS } from "../events";
import { useComposerDictation } from "./composer/useComposerDictation";
import { useComposerMenu, type MenuRow } from "./composer/useComposerMenu";
import { useSlashCommands } from "./composer/useSlashCommands";
import { adjudicateSlashLine } from "../commandLine";
import { ComposerMenu } from "./composer/ComposerMenu";
import { uuid } from "../uuid";

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

export function Composer({ sessionId, onSent, ctx, variant, registerSending }: {
  sessionId: string | null;
  onSent?: () => void;
  ctx?: ContextData;
  /** 子会话（continuable）形态：发送路由 subagents/prompt（父会话身份）。 */
  variant?: { kind: "subagent"; parentSessionId: string };
  /** 排队发送后登记 rpcId（QueueDock 显示「发送中」直到快照观察到）。 */
  registerSending?: (rpcId: string) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [composing, setComposing] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  // 繁忙时 Enter 行为（settings ui-conversation ns，设置页同款；默认排队）
  const [busyEnter, setBusyEnter] = useState<"queue" | "steer">("queue");
  const [hasShell] = useState(() => !!window.webkit?.messageHandlers?.deepdiveHost);
  // 附件 chip 点击预览（Lightbox；仅图片 chip）
  const [preview, setPreview] = useState<ImageAttachment | null>(null);
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
  const { attachments, setAttachments, addAttachments, addImageFile, uploadNow, requeueFile, cancelUpload, dragOver, fileRef, onFile } =
    useComposerAttachments({ setText, hasShell, sessionId });
  // 听写 final 落稿后回焦（长高由 [text] 的 useLayoutEffect 统一负责）
  const refocusDraft = () => requestAnimationFrame(() => {
    taRef.current?.focus();
  });
  const { listening, partial, toggleDictation } = useComposerDictation({ setText, refocus: refocusDraft });
  // 高度与内容单向同步（"输入框突然不居中"的根因修复）：autoGrow 原先只挂在
  // 键盘 onChange/compositionEnd 上，非键盘路径（发送清空/草稿回填/听写落稿/
  // 菜单与"添加到当前任务"插入）改了 text 却残留旧 inline height——胶囊保持
  // 旧高度、单行内容顶在天花板。收敛为单一机制：text 任何来源变化都重算
  // （useLayoutEffect 避免 session 切换首帧闪错高度）。
  useLayoutEffect(() => {
    if (taRef.current) autoGrow(taRef.current);
  }, [text]);
  /** 失败提示文案：优先引擎原文（带可读原因），没有就回落到通用一句。 */
  const failureText = (err: unknown, fallback: string) =>
    err instanceof Error && err.message ? err.message : fallback;
  // 引擎命令目录（0.1.2 commands/list）：菜单与 Enter 裁决共用一份；草稿页没有
  // agent，拿的是前端内建兜底车道（useSlashCommands）。
  const commands = useSlashCommands(sessionId);
  // 无参命令的菜单直发（useComposerMenu 的 run 归到这里）：commands/execute 按
  // agentId 派发，草稿页得先把会话建出来——与首条消息同一链路（建完即进该会话、
  // 草稿清除），会话内则直接用当前会话。
  const runCommand = async (name: string, start: number) => {
    let sid = sessionId;
    if (sid === null) {
      const created = await store.createSession();
      if (created === null) return; // 建会话失败：草稿保留供重试（与发送同策略）
      sid = created;
      if (draftKey) localStorage.removeItem(draftKey);
    }
    try {
      const res = await api.commandExecute({ agentId: sid, line: `/${name}` });
      if (res === undefined) {
        void alertDialog({ message: tt(`未知命令：/${name}`, `Unknown command: /${name}`) });
        return;
      }
      if (res.result.kind === "error") {
        void alertDialog({ message: res.result.text });
        return;
      }
      setText((prev) => prev.slice(0, start));
    } catch {
      void alertDialog({ message: tt("命令发送失败", "Failed to send command") });
    }
  };
  const { menu, query, rows } = useComposerMenu({ text, cursor, dismissed, composing, sessionId, setText, commands, onRunCommand: runCommand });
  // 选中文字「添加到当前任务」（SelectionActions 派发）：追加到现有草稿尾部
  // （带空行分隔），光标落末尾并重新长高。
  useEffect(() => {
    const onAppend = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (!text) return;
      setText((prev) => (prev ? `${prev}\n${text}` : text));
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      });
    };
    window.addEventListener(DD_EVENTS.composerAppend, onAppend);
    return () => window.removeEventListener(DD_EVENTS.composerAppend, onAppend);
  }, [setText]);

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
    for (const a of attachments) {
      if (a.kind === "image") parts.push({ type: "image", mediaType: a.mediaType, data: a.data, name: a.name });
      else if (a.status === "ready" && a.receiptId) parts.push({ type: "file", receiptId: a.receiptId });
    }
    if (text.trim()) parts.push({ type: "text", text: text.trim() });
    return parts;
  }, [attachments, text]);

  /** 文件 chip 全部就绪才可发送（官方 sendSession 同款门槛）。草稿页的
   *  pending 例外——无会话可传，发送时先建会话补传（uploadNow）。 */
  const filesReady = attachments.every((a) =>
    a.kind !== "file" || a.status === "ready" || (sessionId === null && a.status === "pending"));

  // ---------- 发送 / 排队 / 插话 ----------

  const submit = async (modeOverride?: "queue" | "steer") => {
    if (content.length === 0 || busy) return;
    if (!filesReady) {
      void alertDialog({ message: tt("文件还在上传中，稍候再发送", "Files are still uploading; try again shortly") });
      return;
    }
    // 整行斜杠命令裁决（官方 matchEnter）：已知命令 → commands/execute 直发
    //（自驱效果，不经 session/prompt——prompt 无命令槽，斜杠文本只会喂给模型）。
    const decision = adjudicateSlashLine(text, commands);
    if (decision !== null) {
      if (decision.kind === "unknown") {
        void alertDialog({ message: tt(`未知命令：/${decision.name}`, `Unknown command: /${decision.name}`) });
        return; // 草稿保留供修正（官方语义：不静默发给模型）
      }
      // 附件随命令走：引擎声明了 input.attachments 才收（图片直传字节、文件走
      // receiptId，同一条声明管两种）。声明了但被引擎的附件准入拒（模型不吃图等）
      // 时照样执行——附件是附件的事，不让它把命令挡死（见下方 catch）。
      if (attachments.length > 0 && !decision.command.input?.attachments) {
        void alertDialog({ message: tt("该命令不支持附件，请随普通消息发送", "This command does not accept attachments; send them with a normal message") });
        return;
      }
      setBusy(true);
      let sid = sessionId;
      let submitted: CommandSubmitAttachment[] = [];
      for (const a of attachments) {
        if (a.kind === "image") submitted.push({ type: "image", mediaType: a.mediaType, data: a.data, name: a.name });
        else if (a.status === "ready" && a.receiptId) submitted.push({ type: "file", receiptId: a.receiptId });
      }
      if (sid === null) {
        const create = await store.createSession();
        if (!create) { setBusy(false); return; }
        sid = create;
        // 草稿页的 pending 文件此刻才有会话可落：补传后并入载荷（与 prompt 路径同法）
        const receipts = await uploadNow(sid);
        if (receipts === null) { setBusy(false); return; }
        submitted = [...submitted, ...receipts.map((r) => ({ type: "file" as const, receiptId: r }))];
      }
      const runLine = (parts: CommandSubmitAttachment[]) => api.commandExecute({ agentId: sid, line: decision.line, attachments: parts });
      try {
        const res = await runLine(submitted);
        if (res === undefined) {
          void alertDialog({ message: tt(`未知命令：/${decision.command.name}`, `Unknown command: /${decision.command.name}`) });
          setBusy(false); return;
        }
        if (res.result.kind === "error") {
          void alertDialog({ message: res.result.text });
          setBusy(false); return; // 失败保留草稿与附件供修正（官方语义）
        }
      } catch (err) {
        // 附件准入拒了整条命令，但否掉的只是附件：去掉附件照样执行，并说明
        const facts = err as Error & RpcErrorFacts;
        if (submitted.length === 0 || classifyAttachmentRefusal(facts.reason) === undefined) {
          void alertDialog({ message: failureText(facts, tt("命令发送失败", "Failed to send command")) });
          setBusy(false); return; // 失败保留草稿与附件供修正（官方语义）
        }
        try {
          const res = await runLine([]);
          if (res !== undefined && res.result.kind === "error") {
            void alertDialog({ message: res.result.text });
            setBusy(false); return;
          }
          void alertDialog({ message: tt("附件未随本条命令发送（{r}）", "Attachments were not sent with this command ({r})", { r: facts.engineMessage ?? facts.message }) });
        } catch (err2) {
          void alertDialog({ message: failureText(err2, tt("命令发送失败", "Failed to send command")) });
          setBusy(false); return;
        }
      }
      setText("");
      setAttachments([]);
      if (draftKey) localStorage.removeItem(draftKey);
      setBusy(false);
      onSent?.();
      return;
    }
    setBusy(true);
    // 空闲会话两键等价（引擎直接开轮）；运行中按设置分流，修饰键取另一行为
    //（设置页文案："仅在智能体运行时生效;Cmd/Ctrl+Enter 使用另一行为"）。
    const mode = running
      ? (modeOverride ?? busyEnter)
      : "queue";
    let sid = sessionId;
    // 发送载荷：content 是本轮渲染的快照，草稿页补传产生的回执不在其中，
    // 需显式并入（否则文件传了消息里却没有）。
    let sendContent = content;
    if (sid === null) {
      const create = await store.createSession();
      if (!create) { setBusy(false); return; }
      sid = create;
      // 草稿页的文件 chip 是 pending（无会话可传）：建好会话立即补传。
      const receipts = await uploadNow(sid);
      if (receipts === null) { setBusy(false); return; }
      sendContent = [...content, ...receipts.map((r) => ({ type: "file" as const, receiptId: r }))];
    }
    // 子会话（continuable）走 subagents/prompt：content 只收文本/图片。
    const subagent = variant?.kind === "subagent" ? variant : undefined;
    if (subagent && attachments.some((a) => a.kind === "file")) {
      void alertDialog({ message: tt("子会话不支持文件附件", "File attachments are not supported in subagent sessions") });
      setBusy(false); return;
    }
    const rpcId = uuid();
    const send = (parts: PromptContentPart[]) => (subagent
      ? api.subagentPrompt({
        requestId: rpcId,
        parentSessionId: subagent.parentSessionId,
        childSessionId: sid,
        delivery: running ? mode : "queue",
        content: parts,
      })
      : api.prompt({ requestId: rpcId, sessionId: sid, mode, content: parts }));
    try {
      await send(sendContent);
      if (running || mode === "queue") registerSending?.(rpcId);
    } catch (err) {
      // 附件被引擎的附件准入拒（模型不吃图、图片太大、文件没传完…）时，消息照样发：
      // 丢掉被拒的那一类部件重发一次，正文保留（用户定稿：模型支不支持附件是模型的
      // 事，不该让准入把整条消息挡死），并如实说明丢的是什么。其余失败照常报错——
      // 静默吞掉会把「消息没发出去」伪装成「发成功了但会话是空的」（2026-09-20 报障真因）。
      const facts = err as Error & RpcErrorFacts;
      const drop = classifyAttachmentRefusal(facts.reason);
      const reduced = drop === undefined ? null : dropAttachmentParts(sendContent, drop);
      if (reduced === null) {
        void alertDialog({ message: failureText(facts, tt("发送失败，请重试", "Send failed; please retry")) });
        setBusy(false);
        return;
      }
      try {
        await send(reduced);
        if (running || mode === "queue") registerSending?.(rpcId);
        void alertDialog({
          message: tt("{k}未随本条发送（{r}），消息已按纯文本发出", "{k} were not sent with this message ({r}); it was sent as text", {
            k: drop === "images" ? tt("图片", "Images") : tt("附件", "Attachments"),
            r: facts.engineMessage ?? facts.message,
          }),
        });
      } catch (err2) {
        void alertDialog({ message: failureText(err2, tt("发送失败，请重试", "Send failed; please retry")) });
        setBusy(false);
        return;
      }
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

  const canSend = content.length > 0 && !busy && filesReady;
  const wide = text.includes("\n");
  const showCtx = hasContextData(ctx);
  return (
    <div className="composer-wrap" ref={rootRef}>
      {attachments.length > 0 && (
        <div className="composer-chips">
          {attachments.map((a, i) => (
            a.kind === "image" ? (
              <span key={a.id} className="att-chip" onClick={() => setPreview(a)} data-tip={a.name}>
                <img className="att-chip-thumb" src={`data:${a.mediaType};base64,${a.data}`} alt={a.name} />
                <button className="att-chip-x" aria-label={t("删除")} onClick={(e) => { e.stopPropagation(); setAttachments((prev) => prev.filter((_, j) => j !== i)); }}>×</button>
              </span>
            ) : (
              <span key={a.id} className="att-chip file" data-status={a.status} data-tip={a.error ?? a.name}>
                {a.status === "uploading" || a.status === "pending"
                  ? <span className="att-file-progress" data-tip={a.progress !== undefined ? `${a.progress}%` : undefined}>{a.progress ?? undefined}%{a.progress === undefined && <span className="att-file-spin" aria-hidden="true" />}</span>
                  : <FileText size={14} />}
                <span className="att-file-name">{a.name}</span>
                {a.status === "uploading" && <button className="att-file-retry" aria-label={t("取消上传")} onClick={(e) => { e.stopPropagation(); cancelUpload(a.id); }}>{t("取消")}</button>}
                {a.status === "error" && <button className="att-file-retry" onClick={(e) => { e.stopPropagation(); if (sessionId) void uploadNow(sessionId); else requeueFile(a.id); }}>{t("重试")}</button>}
                <button className="att-chip-x" aria-label={t("删除")} onClick={(e) => { e.stopPropagation(); if (a.status === "uploading") cancelUpload(a.id); setAttachments((prev) => prev.filter((_, j) => j !== i)); }}>×</button>
              </span>
            )
          ))}
        </div>
      )}
      <div className="composer-anchor">
        {menu && (
          <ComposerMenu menu={menu} query={query} rows={rows} active={active} setActive={setActive} onPick={pick} />
        )}
        <div className={`composer${wide ? " wide" : ""}${showCtx ? " has-ctx" : ""}`}>
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
            onChange={(e) => { setText(e.target.value); setCursorState(e.target.selectionStart ?? 0); setDismissed(false); }}
            onSelect={(e) => setCursorState(e.currentTarget.selectionStart ?? 0)}
            onCompositionStart={() => { ime.onCompositionStart(); setComposing(true); }}
            onCompositionEnd={() => { ime.onCompositionEnd(); setComposing(false); }}
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
