import { useState } from "react";
import {
  ArrowUpFromLine, Check, ChevronDown, FileDiff, GitBranch,
  GitCommitHorizontal, GitMerge,
} from "lucide-react";
import { gitRun } from "../host";
import { t, tt } from "../i18n";import type { GitStatus } from "../types";

// 状态胶囊的 Git 分区（摘要卡片）：已改动/当前分支两行实况 + 切换分支/
// 提交改动/推送三个可执行动作，全部经壳层 git-run 通道（参数数组直传
// Process，不经 shell）。提交 = git add -A + commit -m（信息行内输入）。

type Busy = "checkout" | "commit" | "push" | null;

export function CapsuleGitSection({ wsPath, git, onRefresh }: {
  wsPath?: string;
  git: GitStatus;
  onRefresh: () => void;
}) {
  const [branchOpen, setBranchOpen] = useState(false);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<string | null>(null);

  const run = async (args: string[], busyKind: Exclude<Busy, null>, done: string): Promise<boolean> => {
    if (!wsPath || busy !== null) return false;
    setBusy(busyKind);
    const r = await gitRun(wsPath, args);
    setBusy(null);
    const ok = !!r?.ok;
    // 失败取 git 输出尾部（报错在 stderr 尾部）；成功用短文案
    setNote(ok ? done : `${t("失败")}：${(r?.output ?? "").trim().split("\n").filter(Boolean).pop() ?? ""}`);
    if (ok) onRefresh();
    return ok;
  };

  const toggleBranches = async () => {
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

  const doCommit = async () => {
    const message = msg.trim();
    if (!message) return;
    setMsg("");
    if (await run(["add", "-A"], "commit", "")) {
      await run(["commit", "-m", message], "commit", tt("已提交：{m}", "Committed: {m}", { m: message }));
    }
  };

  const doPush = async () => {
    await run(["push"], "push", t("已推送"));
  };

  const busyLabel = busy === "commit" ? t("提交中…") : busy === "push" ? t("推送中…") : t("切换中…");

  return (
    <div className="capsule-sec">
      <div className="capsule-sec-name"><GitBranch size={12} />{git.branch ?? t("代码改动")}</div>
      <div className="capsule-row">
        <FileDiff size={13} />
        <span className="capsule-row-text">{t("已改动")}</span>
        <span className="capsule-row-meta"><b className="capsule-add">+{git.additions}</b> <b className="capsule-del">−{git.deletions}</b></span>
      </div>
      <div className="capsule-row">
        <GitBranch size={13} />
        <span className="capsule-row-text">{git.branch ?? "—"}</span>
      </div>
      <button type="button" className="capsule-row-btn" disabled={busy !== null} onClick={() => void toggleBranches()}>
        <GitMerge size={13} />
        <span className="capsule-row-text">{t("切换分支")}</span>
        <ChevronDown size={12} className="capsule-row-go" style={branchOpen ? undefined : { transform: "rotate(-90deg)" }} />
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
      <button type="button" className="capsule-row-btn" disabled={busy !== null} onClick={() => setCommitOpen((v) => !v)}>
        <GitCommitHorizontal size={13} />
        <span className="capsule-row-text">{busy === "commit" ? busyLabel : t("提交改动")}</span>
        <ChevronDown size={12} className="capsule-row-go" style={commitOpen ? undefined : { transform: "rotate(-90deg)" }} />
      </button>
      {commitOpen && (
        <div className="capsule-commit">
          <input
            className="capsule-input"
            placeholder={t("输入提交信息…")}
            value={msg}
            autoFocus
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && msg.trim() && busy === null) void doCommit(); }}
          />
          <button type="button" className="capsule-commit-btn" disabled={!msg.trim() || busy !== null} onClick={() => void doCommit()}>
            {busy === "commit" ? busyLabel : tt("提交", "Commit")}
          </button>
        </div>
      )}
      <button type="button" className="capsule-row-btn" disabled={busy !== null} onClick={() => void doPush()}>
        <ArrowUpFromLine size={13} />
        <span className="capsule-row-text">{busy === "push" ? busyLabel : t("推送")}</span>
      </button>
      {note && <div className="capsule-note">{note}</div>}
    </div>
  );
}
