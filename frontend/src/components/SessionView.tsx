import { useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { t, useT } from "../i18n";
import { Composer } from "./Composer";
import { HeroBrand } from "./HeroBrand";
import { planReviewOf } from "../planReview";
import { PlanReviewCard } from "./PlanReviewCard";
import { SubagentPageHeader } from "../session/SubagentPageHeader";
import { PanelTrigger } from "../sidebar-right/PanelTrigger";
import { SessionPanel } from "../sidebar-right/SessionPanel";
import { useComposerOverlay } from "../sidebar-right/useComposerOverlay";
import { sessionArtifacts } from "../sidebar-right/sessionArtifacts";
import type { PermissionSelect } from "../settings/permissionPreset";
import { groupTurns } from "../turnGroups";
import { useSessionActions, useWidgetErrorReport } from "../session/useSessionActions";
import { FilePreviewOverlay, FilePreviewSurface, PreviewPageHeader } from "./preview/FilePreviewWindow";
import { previewOpen, useFilePreview } from "./preview/useFilePreview";
import { TurnList } from "../session/TurnList";
import { useFollowTail } from "../session/useFollowTail";
import { SessionHeader } from "../session/SessionHeader";
import { panelActions } from "../sidebar-right/panelStore";
import { sessionTitle } from "../session/sessionTitle";
import { ApprovalCard, QuestionCard } from "../session/Cards";
import { QueueDock } from "../session/QueueDock";
import { SteerQueue } from "../session/SteerQueue";
import { useSessionEvents } from "../session/useSessionEvents";
import { isBrowserTool } from "../session/toolKind";
import { useSessionModels } from "../session/useSessionModels";
import { publishReadingProgress, readingProgressOf } from "../session/readingProgress";
import { useSessionFlowScroll } from "../session/useSessionFlowScroll";
import { sessionProjections } from "../session/sessionProjections";
import { FindInConversation } from "./FindInConversation";

export function SessionView({ sessionId }: { sessionId: string }) {
  const { lang } = useT(); // 订阅语言切换：文案与标题回退随 lang 重渲染
  const store = useStore();
  const { approvals, questions, queues, sessions } = store;
  const modelFace = useSessionModels(sessionId);
  // 输入框上的思考强度面（与模型选择分开）：档位表与当前档来自会话的
  // modelSelection 投影，提交走 pickEffort（同一个 selectModel RPC）。
  const effortFace = { levels: modelFace.effortLevels, value: modelFace.effort, pick: modelFace.pickEffort };
  // 轮内过程折叠（官方 turn-process）：默认收起；Set 记用户手动展开的轮号。
  // 切会话时 SessionView 以 sessionId 重挂，Set 随之清空。
  const [processOpen, setProcessOpen] = useState<ReadonlySet<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 渐隐边缘信号（超限标准 UI，样式走 .flow 上的 .fade-y）：不用
  // useEdgeFade——底部要跟 follow（jump-down 同源、32px 容差、ref 镜像
  // 供 syncBottomPad 同步读）保持一个事实源，拆两套监听会算出两个贴底。
  const [scrolled, setScrolled] = useState(false);
  const olderAnchorRef = useRef<HTMLElement | null>(null);
  const { items, liveRunning, runningSince, turnEnded, scheduleRecords, hasMore, loadingOlder, loadOlder, loadError, retry, browserUsed } = useSessionEvents(sessionId, { scrollRef, olderAnchorRef });
  // 贴底跟随与悬浮对话卡共用一份（那边同样要自己滚到底）
  const { follow, followRef, onScroll: followScroll } = useFollowTail(scrollRef, items);
  const flowRef = useRef<HTMLDivElement | null>(null);
  // 容器接线（贴底 padding 自愈/顶部模糊带强度/回到底部缓动）集中在
  // useSessionFlowScroll：refs 在这里持有——scrollRef 供 useSessionEvents 共用，
  // flowRef 供页内查找取词根，follow 与 jump-down/贴底同源。
  const { attachFlow, attachFade, attachBottom, syncFadeRamp, scrollFlowToBottom } =
    useSessionFlowScroll({ scrollRef, flowRef, followRef });
  const summary = sessions.find((s) => s.sessionId === sessionId);
  const title = summary ? sessionTitle(summary, lang) : t("会话");
  // 文件预览窗口（产物/文件 chip 打开）：little 浮窗与全屏两态
  const preview = useFilePreview();
  const previewFull = previewOpen(preview) && preview.fullscreen;
  // 产物/预览路径解析：模型常写 cwd 相对路径，/api/file 与壳动作都要绝对路径
  const wsPath = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId)?.path;
  // 会话动作回调（打开预览 / 分叉 / 继续 / ui 按钮发送）：都要引用稳定，契约与出处见该 hook。
  const { openPreviewFile, branchFrom, continueTurn, sendPrompt } = useSessionActions({ sessionId, store, preview, wsPath });
  // widget 运行时错误回传：运行中自动插队告知模型，空闲出「告知 AI」按钮
  const reportWidgetError = useWidgetErrorReport(sessionId);

  const pending = [...approvals.values()].filter((a) => a.sessionId === sessionId);
  const sessionQuestions = [...questions.values()].filter((q) => q.sessionId === sessionId);
  // 还没被引擎领取的消息按 placement 分流（用户 2026-10-10 定稿）：插话中
  //（next-step）用消息形态排在输入区上方（SteerQueue），排队（next-turn）留在
  // 排队区胶囊（QueueDock）——两种都保留编辑/删除；context（注入的运行时
  // 上下文，不是用户消息）不摆。队列快照本身即真相，本端不再另记"发送中"。
  const sessionQueue = queues.get(sessionId) ?? [];
  const steerItems = sessionQueue.filter((i) => i.placement === "steering");
  const pendingItems = sessionQueue.filter((i) => i.placement === "queued");

  // 子会话（origin==='subagent'）是**只读预览页**：形态照全屏产物预览——返回
  // 父会话 + 标题，内容铺满，不挂输入框（continuable 子会话续话那条路随之撤掉）。
  const isSubagent = summary?.origin === "subagent";
  const isBlank = summary ? !!summary.blank : items.length === 0;
  // 事件流的逐轮真相优先（turnEnded=日志窗见过 turn/end，useSessionEvents 注）：
  // 引擎 agent status 卡在 running 时 summary 的 running 永不落，Deep diving、
  // composer 转圈、工具行脉冲会被它一直抬着（2026-10-12 用户报障）。只有日志窗
  // 未见闭合（开窗落在轮中段、turn/start 已被截走）时才让 summary 兜底。
  const running = liveRunning || (!turnEnded && !!summary?.running);
  // 直播项（流式 chunk/思考）只可能是列表最后一项。思考块用它判定「这一条思考
  // 是否还在进行」（官方 `running={streaming && i === last}` 口径）——只看会话级
  // running 的话，同轮后面的工具/答案都已出现、会话还在跑时，早已结束的思考会
  // 一直摊着「思考中」不收起（用户报障）。
  const liveItem = items.length > 0 ? items[items.length - 1] : undefined;
  // 用量/占用投影（3.1）：空值时 Composer 内的容量圈不渲染；计划态芯片同源
  const { ctxData, plan } = sessionProjections(summary);
  // 浏览器全屏 → 壳在网页之上叠一层透明 webview 跑同一个 Composer（悬浮输入框）；
  // 同时这里把自己那份收起来：同一会话只允许一个活着的 composer。
  const browserFullscreen = useComposerOverlay(sessionId);

  // key 索引/末位行扫描/轮分组只在 items 变化时算一次（AUD-092）：流式期间
  // 每条 delta 与其他会话的 store 更新都会触发重渲染，渲染体内重建 Map +
  // 全量扫是纯浪费。渲染全量进行（离屏排版由 .msg-block 的
  // content-visibility 跳过，长会话内存窗口本身有分页上限）。
  const layout = useMemo(() => {
    const keyIdx = new Map(items.map((it, i) => [it.key, i] as const));
    const groups = groupTurns(items);
    return { keyIdx, groups };
  }, [items]);

  // 右侧边栏的两份取数：会话产物清单（面板的「产物」区）与会话权限投影视图
  // （引擎已经把它算成 {options, currentValue} 的下拉形状）。
  const artifacts = useMemo(() => sessionArtifacts(items, summary?.cwd ?? wsPath), [items, summary?.cwd, wsPath]);
  const permissions = (summary?.projections?.values as { permissions?: PermissionSelect } | undefined)?.permissions ?? null;

  if (isBlank) {
    return (
      <>
        {isSubagent ? (
          <SubagentPageHeader title={title} parentSessionId={summary?.parentSessionId} />
        ) : (
          <>
            <div className="session-header">
              <SessionHeader title={title} face={modelFace} />
            </div>
            <div className="hero">
              <HeroBrand />
              <div className="hero-composer">
                <Composer sessionId={sessionId} ctx={ctxData} effort={effortFace} />
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <div className="session-row">
    <div className="session">
      {/* 顶部渐隐层：滚上去的内容在头部下面被渐变吃掉 + 模糊（样式见 theme.css）。
          六个 <i> 是渐进模糊的六层（半径从峰值逐层减半、各占带高 1/6 的波段），
          层数写在 theme.css 的 nth-child 规则里，与这里是一对——改层数两处一起改。
          全屏预览时一并隐藏——那是另一个页面。 */}
      {!previewFull && (
        <div className="session-fade" ref={attachFade} aria-hidden="true">
          <i /><i /><i /><i /><i /><i />
        </div>
      )}
      {/* 页头三态：全屏预览（文件）与子会话都是"打开成的另一个页面"——页头换成
          各自的返回钮 + 标题，会话自己的标题/模型/胶囊整体让位（不再是"会话界面
          顶着文件/子会话"）。 */}
      {previewFull ? <PreviewPageHeader preview={preview} /> : isSubagent ? (
      <SubagentPageHeader title={title} parentSessionId={summary?.parentSessionId} />
      ) : (
      <div className="session-header">
        {/* key=会话：切会话时标题行整体重挂播 header-in 入场（标题更新/流式
            改名不换 key，不重播）。标题点击 = 弹出右侧面板的会话设置（用户定稿）。 */}
        <SessionHeader key={sessionId} title={title} face={modelFace} onTitleClick={() => panelActions.setSettings(sessionId, true)} />
        {plan?.active && !plan?.pending && (
          <span className="plan-wrap">
            <button
              type="button"
              className="plan-chip"
              data-tip={t("退出计划模式")}
              aria-label={t("退出计划模式")}
              onClick={() => {
                api.commandExecute({ agentId: sessionId, line: "/plan off" })
                  .catch(() => void 0); // 引擎忙时退出指令丢失：芯片由投影轮询纠偏
              }}
            >
              Plan ×
            </button>
          </span>
        )}
        <PanelTrigger
          sessionId={sessionId}
          scheduleRecords={scheduleRecords}
          /* agent 与浏览器的关系：用过 = ingest 记账（browserUsed，重载后仍算得出）；
             正在操控 = 会话在跑且最后一项就是那条浏览器工具调用（此刻正在发生的事） */
          browser={{ used: browserUsed, live: running && isBrowserTool(liveItem?.toolName) }}
        />
      </div>
      )}
      {/* 会话体：消息流 + 悬浮输入区 + （全屏预览时）盖在其上的预览面。
          全屏不让底下两颗卸载——滚动位置与事件状态都在它们身上，停绘制即可。 */}
      <div className="session-body" data-fullscreen={previewFull || undefined}>
        <div
          className="flow fade-y"
          ref={attachFlow}
          data-fade-start={scrolled ? "" : undefined}
          data-fade-end={!follow ? "" : undefined}
          onScroll={(e) => {
            const el = e.currentTarget;
            followScroll(el);
            setScrolled(el.scrollTop > 2);
            syncFadeRamp(el.scrollTop);
            // 侧栏选中行的阅读进度灰底（见 session/readingProgress.ts）
            publishReadingProgress(readingProgressOf(el));
            // 滚到顶自动向前翻页（替代手点「载入更早」）：靠近顶部即拉一页；
            // loadOlder 内部有 paging 互斥 + 锚点保位，连续触发安全。
            if (el.scrollTop < 48 && hasMore && !loadingOlder) void loadOlder();
          }}
        >
          {/* key=会话:已加载——历史到达那一刻（off→on）重挂播 session-enter
              入场；流式增量不换 key 不重播；未加载完保持 off 不播（空容器） */}
          <div className="flow-inner" key={`${sessionId}:${items.length > 0 ? "on" : "off"}`}>
            {loadError && items.length === 0 && (
              <div className="load-error" role="alert">
                {t("历史加载失败")}
                <button type="button" onClick={retry}>{t("重试")}</button>
              </div>
            )}
            {loadingOlder && (
              <div className="load-older" aria-live="polite">{t("加载中…")}</div>
            )}
            <TurnList
              keyIdx={layout.keyIdx}
              groups={layout.groups}
              running={running}
              runningSince={runningSince}
              liveItem={liveItem}
              processOpen={processOpen}
              setProcessOpen={setProcessOpen}
              sessionId={sessionId}
              wsPath={wsPath}
              cwd={summary?.cwd}
              olderAnchorRef={olderAnchorRef}
              onBranch={branchFrom}
              onPreviewFile={openPreviewFile}
              onSendPrompt={sendPrompt}
              onWidgetError={reportWidgetError}
              onContinue={continueTurn}
            />
            {pending.map((a) => (
              <ApprovalCard key={a.eventId} eventId={a.eventId} toolName={a.toolName} reason={a.reason} />
            ))}
            {sessionQuestions.map((q) => {
              // plan-review 提意 → 决策卡接管；其余保持通用提问流（官方分流规则）
              const review = planReviewOf(q.questions);
              if (review) {
                return <PlanReviewCard key={q.eventId} eventId={q.eventId} review={review} />;
              }
              return <QuestionCard key={q.eventId} eventId={q.eventId} questions={q.questions} />;
            })}
          </div>
        </div>
        {/* 页内查找（⌘F）：只读真会话里找词——预览页与子会话是"打开成的另一个页面"，
            不挂。取词根就是消息流本体。 */}
        {!previewFull && !isSubagent && <FindInConversation rootRef={flowRef} />}
        {!follow && (
          <button
            className="jump-down"
            data-tip={t("回到最新")}
            onClick={() => scrollFlowToBottom(true)}
          >
            <ArrowDown size={16} />
          </button>
        )}
        {/* 悬浮输入区：子会话不挂（只读预览页），其余按浏览器全屏让位。 */}
        {!isSubagent && (
        <div
          className="session-bottom"
          ref={attachBottom}
        >
          {steerItems.length > 0 && <SteerQueue sessionId={sessionId} items={steerItems} />}
          {pendingItems.length > 0 && (
            <div className="queue-dock-wrap">
              <QueueDock sessionId={sessionId} items={pendingItems} />
            </div>
          )}
          {browserFullscreen ? null : (
            <Composer sessionId={sessionId} ctx={ctxData} effort={effortFace} />
          )}
        </div>
        )}
      {previewFull && <FilePreviewSurface preview={preview} wsPath={wsPath} />}
      </div>
      {previewOpen(preview) && !previewFull && <FilePreviewOverlay preview={preview} wsPath={wsPath} />}
    </div>
    <SessionPanel
      sessionId={sessionId}
      scheduleRecords={scheduleRecords}
      artifacts={artifacts}
      face={modelFace}
      agentPreset={summary?.agentPreset}
      permissions={permissions}
      onPreview={openPreviewFile}
      onOpenReview={preview.openReview}
    />
    </div>
  );
}
