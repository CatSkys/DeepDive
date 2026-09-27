// 状态面板「目标」区的区体。原先这是 composer 上方的独立目标条（GoalBar），
// 按用户要求并进面板、那条 bar 撤掉——能力一件不少地搬过来：阶段与阻塞原因、
// 目标文本、暂停/恢复（blocked 由模型自行阻塞，与 paused 一样需用户手动恢复）、
// 就地编辑、清除。
// 动作全部 CAS（用投影当前的 id+revision）；pendingRef 挡同帧双击；goal id 变化
// 重置编辑态，防止误写新目标。已完成的目标只留「清除」——旧 bar 在 complete 时整条
// 隐藏，那个目标反而清不掉。
import { useEffect, useRef, useState } from "react";
import { Check, CircleCheck, Flag, Pause, Pencil, Play, Trash2, X } from "lucide-react";
import { api } from "../api";
import { t, tt } from "../i18n";
import { useCompositionGuard } from "../useCompositionGuard";
import { goalPhasePair, type CapsuleGoal } from "./capsuleModel";

export function CapsuleGoalSection({ goal, sessionId, onChange }: {
  goal: CapsuleGoal;
  sessionId: string;
  /** 动作成功后由父级刷新投影（mux 推送通常先到，兜底轮询）。 */
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const ime = useCompositionGuard();

  useEffect(() => {
    setEditing(false);
    setError(null);
  }, [goal.id]);

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

  const cas = () => ({ id: goal.id, revision: goal.revision });
  const edit = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    await run(() => api.goalEdit({ sessionId, ref: cas(), objective: trimmed }));
    setEditing(false);
  };

  const complete = goal.phase === "complete";
  const phaseLabel = goal.phase === "blocked"
    ? (goal.blockedReason?.message ?? tt(...goalPhasePair("blocked")))
    : tt(...goalPhasePair(goal.phase));

  if (editing) {
    return (
      <div className="capsule-row">
        <Flag size={13} />
        <input
          className="capsule-inline-input"
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
        {error && <span className="capsule-note" role="alert">{error}</span>}
        <button type="button" className="capsule-icon-btn" data-tip={t("保存")} disabled={pending || !draft.trim()} onClick={() => void edit()}>
          <Check size={13} />
        </button>
        <button type="button" className="capsule-icon-btn" data-tip={t("取消")} disabled={pending} onClick={() => setEditing(false)}>
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="capsule-row">
        {/* 前导图标与摘要胶囊的目标位同款（完成 CircleCheck，否则 Flag）；
            原来的 state-dot 是裸 span，行内被 flex 压成一条竖线 */}
        {complete
          ? <CircleCheck size={13} className="capsule-check" aria-hidden="true" />
          : <Flag size={13} aria-hidden="true" />}
        <span className="capsule-row-text">{goal.objective}</span>
      </div>
      {/* 阶段词（进行中/受阻…）与动作钮同行：词贴左、钮贴右（用户定稿） */}
      <div className="capsule-goal-actions">
        <span
          className="capsule-row-meta capsule-goal-phase"
          data-tip={goal.phase === "blocked" ? goal.blockedReason?.message : undefined}
        >
          {phaseLabel}
        </span>
        {goal.phase === "active" && (
          <button type="button" className="capsule-icon-btn" data-tip={t("暂停目标")} disabled={pending} onClick={() => void run(() => api.goalPause({ sessionId, ref: cas() }))}>
            <Pause size={13} />
          </button>
        )}
        {(goal.phase === "paused" || goal.phase === "blocked") && (
          <button type="button" className="capsule-icon-btn" data-tip={t("恢复目标")} disabled={pending} onClick={() => void run(() => api.goalResume({ sessionId, ref: cas() }))}>
            <Play size={13} />
          </button>
        )}
        {!complete && (
          <button
            type="button"
            className="capsule-icon-btn"
            data-tip={t("编辑目标")}
            disabled={pending}
            onClick={() => { setDraft(goal.objective); setEditing(true); }}
          >
            <Pencil size={13} />
          </button>
        )}
        <button type="button" className="capsule-icon-btn" data-tip={t("清除目标")} disabled={pending} onClick={() => void run(() => api.goalClear({ sessionId, ref: cas() }))}>
          <Trash2 size={13} />
        </button>
      </div>
      {error && <div className="capsule-note" role="alert">{error}</div>}
    </>
  );
}
