// 自进化（设置页分区）：台账 Dashboard + 待审提案列表 + 已交办/已丢弃历史。
// 会话里零 UI（SPEC §8）：提案只在设置页看，采纳/丢弃都在这里。
// 政策与判据不在这里——它们归 `docs/EVOLUTION-POLICY.md` 与引擎技能 `deepdive-evolution`。

import { useState } from "react";
import { ChevronDown, FileDiff, ScrollText } from "lucide-react";
import { useT } from "../i18n";
import { useEvolution } from "./useEvolution";
import type { LessonProposal } from "./protocol";
import css from "./Evolution.module.css";

const CATEGORY_LABEL: Record<LessonProposal["category"], string> = {
  incident: "事故",
  workflow: "流程",
  fact: "事实",
  rule: "规则",
};

const HOME_LABEL: Record<LessonProposal["home"], string> = {
  agents: "AGENTS.md",
  pitfalls: "PITFALLS",
  spec: "SPEC",
  skill: "技能",
  policy: "政策",
};

export function EvolutionSection({ onOpenSession }: { onOpenSession: (sessionId: string) => void }) {
  const { t, tt } = useT();
  const evo = useEvolution();
  const [busy, setBusy] = useState<string | null>(null);
  const pending = evo.proposals.filter((p) => p.status === "pending");
  const done = evo.proposals.filter((p) => p.status !== "pending");

  const adopt = async (id: string) => {
    setBusy(id);
    const sessionId = await evo.apply(id);
    setBusy(null);
    if (sessionId !== null) onOpenSession(sessionId); // 跳到那次会话看落库与提交
  };

  return (
    <div className={css.col}>
      <div className={css.card}>
        <div className={css.cardHead}>
          <span className={css.cardTitle}>{t("经验台账")}</span>
          <span className={css.meta}>
            {tt("累计 {n} 条 · 待审 {p} · 已交办 {a} · 已丢弃 {d}", "{n} total · {p} pending · {a} handed off · {d} dismissed", {
              n: evo.stats.total, p: evo.stats.pending, a: evo.stats.applied, d: evo.stats.dismissed,
            })}
          </span>
        </div>
        <div className={css.note}>{t("默认只提议：提案不会自动改变行为，落库要你在这里采纳。标准与红线见仓库的 docs/EVOLUTION-POLICY.md。")}</div>
      </div>

      <div className={css.sectionLabel}>{t("待审提案")}</div>
      {pending.length === 0 ? (
        <div className={css.empty}>{t("暂无待审提案。在会话里说一句「记住这个……」，或让它在复盘时提出。")}</div>
      ) : (
        pending.map((p) => (
          <Row
            key={p.id}
            proposal={p}
            actionLabel={busy === p.id ? t("交办中…") : t("采纳")}
            actionDisabled={busy !== null}
            onAction={() => void adopt(p.id)}
            onDismiss={() => evo.dismiss(p.id)}
            onOpenSession={onOpenSession}
          />
        ))
      )}

      {done.length > 0 && (
        <>
          <div className={css.sectionLabel}>{t("已处理")}</div>
          {done.map((p) => (
            <Row key={p.id} proposal={p} onOpenSession={onOpenSession} />
          ))}
        </>
      )}
    </div>
  );
}

/** 一行提案：标题行（类别 · 落点 · 展开）+ 展开后的正文/证据/效果主张与动作。 */
function Row({ proposal, actionLabel, actionDisabled, onAction, onDismiss, onOpenSession }: {
  proposal: LessonProposal;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
  onDismiss?: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const { t, tt } = useT();
  const [open, setOpen] = useState(false);
  const status = proposal.status;
  return (
    <div className={css.row} data-status={status}>
      <button className={css.rowHead} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={css.chip}>{t(CATEGORY_LABEL[proposal.category])}</span>
        <span className={css.chipQuiet}>{HOME_LABEL[proposal.home]}</span>
        <span className={css.anchor}>{proposal.anchor}</span>
        <span className={css.spacer} />
        {status !== "pending" && (
          <span className={css.status}>{status === "applied" ? t("已交办") : status === "dismissed" ? t("已丢弃") : t("已过期")}</span>
        )}
        <ChevronDown size={14} className={css.chevron} data-open={open || undefined} />
      </button>
      {open && (
        <div className={css.body}>
          <div className={css.content}>{proposal.content}</div>
          <div className={css.metaLine}>
            {proposal.predict === null
              ? t("风格类（不设校验，不计入效果统计）")
              : tt("效果主张：{m} · 签名 {sig} · 窗口 {d} 天", "Claim: {m} · signature {sig} · window {d}d", {
                  m: proposal.predict.metric, sig: proposal.predict.signature, d: String(proposal.predict.windowDays),
                })}
          </div>
          <div className={css.evidence}>
            {proposal.evidence.map((e, i) => (
              <div key={i} className={css.evidenceItem}>
                <ScrollText size={12} />
                <span>{e.excerpt}</span>
              </div>
            ))}
          </div>
          <div className={css.actions}>
            {proposal.appliedSessionId !== undefined && (
              <button className={css.link} onClick={() => onOpenSession(proposal.appliedSessionId!)}>
                <FileDiff size={12} /> {t("打开落库会话")}
              </button>
            )}
            <span className={css.spacer} />
            {onDismiss && (
              <button className={css.btn} disabled={actionDisabled} onClick={onDismiss}>{t("丢弃")}</button>
            )}
            {onAction && (
              <button className={css.btnPrimary} disabled={actionDisabled} onClick={onAction}>{actionLabel}</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
