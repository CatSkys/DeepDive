import { useState } from "react";
import {
  ArrowUpFromLine, Check, ChevronDown, FileDiff, GitBranch,
  GitCommitHorizontal,
} from "lucide-react";
import { gitRun } from "../host";
import { t, tt } from "../i18n";
import { useCompositionGuard } from "../useCompositionGuard";
import type { GitStatus } from "../types";

// 状态胶囊的 Git 分区（摘要卡片，参考环境信息卡三行式）：变更 / 分支 /
// 提交或推送。动作全部经壳层 git-run 通道（参数数组直传 Process，不经
// shell）；提交 = git add -A + commit -m（信息行内输入），提交并推送在
// 其后追加 git push。

type Busy = "checkout" | "commit" | "push" | null;

export function CapsuleGitSection({ wsPath, git, onRefresh }: {
  wsPath?: string;
  git: GitStatus;
  onRefresh: () => void;
}) {
  const [branchOpen, setBranchOpen] = useState(false);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<string | null>(null);
  const ime = useCompositionGuard();

  const run = async (args: string[], kind: Exclude<Busy, null>, done: string): Promise<boolean> => {
    if (!wsPath || busy !== null) return false;
    setBusy(kind);
    const r = await gitRun(wsPath, args);
    setBusy(null);
    const ok = !!r?.ok;
    // 失败取 git 输出尾部（报错在 stderr 尾部）；成功用短文案
    setNote(ok ? done : `${t("失败")}：${(r?.output ?? "").trim().split("\n").filter(Boolean).pop() ?? ""}`);
    if (ok) onRefresh();
    return ok;
  };

  const toggleBranches = async () => {
    setMenuOpen(false);
    const next = !branchOpen;
    setBranchOpen(next);
    if (!next) return;
    setBranches(null);
    const r = wsPath ? await gitRun(wsPath, ["for-each-ref", "refs/heads", "--format=%(refname:short)"]) : null;
    setBranches(r?.ok ? r.output.split("\n").map((s) => s.trim()).filter(Boolean) : []);
  };

  const checkout = async (name: string) => {
    const ok = await run(["checkout", name], "checkout", tt("已切换到 {b}", "Switched to {b}", { b: name }));
    if (ok) setBranchOpen(false);
  };

  const commit = async (push: boolean) => {
    const message = msg.trim();
    if (!wsPath || !message) return;
    const dir = wsPath;
    setMsg("");
    setBusy("commit");
    const add = await gitRun(dir, ["add", "-A"]);
    const created = add?.ok ? await gitRun(dir, ["commit", "-m", message]) : null;
    let ok = !!created?.ok;
    if (ok && push) ok = !!(await gitRun(dir, ["push"]))?.ok;
    setBusy(null);
    const doneText = push ? t("已提交并推送") : t("已提交");
    setNote(ok ? doneText : `${t("失败")}：${(created?.output ?? "").trim().split("\n").filter(Boolean).pop() ?? ""}`);
    if (ok) onRefresh();
  };

  const doPush = async () => {
    await run(["push"], "push", t("已推送"));
  };

  const busyLabel = busy === "commit" ? t("提交中…") : busy === "push" ? t("推送中…") : t("切换中…");

  return (
    <div className="capsule-sec">
      <div className="capsule-row">
        <FileDiff size={14} />
        <span className="capsule-row-text">{t("变更")}</span>
        <span className="capsule-row-meta"><b className="capsule-add">+{git.additions}</b> <b className="capsule-del">−{git.deletions}</b></span>
      </div>
      <button type="button" className="capsule-row-btn" disabled={busy !== null} onClick={() => void toggleBranches()}>
        <GitBranch size={14} />
        <span className="capsule-row-text">{git.branch ?? "—"}</span>
        <ChevronDown size={13} className="capsule-row-go" style={branchOpen ? undefined : { transform: "rotate(-90deg)" }} />
      </button>
      {branchOpen && (
        <div className="capsule-branches">
          {branches === null && <span className="capsule-note">{t("载入中…")}</span>}
          {branches !== null && branches.length === 0 && <span className="capsule-note">{t("无结果")}</span>}
          {branches?.map((b) => (
            <button
              key={b}
              type="button"
              className="capsule-branch"
              disabled={busy !== null || b === git.branch}
              onClick={() => void checkout(b)}
            >
              <span className="capsule-row-text">{b}</span>
              {b === git.branch && <Check size={12} className="capsule-check" />}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="capsule-row-btn" disabled={busy !== null} onClick={() => { setBranchOpen(false); setMenuOpen((v) => !v); }}>
        <GitCommitHorizontal size={14} />
        <span className="capsule-row-text">{t("提交或推送")}</span>
        <ChevronDown size={13} className="capsule-row-go" style={menuOpen ? undefined : { transform: "rotate(-90deg)" }} />
      </button>
      {menuOpen && (
        <div className="capsule-commit">
          <input
            className="capsule-input"
            placeholder={t("输入提交信息…")}
            value={msg}
            autoFocus
            onChange={(e) => setMsg(e.target.value)}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            onKeyDown={(e) => {
              if (ime.swallow(e)) return;
              if (e.key === "Enter" && msg.trim() && busy === null) void commit(false);
            }}
          />
          <button type="button" className="capsule-row-btn" disabled={busy !== null || !msg.trim()} onClick={() => void commit(false)}>
            <GitCommitHorizontal size={14} /><span>{tt("提交", "Commit")}</span>
          </button>
          <button type="button" className="capsule-row-btn" disabled={busy !== null || !msg.trim()} onClick={() => void commit(true)}>
            <ArrowUpFromLine size={14} /><span>{t("提交并推送")}</span>
          </button>
          <button type="button" className="capsule-row-btn" disabled={busy !== null} onClick={() => void doPush()}>
            <ArrowUpFromLine size={14} /><span>{t("推送")}</span>
          </button>
        </div>
      )}
      {busy && <div className="capsule-note">{busyLabel}</div>}
      {note && <div className="capsule-note">{note}</div>}
    </div>
  );
}
