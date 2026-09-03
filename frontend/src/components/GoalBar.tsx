import { useEffect, useRef, useState } from "react";
import { Flag, Pause, Play, Pencil, Trash2, Check, X } from "lucide-react";
import { api } from "../api";
import { t, tt } from "../i18n";
import { useCompositionGuard } from "../useCompositionGuard";
import type { GoalProjection } from "../types";

// GoalBar（5.1，官方 ui-goal GoalBar 移植）：composer 上方的目标条。
// 有目标且未完成才渲染；动作全部 CAS（ref 取投影当前 revision），
// pendingRef 挡同帧双击，goal id 变化重置编辑态防止误写新目标。

export interface GoalActions {
  onEdit: (objective: string) => Promise<void>;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onClear: () => Promise<void>;
}

const PHASE_LABEL: Record<string, [string, string]> = {
  active: ["进行中", "Active"],
  paused: ["已暂停", "Paused"],
  blocked: ["受阻", "Blocked"],
};

export function GoalBar({ projection, onChange, sessionId }: {
  projection: GoalProjection | null | undefined;
  /** 动作成功后由父级刷新投影（mux 推送通常先到，兜底轮询）。 */
  onChange: () => void;
  sessionId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const ime = useCompositionGuard();
  const goal = projection?.goal;
  const goalId = goal?.id;

  useEffect(() => {
    setEditing(false);
    setError(null);
  }, [goalId]);

  const run = async (action: () => Promise<unknown>) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const cas = () => ({ id: goal!.id, revision: goal!.revision });
  const edit = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    await run(() => api.goalEdit({ sessionId, ref: cas(), objective: trimmed }));
    setEditing(false);
  };

  if (projection === undefined || projection === null || goal!.phase === "complete") return null;

  if (editing) {
    return (
      <div className="goal-bar" data-goal-bar="">
        <span className="goal-glyph"><Flag size={13} /></span>
        <input
          className="goal-input"
          value={draft}
          autoFocus
          aria-label={t("目标")}
          onChange={(e) => setDraft(e.target.value)}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          onKeyDown={(e) => {
            if (ime.swallow(e)) return;
            if (e.key === "Enter") void edit();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        {error && <span className="goal-error" role="alert">{error}</span>}
        <button className="goal-act" title={t("保存")} disabled={pending || !draft.trim()} onClick={() => void edit()}>
          <Check size={13} />
        </button>
        <button className="goal-act" title={t("取消")} disabled={pending} onClick={() => setEditing(false)}>
          <X size={13} />
        </button>
      </div>
    );
  }

  const phasePair = PHASE_LABEL[goal!.phase] ?? PHASE_LABEL.active!;
  const phaseLabel = goal!.phase === "blocked"
    ? (goal!.blockedReason?.message ?? tt(...PHASE_LABEL.blocked!))
    : tt(...phasePair);
  return (
    <div className="goal-bar" data-goal-bar="" data-phase={goal!.phase} title={goal!.phase === "blocked" ? goal!.blockedReason?.message : undefined}>
      <span className="goal-glyph"><Flag size={13} /></span>
      <span className="goal-phase">{phaseLabel}</span>
      <span className="goal-objective">{goal!.objective}</span>
      {error && <span className="goal-error" role="alert">{error}</span>}
      <div className="goal-actions">
        {goal!.phase === "active" && (
          <button className="goal-act" title={t("暂停目标")} disabled={pending} onClick={() => void run(() => api.goalPause({ sessionId, ref: cas() }))}>
            <Pause size={13} />
          </button>
        )}
        {goal!.phase === "paused" && (
          <button className="goal-act" title={t("恢复目标")} disabled={pending} onClick={() => void run(() => api.goalResume({ sessionId, ref: cas() }))}>
            <Play size={13} />
          </button>
        )}
        <button
          className="goal-act"
          title={t("编辑目标")}
          disabled={pending}
          onClick={() => { setDraft(goal!.objective); setEditing(true); }}
        >
          <Pencil size={13} />
        </button>
        <button className="goal-act" title={t("清除目标")} disabled={pending} onClick={() => void run(() => api.goalClear({ sessionId, ref: cas() }))}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
