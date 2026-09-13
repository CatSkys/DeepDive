// 记忆（设置页分区）：会话记忆开关 + 笔记审计面。笔记由 deepdive-session-memory
// 插件落盘（每会话一份 Markdown），这里只看与删（Ditto 记忆页同款：查看/单条
// 忘记/全部清除）——不是编辑器，笔记的正文归模型维护。

import { useCallback, useEffect, useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import { Toggle } from "../components/controls";
import { confirmDialog } from "../components/DialogHost";
import { useT } from "../i18n";
import { memoryClear, memoryDelete, memoryList, type MemoryNote } from "../host";
import { useStore } from "../store";
import css from "../evolution/Evolution.module.css";

export function MemorySection() {
  const { t, tt } = useT();
  const store = useStore();
  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void memoryList().then(setNotes);
  }, []);
  useEffect(refresh, [refresh]);

  /** 开启前说清它做什么（可随时关；关掉后插件不再挂载，对运行中的会话不生效）。 */
  const toggle = async (on: boolean) => {
    if (!on) { store.setSessionMemoryEnabled(false); return; }
    const ok = await confirmDialog({
      message: tt(
        "开启「会话记忆」后将发生：每个会话获得一份可累积的 Markdown 笔记，在每个用户轮开始时注入给模型，模型可在工作过程中用工具更新它，并可主动压缩历史上下文。笔记存储在本机引擎目录，可在本页查看或删除；开启会增加每轮的上下文占用与模型调用。该能力可在应用下次启动后关闭。",
        "Enabling session memory gives each conversation a cumulative Markdown note that is injected to the model at every user turn; the model can update it with tools while working and condense history on demand. Notes are stored locally in the engine directory and can be viewed or removed here; this increases per-turn context usage and model calls. It can be turned off after the app restarts.",
      ),
      confirmLabel: t("我明白，继续"),
      cancelLabel: t("取消"),
    });
    if (ok) store.setSessionMemoryEnabled(true);
  };

  const forget = async (sessionId: string) => {
    const ok = await confirmDialog({
      message: tt("删除该会话的笔记？删除后不可恢复。", "Delete this session's notes? This cannot be undone."),
      confirmLabel: t("删除"),
      cancelLabel: t("取消"),
    });
    if (!ok) return;
    if (await memoryDelete(sessionId)) refresh();
  };

  const clearAll = async () => {
    const ok = await confirmDialog({
      message: tt("清空全部会话笔记？删除后不可恢复。", "Clear all session notes? This cannot be undone."),
      confirmLabel: t("全部清除"),
      cancelLabel: t("取消"),
    });
    if (!ok) return;
    if (await memoryClear()) refresh();
  };

  return (
    <div className={css.col}>
      <div className={css.card}>
        <div className={css.switchRow}>
          <div className={css.switchText}>
            <div className={css.switchTitle}>{t("会话记忆")}</div>
            <div className={css.switchCaption}>
              {t("实验性能力，默认关闭。开启后，每个会话维护一份笔记（目标、计划、踩过的坑等），每轮注入给模型，长对话可用「新上下文」压缩历史而不丢要点；笔记只存本机，可在下方查看或删除。开关在应用下次启动后对会话生效。")}
            </div>
          </div>
          <Toggle on={store.sessionMemoryEnabled} onChange={(v) => void toggle(v)} />
        </div>
      </div>

      <div className={css.sectionLabel}>{tt("会话笔记（{n}）", "Session notes ({n})", { n: String(notes.length) })}</div>
      {notes.length === 0 ? (
        <div className={css.empty}>{t("暂无会话笔记。开启会话记忆并使用后，笔记会出现在这里。")}</div>
      ) : (
        notes.map((n) => (
          <div key={n.sessionId} className={css.row}>
            <button className={css.rowHead} aria-expanded={openId === n.sessionId}
              onClick={() => setOpenId((v) => (v === n.sessionId ? null : n.sessionId))}>
              <FileText size={13} />
              <span className={css.anchor}>{n.sessionId}</span>
              <span className={css.spacer} />
              <span className={css.status}>{tt("{c} 字", "{c} chars", { c: String(n.content.length) })}</span>
            </button>
            {openId === n.sessionId && (
              <div className={css.body}>
                <div className={css.content}>{n.content}</div>
                <div className={css.actions}>
                  <span className={css.spacer} />
                  <button className={css.btn} onClick={() => void forget(n.sessionId)}>
                    <Trash2 size={12} /> {t("忘记")}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))
      )}

      {notes.length > 0 && (
        <div className={css.actions}>
          <span className={css.spacer} />
          <button className={css.btn} onClick={() => void clearAll()}>{t("全部清除")}</button>
        </div>
      )}
    </div>
  );
}
