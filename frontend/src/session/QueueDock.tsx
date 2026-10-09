// 排队区（会话框上方一叠胶囊）：**引擎还没领取**的消息一条一枚——排队（next-turn）
// 与插话中（next-step）都摆在这里，因此两种都能编辑/删除（引擎的 session.updateQueue
// 对两者都收；只有「立即」限定 next-turn，插话中的不给这枚）。
//
// 交互是**点击展开**（用户定稿：hover 展开不好控制）：常态只包住一行文本的小胶囊，
// 点它长成整行并浮出操作，点别处收回。数据来自 store.queues（session/control 帧），
// 操作走 updateQueue，引擎应用后广播新快照，胶囊随之刷新。

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Pencil, Trash2, X } from "lucide-react";
import { api } from "../api";
import { t, tt } from "../i18n";
import { alertDialog } from "../components/DialogHost";
import { useCompositionGuard } from "../useCompositionGuard";
import { IconCheckOutline16 } from "../components/Icons";
import type { SessionQueuedItem } from "../types";
import { queueAttachments, queueLabel, queueText } from "./format";

export function QueueDock({ sessionId, items }: { sessionId: string; items: SessionQueuedItem[] }) {
  /** 展开的那一枚（同一时刻只展开一枚）。 */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const ime = useCompositionGuard();
  const dockRef = useRef<HTMLDivElement>(null);
  // 点别处收回（与 Tooltip/菜单同一套：document 级 mousedown + 容器包含判定）。
  useEffect(() => {
    if (expandedId === null) return;
    const onDown = (e: MouseEvent) => {
      if (!dockRef.current?.contains(e.target as Node)) setExpandedId(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [expandedId]);
  const mutate = async (itemId: string, action: Parameters<typeof api.updateQueue>[0]["action"]) => {
    try {
      await api.updateQueue({ sessionId, itemId, action });
    } catch (err) {
      void alertDialog({ message: tt("排队消息操作失败：{m}", "Queue update failed: {m}", { m: (err as Error).message }) });
    }
  };
  const saveEdit = (itemId: string) => {
    // 空文本不是合法编辑（引擎也拒）：留在编辑态让用户接着改，别静默关掉。
    if (!draft.trim()) return;
    void mutate(itemId, { kind: "edit", content: [{ type: "text", text: draft.trim() }] });
    setEditingId(null);
  };
  const toggle = (id: string, expanded: boolean) => setExpandedId(expanded ? null : id);
  return (
    <div className="queue-dock" ref={dockRef}>
      {items.map((item) => {
        const text = queueText(item);
        const label = queueLabel(item);
        // 引擎的排队编辑只收文本部件（QUEUE_EDIT_NON_TEXT）：带附件的改一次就把
        // 附件丢了，所以那种行不给编辑钮——不拿数据换功能。
        const { images, files } = queueAttachments(item);
        const editable = images === 0 && files === 0;
        const editing = editingId === item.id;
        const expanded = editing || expandedId === item.id;
        return (
          <div
            className="queue-pill"
            key={item.id}
            data-expanded={expanded ? "true" : undefined}
            /* 展开态里装着操作钮，不再把它当按钮（嵌套交互元素不是合法 a11y 形状） */
            role={expanded ? undefined : "button"}
            tabIndex={expanded ? -1 : 0}
            aria-expanded={expanded ? undefined : false}
            onClick={() => { if (!expanded) toggle(item.id, false); }}
            onKeyDown={(e) => {
              if (expanded) return;
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(item.id, false); }
            }}
          >
            {editing ? (
              <input
                className="queue-edit"
                value={draft}
                autoFocus
                aria-label={t("编辑排队消息")}
                onChange={(e) => setDraft(e.target.value)}
                onCompositionStart={ime.onCompositionStart}
                onCompositionEnd={ime.onCompositionEnd}
                onKeyDown={(e) => {
                  if (ime.swallow(e)) return;
                  if (e.key === "Enter") saveEdit(item.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
              />
            ) : (
              <span className="queue-text" data-tip={expanded ? undefined : label}>{label}</span>
            )}
            {expanded && (
              <div className="queue-actions">
                {editing ? (
                  <>
                    <button className="queue-btn" data-tip={t("保存排队消息")} aria-label={t("保存排队消息")} onClick={() => saveEdit(item.id)}>
                      <IconCheckOutline16 size={13} />
                    </button>
                    <button className="queue-btn" data-tip={t("取消编辑")} aria-label={t("取消编辑")} onClick={() => setEditingId(null)}>
                      <X size={13} />
                    </button>
                  </>
                ) : (
                  <>
                    {item.placement === "queued" && (
                      <button className="queue-now" data-tip={t("立即插队执行")} onClick={() => void mutate(item.id, { kind: "steer" })}>
                        <ArrowUp size={13} />
                        {t("立即")}
                      </button>
                    )}
                    <button
                      className="queue-btn"
                      data-tip={editable ? t("编辑排队消息") : t("带附件的排队消息不能编辑（排队编辑只收文本）")}
                      aria-label={t("编辑排队消息")}
                      disabled={!editable}
                      onClick={() => { setEditingId(item.id); setDraft(text); }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button className="queue-btn" data-tip={t("删除排队消息")} aria-label={t("删除排队消息")} onClick={() => void mutate(item.id, { kind: "remove" })}>
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
