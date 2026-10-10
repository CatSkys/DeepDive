// 插话队列（用户 2026-10-10 定稿）：插话中（next-step）的消息用**消息的形态**
// 排队——用户气泡 + 右下状态行「等待引导当前任务…」，不再是排队区的小胶囊
// （排队 next-turn 的仍留在 QueueDock 胶囊里）。编辑/删除能力保留：悬停状态
// 行浮现操作钮，编辑就地把气泡换成输入框（引擎的排队编辑只收文本，带附件的
// 行不给编辑钮）。操作走 updateQueue，引擎应用后广播新快照，行随之刷新。
import { useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { api } from "../api";
import { t, tt } from "../i18n";
import { alertDialog } from "../components/DialogHost";
import { useCompositionGuard } from "../useCompositionGuard";
import { IconCheckOutline16 } from "../components/Icons";
import { UserAttachments } from "../components/AttachmentImage";
import { queueAttachments, queueLabel, queueText } from "./format";
import type { SessionQueuedItem } from "../types";

export function SteerQueue({ sessionId, items }: { sessionId: string; items: SessionQueuedItem[] }) {
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
    <div className="steer-queue">
      {items.map((item) => {
        const text = queueText(item);
        // 引擎的排队编辑只收文本部件（QUEUE_EDIT_NON_TEXT）：带附件的改一次就把
        // 附件丢了，所以那种行不给编辑钮——不拿数据换功能。
        const { images, files } = queueAttachments(item);
        const editable = images === 0 && files === 0;
        const editing = editingId === item.id;
        return (
          <div className="steer-row" key={item.id}>
            {editing ? (
              <input
                className="steer-edit"
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
              <div className="user-bubble steer-bubble">{text || queueLabel(item)}</div>
            )}
            {/* 附件带（缩略图/文件 chip）与用户消息那条同款；没有附件它自己返回 null */}
            <UserAttachments sessionId={sessionId} content={item.message.content} />
            <div className="steer-status">
              <span className="steer-actions">
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
              </span>
              <span>{t("等待引导当前任务…")}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
