// 状态面板的 Git 区（区头与折叠由 CapsuleSection 提供）。三行的形状照 ZCode
// ConversationStatusPanel 的 GitStatusSection：**每行都是 h-8 的整行按钮**——图标 16、
// 标签 flex-1 截断、值等宽右对齐、hover 底色；**动作不就地展开**，而是开各自的浮层
// 或对话框（他们点「提交或推送」开的是提交对话框，行本身只占一行）。
// 动作全部经壳层 git-run 通道（参数数组直传 Process，不经 shell）。
//
// 与他们不同、且如实记下的两处：
//  ① 他们的「更改」行可点，开的是 Git review 页；本仓没有审阅页，故按他们"无回调"
//     的降级走禁用态（他们代码里正是这么降级的：disabled + 半透明）。
//  ② 他们的提交与推送是两个对话框 + 一个动作菜单（GitActionMenu 1,404 行）；本仓
//     复用现有 promptDialog/confirmDialog，三个动作收在一个随行展开的小菜单里。
import { useRef, useState } from "react";
import { Check, ChevronDown, CloudUpload, FileDiff, GitBranch, GitCommitHorizontal } from "lucide-react";
import { gitRun } from "../host";
import { t, tt } from "../i18n";
import { confirmDialog, promptDialog } from "./DialogHost";
import type { GitStatus } from "../types";

type Busy = "checkout" | "commit" | "push" | null;

export function CapsuleGitSection({ wsPath, git, onRefresh }: {
  wsPath?: string;
  git: GitStatus;
  onRefresh: () => void;
}) {
  const [branchOpen, setBranchOpen] = useState(false);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<string | null>(null);

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

  // 分支列表请求序号门（同 Sidebar 全文搜索 searchReqRef）：快速开关时旧响应不得覆盖新状态
  const branchesReqRef = useRef(0);
  const toggleBranches = async () => {
    setMenuOpen(false);
    const next = !branchOpen;
    setBranchOpen(next);
    if (!next) return;
    setBranches(null);
    const seq = ++branchesReqRef.current;
    const r = wsPath ? await gitRun(wsPath, ["for-each-ref", "refs/heads", "--format=%(refname:short)"]) : null;
    if (branchesReqRef.current !== seq) return;
    setBranches(r?.ok ? r.output.split("\n").map((s) => s.trim()).filter(Boolean) : []);
  };

  const checkout = async (name: string) => {
    const ok = await run(["checkout", name], "checkout", tt("已切换到 {b}", "Switched to {b}", { b: name }));
    if (ok) setBranchOpen(false);
  };

  // 提交信息在对话框里问（ZCode 的 GitCommitDialog 同形）；取消即中止，不产生副作用。
  const commitFlow = async (push: boolean) => {
    setMenuOpen(false);
    const answer = await promptDialog({
      title: t("提交信息"),
      placeholder: t("输入提交信息…"),
      confirmLabel: push ? t("提交并推送") : t("提交"),
    });
    const message = answer?.trim();
    if (!wsPath || !message) return;
    const dir = wsPath;
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

  const pushFlow = async () => {
    setMenuOpen(false);
    const go = await confirmDialog({
      title: t("推送"),
      message: tt("把 {b} 推到远端？", "Push {b} to the remote?", { b: git.branch ?? "—" }),
      confirmLabel: t("推送"),
    });
    if (go) await run(["push"], "push", t("已推送"));
  };

  const dirty = git.files > 0;
  const busyLabel = busy === "commit" ? t("提交中…") : busy === "push" ? t("推送中…") : t("切换中…");

  return (
    <>
      {/* 他们的「更改」行可点（开审阅页）；本仓没有审阅页，按他们无回调时的降级渲染 */}
      <button type="button" className="capsule-git-row" disabled>
        <FileDiff size={16} />
        <span className="capsule-git-label">{tt("更改", "Changes")}</span>
        <span className="capsule-row-meta"><b className="capsule-add">+{git.additions}</b> <b className="capsule-del">−{git.deletions}</b></span>
      </button>
      <button type="button" className="capsule-git-row" disabled={busy !== null} onClick={() => void toggleBranches()}>
        <GitBranch size={16} />
        <span className="capsule-git-label">{git.branch ?? "—"}</span>
        <ChevronDown size={14} className="capsule-row-go" style={branchOpen ? undefined : { transform: "rotate(-90deg)" }} />
      </button>
      {/* 分支列表与动作菜单共用同一张行下卡片（用户定稿：两处统一） */}
      {branchOpen && (
        <div className="capsule-card">
          {branches === null && <span className="capsule-note">{t("载入中…")}</span>}
          {branches !== null && branches.length === 0 && <span className="capsule-note">{t("无结果")}</span>}
          {branches?.map((b) => (
            <button
              key={b}
              type="button"
              className="capsule-card-item"
              aria-current={b === git.branch ? "true" : undefined}
              disabled={busy !== null || b === git.branch}
              onClick={() => void checkout(b)}
            >
              <GitBranch size={16} />
              <span className="capsule-git-label">{b}</span>
              {b === git.branch && <Check size={14} className="capsule-check capsule-card-check" />}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="capsule-git-row" disabled={busy !== null} onClick={() => { setBranchOpen(false); setMenuOpen((v) => !v); }}>
        <GitCommitHorizontal size={16} />
        <span className="capsule-git-label">{t("提交或推送")}</span>
        <ChevronDown size={14} className="capsule-row-go" style={menuOpen ? undefined : { transform: "rotate(-90deg)" }} />
      </button>
      {menuOpen && (
        <div className="capsule-card">
          {/* 提交要脏工作树；推送只要有分支就允许（同 ZCode 的 commitEnabled/pushEnabled 分判） */}
          <button type="button" className="capsule-card-item" disabled={busy !== null || !dirty} onClick={() => void commitFlow(false)}>
            <GitCommitHorizontal size={14} /><span>{t("提交")}</span>
          </button>
          <button type="button" className="capsule-card-item" disabled={busy !== null || !dirty} onClick={() => void commitFlow(true)}>
            <CloudUpload size={14} /><span>{t("提交并推送")}</span>
          </button>
          <button type="button" className="capsule-card-item" disabled={busy !== null} onClick={() => void pushFlow()}>
            <CloudUpload size={14} /><span>{t("推送")}</span>
          </button>
        </div>
      )}
      {busy && <div className="capsule-note">{busyLabel}</div>}
      {note && <div className="capsule-note">{note}</div>}
    </>
  );
}
