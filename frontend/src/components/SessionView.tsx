import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useSessionActions } from "../session/useSessionActions";
import { FilePreviewOverlay, FilePreviewSurface, PreviewPageHeader } from "./preview/FilePreviewWindow";
import { previewOpen, useFilePreview } from "./preview/useFilePreview";
import { TurnList } from "../session/TurnList";
import { useFollowTail } from "../session/useFollowTail";
import { SessionHeader } from "../session/SessionHeader";
import { panelActions } from "../sidebar-right/panelStore";
import { sessionTitle } from "../session/sessionTitle";
import { ApprovalCard, QuestionCard } from "../session/Cards";
import { QueueDock } from "../session/QueueDock";
import { useSessionEvents } from "../session/useSessionEvents";
import { useSessionModels } from "../session/useSessionModels";
import { placeReadingProgress, publishReadingProgress, readingProgressOf } from "../session/readingProgress";
import { FindInConversation } from "./FindInConversation";

/** 顶部模糊带满强度所需的滚动深度（px）：雾的渐显与内容渐隐共用这一个深度，
 *  两条边同步走完，不会各显各的。 */
const FADE_RAMP_PX = 96;


export function SessionView({ sessionId }: { sessionId: string }) {
  const { lang } = useT(); // 订阅语言切换：文案与标题回退随 lang 重渲染
  const store = useStore();
  const { approvals, questions, queues, sessions } = store;
  const modelFace = useSessionModels(sessionId);
  // 轮内过程折叠（官方 turn-process）：默认收起；Set 记用户手动展开的轮号。
  // 切会话时 SessionView 以 sessionId 重挂，Set 随之清空。
  const [processOpen, setProcessOpen] = useState<ReadonlySet<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 渐隐边缘信号（超限标准 UI，样式走 .flow 上的 .fade-y）：不用
  // useEdgeFade——底部要跟 follow（jump-down 同源、32px 容差、ref 镜像
  // 供 syncBottomPad 同步读）保持一个事实源，拆两套监听会算出两个贴底。
  const [scrolled, setScrolled] = useState(false);
  const olderAnchorRef = useRef<HTMLElement | null>(null);
  const { items, liveRunning, runningSince, plan, scheduleRecords, hasMore, loadingOlder, loadOlder, loadError, retry } =
    useSessionEvents(sessionId, { scrollRef, olderAnchorRef });
  // 贴底跟随与悬浮对话卡共用一份（那边同样要自己滚到底）
  const { follow, followRef, onScroll: followScroll } = useFollowTail(scrollRef, items);
  const summary = sessions.find((s) => s.sessionId === sessionId);
  const title = summary ? sessionTitle(summary, lang) : t("会话");
  // 文件预览窗口（产物/文件 chip 打开）：little 浮窗与全屏两态
  const preview = useFilePreview();
  const previewFull = previewOpen(preview) && preview.fullscreen;
  // 产物/预览路径解析：模型常写 cwd 相对路径，/api/file 与壳动作都要绝对路径
  const wsPath = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId)?.path;
  // 会话动作回调（打开预览 / 分叉 / 继续）：三者都要引用稳定，契约与出处见该 hook。
  const { openPreviewFile, branchFrom, continueTurn } = useSessionActions({ sessionId, store, preview, wsPath });

  // 底部悬浮区（用户定稿「消息区下延贴底」）：composer 悬浮于消息流之上，
  // flow 的 padding-bottom 按悬浮区实测高度动态设置（附件/排队坞/多行输入
  // 都会改变它），滚到底时最后一条消息恰好停在悬浮区上方 16px。
  // 接线必须自愈：WS 断连/引擎重启期间 React 可长期不重渲染，ref 不重触发，
  // ResizeObserver 也可能落在死节点上（实测 padding 静默丢失）——RO 之外加
  // 1s 看门狗，节点换新或断观察都会在一秒内重新接上。
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<HTMLDivElement | null>(null);
  const padObserver = useRef<ResizeObserver | null>(null);
  const observedBottom = useRef<Element | null>(null);
  const scrollAnim = useRef<number | null>(null);
  // padding 无变化时绝不碰滚动位置——贴底强拉只允许发生在「悬浮区确实
  // 长高/变矮且用户处于跟随态」时；无条件的 wasAtBottom 强拉会和用户上滑
  // 对抗（底部鬼畜事故：内联 ref 每渲染重挂 → 本函数被渲染节奏反复调用 →
  // 48px 内上滑被不停拽回底部）。
  const syncBottomPad = useCallback(() => {
    const flow = flowRef.current;
    const bottom = bottomRef.current;
    if (!flow || !bottom) return;
    if (observedBottom.current !== bottom) {
      padObserver.current?.disconnect();
      const ro = new ResizeObserver(syncBottomPad);
      ro.observe(bottom);
      padObserver.current = ro;
      observedBottom.current = bottom;
    }
    const next = `${bottom.offsetHeight + 16}px`;
    if (flow.style.paddingBottom === next) return;
    flow.style.paddingBottom = next;
    if (followRef.current) flow.scrollTop = flow.scrollHeight;
  }, [followRef]);
  useEffect(() => {
    const t = setInterval(syncBottomPad, 1000);
    return () => {
      clearInterval(t);
      padObserver.current?.disconnect();
      if (scrollAnim.current !== null) cancelAnimationFrame(scrollAnim.current);
    };
  }, [syncBottomPad]);

  // ref 回调必须稳定（useCallback）：内联箭头每次渲染换新身份，React 每渲染
  // 都 detach/reattach → syncBottomPad 被渲染节奏反复调用（鬼畜事故帮凶）。
  const attachFlow = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    flowRef.current = el;
    syncBottomPad();
    // 会话页整体重挂（SessionView 以 sessionId 为 key）：读数按新容器重算一次，
    // 否则新选中的会话顶着上一个会话的灰底，要等它自己滚一下才纠正。挂载时流还
    // 是空的（读数 0）；历史到达后贴底那一次滚动会自己补上。落位而非收敛：新会话
    // 的灰底不该从上一个会话的读数扫过来。
    if (el) placeReadingProgress(readingProgressOf(el));
  }, [syncBottomPad]);
  // 顶部模糊带强度 = 滚动深度，0→1 走 FADE_RAMP_PX（内容淡出段走完，雾正好到
  // 满强度）。写的是**模糊半径的倍率**而非整体 opacity：opacity<1 会让面板自建
  // backdrop root，backdrop-filter 采样空组、模糊整个消失（theme.css 有实测记录）。
  // 直接写 CSS 变量、不进 state——每帧都变的值走 React 会把整条会话流拖进滚动重渲。
  const fadeRef = useRef<HTMLDivElement | null>(null);
  // 两个量走同一深度：模糊强度（乘进半径）与内容渐隐长度（--flow-fade-live）。渐隐长度
  // 必须连续长出来——布尔挂上固定长度会让顶部内容越过阈值那一刻整片瞬间变暗，而模糊尚
  // 未开始，观感就是「过渡僵硬」。
  const syncFadeRamp = useCallback((top: number) => {
    const depth = Math.min(1, top / FADE_RAMP_PX);
    fadeRef.current?.style.setProperty("--session-fade-ramp", String(depth));
    flowRef.current?.style.setProperty("--flow-fade-live", `${Math.min(FADE_RAMP_PX, Math.max(0, top))}px`);
  }, []);
  // 带子在预览全屏切换时会重挂（重挂即丢变量）：挂上就按当前深度补一次，
  // 否则退出全屏要等下一次滚动雾才回来。
  const attachFade = useCallback((el: HTMLDivElement | null) => {
    fadeRef.current = el;
    if (el) syncFadeRamp(flowRef.current?.scrollTop ?? 0);
  }, [syncFadeRamp]);
  const attachBottom = useCallback((el: HTMLDivElement | null) => {
    bottomRef.current = el;
    syncBottomPad();
  }, [syncBottomPad]);

  // 回到底部：rAF 缓动（ease-out-cubic）。WKWebView 原生 smooth 的时长与
  // 松紧不可控；且 content-visibility 的估高在跳达后被真实高度替换、
  // scrollHeight 会漂移——落点后下一帧再校准一次。
  const scrollFlowToBottom = (smooth: boolean) => {
    const flow = flowRef.current;
    if (!flow) return;
    if (scrollAnim.current !== null) { cancelAnimationFrame(scrollAnim.current); scrollAnim.current = null; }
    const settle = () => { flow.scrollTop = flow.scrollHeight; };
    const from = flow.scrollTop;
    const distance = flow.scrollHeight - flow.clientHeight - from;
    if (!smooth || distance < 2) { settle(); return; }
    const duration = Math.min(480, 220 + distance * 0.08);
    const t0 = performance.now();
    const step = (now: number) => {
      if (flowRef.current !== flow) return; // 中途切会话：动画作废
      const p = Math.min(1, (now - t0) / duration);
      flow.scrollTop = from + distance * (1 - Math.pow(1 - p, 3));
      if (p < 1) {
        scrollAnim.current = requestAnimationFrame(step);
        return;
      }
      // 落点后持续校准：content-visibility 估高在跳达后被真实高度替换，
      // scrollHeight 会连漂几帧，双帧校准不够（实测停在离底 322px 处）。
      // 连续两帧位置无变化才收手（≤12 帧封顶）；期间用户上滑（follow
      // 翻 false）立即中止，绝不和人抢滚动。
      let stable = 0;
      let frames = 0;
      let lastSt = -1;
      const stabilize = () => {
        if (flowRef.current !== flow || !followRef.current) { scrollAnim.current = null; return; }
        flow.scrollTop = flow.scrollHeight;
        const st = flow.scrollTop;
        stable = Math.abs(st - lastSt) < 1 ? stable + 1 : 0;
        lastSt = st;
        frames += 1;
        if (stable < 2 && frames < 12) scrollAnim.current = requestAnimationFrame(stabilize);
        else scrollAnim.current = null;
      };
      scrollAnim.current = requestAnimationFrame(stabilize);
    };
    scrollAnim.current = requestAnimationFrame(step);
  };

  const pending = [...approvals.values()].filter((a) => a.sessionId === sessionId);
  const sessionQuestions = [...questions.values()].filter((q) => q.sessionId === sessionId);
  // 还没被引擎领取的消息都在排队区（一叠胶囊）：排队（next-turn）与插话中
  //（next-step）两种 placement 都摆，因此都能编辑/删除；context（注入的运行时
  // 上下文，不是用户消息）不摆。队列快照本身即真相，本端不再另记"发送中"。
  const sessionQueue = queues.get(sessionId) ?? [];
  const pendingItems = sessionQueue.filter((i) => i.placement !== "context");

  // 子会话（origin==='subagent'）是**只读预览页**：形态照全屏产物预览——返回
  // 父会话 + 标题，内容铺满，不挂输入框（continuable 子会话续话那条路随之撤掉）。
  const isSubagent = summary?.origin === "subagent";
  const isBlank = summary ? !!summary.blank : items.length === 0;
  const running = liveRunning || !!summary?.running;
  // 直播项（流式 chunk/思考）只可能是列表最后一项。思考块用它判定「这一条思考
  // 是否还在进行」（官方 `running={streaming && i === last}` 口径）——只看会话级
  // running 的话，同轮后面的工具/答案都已出现、会话还在跑时，早已结束的思考会
  // 一直摊着「思考中」不收起（用户报障）。
  const liveItem = items.length > 0 ? items[items.length - 1] : undefined;
  // 用量/占用投影（3.1）：空值时 Composer 内的容量圈不渲染
  const projVals = (summary?.projections?.values ?? {}) as {
    tokenUsage?: { uncachedInputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
    contextPressure?: { projectedTokens?: number; contextWindow?: number };
    contextBreakdown?: { systemTokens?: number; toolsTokens?: number; messageTokens?: number };
    sessionStats?: { turns?: number; steps?: number; llmMs?: number; toolMs?: number; ttftMs?: number; ttftSteps?: number; decodeMs?: number; decodeTokens?: number };
  };
  // 容量圈数据挂在输入框上（发送/听写钮左侧，hover 出面板）
  // 浏览器全屏 → 壳在网页之上叠一层透明 webview 跑同一个 Composer（悬浮输入框）；
  // 同时这里把自己那份收起来：同一会话只允许一个活着的 composer。
  const browserFullscreen = useComposerOverlay(sessionId);

  const ctxData = {
    projected: projVals.contextPressure?.projectedTokens,
    window: projVals.contextPressure?.contextWindow,
    usage: projVals.tokenUsage,
    stats: projVals.sessionStats,
    breakdown: projVals.contextBreakdown,
  };

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
                <Composer sessionId={sessionId} ctx={ctxData} />
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
        <PanelTrigger sessionId={sessionId} scheduleRecords={scheduleRecords} />
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
          {pendingItems.length > 0 && (
            <div className="queue-dock-wrap">
              <QueueDock sessionId={sessionId} items={pendingItems} />
            </div>
          )}
          {browserFullscreen ? null : (
            <Composer sessionId={sessionId} ctx={ctxData} />
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
      permissions={permissions}
      onPreview={openPreviewFile}
      onOpenReview={preview.openReview}
    />
    </div>
  );
}
