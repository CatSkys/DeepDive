// 悬浮对话卡里的会话流：**整段对话**（多轮），与会话页同一份渲染。
//
// **不另写一套渲染**：交给会话流同一个 `TurnList`（轮内过程折叠 = "已工作 x" 披露条 +
// 收起过程项都在那儿）。这里只做三件事：把 `items` 分成轮、自己当滚动容器（跟着最新一条走，
// 与会话页一致）、持有本卡的折叠开关。
//
// 不管什么：历史分页、翻页锚点、分叉/文件预览（那几支回调是会话页的事）——卡片只读地看对话。
import { useMemo, useRef, useState } from "react";
import { useSessionEvents } from "../session/useSessionEvents";
import { TurnList } from "../session/TurnList";
import { groupTurns } from "../turnGroups";
import { useStore } from "../store";

export function TurnTail({ sessionId }: { sessionId: string }) {
  const store = useStore();
  // scrollRef 交给 hook：它据此把视图钉在最新一条（会话页同一套语义）。
  // 翻页锚点只有会话页用，卡片不翻页，给空引用。
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const olderAnchorRef = useRef<HTMLElement | null>(null);
  const { items, liveRunning } = useSessionEvents(sessionId, { scrollRef, olderAnchorRef });
  // 折叠开关归这张卡自己（会话页那份要跨重渲染保留，各持一份互不干扰）
  const [processOpen, setProcessOpen] = useState<ReadonlySet<number>>(new Set());

  const summary = store.sessions.find((s) => s.sessionId === sessionId) ?? store.allSessions.find((s) => s.sessionId === sessionId);
  const wsPath = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId)?.path;

  const groups = useMemo(() => groupTurns(items), [items]);
  // 锚点索引只有历史翻页要用：卡片不翻页，空表即可（TurnList 那边据此不挂锚点）
  const keyIdx = useMemo(() => new Map<string, number>(), []);
  const liveItem = liveRunning ? items[items.length - 1] : undefined;

  if (groups.length === 0) return null;

  return (
    <div className="chat-turn" ref={scrollRef}>
      <TurnList
        keyIdx={keyIdx}
        groups={groups}
        running={liveRunning}
        liveItem={liveItem}
        processOpen={processOpen}
        setProcessOpen={setProcessOpen}
        sessionId={sessionId}
        wsPath={wsPath}
        cwd={summary?.cwd}
        olderAnchorRef={olderAnchorRef}
      />
    </div>
  );
}
