// 悬浮对话卡里的"最近一轮"内容。
//
// 直接摊开显示（没有折叠行——对话卡要的是对话，不是一条"已工作 x"的开关），渲染的是会话流里
// 同一批组件（`Item`），不另写渲染。轮跑着时把最后一项标成 streaming。
//
// 不管什么：历史分页、翻页锚点、产物面板——那些是会话页的事。
import { useMemo, useRef } from "react";
import { Item } from "../session/Item";
import { useSessionEvents } from "../session/useSessionEvents";
import { groupTurns } from "../turnGroups";
import { useStore } from "../store";

export function TurnTail({ sessionId }: { sessionId: string }) {
  const store = useStore();
  // 这两支锚点只有历史翻页用；叠加层不翻页，给空引用即可
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const olderAnchorRef = useRef<HTMLElement | null>(null);
  const { items, liveRunning } = useSessionEvents(sessionId, { scrollRef, olderAnchorRef });

  const summary = store.sessions.find((s) => s.sessionId === sessionId) ?? store.allSessions.find((s) => s.sessionId === sessionId);
  const wsPath = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId)?.path;

  const last = useMemo(() => {
    const groups = groupTurns(items);
    return groups.length > 0 ? groups[groups.length - 1]! : null;
  }, [items]);

  if (last === null) return null;
  const liveItem = liveRunning ? last.items[last.items.length - 1] : undefined;

  return (
    <div className="chat-turn">
      {last.items.map((item) => (
        <Item
          key={item.key}
          item={item}
          running={item === liveItem}
          sessionId={sessionId}
          wsPath={wsPath}
          cwd={summary?.cwd}
        />
      ))}
    </div>
  );
}
