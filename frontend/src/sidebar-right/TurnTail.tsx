// 悬浮输入框上方那张"最近一轮"卡（参考图两态：收起 = 一行「已工作 x ›」，展开 = 整轮内容）。
//
// 收起是**默认态**：只留一行头（`已工作 x` + 展开箭头），点它摊开本轮。头永远在——
// 轮跑着时用 runningSince 现算并每秒走字，轮结束后用引擎给的本轮耗时（`computeTurnProcess`）。
// 展开后渲染的是会话流里同一批组件（`Item`），不另写渲染。
//
// 不管什么：历史分页、翻页锚点、产物面板——那些是会话页的事。
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { tt } from "../i18n";
import { Item } from "../session/Item";
import { computeTurnProcess, turnWorkLabel } from "../session/turnProcess";
import { useSessionEvents } from "../session/useSessionEvents";
import { groupTurns } from "../turnGroups";
import { useStore } from "../store";

export function TurnTail({ sessionId }: { sessionId: string }) {
  const store = useStore();
  // 这两支锚点只有历史翻页用；叠加层不翻页，给空引用即可
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const olderAnchorRef = useRef<HTMLElement | null>(null);
  const { items, liveRunning, runningSince } = useSessionEvents(sessionId, { scrollRef, olderAnchorRef });
  const [open, setOpen] = useState(false);
  // 跑着的轮没有 turn-tail（引擎收尾才写），耗时只能现算；每秒推一次让"已工作 x"走字
  const [, tick] = useState(0);
  useEffect(() => {
    if (runningSince === null || runningSince === undefined) return;
    const timer = window.setInterval(() => tick((v) => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, [runningSince]);

  const summary = store.sessions.find((s) => s.sessionId === sessionId) ?? store.allSessions.find((s) => s.sessionId === sessionId);
  const wsPath = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId)?.path;

  const last = useMemo(() => {
    const groups = groupTurns(items);
    return groups.length > 0 ? groups[groups.length - 1]! : null;
  }, [items]);

  if (last === null) return null;
  const proc = last.turn !== null ? computeTurnProcess(last.items) : null;
  const durationMs = proc?.durationMs ?? (runningSince == null ? null : Date.now() - runningSince);
  const liveItem = liveRunning ? last.items[last.items.length - 1] : undefined;

  return (
    <div className="composer-float-tail" data-open={open || undefined}>
      <button
        type="button"
        className="composer-float-head"
        aria-expanded={open}
        aria-label={open ? tt("收起这一轮", "Collapse this turn") : tt("展开这一轮", "Expand this turn")}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="composer-float-head-label">
          {durationMs === null ? tt("本轮", "This turn") : turnWorkLabel(durationMs, tt)}
        </span>
        <ChevronDown size={14} className="composer-float-chevron" />
      </button>
      {open && last.items.map((item) => (
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
