// 自进化（设置页分区）：台账 Dashboard + 待审提案 + 已处理（含校验结论）+ 运行历史。
// 会话里零 UI（SPEC §8）：提案只在设置页看，采纳/丢弃/校验/撤销都在这里。
// 政策与判据不在这里——它们归 `docs/EVOLUTION-POLICY.md` 与技能 `deepdive-evolution`。

import { useState } from "react";
import { ChevronDown, FileDiff, ScrollText } from "lucide-react";
import { runTimeText } from "../automation/model";
import { Toggle } from "../components/controls";
import { confirmDialog } from "../components/DialogHost";
import { useT } from "../i18n";
import { ActivityBars, StatusDonut } from "./Charts";
import { activityDays, statusSlices } from "./chartData";
import { useEvolution } from "./useEvolution";
import type { LessonProposal } from "./protocol";
import type { EvolutionRun } from "./store";
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

const RUN_LABEL: Record<EvolutionRun["kind"], string> = {
  review: "复盘",
  verify: "校验",
  apply: "落库",
  revoke: "撤销",
};

export function EvolutionSection({ onOpenSession }: { onOpenSession: (sessionId: string) => void }) {
  const { t, tt, lang } = useT();
  const evo = useEvolution();
  const [busyId, setBusyId] = useState<string | null>(null);
  const pending = evo.proposals.filter((p) => p.status === "pending");
  const done = evo.proposals.filter((p) => p.status !== "pending");

  const adopt = async (id: string) => {
    setBusyId(id);
    const sessionId = await evo.apply(id);
    setBusyId(null);
    if (sessionId !== null) onOpenSession(sessionId); // 跳到那次会话看落库与提交
  };
  const check = async (id: string) => {
    setBusyId(id);
    const sessionId = await evo.verify(id);
    setBusyId(null);
    if (sessionId !== null) onOpenSession(sessionId);
  };
  const undo = async (id: string) => {
    setBusyId(id);
    const sessionId = await evo.revoke(id);
    setBusyId(null);
    if (sessionId !== null) onOpenSession(sessionId);
  };

  const slices = statusSlices(evo.proposals);
  const days = activityDays(evo.proposals, evo.runs, Date.now(), 30);

  /** 开启前先说清它会动什么（可随时关；关掉即不采集、不复盘、不校验）。 */
  const toggle = async (on: boolean) => {
    if (!on) { evo.setEnabled(false); return; }
    const ok = await confirmDialog({
      message: tt(
        "开启后：本应用会读你的会话日志找可沉淀的经验，按你的模型凭据定期跑复盘与到期校验（会花 token）；你采纳提案后，由 agent 往仓库的知识文件（AGENTS.md / PITFALLS / SPEC / 技能正文 / 政策文件）写入并提交。它不改产品代码。随时可以关。",
        "Once on: the app reads your session logs for lessons worth keeping and runs periodic reviews and due-date checks on your model credentials (this spends tokens). When you accept a proposal, an agent turn writes it into the repo's knowledge files (AGENTS.md / PITFALLS / SPEC / skill bodies / the policy file) and commits. It never touches product code. You can turn it off any time.",
      ),
      confirmLabel: t("我明白，继续"),
      cancelLabel: t("取消"),
    });
    if (ok) evo.setEnabled(true);
  };

  return (
    <div className={css.col}>
      <div className={css.card}>
        <div className={css.switchRow}>
          <div className={css.switchText}>
            <div className={css.switchTitle}>{t("自进化")}</div>
            <div className={css.switchCaption}>
              {t("实验性能力：默认关。开启后应用会从会话里找可沉淀的经验、定期复盘并校验效果；提案只提议，落库要你点。它读你的会话日志、按你的模型凭据花 token，采纳后由 agent 往仓库的知识文件里写——不改产品代码。关掉即停（对新会话的指路晚一拍生效，装配在启动时读）。")}
            </div>
          </div>
          <Toggle on={evo.enabled} onChange={(v) => void toggle(v)} />
        </div>
      </div>

      <div className={css.card}>
        <StatusDonut slices={slices} total={evo.stats.total} />
        <ActivityBars days={days} />
        <div className={css.note}>
          {evo.lastReviewAt === null
            ? t("还没跑过复盘——攒够几次回复后会自动跑。")
            : tt("上次复盘：{t}", "Last review: {t}", { t: runTimeText(evo.lastReviewAt, lang) })}
          {" · "}
          {t("提案不会自动改变行为；标准与红线见仓库的 docs/EVOLUTION-POLICY.md。")}
        </div>
      </div>

      <div className={css.sectionLabel}>{t("待审提案")}</div>
      {pending.length === 0 ? (
        <div className={css.empty}>{t("暂无待审提案。在会话里说一句「记住这个……」，或让它自己复盘提出。")}</div>
      ) : (
        pending.map((p) => (
          <Row
            key={p.id}
            proposal={p}
            busy={busyId === p.id || evo.busy}
            actionLabel={busyId === p.id ? t("交办中…") : t("采纳")}
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
            <Row
              key={p.id}
              proposal={p}
              busy={busyId === p.id || evo.busy}
              actionLabel={p.verdict === undefined ? t("校验") : undefined}
              onAction={p.status === "applied" && p.predict !== null && p.verdict === undefined ? () => void check(p.id) : undefined}
              onRevoke={p.status === "applied" ? () => void undo(p.id) : undefined}
              onOpenSession={onOpenSession}
            />
          ))}
        </>
      )}

      {evo.runs.length > 0 && (
        <>
          <div className={css.sectionLabel}>{t("运行历史")}</div>
          <div className={css.runs}>
            {evo.runs.slice(0, 6).map((r) => (
              <div key={r.id} className={css.runRow}>
                <span className={css.chipQuiet}>{t(RUN_LABEL[r.kind])}</span>
                <button className={css.link} onClick={() => onOpenSession(r.sessionId)}>
                  <FileDiff size={12} /> {t("打开会话")}
                </button>
                <span className={css.spacer} />
                <span className={css.status}>{runTimeText(r.at, lang)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** 一行提案：标题行（类别 · 落点 · 锚点 · 展开）+ 展开后的正文/证据/主张与动作。 */
function Row({ proposal, busy, actionLabel, onAction, onDismiss, onRevoke, onOpenSession }: {
  proposal: LessonProposal;
  busy: boolean;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  onRevoke?: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const { t, tt } = useT();
  const [open, setOpen] = useState(false);
  const verdict = proposal.verdict;
  return (
    <div className={css.row} data-status={proposal.status}>
      <button className={css.rowHead} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={css.chip}>{t(CATEGORY_LABEL[proposal.category])}</span>
        <span className={css.chipQuiet}>{HOME_LABEL[proposal.home]}</span>
        <span className={css.anchor}>{proposal.anchor}</span>
        <span className={css.spacer} />
        {verdict !== undefined && (
          <span className={css.verdict} data-verdict={verdict.verdict}>
            {tt("复现 {n} 次 · {v}", "{n} recurrences · {v}", { n: String(verdict.recurrences), v: verdict.verdict === "effective" ? t("有效") : t("无效") })}
          </span>
        )}
        {proposal.status !== "pending" && verdict === undefined && (
          <span className={css.status}>
            {proposal.status === "applied" ? t("已交办") : proposal.status === "dismissed" ? t("已丢弃") : t("已过期")}
          </span>
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
            {onRevoke && <button className={css.btn} disabled={busy} onClick={onRevoke}>{t("撤销")}</button>}
            {onDismiss && <button className={css.btn} disabled={busy} onClick={onDismiss}>{t("丢弃")}</button>}
            {onAction && <button className={css.btnPrimary} disabled={busy} onClick={onAction}>{actionLabel}</button>}
          </div>
        </div>
      )}
    </div>
  );
}
