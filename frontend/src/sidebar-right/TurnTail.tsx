// 悬浮输入框上方那张"最近一轮"卡片（参考图里的样子：过程条 + agent 回复 + 编辑文件卡）。
//
// 只挑**最后一轮**渲染，用的是会话流里同一批组件（`TurnProcessBar` / `Item`），不另写渲染：
// 折叠语义也照抄会话流——过程项默认收起、点过程条展开（`computeTurnProcess` 给的
// processIndices）。会话流那边把过程条挂"过程窗起点"上，这里挂整轮开头，视觉上就是参考图
// 那张卡（过程条在最上面）。
//
// 不管什么：历史分页、翻页锚点、产物面板——那些是会话页的事。
import { useMemo, useRef, useState } from "react";
import { Item } from "../session/Item";
import { TurnProcessBar } from "../session/TurnProcessBar";
import { computeTurnProcess } from "../session/turnProcess";
import { useSessionEvents } from "../session/useSessionEvents";
import { groupTurns } from "../turnGroups";
import { useStore } from "../store";

export function TurnTail({ sessionId }: { sessionId: string }) {
  const store = useStore();
  // 这两支锚点只有历史翻页用；叠加层不翻页，给空引用即可
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const olderAnchorRef = useRef<HTMLElement | null>(null);
  const { items, liveRunning } = useSessionEvents(sessionId, { scrollRef, olderAnchorRef });
  const [open, setOpen] = useState(false);

  const summary = store.sessions.find((s) => s.sessionId === sessionId) ?? store.allSessions.find((s) => s.sessionId === sessionId);
  const wsPath = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId)?.path;

  const last = useMemo(() => {
    const groups = groupTurns(items);
    return groups.length > 0 ? groups[groups.length - 1]! : null;
  }, [items]);

  if (last === null) return null;
  const proc = last.turn !== null ? computeTurnProcess(last.items) : null;
  const hidden = new Set(proc !== null && !open ? proc.processIndices : []);
  const liveItem = liveRunning ? last.items[last.items.length - 1] : undefined;

  return (
    <div className="composer-float-tail">
      {proc !== null && <TurnProcessBar info={proc} open={open} onToggle={() => setOpen((v) => !v)} />}
      {last.items.map((item, index) => (
        hidden.has(index) ? null : (
          <Item
            key={item.key}
            item={item}
            running={item === liveItem}
            sessionId={sessionId}
            wsPath={wsPath}
            cwd={summary?.cwd}
            hideThinking={proc !== null && !open && !!proc.inlineReasoning}
          />
        )
      ))}
    </div>
  );
}
