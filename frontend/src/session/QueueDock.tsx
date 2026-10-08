// 排队区（会话框上方一叠胶囊）：**引擎还没领取**的消息一条一枚——排队（next-turn）
// 与插话中（next-step）都摆在这里，因此两种都能编辑/删除（引擎的 session.updateQueue
// 对两者都收；只有「立即」限定 next-turn，插话中的不给这枚）。胶囊平时只占一行文本，
// hover 才浮出操作；数据来自 store.queues（session/control 帧），操作走 updateQueue，
// 引擎应用后广播新快照，胶囊随之刷新。

import { useState } from "react";
import { ArrowUp, Pencil, Trash2, X } from "lucide-react";
import { api } from "../api";
import { t, tt } from "../i18n";
import { alertDialog } from "../components/DialogHost";
import { useCompositionGuard } from "../useCompositionGuard";
import { IconCheckOutline16 } from "../components/Icons";
import type { SessionQueuedItem } from "../types";
import { queueText } from "./format";

/** 一行状态词：排队中（还在 next-turn 等轮边界）/ 插话中（已递给当前轮，下一步生效）。 */
function stateLabel(item: SessionQueuedItem): string {
  return item.placement === "steering" ? t("插话中") : t("排队中");
}

export function QueueDock({ sessionId, items }: { sessionId: string; items: SessionQueuedItem[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const ime = useCompositionGuard();
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
  return (
    <div className="queue-dock">
      {items.map((item) => {
        const text = queueText(item);
        const editing = editingId === item.id;
        return (
          <div className="queue-pill" key={item.id} data-editing={editing ? "true" : undefined}>
            {editing ? (
              <>
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
                <div className="queue-actions">
                  <button className="queue-btn" data-tip={t("保存排队消息")} aria-label={t("保存排队消息")} onClick={() => saveEdit(item.id)}>
                    <IconCheckOutline16 size={13} />
                  </button>
                  <button className="queue-btn" data-tip={t("取消编辑")} aria-label={t("取消编辑")} onClick={() => setEditingId(null)}>
                    <X size={13} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="queue-state">{stateLabel(item)}</span>
                <span className="queue-text" data-tip={text}>{text}</span>
                <div className="queue-actions">
                  {item.placement === "queued" && (
                    <button className="queue-now" data-tip={t("立即插队执行")} onClick={() => void mutate(item.id, { kind: "steer" })}>
                      <ArrowUp size={13} />
                      {t("立即")}
                    </button>
                  )}
                  <button className="queue-btn" data-tip={t("编辑排队消息")} aria-label={t("编辑排队消息")} onClick={() => { setEditingId(item.id); setDraft(text); }}>
                    <Pencil size={13} />
                  </button>
                  <button className="queue-btn" data-tip={t("删除排队消息")} aria-label={t("删除排队消息")} onClick={() => void mutate(item.id, { kind: "remove" })}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
