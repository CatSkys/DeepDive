import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, Square, Plus, Mic } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { comboFor } from "../keybinds";
import { inShell } from "../platform";
import { useT } from "../i18n";
import { useCompositionGuard } from "../useCompositionGuard";
import { Lightbox } from "./Lightbox";
import { alertDialog } from "./DialogHost";
import { ContextRing, hasContextData, type ContextData } from "./UsageMeter";
import type { CommandSubmitAttachment, PromptContentPart } from "../types";
import { classifyAttachmentRefusal, classifyAttachmentRefusalText, type AttachmentRefusalClass } from "../attachmentRefusal";
import type { RpcErrorFacts } from "../api";
import { useComposerDraft } from "./composer/useComposerDraft";
import { useComposerAttachments, type ImageAttachment } from "./composer/useComposerAttachments";
import { onHostEvent, screenshotCapture, selectionCapture, type PickedAttachment } from "../host";
import { DD_EVENTS, dispatchAppEvent } from "../events";
import { useComposerDictation } from "./composer/useComposerDictation";
import { useComposerMenu, type MenuRow } from "./composer/useComposerMenu";
import { useSlashCommands } from "./composer/useSlashCommands";
import { adjudicateSlashLine } from "../commandLine";
import { ComposerMenu } from "./composer/ComposerMenu";
import { ComposerPlusMenu, type PlusAction } from "./composer/ComposerPlusMenu";
import { EffortPicker, type EffortFace } from "./composer/EffortPicker";
import { FileIcon } from "../session/FileIcon";
import { fileMeta } from "./composer/fileMeta";
import { uuid } from "../uuid";

/* ─────────────────────────────────────────────────────────
 * COMPOSER — single glass pill: [＋] [textarea] [思考强度] [容量圈] [发送]
 *
 * 思考强度档位是输入框自己的控件（用户 2026-10-09 定稿：与模型选择分开，
 * 档位跟输入走、模型仍留头部）——数据经 effort prop 由调用方给，见
 * composer/EffortPicker.tsx。右侧三颗（档位/容量圈/发送·停止·听写）收在
 * 同一格 flex 簇里，宽态一起换行到底部行。
 *
 * Menus are keyboard-first: typing "@" opens 附件/引用, typing "/" opens 命令;
 * the ＋ button opens its own menu (截图 / 上传文件 / 添加文件夹… / 提及…, 照 Atd
 * 参考图 2026-10-13 定稿), whose 提及 row just types the "@" that opens the
 * mention menu. ↑↓ + Enter/Tab pick, Esc dismisses until the next edit,
 * click-outside closes. The
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

export function Composer({ sessionId, onSent, ctx, effort }: {
  sessionId: string | null;
  onSent?: () => void;
  ctx?: ContextData;
  /** 思考强度面（档位表 + 当前档 + 提交）：真会话来自 modelSelection 投影，
   *  草稿页来自 store.draftModel；模型没有档位元数据时档位胶囊不渲染。 */
  effort: EffortFace;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [composing, setComposing] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  /** 内容已折成两行以上（软换行也算）→ 卡片布局；清空回胶囊（见下方 useLayoutEffect） */
  const [multiline, setMultiline] = useState(false);
  /** 量测件宽度变化的计数（只用来重跑上面那条 useLayoutEffect） */
  const [widthTick, setWidthTick] = useState(0);
  // 繁忙时 Enter 行为（settings conversation ns，设置页同款；默认排队）
  const [busyEnter, setBusyEnter] = useState<"queue" | "steer">("queue");
  const [hasShell] = useState(() => inShell());
  // 附件 chip 点击预览（Lightbox；仅图片 chip）
  const [preview, setPreview] = useState<ImageAttachment | null>(null);
  // 中文输入法确认词的回车余波守卫（useCompositionGuard.ts 顶部注释）
  const ime = useCompositionGuard();
  const rootRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  /** 行数量测件（不绘制、不交互，只为读折行行数） */
  const probeRef = useRef<HTMLTextAreaElement>(null);
  /** textarea 光标位（@ grammar 的 cursorCol）；onSelect 跟随 caret 更新。 */
  const [cursor, setCursorState] = useState(0);
  const store = useStore();
  const { t, tt } = useT();
  const running = sessionId ? (store.sessions.find((x) => x.sessionId === sessionId)?.running ?? false) : false;

  const { text, setText, draftKey } = useComposerDraft(sessionId, store.activeWorkspaceId);
  const { attachments, setAttachments, addAttachments, ingestAttachments, addImageFile, uploadNow, stageImageAsFile, requeueFile, cancelUpload, firstUploadError, dragOver, fileRef, onFile } =
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
  //
  // 同一处判「是否多行」，单向铰链（2026-10-12 用户定稿）：
  //   胶囊 → 卡片：内容在**胶囊**文本列宽下折成两行以上（软换行也算）；
  //   卡片 → 胶囊：只认「清空」。
  // 行数必须用量测件（.composer-probe：同款只读 textarea，与输入框同格）读，
  // 不能拿输入框自己的 scrollHeight。铰链的两档门槛刻意不重叠：旧逻辑按**当前
  // 布局**的列宽判行数，临界文本在窄胶囊下折两行、在宽卡片下只有一行——每敲
  // 一键就在两套布局间翻转一次（输入时整框上下抽搐，用户报障），还会停在折行
  // 的胶囊上。改成进/出各认一个门槛后判定是 (text, 当前布局) 的纯函数，同段
  // 文本的二次翻转（#185 的探针 resize → widthTick 死循环）在结构上不可能，
  // 无需再钉任何「首次判定」。
  useLayoutEffect(() => {
    const el = taRef.current;
    const probe = probeRef.current;
    if (!el || !probe) return;
    const cs = getComputedStyle(probe);
    const rows = Math.round(
      (probe.scrollHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / parseFloat(cs.lineHeight),
    );
    // 翻转的这一轮只改布局：输入框宽度跟着布局变，高度必须等新宽度落地后再量。
    // 否则窄态量出的高度留着——框里多一条空行，再敲一个字才回落。
    if (!multiline && rows > 1) { setMultiline(true); return; }
    if (multiline && text.length === 0) { setMultiline(false); return; }
    autoGrow(el);
  }, [text, multiline, widthTick]);
  // 列宽变化（窗口缩放、容量圈进出）会移动折行点：量测件宽度一变就重跑上面那条。
  // 只认**宽度**：高度变化不移动折行点（#185 教训——探针盒高度抖动引发的计数
  // 重入是同步 setState 循环的燃料），宽度不变就不 tick。
  useEffect(() => {
    const probe = probeRef.current;
    if (!probe) return;
    let lastWidth = -1;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w === undefined || w === lastWidth) return;
      lastWidth = w;
      setWidthTick((t) => t + 1);
    });
    ro.observe(probe);
    return () => ro.disconnect();
  }, []);
  /** 把「模型条目不吃 inline 图片」的那批图片按通用文件原件重投：同一份字节走
   *  文件回执，内容不减、顺序不变（文本/文件部件原样保留）。有一张投不出去就整条
   *  返回 null——由调用方按失败处理（不静默）。 */
  const restageImages = async (sid: string, parts: PromptContentPart[]): Promise<PromptContentPart[] | null> => {
    const images = attachments.filter((a): a is ImageAttachment => a.kind === "image");
    if (images.length === 0) return null;
    const receipts = await Promise.all(images.map((a) => stageImageAsFile(sid, a)));
    if (receipts.some((r) => r === null)) return null;
    let next = 0;
    return parts.map((part): PromptContentPart => (part.type === "image" ? { type: "file", receiptId: receipts[next++]! } : part));
  };

  /** 文件回执在引擎侧失效（FILE_NOT_STAGED）时重传拿新回执：排掉旧文件部件，
   *  按重传顺序换成新的（字节一直留在 chip 上，见 useComposerAttachments）。 */
  const refreshFileReceipts = async (sid: string): Promise<string[] | null> => uploadNow(sid, true);

  /** 附件准入拒绝后的等效重投：判到图片类就把这批图片按通用文件原件投递（同一份
   *  字节走文件回执），判到文件类就重传拿新回执；内容与顺序都不变，发送不被打断。 */
  const redeliver = async (sid: string, parts: PromptContentPart[], reason: string | undefined): Promise<PromptContentPart[] | null> => {
    const cls = classifyAttachmentRefusal(reason);
    if (cls === "images") return restageImages(sid, parts);
    if (cls !== "files") return null;
    const receipts = await refreshFileReceipts(sid);
    if (receipts === null || receipts.length === 0) return null;
    let next = 0;
    return parts.map((part): PromptContentPart => (part.type === "file" && next < receipts.length ? { type: "file", receiptId: receipts[next++]! } : part));
  };

  /** 命令载荷同理：重投被拒的那一类附件，其它部件不动（判类由调用方给——
   *  抛错路径有 reason 码，error 结果路径只有引擎原文）。 */
  const redeliverCommand = async (
    sid: string, parts: CommandSubmitAttachment[], cls: AttachmentRefusalClass | undefined,
  ): Promise<CommandSubmitAttachment[] | null> => {
    if (cls === "images") return restageCommandImages(sid, parts);
    if (cls !== "files") return null;
    const receipts = await refreshFileReceipts(sid);
    if (receipts === null || receipts.length === 0) return null;
    let next = 0;
    return parts.map((part): CommandSubmitAttachment => (part.type === "file" && next < receipts.length ? { type: "file", receiptId: receipts[next++]! } : part));
  };

  /** 命令载荷：inline 图片部件换成文件回执，其它部件不动。 */
  const restageCommandImages = async (sid: string, parts: CommandSubmitAttachment[]): Promise<CommandSubmitAttachment[] | null> => {
    const images = attachments.filter((a): a is ImageAttachment => a.kind === "image");
    if (images.length === 0 || !parts.some((p) => p.type === "image")) return null;
    const receipts = await Promise.all(images.map((a) => stageImageAsFile(sid, a)));
    if (receipts.some((r) => r === null)) return null;
    let next = 0;
    return parts.map((part): CommandSubmitAttachment => (part.type === "image" ? { type: "file", receiptId: receipts[next++]! } : part));
  };

  /** 失败提示文案：优先引擎原文（带可读原因），没有就回落到通用一句。 */
  const failureText = (err: unknown, fallback: string) =>
    err instanceof Error && err.message ? err.message : fallback;

  /** 草稿页发消息要先有会话：建一条但**先不切过去**（store.createSession 的
   *  activate:false）。发送真正成功才切——建完即切的老路子一旦这轮发送失败，
   *  草稿与附件 chip 就随组件卸载没了，用户只剩一个空会话（用户报过）。
   *  建好的会话记在 ref 里复用：重试不会再建第二条。 */
  const pendingSessionRef = useRef<{ sessionId: string; workspaceId: string | null } | null>(null);
  const ensureSession = async (): Promise<string | null> => {
    if (sessionId) return sessionId;
    const pending = pendingSessionRef.current;
    if (pending && pending.workspaceId === store.activeWorkspaceId) return pending.sessionId;
    const created = await store.createSession({ activate: false });
    if (created === null) {
      void alertDialog({ message: tt("新建会话失败（引擎未就绪？），请稍后重试", "Could not create a session (engine not ready?); please retry") });
      return null;
    }
    pendingSessionRef.current = { sessionId: created, workspaceId: store.activeWorkspaceId };
    return created;
  };
  /** 发送成功：切进这条会话（草稿页建的那条），并清掉复用位。 */
  const enterSentSession = (sid: string) => {
    if (pendingSessionRef.current?.sessionId === sid) {
      pendingSessionRef.current = null;
      store.openSession(sid);
    }
  };
  /** 附件没传成时的说明：带上 chip 上的原话（引擎/桥的错误文本）。 */
  const uploadFailureText = () => {
    const why = firstUploadError();
    return tt(
      `附件没能上传${why ? `：${why}` : ""}，消息没有发出——请重试或删掉该附件后重发`,
      `Attachment upload failed${why ? `: ${why}` : ""}; nothing was sent — retry or remove the attachment`,
    );
  };
  // 引擎命令目录（0.1.2 commands/list）：菜单与 Enter 裁决共用一份；草稿页没有
  // agent，拿的是前端内建兜底车道（useSlashCommands）。
  const commands = useSlashCommands(sessionId);
  // 无参命令的菜单直发（useComposerMenu 的 run 归到这里）：commands/execute 按
  // agentId 派发，草稿页得先把会话建出来——与首条消息同一链路（建完即进该会话、
  // 草稿清除），会话内则直接用当前会话。
  const runCommand = async (name: string, start: number) => {
    let sid = sessionId;
    if (sid === null) {
      const created = await ensureSession();
      if (created === null) return; // 建会话失败已弹窗；草稿保留供重试
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
      enterSentSession(sid);
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

  // 迷你面板壳命令（quickPanelFocus/runQuickCommand）进输入框的两条通道：
  // 预填 = 整段替换（防抖照落草稿），聚焦 = 只拿键盘。输入框归 Composer 管，
  // 外部一律经 DD 事件进来（composerAppend 同款）；CustomEvent 只在窗口内
  // 走，主窗的 composer 不会被迷你面板的壳命令碰到。
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (typeof text !== "string" || !text) return;
      setText(text);
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      });
    };
    const onFocus = () => {
      requestAnimationFrame(() => taRef.current?.focus());
    };
    window.addEventListener(DD_EVENTS.composerPrefill, onPrefill);
    window.addEventListener(DD_EVENTS.composerFocus, onFocus);
    return () => {
      window.removeEventListener(DD_EVENTS.composerPrefill, onPrefill);
      window.removeEventListener(DD_EVENTS.composerFocus, onFocus);
    };
  }, [setText]);

  // ＋ 的二级菜单：截图 / 上传文件 / 添加文件夹… / 提及…（照 Atd 参考图，2026-10-13 用户定稿）
  const [plusOpen, setPlusOpen] = useState(false);
  const onPlusPick = (action: PlusAction) => {
    setPlusOpen(false);
    if (action === "screenshot") {
      void screenshotCapture().then((result) => {
        if (result.ok) { if (result.items.length > 0) ingestAttachments(result.items); return; }
        if (result.copied) { void alertDialog({ message: tt("截图已复制到剪贴板", "Screenshot copied to the clipboard") }); return; }
        if (result.cancelled) return; // 用户取消：正常收尾，不打扰
        if (result.error) void alertDialog({ message: result.error });
      });
      return;
    }
    if (action === "files" || action === "folders") { addAttachments(action); return; }
    // 提及：插入 "@" 交给既有的 @ 菜单（键盘优先那条路，本项只是它的一个入口）
    setText((prev) => `${prev}@`);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  // Esc 与点别处收起 ＋ 菜单（@/ 命令菜单由输入框自己管，这条只管 plusOpen）
  useEffect(() => {
    if (!plusOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPlusOpen(false); };
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest(".composer-anchor")) setPlusOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [plusOpen]);

  // 壳推来的截图与划词事件（全局截图热键、工具条上的「问 DeepDive」）：
  // 带 reqId 的截图是上面那次请求的应答，由 promise 消费，这里不重复摄入。
  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd === "screenshotCaptured") {
      const p = payload as { reqId?: string; items?: PickedAttachment[]; error?: string; copied?: boolean } | undefined;
      if (p?.reqId) return; // 有请求方的由那次 promise 处理
      if (p?.copied) { void alertDialog({ message: tt("截图已复制到剪贴板", "Screenshot copied to the clipboard") }); return; }
      if (p?.error) { void alertDialog({ message: p.error }); return; }
      ingestAttachments(p?.items ?? []);
      return;
    }
    if (cmd === "selectionAsk") {
      // 文字已在壳里暂存（面板抢焦点前读的）；这里读一次并引用进草稿。
      void selectionCapture().then((captured) => {
        if (!captured) {
          void alertDialog({
            message: tt("没有读到选中的文字（需在「辅助功能」里允许本应用）",
              "No selected text was read (allow this app under Accessibility)"),
          });
          return;
        }
        dispatchAppEvent(DD_EVENTS.composerPrefill, { text: captured.text });
      });
    }
  }), [ingestAttachments, tt]);

  // 发送行为偏好（busyEnter：排队/插话）存在引擎里。启动期引擎还没起（503）→
  // 就绪后补取一次：壳不再因引擎就绪重载整页 SPA，这类一次性取数得自己跟上。
  useEffect(() => {
    if (!store.engineUp) return;
    api.settingsDescribe().then((d) => {
      const ns = (d.namespaces ?? []).find((n) => n.ns === "conversation");
      const v = (ns?.value as { busyEnter?: string } | null)?.busyEnter;
      if (v === "steer" || v === "queue") setBusyEnter(v);
    }).catch(() => void 0); // engine booting: keep default
  }, [store.engineUp]);

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
      // 失败 chip 说真话：笼统的"还在上传中"会让一个永远不会完成的附件
      // 看着像在等（原因就在 chip 的 error 上，带出来）。
      const why = firstUploadError();
      void alertDialog({ message: why
        ? tt(`附件上传失败：${why}——重试或删除该附件后发送`, `Attachment upload failed: ${why} — retry or remove it, then send`)
        : tt("文件还在上传中，稍候再发送", "Files are still uploading; try again shortly") });
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
        const created = await ensureSession();
        if (created === null) { setBusy(false); return; }
        sid = created;
        // 草稿页的 pending 文件此刻才有会话可落：补传后并入载荷（与 prompt 路径同法）
        const receipts = await uploadNow(sid);
        if (receipts === null) {
          void alertDialog({ message: uploadFailureText() });
          setBusy(false); return;
        }
        submitted = [...submitted, ...receipts.map((r) => ({ type: "file" as const, receiptId: r }))];
      }
      const runLine = (parts: CommandSubmitAttachment[]) => api.commandExecute({ agentId: sid, line: decision.line, attachments: parts });
      // 附件被准入拒时**引擎不抛错**：它把失败包成一次成功 RPC 的 error 结果
      //（interaction/commands 的 settle），所以判类要看原文；抛错那条留给传输/其他
      // RPC 错误。两条路径都做一次等效重投，重投不成才报错（旧实现只在 catch 里
      // 重投，而准入拒绝永远走不到那儿——等于命令带附件永远发不出去）。
      let parts = submitted;
      let failure: string | null = null;
      for (let round = 0; round < 2 && failure === null; round += 1) {
        try {
          const res = await runLine(parts);
          if (res === undefined) {
            void alertDialog({ message: tt(`未知命令：/${decision.command.name}`, `Unknown command: /${decision.command.name}`) });
            setBusy(false); return;
          }
          if (res.result.kind !== "error") break; // 成功
          const retry = round === 0 ? await redeliverCommand(sid, parts, classifyAttachmentRefusalText(res.result.text)) : null;
          if (retry === null) failure = res.result.text;
          else parts = retry;
        } catch (err) {
          const facts = err as Error & RpcErrorFacts;
          const retry = round === 0 ? await redeliverCommand(sid, parts, classifyAttachmentRefusal(facts.reason)) : null;
          if (retry === null) failure = failureText(facts, tt("命令发送失败", "Failed to send command"));
          else parts = retry;
        }
      }
      if (failure !== null) {
        void alertDialog({ message: failure });
        setBusy(false); return; // 失败保留草稿与附件供修正（官方语义）
      }
      setText("");
      setAttachments([]);
      if (draftKey) localStorage.removeItem(draftKey);
      setBusy(false);
      enterSentSession(sid);
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
    const fromDraft = sid === null;
    if (sid === null) {
      const created = await ensureSession();
      if (created === null) { setBusy(false); return; }
      sid = created;
      // 草稿页的文件 chip 是 pending（无会话可传）：建好会话立即补传。
      const receipts = await uploadNow(sid);
      if (receipts === null) {
        void alertDialog({ message: uploadFailureText() });
        setBusy(false); return;
      }
      sendContent = [...content, ...receipts.map((r) => ({ type: "file" as const, receiptId: r }))];
    }
    const rpcId = uuid();
    try {
      await api.prompt({ requestId: rpcId, sessionId: sid, mode, content: sendContent });
    } catch (err) {
      // 引擎对「模型条目没声明图片能力」的会话会在准入处拒 inline 图片部件。用户定稿：
      // 附件与内容必须发出去，跟模型无关——所以不丢附件、不弹拒绝，改把这批图片按通用
      // 文件原件投递（同一份字节，走文件回执），原样重发一次。模型能不能看图是模型自己
      // 的事（它会自己说），我们只负责把东西送到。
      const facts = err as Error & RpcErrorFacts;
      const delivered = await redeliver(sid, sendContent, facts.reason);
      if (delivered === null) {
        void alertDialog({ message: failureText(facts, tt("发送失败，请重试", "Send failed; please retry")) });
        setBusy(false);
        return;
      }
      try {
        await api.prompt({ requestId: rpcId, sessionId: sid, mode, content: delivered });
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
    if (fromDraft) enterSentSession(sid);
    onSent?.();
  };

  useEffect(() => setActive(0), [menu, query]);

  const pick = (row: MenuRow) => {
    row.run();
    taRef.current?.focus();
  };

  const canSend = content.length > 0 && !busy && filesReady;
  const showCtx = hasContextData(ctx);
  return (
    <div className="composer-wrap" ref={rootRef}>
      {attachments.length > 0 && (
        <div className="composer-chips">
          {attachments.map((a, i) => (
            a.kind === "image" ? (
              <span key={a.id} className="att-chip" onClick={() => setPreview(a)}>
                <img className="att-chip-thumb" src={`data:${a.mediaType};base64,${a.data}`} alt={a.name} />
                <button className="att-chip-x" aria-label={t("删除")} onClick={(e) => { e.stopPropagation(); setAttachments((prev) => prev.filter((_, j) => j !== i)); }}>×</button>
              </span>
            ) : (
              <span key={a.id} className="att-chip file" data-status={a.status} data-tip={a.error}>
                {/* 名字不做悬浮注释（用户 2026-10-09 定稿：没必要）——chip 自己已经把名字
                    截断摆着了；只有失败原因还留着 tooltip，那是 chip 展不开的原话。
                    图标位与官方 FileCard 同款：**上传中换成转圈**，其余时候就是文件类型图标
                    （图标永远在，不会出现"前面那块不知道是什么"）；状态写在名字右边，
                    大小用与消息里那颗文件 chip 同一个 sizeText。 */}
                {a.status === "uploading"
                  ? <span className="att-file-spin" aria-hidden="true" />
                  : <FileIcon file={a.name} size={16} />}
                <span className="att-file-name">{a.name}</span>
                <span className={`att-file-meta${a.status === "error" ? " failed" : ""}`}>{fileMeta(a, t)}</span>
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
        {plusOpen && !menu && <ComposerPlusMenu onPick={onPlusPick} />}
        <div className={`composer${multiline ? " wide" : ""}`}>
          {/* 行数量测件：与输入框同款式的只读 textarea，零高度、不可见，占第 2 列
              （＝单行态文本列宽）。列宽与当前布局无关，所以行数判据不会抖。 */}
          <textarea ref={probeRef} className="composer-probe" readOnly tabIndex={-1} aria-hidden="true" value={text} />
          <button
            type="button"
            className="composer-icon"
            data-tip={t("添加")}
            aria-expanded={plusOpen}
            onClick={() => setPlusOpen((open) => !open)}
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
          {/* 右侧控件簇：思考强度胶囊（有档位的模型才有）→ 容量圈 → 单槽位
              （空=听写 → 有内容=发送 → 运行中=停止）。同一格一个 flex 行，
              宽态整簇换到底部行。 */}
          <div className="composer-actions">
            {effort.levels.length > 0 && <EffortPicker {...effort} />}
            {/* 容量圈 hover 出容量面板 */}
            {showCtx && <ContextRing ctx={ctx} />}
            {running ? (
              <button
                type="button"
                className="composer-send stop"
                data-tip={t("停止")}
                onClick={() => {
                  // 停止失败要说话：静默吞掉时用户会以为"点了没反应"，而引擎挂着
                  // 恰恰是最需要知道"停不下来"的时候（运行态仍随事件流收敛）。
                  if (!sessionId) return;
                  void api.cancel({ sessionId }).catch((err: unknown) => {
                    void alertDialog({ message: tt(`停止失败：${(err as Error).message}`, `Stop failed: ${(err as Error).message}`) });
                  });
                }}
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
