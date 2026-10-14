import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { GlassLayer } from "./GlassLayer";
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
import { useComposerAttachments, type Attachment, type ImageAttachment } from "./composer/useComposerAttachments";
import { shotMessageContent, splitShotItems } from "./composer/shotMessage";
import { onHostEvent, screenshotCapture, selectionCapture, uploadAttachmentPath, type PickedAttachment } from "../host";
import { DD_EVENTS, dispatchAppEvent } from "../events";
import { useComposerDictation } from "./composer/useComposerDictation";
import { useComposerMenu, type MenuRow } from "./composer/useComposerMenu";
import { DraftEditor, type DraftEditorHandle, type EditorKeyRouting } from "./composer/editor/DraftEditor";

/** 刚删掉的附件在"回收站"里留几条（给 ⌘Z 用）：见 removeAttachment。 */
const REMOVED_KEEP = 8;
import { useSlashCommands } from "./composer/useSlashCommands";
import { adjudicateSlashLine } from "../commandLine";
import { ComposerMenu } from "./composer/ComposerMenu";
import { ComposerPlusMenu, type PlusAction } from "./composer/ComposerPlusMenu";
import { EffortPicker, type EffortFace } from "./composer/EffortPicker";
import { setAtomHost } from "./composer/editor/atomStore";
import { uuid } from "../uuid";
import { renderSelectionPrompt } from "../settings/selectionCommands";

/* ─────────────────────────────────────────────────────────
 * COMPOSER — single glass pill: [＋] [附件胶囊… 输入框] [思考强度] [容量圈] [发送]
 *
 * 附件在**输入框内部**：胶囊排在输入框前面（同一行，见 composer/AttachmentPill.tsx），
 * 不再另起一行摆在胶囊外面。媒体附件悬停出预览画面。
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
  // 繁忙时 Enter 行为（settings conversation ns，设置页同款；默认排队）
  const [busyEnter, setBusyEnter] = useState<"queue" | "steer">("queue");
  const [hasShell] = useState(() => inShell());
  // 附件 chip 点击预览（Lightbox；仅图片 chip）
  const [preview, setPreview] = useState<ImageAttachment | null>(null);
  // 中文输入法确认词的回车余波守卫（useCompositionGuard.ts 顶部注释）
  const ime = useCompositionGuard();
  const rootRef = useRef<HTMLDivElement>(null);
  /** 文本的真正持有者（CodeMirror 编辑器）；React 那份 text 只是它的镜像。 */
  const editorRef = useRef<DraftEditorHandle>(null);
  /** 刚删掉的附件留一小会儿（给 ⌘Z 用），上限 REMOVED_KEEP 条。 */
  const removed = useRef(new Map<string, Attachment>());
  /** textarea 光标位（@ grammar 的 cursorCol）；onSelect 跟随 caret 更新。 */
  const [cursor, setCursorState] = useState(0);
  const store = useStore();
  const { t, tt } = useT();
  const running = sessionId ? (store.sessions.find((x) => x.sessionId === sessionId)?.running ?? false) : false;

  /** 往草稿末尾追加一段（听写落稿、文件夹转 `@` 引用、菜单提及都走它）：
   *  编辑器按"有内容先补一个空格"接上——整篇替换会把正文里的附件原子抹掉。 */
  const appendText = useCallback((value: string) => { editorRef.current?.appendText(value); }, []);
  const { text, setText, draftKey } = useComposerDraft(
    sessionId, store.activeWorkspaceId,
    // 载入的草稿是整篇来源：编辑器文档一起换（正文里的附件原子随草稿丢，草稿只存文本）
    (loaded) => editorRef.current?.setText(loaded),
  );
  /** 刚摄入的附件：在光标处插一枚行内令牌（正文里就多了这颗胶囊）。 */
  const attachToDraft = useCallback((att: Attachment) => { editorRef.current?.insertAttachment(att.id); }, []);
  const { attachments, setAttachments, addAttachments, ingestAttachments, addImageFile, uploadNow, stageImageAsFile, requeueFile, cancelUpload, firstUploadError, dragOver, fileRef, onFile } =
    useComposerAttachments({ appendToDraft: appendText, onAdded: attachToDraft, hasShell, sessionId });
  // 听写 final 落稿后回焦（长高由 [text] 的 useLayoutEffect 统一负责）
  const refocusDraft = () => requestAnimationFrame(() => {
    editorRef.current?.focus();
  });
  const { listening, partial, toggleDictation } = useComposerDictation({ appendText, refocus: refocusDraft });
  // 高度与内容单向同步：编辑器（CodeMirror）自己按内容排版长高，没有手写的 inline
  // height 可残留；这一段只判「内容高过单行没有」，据此决定胶囊态还是展开态
  // （useLayoutEffect：session 切换首帧别闪错布局）。
  //
  // 同一处判「是否多行」，单向铰链（2026-10-12 用户定稿，2026-10-14 改判据）：
  //   胶囊 → 卡片：**内容**高过单行——读的就是文本列那一格的实测高度（先把编辑器
  //                按当前文本定好高，再看那一格有没有高出来）。文本折行、附件胶囊
  //                折行、编辑器被挤到下一行，三种都算；
  //   卡片 → 胶囊：只认「清空」（文本空且附件清空）。
  // 判据为什么是"那一格有多高"而不是"数几行字"：附件与文本同处一条流，"内容不止
  // 一行"有四种来源（文本折行 / 胶囊折行 / 胶囊把编辑器挤到下一行 / 空框占位符折行），
  // 逐个枚举必漏。旧实现数的是量测件里的文本行数，于是"空框 + 一颗长名附件"那条路径
  // 漏了：框长到两行高、＋ 与右簇仍按单行态垂直居中在框中间（用户 2026-10-14 截图
  // 报障）。Atd 同一条判据也是"内容高过一行就展开"（`data-expanded`），不是数行。
  // 进/出各认一个门槛、且**退出只认清空**（与旧实现同一条纪律）：判定在胶囊态的列宽下
  // 做，宽态只在清空时回退，所以临界内容不会在两套布局间来回翻转（#185 那次输入时整框
  // 上下抽搐的根因就是按当前布局反复重判）。
  /** 编辑器报的"内容高过一行没有"（它量自己的排版：折行、附件与文本都算）。
   *  进出两档门槛在下一条——判定量来自编辑器，不会跟着外层布局的宽窄来回翻转。 */
  const [tall, setTall] = useState(false);
  useLayoutEffect(() => {
    if (!multiline && tall) { setMultiline(true); return; }
    if (multiline && text.length === 0 && attachments.length === 0) setMultiline(false);
  }, [tall, multiline, text, attachments]);
  /** 把「模型条目不吃 inline 图片」的那批图片按通用文件原件重投：同一份字节走文件回执
   *  （内容不减、顺序不变）。返回 附件 id → 回执；任一张投不出去就整条 null——由调用方
   *  按失败处理（不静默）。载荷据这张表**整份重拼**，不再按位替换：附件落在正文哪个位置
   *  由文档说了算（见 buildContent）。 */
  const stageImagesAsFiles = async (sid: string): Promise<Map<string, string> | null> => {
    const images = attachments.filter((a): a is ImageAttachment => a.kind === "image");
    if (images.length === 0) return null;
    const staged = await Promise.all(images.map(async (a): Promise<[string, string | null]> => [a.id, await stageImageAsFile(sid, a)]));
    if (staged.some(([, receipt]) => receipt === null)) return null;
    return new Map(staged.map(([id, receipt]) => [id, receipt!]));
  };

  /** 文件回执在引擎侧失效（FILE_NOT_STAGED）时重传拿新回执：**按附件 id** 收（字节一直留在
   *  胶囊上，见 useComposerAttachments），载荷据它重拼。 */
  const refreshFileReceipts = async (sid: string): Promise<Map<string, string> | null> => {
    const receipts = await uploadNow(sid, true);
    return receipts === null ? null : new Map(receipts.map((r) => [r.id, r.receiptId]));
  };


  /** 附件从正文里没了（用户退格删掉 / 删掉含它的整段 / 点胶囊上的 ×）→ 从集合里摘掉。
   *  **正文是唯一的账本**：谁在正文里就留着，谁不在了就扔（上传中的先取消）。 */
  const removeAttachment = (id: string) => {
    const att = attachments.find((a) => a.id === id);
    if (att === undefined) return;
    if (att.kind === "file" && att.status === "uploading") cancelUpload(id);
    // 留一小会儿（上限 REMOVED_KEEP 条）：⌘Z 把令牌救回来时胶囊还画得出来。附件带字节，
    // 不能一直留着（Atd 的 chip 表可以只增不删是因为它存的是 id，我们这里存的是字节）。
    removed.current.set(id, att);
    while (removed.current.size > REMOVED_KEEP) {
      const oldest = removed.current.keys().next().value;
      if (oldest === undefined) break;
      removed.current.delete(oldest);
    }
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  /** 失败那颗胶囊上的「重试」：会话内直接重传（同一条链会把其余未就绪的也补上）；
   *  草稿页没有会话可传，回 pending 等发送时建会话补传。 */
  const retryAttachment = useCallback((id: string) => {
    if (sessionId) void uploadNow(sessionId);
    else requeueFile(id);
  }, [sessionId, uploadNow, requeueFile]);

  /** 附件原子的接线：每次提交后推最新值（widget 是独立 React 根，靠订阅拿数据）。
   *  查附件时连"刚删掉那一小会儿"的一起查——⌘Z 救回令牌时胶囊要能接着画。 */
  useLayoutEffect(() => {
    setAtomHost({
      t,
      attachment: (id) => attachments.find((a) => a.id === id) ?? removed.current.get(id),
      onRemove: (id) => editorRef.current?.removeAttachment(id),
      onRetry: retryAttachment,
      onOpenImage: setPreview,
    });
  }, [attachments, retryAttachment, t]);


  /** 附件准入拒绝后的等效重投：判到图片类就把这批图片按通用文件原件投递（同一份字节走
   *  文件回执），判到文件类就重传拿新回执——两种情况都**整份重拼**载荷（附件在正文里的
   *  位置由文档决定，按位替换是把位置当成了数组下标，正文里插过附件就对不上了）。 */
  const redeliver = async (sid: string, reason: string | undefined): Promise<PromptContentPart[] | null> => {
    const cls = classifyAttachmentRefusal(reason);
    if (cls === "images") {
      const staged = await stageImagesAsFiles(sid);
      return staged === null ? null : buildContent(staged, true);
    }
    if (cls !== "files") return null;
    const receipts = await refreshFileReceipts(sid);
    return receipts === null ? null : buildContent(receipts);
  };

  /** 命令载荷同理（判类由调用方给——抛错路径有 reason 码，error 结果路径只有引擎原文）。 */
  const redeliverCommand = async (
    sid: string, cls: AttachmentRefusalClass | undefined,
  ): Promise<CommandSubmitAttachment[] | null> => {
    if (cls === "images") {
      const staged = await stageImagesAsFiles(sid);
      return staged === null ? null : buildCommandAttachments(staged, true);
    }
    if (cls !== "files") return null;
    const receipts = await refreshFileReceipts(sid);
    return receipts === null ? null : buildCommandAttachments(receipts);
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
  /** 划词命令：把渲染好的提示词当一条消息发出去。有意不走 `submit`——那条链读的是
   *  输入框里的草稿（`text` 与附件），而命令的正文不归输入框持有：用户可能正打到一半，
   *  不能被命令清掉，命令也不该把别人的草稿当自己的内容。这里只用同几个原语：
   *  草稿页先建会话、发送、进会话（草稿留在 localStorage，不清）。 */
  const sendPromptText = async (body: string) => {
    let sid = sessionId;
    const fromDraft = sid === null;
    if (sid === null) {
      const created = await ensureSession();
      if (created === null) return; // 建会话失败已弹窗
      sid = created;
    }
    try {
      await api.prompt({
        requestId: uuid(), sessionId: sid, mode: "queue",
        content: [{ type: "text", text: body }],
      });
    } catch (err) {
      void alertDialog({ message: failureText(err, tt("命令没发出去，请重试", "The command was not sent; please retry")) });
      return;
    }
    if (fromDraft) enterSentSession(sid);
  };

  /** 截图工具条上的「提问」：把用户写的那句话与这张标注图（连屏幕上下文）当**一条消息**
   *  直接发出去，答案在会话里流式回来。与划词命令同一口径——有意不走 `submit`（那条链读的
   *  是输入框草稿，不该动用户正打到一半的字），也不建 chip：消息落在会话里，不在草稿里。
   *  图内联（模型才看得见），屏幕上下文 md 由壳按路径上传拿回执（与 ＋ 选择器同一条通道）；
   *  引擎按图片准入拒收时，同一份字节改走文件回执重投一次（同 submit：附件与内容必须发
   *  出去，跟模型无关）。 */
  const sendShotMessage = async (text: string, items: PickedAttachment[]) => {
    const { images, files } = splitShotItems(items);
    let sid = sessionId;
    const fromDraft = sid === null;
    if (sid === null) {
      const created = await ensureSession();
      if (created === null) return; // 建会话失败已弹窗
      sid = created;
    }
    const fileReceipts: string[] = [];
    for (const file of files) {
      const receipt = await uploadAttachmentPath(file.path, sid, file.name);
      if (receipt === null) {
        void alertDialog({ message: tt("截图没能发出去：屏幕上下文上传失败", "The screenshot was not sent: its screen context failed to upload") });
        return;
      }
      fileReceipts.push(receipt.receiptId);
    }
    const rpcId = uuid();
    try {
      await api.prompt({
        requestId: rpcId, sessionId: sid, mode: "queue",
        content: shotMessageContent(text, images, fileReceipts),
      });
    } catch (err) {
      const facts = err as Error & RpcErrorFacts;
      if (classifyAttachmentRefusal(facts.reason) !== "images") {
        void alertDialog({ message: failureText(err, tt("发送失败，请重试", "Send failed; please retry")) });
        return;
      }
      const staged: string[] = [];
      for (const image of images) {
        const receiptId = await stageImageAsFile(sid, image);
        if (receiptId === null) {
          void alertDialog({ message: tt("发送失败，请重试", "Send failed; please retry") });
          return;
        }
        staged.push(receiptId);
      }
      try {
        await api.prompt({
          requestId: rpcId, sessionId: sid, mode: "queue",
          content: shotMessageContent(text, [], [...fileReceipts, ...staged]),
        });
      } catch (err2) {
        void alertDialog({ message: failureText(err2, tt("发送失败，请重试", "Send failed; please retry")) });
        return;
      }
    }
    if (fromDraft) enterSentSession(sid);
  };
  // 壳推来的事件订阅一次就够（与划词命令同一份纪律）：处理函数经 ref 镜像取实时值。
  const shotMessageRef = useRef(sendShotMessage);
  shotMessageRef.current = sendShotMessage;

  /** 工具条上的划词命令被点了：壳已把选中的文字存进暂存（面板抢焦点之前读的），
   *  随后推来命令 id——这里取文字、套模板、发出去，答案在面板会话里流式回来。 */
  const runSelectionCommand = (id: string) => {
    const command = store.selectionCommands.find((c) => c.id === id);
    if (!command) {
      void alertDialog({ message: tt(`未知的划词命令：${id}`, `Unknown selection command: ${id}`) });
      return;
    }
    void selectionCapture().then((captured) => {
      if (!captured) {
        void alertDialog({
          message: tt("没有读到选中的文字（需在「辅助功能」里允许本应用）",
            "No selected text was read (allow this app under Accessibility)"),
        });
        return;
      }
      void sendPromptText(renderSelectionPrompt(command, captured.text));
    });
  };
  // 事件回调取实时值（命令目录会被设置页改）：effect 只订阅一次，处理函数经 ref 镜像
  // ——闭包里直接捕获会一直用挂载那一刻的目录（store.tsx 的 refreshRef 同款纪律）。
  const selectionCommandRef = useRef(runSelectionCommand);
  selectionCommandRef.current = runSelectionCommand;

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
      editorRef.current?.replacePlain(start, text.length, "");
      enterSentSession(sid);
    } catch {
      void alertDialog({ message: tt("命令发送失败", "Failed to send command") });
    }
  };
  /** 菜单里的插入按**纯文本坐标**给（附件令牌的换算在编辑器那层）。 */
  const replacePlain = useCallback((from: number, to: number, insert: string) => {
    editorRef.current?.replacePlain(from, to, insert);
  }, []);
  const { menu, query, rows } = useComposerMenu({ text, cursor, dismissed, composing, sessionId, replace: replacePlain, commands, onRunCommand: runCommand });
  // 选中文字「添加到当前任务」（SelectionActions 派发）：追加到现有草稿尾部
  // （带空行分隔），光标落末尾并重新长高。
  useEffect(() => {
    const onAppend = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (!text) return;
      editorRef.current?.replacePlain(text.length, text.length, text ? `\n${text}` : text);
      requestAnimationFrame(() => {
        editorRef.current?.focus();
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
      editorRef.current?.setText(text);
      requestAnimationFrame(() => editorRef.current?.focus());
    };
    const onFocus = () => {
      requestAnimationFrame(() => editorRef.current?.focus());
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
        if (result.ok) {
          // 带话（工具条上的提问）：图与这句话直接成一条消息，不建 chip。
          if (result.chat !== undefined) { void sendShotMessage(result.chat, result.items); return; }
          if (result.items.length > 0) ingestAttachments(result.items);
          return;
        }
        if (result.copied) { void alertDialog({ message: tt("截图已复制到剪贴板", "Screenshot copied to the clipboard") }); return; }
        if (result.cancelled) return; // 用户取消：正常收尾，不打扰
        if (result.error) void alertDialog({ message: result.error });
      });
      return;
    }
    if (action === "files" || action === "folders") { addAttachments(action); return; }
    // 提及：插入 "@" 交给既有的 @ 菜单（键盘优先那条路，本项只是它的一个入口）
    editorRef.current?.replacePlain(text.length, text.length, "@");
    requestAnimationFrame(() => editorRef.current?.focus());
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

  // 壳推来的截图与划词事件（全局截图热键、工具条上的「问 AI」）：
  // 带 reqId 的截图是上面那次请求的应答，由 promise 消费，这里不重复摄入。
  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd === "screenshotCaptured") {
      const p = payload as { reqId?: string; items?: PickedAttachment[]; chat?: string; error?: string; copied?: boolean } | undefined;
      if (p?.reqId) return; // 有请求方的由那次 promise 处理
      if (p?.copied) { void alertDialog({ message: tt("截图已复制到剪贴板", "Screenshot copied to the clipboard") }); return; }
      if (p?.error) { void alertDialog({ message: p.error }); return; }
      // 带话（工具条上的提问，热键召来的截图走这条）：图与这句话直接成一条消息。
      if (p?.chat !== undefined) { void shotMessageRef.current(p.chat, p.items ?? []); return; }
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
      return;
    }
    if (cmd === "selectionCommand") {
      const id = (payload as { id?: string } | undefined)?.id;
      if (id) selectionCommandRef.current(id);
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

  /** 一条一条按**文档序**取出来：正文段与附件段交替（附件插在正文哪一段后面，载荷里就在哪）。
   *  receipts：本次刚拿到的文件回执（按附件 id 认）；imagesAsFiles：图片改走文件回执那一档。
   *  还没就绪的文件跳过——发送前的 filesReady 门槛已经把它们拦住了。 */
  const segmentsWithParts = (): Array<string | Attachment> => {
    const byId = new Map(attachments.map((a) => [a.id, a]));
    const out: Array<string | Attachment> = [];
    for (const segment of editorRef.current?.payload() ?? []) {
      if (typeof segment === "string") { out.push(segment); continue; }
      const att = byId.get(segment.attachmentId);
      if (att !== undefined) out.push(att);
    }
    return out;
  };

  const buildContent = (receipts: Map<string, string>, imagesAsFiles = false): PromptContentPart[] => {
    const parts: PromptContentPart[] = [];
    for (const segment of segmentsWithParts()) {
      if (typeof segment === "string") {
        const body = segment.trim();
        if (body) parts.push({ type: "text", text: body });
        continue;
      }
      if (segment.kind === "image" && !imagesAsFiles) {
        parts.push({ type: "image", mediaType: segment.mediaType, data: segment.data, name: segment.name });
        continue;
      }
      const receiptId = segment.kind === "file" ? segment.receiptId ?? receipts.get(segment.id) : receipts.get(segment.id);
      if (receiptId !== undefined) parts.push({ type: "file", receiptId });
    }
    return parts;
  };

  /** 命令的附件载荷：同一份文档序，但没有文本部件（命令正文在命令行里）。 */
  const buildCommandAttachments = (receipts: Map<string, string>, imagesAsFiles = false): CommandSubmitAttachment[] =>
    buildContent(receipts, imagesAsFiles).flatMap((part): CommandSubmitAttachment[] =>
      part.type === "text" ? [] : [part]);

  /** 有没有可发的：正文非空或挂着附件（发送门槛与发送钮/听写钮的切换都读它）。 */
  const hasContent = text.trim().length > 0 || attachments.length > 0;

  /** 文件 chip 全部就绪才可发送（官方 sendSession 同款门槛）。草稿页的
   *  pending 例外——无会话可传，发送时先建会话补传（uploadNow）。 */
  const filesReady = attachments.every((a) =>
    a.kind !== "file" || a.status === "ready" || (sessionId === null && a.status === "pending"));

  // ---------- 发送 / 排队 / 插话 ----------

  const submit = async (modeOverride?: "queue" | "steer") => {
    if (!hasContent || busy) return;
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
      let receipts = new Map<string, string>();
      if (sid === null) {
        const created = await ensureSession();
        if (created === null) { setBusy(false); return; }
        sid = created;
        // 草稿页的 pending 文件此刻才有会话可落：补传后并入载荷（与 prompt 路径同法）
        const uploaded = await uploadNow(sid);
        if (uploaded === null) {
          void alertDialog({ message: uploadFailureText() });
          setBusy(false); return;
        }
        receipts = new Map(uploaded.map((r) => [r.id, r.receiptId]));
      }
      const submitted = buildCommandAttachments(receipts);
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
          const retry = round === 0 ? await redeliverCommand(sid, classifyAttachmentRefusalText(res.result.text)) : null;
          if (retry === null) failure = res.result.text;
          else parts = retry;
        } catch (err) {
          const facts = err as Error & RpcErrorFacts;
          const retry = round === 0 ? await redeliverCommand(sid, classifyAttachmentRefusal(facts.reason)) : null;
          if (retry === null) failure = failureText(facts, tt("命令发送失败", "Failed to send command"));
          else parts = retry;
        }
      }
      if (failure !== null) {
        void alertDialog({ message: failure });
        setBusy(false); return; // 失败保留草稿与附件供修正（官方语义）
      }
      editorRef.current?.setText("");
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
    // 发送载荷**在发送这一刻按文档序现拼**：正文段与附件段交替，附件插在正文哪一段后面
    // 载荷里就在哪。草稿页这里刚补传的回执照附件 id 认（不是按数组下标对位）。
    let receipts = new Map<string, string>();
    const fromDraft = sid === null;
    if (sid === null) {
      const created = await ensureSession();
      if (created === null) { setBusy(false); return; }
      sid = created;
      // 草稿页的文件胶囊是 pending（无会话可传）：建好会话立即补传。
      const uploaded = await uploadNow(sid);
      if (uploaded === null) {
        void alertDialog({ message: uploadFailureText() });
        setBusy(false); return;
      }
      receipts = new Map(uploaded.map((r) => [r.id, r.receiptId]));
    }
    const sendContent = buildContent(receipts);
    const rpcId = uuid();
    try {
      await api.prompt({ requestId: rpcId, sessionId: sid, mode, content: sendContent });
    } catch (err) {
      // 引擎对「模型条目没声明图片能力」的会话会在准入处拒 inline 图片部件。用户定稿：
      // 附件与内容必须发出去，跟模型无关——所以不丢附件、不弹拒绝，改把这批图片按通用
      // 文件原件投递（同一份字节，走文件回执），原样重发一次。模型能不能看图是模型自己
      // 的事（它会自己说），我们只负责把东西送到。
      const facts = err as Error & RpcErrorFacts;
      const delivered = await redeliver(sid, facts.reason);
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
    editorRef.current?.setText("");
    setAttachments([]);
    if (draftKey) localStorage.removeItem(draftKey);
    setBusy(false);
    if (fromDraft) enterSentSession(sid);
    onSent?.();
  };

  /** 键路由：菜单导航 / 发送 / Esc / 组合态守卫。编辑器每次按键现问一次这个函数，
   *  所以里面读到的永远是最新渲染里的 menu/rows/active——不存第二份状态。 */
  const keyRouting = (): EditorKeyRouting => ({
    menuKey: (event) => {
      if (menu === null || rows.length === 0) return event.key === "Escape";
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActive((current) => (current + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
        return true;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        const row = rows[active];
        if (row) pick(row);
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return true;
      }
      return false;
    },
    submit: (event) => {
      // 修饰键取另一行为：设置 queue 时 Cmd/Ctrl+Enter=steer，反之亦然
      const other = busyEnter === "queue" ? "steer" : "queue";
      void submit(event.metaKey || event.ctrlKey ? other : undefined);
    },
    swallow: (event) => ime.swallow(event),
    compositionStart: () => { ime.onCompositionStart(); setComposing(true); },
    compositionEnd: () => { ime.onCompositionEnd(); setComposing(false); },
  });

  useEffect(() => setActive(0), [menu, query]);

  const pick = (row: MenuRow) => {
    row.run();
    editorRef.current?.focus();
  };

  const canSend = hasContent && !busy && filesReady;
  const showCtx = hasContextData(ctx);
  return (
    <div className="composer-wrap" ref={rootRef}>
      <div className="composer-anchor">
        {menu && (
          <ComposerMenu menu={menu} query={query} rows={rows} active={active} setActive={setActive} onPick={pick} />
        )}
        {plusOpen && !menu && <ComposerPlusMenu onPick={onPlusPick} />}
        <div className={`composer${multiline ? " wide" : ""}`}>
          {/* 液态玻璃材质层：内容与材质分离——胶囊只留几何，底色/投影/模糊（或系统
              材质）都落在这个元素上。失焦、降级、换材质因此只动它一个；胶囊身上
              **不许**有 backdrop-root 触发器，否则本层会被锁进胶囊内部＝一块实心
              （完整约束见 theme.css 的 [data-liquid-glass-backdrop] 段）。 */}
          <GlassLayer />
          <button
            type="button"
            className="composer-icon"
            data-tip={t("添加")}
            aria-expanded={plusOpen}
            /* 打开时图标转 45° 放大 1.15（＋ 变 ×），样式在 theme.css 的
               .composer-icon[data-open] */
            data-open={plusOpen ? "true" : "false"}
            onClick={() => setPlusOpen((open) => !open)}
          >
            <Plus size={16} strokeWidth={2} />
          </button>
          {/* 文本列：附件胶囊与编辑器**同处一条流**（照 Atd：胶囊是行内的原子，正文
              接在它后面）——胶囊在前，编辑器吃剩下的宽度；剩下的宽度不够它落脚
              （见 .composer-field 的 min-width）时整条折到下一行。这一格的实测高度
              就是"内容折了几行"的判据（见上面那条 useLayoutEffect）。 */}
          <div className="composer-field">
            <DraftEditor
              ref={editorRef}
              initialText={text}
              placeholder={listening ? (partial || t("正在听写…")) : running ? t("继续输入以排队后续修改") : t("输入任务，@ 引用 · / 命令")}
              routing={keyRouting}
              onText={(value) => { setText(value); setDismissed(false); }}
              onCaret={setCursorState}
              onPasteFiles={(files) => { for (const f of files) addImageFile(f); }}
              onAttachmentRemoved={removeAttachment}
              onOverflow={setTall}
            />
          </div>
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
