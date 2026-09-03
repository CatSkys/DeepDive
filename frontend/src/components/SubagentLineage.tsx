import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Square, Users } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { t } from "../i18n";
import type { SubagentListEntry } from "../types";

// Subagent 谱系（5.2，官方 ui-subagent 移植）：会话头的直接子会话目录。
// 状态点=运行中/收起，行点击切入子会话，可续型运行中的子会话可就地中断。
// 子会话视图（origin==='subagent'）的 composer 以只读说明替代——目录寻址
// 的子会话不接受人类输入（官方 SubagentReadOnlyComposer 语义），续聊经父会话。

type ChildEntry = Extract<SubagentListEntry, { kind: "child" }>;

/// 谱系目录按钮 + 下拉（挂会话头部）。
export function SubagentLineage({ sessionId }: { sessionId: string }) {
  const { sessions, openSession } = useStore();
  const [entries, setEntries] = useState<SubagentListEntry[] | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    void api.subagentList({ parentSessionId: sessionId }).then((r) => {
      setEntries(r.entries ?? []);
    }).catch(() => setEntries([])); // 能力缺失/引擎忙 → 无谱系
  }, [sessionId]);
  useEffect(load, [load]);

  const children = (entries ?? []).filter((e): e is ChildEntry => e.kind === "child");
  const liveCount = children.filter((c) => sessions.find((s) => s.sessionId === c.id)?.running).length;
  if (!entries || children.length === 0) return null;

  const interrupt = async (childId: string) => {
    setBusy(true);
    try {
      await api.subagentInterrupt({ parentSessionId: sessionId, childSessionId: childId, mode: "continuable" });
      load();
    } catch { /* 引擎忙或不可中断：行上状态点反映实况 */ }
    setBusy(false);
  };

  return (
    <div className="lineage-wrap">
      <button
        type="button"
        className="lineage-trigger"
        data-open={open ? "true" : "false"}
        title={t("子代理谱系")}
        onClick={() => setOpen((v) => !v)}
      >
        <Users size={13} />
        {children.length}
        {liveCount > 0 && <span className="lineage-live" aria-hidden="true" />}
      </button>
      {open && (
        <div className="lineage-menu">
          <div className="lineage-head">
            <span>{t("子代理")}</span>
            <button className="lineage-refresh" title={t("刷新")} onClick={load}>
              <RefreshCw size={12} />
            </button>
          </div>
          {children.map((c) => {
            const running = !!sessions.find((s) => s.sessionId === c.id)?.running || c.activity === "running";
            const modeLabel = c.mode === "continuable" ? t("可续") : t("一次性");
            return (
              <div key={c.id} className="lineage-row">
                <button type="button" className="lineage-main" onClick={() => { setOpen(false); openSession(c.id); }}>
                  <span className={`lineage-dot${running ? " live" : ""}`} aria-hidden="true" />
                  <span className="lineage-label">{c.label ?? c.id.slice(0, 8)}</span>
                  <span className="lineage-mode">{modeLabel}{running ? ` · ${t("运行中")}` : ""}</span>
                </button>
                {running && c.mode === "continuable" && (
                  <button className="lineage-stop" title={t("中断子代理")} disabled={busy} onClick={() => void interrupt(c.id)}>
                    <Square size={11} />
                  </button>
                )}
              </div>
            );
          })}
          {(entries ?? []).some((e) => e.kind === "diagnostic") && (
            <div className="lineage-diag">{t("部分子会话状态不可读")}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** 子会话只读说明（origin==='subagent' 的会话视图 composer 替代）。 */
export function SubagentReadOnlyNotice({ parentSessionId }: { parentSessionId?: string }) {
  const { sessions, openSession } = useStore();
  const parentTitle = (sessions.find((s) => s.sessionId === parentSessionId)?.projections?.values?.title as string | undefined)
    ?? t("打开父会话");
  return (
    <div className="subagent-readonly" role="status">
      <strong>{t("这是子代理会话")}</strong>
      <span>{t("目录寻址的子会话在此只读；继续对话请回到父会话。")}</span>
      {parentSessionId && (
        <button type="button" className="subagent-parent-link" onClick={() => openSession(parentSessionId)}>
          {parentTitle}
        </button>
      )}
    </div>
  );
}
