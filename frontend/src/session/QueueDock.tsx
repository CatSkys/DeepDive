// 排队消息卡（官方 QueueDock 式，R-007 从 SessionView 搬出）：挂在会话框上方，
// 行内 立即/编辑/删除；数据来自 store.queues（session/queue 帧），操作走
// session.updateQueue，引擎应用后广播新快照，卡片随之刷新。
// 只摆 placement=queued 的项——立即发送/插话中的消息按用户定稿走流内用户气泡
//（SteeringMessages），不在这里占一条「发送中」。

import { useState } from "react";
import { ArrowUp, Pencil, Trash2, X } from "lucide-react";
import { api } from "../api";
import { t, tt } from "../i18n";
import { alertDialog } from "../components/DialogHost";
import { useCompositionGuard } from "../useCompositionGuard";
import { IconCheckOutline16 } from "../components/Icons";
import type { SessionQueuedItem } from "../types";
import { queueText } from "./format";
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
          <div className="queue-row" key={item.id}>
            {editing ? (
              <>
                <input
                  className="queue-edit"
                  value={draft}
                  autoFocus
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
                  <button className="queue-btn" data-tip={t("保存排队消息")} onClick={() => saveEdit(item.id)}>
                    <IconCheckOutline16 size={14} />
                  </button>
                  <button className="queue-btn" data-tip={t("取消编辑")} onClick={() => setEditingId(null)}>
                    <X size={14} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="queue-text" data-tip={text}>{text}</span>
                <div className="queue-actions">
                  <button className="queue-now" data-tip={t("立即插队执行")} onClick={() => void mutate(item.id, { kind: "steer" })}>
                    <ArrowUp size={14} />
                    {t("立即")}
                  </button>
                  <button className="queue-btn" data-tip={t("编辑排队消息")} onClick={() => { setEditingId(item.id); setDraft(text); }}>
                    <Pencil size={14} />
                  </button>
                  <button className="queue-btn" data-tip={t("删除排队消息")} onClick={() => void mutate(item.id, { kind: "remove" })}>
                    <Trash2 size={14} />
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

