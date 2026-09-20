// 自进化（设置页分区）：台账 Dashboard + 处理中（管线状态）+ 台账（已定案）+ 运行历史。
// 零人审（SPEC-SELF-EVOLUTION v3）：这里没有"采纳"——落地是自动管线的事，人只审计
// （丢弃/撤销/查看原文/打开写入会话）。会话里零 UI（SPEC §8）。

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
  global: "全局",
  plugin: "插件",
};

const RUN_LABEL: Record<EvolutionRun["kind"], string> = {
  review: "复盘",
  verify: "校验",
  apply: "写入",
  revoke: "撤销",
  gate: "证据门",
  land: "落地确认",
  consolidate: "整理",
};

/** 管线中的一条提案现在处于哪一步（处理中列表的状态词）。 */
function pipelineState(p: LessonProposal): { label: string; done: boolean } {
  if (p.gate === undefined) return { label: "证据校验中", done: false };
  if (!p.gate.verbatim || !p.gate.anchorFound) return { label: "未过证据门", done: true };
  return { label: "待落地（限速排队）", done: false };
}

export function EvolutionSection({ onOpenSession }: { onOpenSession: (sessionId: string) => void }) {
  const { t, tt, lang } = useT();
  const evo = useEvolution();
  const [busyId, setBusyId] = useState<string | null>(null);
  const processing = evo.proposals.filter((p) => p.status === "pending");
  const settled = evo.proposals.filter((p) => p.status !== "pending");

  const undo = async (id: string) => {
    setBusyId(id);
    const sessionId = await evo.revoke(id);
    setBusyId(null);
    if (sessionId !== null) onOpenSession(sessionId); // 跳到那次会话看回滚
  };

  const slices = statusSlices(evo.proposals);
  const days = activityDays(evo.proposals, evo.runs, Date.now(), 30);

  /** 开启前先说清它会动什么（可随时关；关掉即不采集、不落地、不校验）。 */
  const toggle = async (on: boolean) => {
    if (!on) { evo.setEnabled(false); return; }
    const ok = await confirmDialog({
      message: tt(
        "开启「自进化」后将发生：应用读取会话日志并从中提炼可复用的经验；通过机械校验（证据逐字、落点存在）的经验会由 Agent 自动写入仓库的知识文件（AGENTS.md / PITFALLS / SPEC / 技能正文 / 政策文件）并提交 git，每日最多 3 条；每条经验到期后会用会话日志自动验证其效果主张，无效的自动回滚。该能力不修改产品代码，可随时关闭。",
        "Enabling self-evolution means: the app reads session logs to extract reusable lessons; lessons that pass mechanical checks (verbatim evidence, existing anchor) are written automatically by an Agent into the repository's knowledge files (AGENTS.md / PITFALLS / SPEC / skill bodies / the policy file) with a git commit, at most 3 per day; each lesson's effect claim is later verified automatically against session logs, and ineffective ones are rolled back automatically. It never modifies product code, and can be turned off at any time.",
      ),
      confirmLabel: t("我明白，继续"),
      cancelLabel: t("取消"),
    });
    if (ok) evo.setEnabled(true);
  };

  return (
    <div>
      <div className={css.card}>
        <div className={css.switchRow}>
          <div className={css.switchText}>
            <div className={css.switchTitle}>{t("自进化")}</div>
            <div className={css.switchCaption}>
              {t("实验性能力，默认关闭。开启后，应用从会话中提炼可复用的经验，经机械校验后由 Agent 自动落库并提交，定期复盘、到期校验、无效自动回滚；不修改产品代码，会读取会话日志并消耗模型额度。开关对采集与自动化即时生效，对会话内的提示在应用下次启动后生效。")}
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
            ? t("尚未运行复盘。")
            : tt("上次复盘：{t}", "Last review: {t}", { t: runTimeText(evo.lastReviewAt, lang) })}
          {" · "}
          {t("经验自动落地并接受效果校验；判定标准见仓库 docs/EVOLUTION-POLICY.md。")}
        </div>
      </div>

      <div className={css.sectionLabel}>{t("处理中")}</div>
      {processing.length === 0 ? (
        <div className={css.empty}>{t("暂无处理中的经验。经验由会话中的明确要求或后台复盘产出。")}</div>
      ) : (
        processing.map((p) => (
          <Row
            key={p.id}
            proposal={p}
            busy={busyId === p.id || evo.busy}
            onDismiss={() => evo.dismiss(p.id)}
            onOpenSession={onOpenSession}
          />
        ))
      )}

      {settled.length > 0 && (
        <>
          <div className={css.sectionLabel}>{t("台账")}</div>
          {settled.map((p) => (
            <Row
              key={p.id}
              proposal={p}
              busy={busyId === p.id || evo.busy}
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
                {r.sessionId !== "" ? (
                  <button className={css.link} onClick={() => onOpenSession(r.sessionId)}>
                    <FileDiff size={12} /> {t("打开会话")}
                  </button>
                ) : (
                  <span className={css.status}>{t("本机执行")}</span>
                )}
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

/** 一行经验：标题行（类别 · 落点 · 锚点 · 状态 · 展开）+ 展开后的正文/证据/主张与动作。 */
function Row({ proposal, busy, onDismiss, onRevoke, onOpenSession }: {
  proposal: LessonProposal;
  busy: boolean;
  onDismiss?: () => void;
  onRevoke?: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const { t, tt } = useT();
  const [open, setOpen] = useState(false);
  const verdict = proposal.verdict;
  const settled = proposal.status !== "pending";
  const pipe = settled ? null : pipelineState(proposal);
  return (
    <div className={css.row} data-status={proposal.status}>
      <button className={css.rowHead} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={css.chip}>{t(CATEGORY_LABEL[proposal.category])}</span>
        <span className={css.chipQuiet}>{HOME_LABEL[proposal.home]}</span>
        <span className={css.anchor}>{proposal.anchor}</span>
        <span className={css.spacer} />
        {pipe !== undefined && pipe !== null && (
          <span className={css.status} data-done={pipe.done || undefined}>{t(pipe.label)}</span>
        )}
        {verdict !== undefined && (
          <span className={css.verdict} data-verdict={verdict.verdict}>
            {tt("{b} → {a} · {v}", "{b} → {a} · {v}", {
              b: String(verdict.before), a: String(verdict.after),
              v: verdict.verdict === "effective" ? t("有效") : verdict.verdict === "ineffective" ? t("无效") : t("样本不足"),
            })}
          </span>
        )}
        {settled && (
          <span className={css.status}>
            {proposal.status === "applied"
              ? (proposal.landing?.landed === true
                ? tt("已落地 {c}", "landed {c}", { c: proposal.landing.commit?.slice(0, 7) ?? "" })
                : t("落地中"))
              : proposal.status === "dismissed" ? t("已丢弃") : t("已退役")}
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
            {proposal.origin.sessionId !== "" && (
              <button className={css.link} onClick={() => onOpenSession(proposal.origin.sessionId)}>
                <ScrollText size={12} /> {t("查看原文")}
              </button>
            )}
            {proposal.appliedSessionId !== undefined && (
              <button className={css.link} onClick={() => onOpenSession(proposal.appliedSessionId!)}>
                <FileDiff size={12} /> {t("查看写入会话")}
              </button>
            )}
            <span className={css.spacer} />
            {onRevoke && <button className={css.btn} disabled={busy} onClick={onRevoke}>{t("撤销")}</button>}
            {onDismiss && <button className={css.btn} disabled={busy} onClick={onDismiss}>{t("丢弃")}</button>}
          </div>
        </div>
      )}
    </div>
  );
}
