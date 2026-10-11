// 悬浮对话卡里的会话流：**整段对话**（多轮），与会话页同一份渲染。
//
// **不另写一套渲染**：交给会话流同一个 `TurnList`（轮内过程折叠 = "已工作 x" 披露条 +
// 收起过程项、流末的运行中 loader 都在那儿）。这里只做三件事：把 `items` 分成轮、自己当
// 滚动容器（贴底跟随走会话页同一个钩子）、持有本卡的折叠开关。
//
// 不管什么：历史分页、翻页锚点、分叉/文件预览（那几支回调是会话页的事）——卡片只读地看对话。
import { useMemo, useRef, useState } from "react";
import { useSessionEvents } from "../session/useSessionEvents";
import { useFollowTail } from "../session/useFollowTail";
import { TurnList } from "../session/TurnList";
import { useSessionSend, useWidgetErrorReport } from "../session/useSessionActions";
import { groupTurns } from "../turnGroups";
import { useStore } from "../store";

export function TurnTail({ sessionId }: { sessionId: string }) {
  const store = useStore();
  // 滚动容器：翻页锚点只有会话页用，卡片不翻页，给空引用。
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const olderAnchorRef = useRef<HTMLElement | null>(null);
  const { items, liveRunning, runningSince } = useSessionEvents(sessionId, { scrollRef, olderAnchorRef });
  // 贴底跟随与会话页共用：发完消息/流式增长自己滚到底，用户上滑即交还控制权
  const { onScroll: followScroll } = useFollowTail(scrollRef, items);
  // 折叠开关归这张卡自己（会话页那份要跨重渲染保留，各持一份互不干扰）
  const [processOpen, setProcessOpen] = useState<ReadonlySet<number>>(new Set());

  const summary = store.sessions.find((s) => s.sessionId === sessionId) ?? store.allSessions.find((s) => s.sessionId === sessionId);
  const wsPath = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId)?.path;

  const groups = useMemo(() => groupTurns(items), [items]);
  // 锚点索引只有历史翻页要用：卡片不翻页，空表即可（TurnList 那边据此不挂锚点）
  const keyIdx = useMemo(() => new Map<string, number>(), []);
  // 卡片里的 ui 围栏动作按钮与会话页同一份发送实现
  const sendPrompt = useSessionSend(sessionId);
  // widget 运行时错误：运行中自动告知模型，空闲出「告知 AI」按钮
  const reportWidgetError = useWidgetErrorReport(sessionId);
  // 与会话页同一口径：事件侧 liveRunning 要等 turn/start 被观察到才为真，摘要的 running
  // 补上"刚发出、引擎还没吐第一个事件"那段窗口——loader 恰恰最该在那段出现。
  const running = liveRunning || !!summary?.running;
  const liveItem = liveRunning ? items[items.length - 1] : undefined;

  return (
    <div className="chat-turn" ref={scrollRef} onScroll={(e) => followScroll(e.currentTarget)}>
      <TurnList
        keyIdx={keyIdx}
        groups={groups}
        running={running}
        runningSince={runningSince}
        liveItem={liveItem}
        processOpen={processOpen}
        setProcessOpen={setProcessOpen}
        sessionId={sessionId}
        wsPath={wsPath}
        cwd={summary?.cwd}
        olderAnchorRef={olderAnchorRef}
        onSendPrompt={sendPrompt}
        onWidgetError={reportWidgetError}
      />
    </div>
  );
}
