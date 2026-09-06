import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { api, type ImportRunResult, type ImportableSession } from "../api";
import { useT } from "../i18n";
import cssRows from "./SettingsRows.module.css";

// 导入确认弹窗（参考 ChatGPT「导入自 …」选择对话框）：点来源卡的「导入」
// 先弹出本窗——勾选要导入的会话（按项目分组，已导入的默认不勾）→「导入
// n 个会话」确认才真正执行。执行经 /api-import/import，每个选中会话一条
// item（DB 源带 sessionId 由插件只导所选；文件源按 sourcePath 去重整文件导）。

/** sessionId → importStatus 映射用；DB 源 = 一个 sourcePath 多会话。 */
const DB_FORMATS = new Set(["zcode", "opencode", "mimocode"]);

export function ImportDialog({ sourceName, format, sessions, onDone, onClose }: {
  sourceName: string;
  format: string;
  sessions: ImportableSession[];
  onDone: (summary: { imported: number; already: number; error?: string }) => void;
  onClose: () => void;
}) {
  const { t, tt } = useT();
  const fresh = useMemo(() => sessions.filter((s) => s.importStatus !== "imported"), [sessions]);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set((fresh.length > 0 ? fresh : sessions).map((s) => s.sessionId)),
  );
  const [saving, setSaving] = useState(false);

  const groups = useMemo(() => {
    const byProject = new Map<string, ImportableSession[]>();
    for (const s of sessions) {
      const key = s.project || t("无项目");
      const list = byProject.get(key) ?? [];
      list.push(s);
      byProject.set(key, list);
    }
    return [...byProject.entries()].map(([name, list]) => ({ name, sessions: list }));
  }, [sessions, t]);

  const dateFmt = (ms: number | null) =>
    ms === null
      ? ""
      : new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allChecked = selected.size === sessions.length;
  const toggleAll = () =>
    setSelected(allChecked ? new Set() : new Set(sessions.map((s) => s.sessionId)));

  const run = async () => {
    setSaving(true);
    try {
      const picked = sessions.filter((s) => selected.has(s.sessionId));
      const items = picked.map((s) => ({
        source: format,
        sourcePath: s.sourcePath,
        ...(DB_FORMATS.has(format) ? { sessionId: s.sessionId } : {}),
      }));
      const r = await api.importRun({ items });
      const results: ImportRunResult[] = r.results;
      const errors = results.filter((x) => x.error).map((x) => x.error as string);
      onDone({
        imported: results.reduce((n, x) => n + x.imported, 0),
        already: results.reduce((n, x) => n + x.alreadyImported, 0),
        error: errors[0]?.slice(0, 140),
      });
    } catch (err) {
      onDone({ imported: 0, already: 0, error: (err as Error).message.slice(0, 140) });
    }
    setSaving(false);
  };

  return createPortal(
    <div
      className={cssRows.modalOverlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
      role="dialog"
      aria-label={tt("从 {s} 导入", "Import from {s}", { s: sourceName })}
    >
      <div className={cssRows.modal} onClick={(e) => e.stopPropagation()}>
        <div className={cssRows.modalHead}>
          <span className={cssRows.modalTitle}>{tt("从 {s} 导入", "Import from {s}", { s: sourceName })}</span>
          <span className={cssRows.modalBadge}>{tt("{n} 个会话", "{n} chats", { n: sessions.length })}</span>
        </div>
        <div className={cssRows.modalBody}>
          <label className={cssRows.pickAllRow}>
            <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label={t("全选")} />
            <span>{t("全选")}</span>
            <span className={cssRows.pickCount}>
              {tt("已选 {n} 个", "{n} selected", { n: selected.size })}
            </span>
          </label>
          <div className={cssRows.pickList}>
            {groups.map((g) => (
              <div key={g.name} className={cssRows.pickGroup}>
                <div className={cssRows.pickGroupHead}>{g.name}</div>
                {g.sessions.map((s) => {
                  const imported = s.importStatus === "imported";
                  return (
                    <label key={s.sessionId} className={cssRows.pickRow}>
                      <input
                        type="checkbox"
                        checked={selected.has(s.sessionId)}
                        onChange={() => toggle(s.sessionId)}
                      />
                      <span className={cssRows.pickTitle}>{s.title || t("（无标题）")}</span>
                      {imported && <span className={cssRows.metaTag}>{t("已导入")}</span>}
                      <span className={cssRows.pickMeta}>
                        {tt("{n} 条消息", "{n} messages", { n: s.messageCount ?? 0 })}
                        {s.lastActiveAt ? ` · ${dateFmt(s.lastActiveAt)}` : ""}
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className={cssRows.modalFoot}>
          <button className={cssRows.secondaryButton} onClick={onClose} disabled={saving}>{t("取消")}</button>
          <button className={cssRows.primaryButton} disabled={saving || selected.size === 0} onClick={() => void run()}>
            {saving ? <Loader2 size={13} className={cssRows.spin} /> : null}
            {saving ? t("导入中…") : tt("导入 {n} 个会话", "Import {n} chats", { n: selected.size })}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
