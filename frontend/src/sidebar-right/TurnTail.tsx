// 悬浮对话卡里的"最近一轮"。
//
// **不另写一套渲染**：交给会话流同一个 `TurnList`（轮内过程折叠 = "已工作 x" 披露条 +
// 收起过程项，都在那儿）。这里只做两件事：取最后一轮、把锚点/回调用不上的那些接上空实现。
//
// 不管什么：历史分页、翻页锚点、产物面板——那些是会话页的事。
import { useMemo, useRef, useState } from "react";
import { useSessionEvents } from "../session/useSessionEvents";
import { TurnList } from "../session/TurnList";
import { groupTurns } from "../turnGroups";
import { useStore } from "../store";

export function TurnTail({ sessionId }: { sessionId: string }) {
  const store = useStore();
  // 这两支锚点只有历史翻页用；叠加层不翻页，给空引用即可
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const olderAnchorRef = useRef<HTMLElement | null>(null);
  const { items, liveRunning } = useSessionEvents(sessionId, { scrollRef, olderAnchorRef });
  // 折叠开关归这张卡自己（会话页那份要跨重渲染保留，各持一份互不干扰）
  const [processOpen, setProcessOpen] = useState<ReadonlySet<number>>(new Set());

  const summary = store.sessions.find((s) => s.sessionId === sessionId) ?? store.allSessions.find((s) => s.sessionId === sessionId);
  const wsPath = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId)?.path;

  const last = useMemo(() => {
    const groups = groupTurns(items);
    return groups.length > 0 ? groups[groups.length - 1]! : null;
  }, [items]);
  // 锚点索引只有历史翻页要用：卡片不翻页，空表即可（TurnList 那边据此不挂锚点）
  const keyIdx = useMemo(() => new Map<string, number>(), []);

  if (last === null) return null;
  const liveItem = liveRunning ? last.items[last.items.length - 1] : undefined;

  return (
    <div className="chat-turn">
      <TurnList
        keyIdx={keyIdx}
        groups={last === null ? [] : [last]}
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
