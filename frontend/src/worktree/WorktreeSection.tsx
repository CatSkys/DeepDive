// 工作树（设置页分区）：给一个工作区建 git 工作树、列出/删除、把它注册成新工作区。
//
// **能做到与做不到的边界写在这里**：工作树是 git 的事，创建/删除/列出都交给 git 本体
// （`WorktreeAdmin` 只拼参数）。但「同一工作区的并行会话各跑一个工作树」**做不到**——
// 会话 cwd 创建后不可变、沙箱根 = 引擎进程 cwd（`sandbox-policy/src/index.ts:82`、
// `EngineSupervisor.swift` 的 launch cwd），所以每个工作树只能注册成**独立工作区**，
// 会话就丢了"同一项目"的分组语义。要真正做到并行隔离得改引擎（把沙箱根从 header cwd
// 改成 per-session 可解析的 workspace 根）。这一页不假装做到了那件事。

import { useCallback, useEffect, useState } from "react";
import { Folder, GitBranch, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Dropdown } from "../components/controls";
import { confirmDialog } from "../components/DialogHost";
import { inShell, revealPath, worktreeAdd, worktreeList, worktreeRemove, type WorktreeRow } from "../host";
import { useT } from "../i18n";
import { useStore } from "../store";
import css from "../settings/SettingsRows.module.css";
import { defaultBranchName, defaultWorktreePath, isMainWorktree, worktreeLabel } from "./model";

export function WorktreeSection() {
  const { t, tt } = useT();
  const store = useStore();
  const [repo, setRepo] = useState("");
  const [rows, setRows] = useState<WorktreeRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [branch, setBranch] = useState(() => defaultBranchName(new Date()));
  const [path, setPath] = useState("");
  /** 判定"哪一条是主工作树"用的仓库路径：以壳回推的 realpath 为准（git 的 porcelain
   *  给的就是 realpath，拿用户输入的原样路径比字面量会在符号链接上判错）。 */
  const [treeRepo, setTreeRepo] = useState("");
  const shell = inShell();

  const options = store.workspaces.map((w) => ({ v: w.path, label: w.title || w.path, description: w.path }));
  const active = repo || (options[0]?.v ?? "");

  const refresh = useCallback(() => {
    // 列表要跑本机 git（壳的事）：浏览器访问时不去发那个必然超时的桥请求，直接说清楚
    if (!shell || !active) { setRows([]); setLoaded(true); return; }
    setBusy(true);
    void worktreeList(active).then((result) => {
      setRows(result.worktrees);
      setTreeRepo(result.resolvedRepo || active);
      setError(result.ok ? null : (result.error ?? t("列不出来，可能不是 git 仓库。")));
      setLoaded(true);
      setBusy(false);
    });
  }, [active, t, shell]);
  useEffect(refresh, [refresh]);

  // 换仓库时把默认目录跟着改（分支名保留用户已改的）
  useEffect(() => {
    if (active) setPath(defaultWorktreePath(active, branch));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const create = async () => {
    if (!active || !branch.trim() || !path.trim()) return;
    setBusy(true);
    const result = await worktreeAdd(active, branch.trim(), path.trim());
    setBusy(false);
    if (!result.ok) { setError(result.error ?? t("创建失败")); return; }
    setError(null);
    setBranch(defaultBranchName(new Date()));
    refresh();
  };

  const remove = async (row: WorktreeRow) => {
    const ok = await confirmDialog({
      message: tt(
        "删除工作树 {path}？git 会在有未提交改动时拒绝（这里不带 --force）。",
        "Remove the worktree at {path}? git refuses when there are uncommitted changes (no --force here).",
        { path: row.path },
      ),
      confirmLabel: t("删除"),
      cancelLabel: t("取消"),
    });
    if (!ok) return;
    const result = await worktreeRemove(active, row.path);
    if (!result.ok) { setError(result.error ?? t("删除失败")); return; }
    setError(null);
    refresh();
  };

  const register = async (row: WorktreeRow) => {
    const result = await store.createWorkspace(row.path);
    setError(result.error ?? null);
  };

  return (
    <div className={css.section}>
      <div className={css.sectionTitle}>{t("工作树")}</div>
      <div className={css.sectionIntro}>
        {t("在一个 git 工作区上开工作树（分支 + 同级目录），把工作树注册成新工作区，就能在独立目录里干活而不互相踩文件。注意：引擎的会话工作目录在创建时固定（沙箱根 = 引擎进程启动目录），所以「同一工作区里多个会话各跑一个工作树」现在还做不到——每个工作树只能作为独立工作区使用。")}
      </div>

      <div className={css.blockCard}>
        <div className={css.blockHead}>
          <div className={css.blockTitle}>{t("工作区")}</div>
          <div className={css.blockDesc}>{t("工作树挂在某个工作区（仓库）上；列表来自 git 自己。")}</div>
        </div>
        <div className={css.blockRow}>
          <GitBranch size={13} />
          <Dropdown options={options} value={active} onChange={setRepo} />
          <span style={{ marginLeft: "auto" }} />
          <button className={css.secondaryButton} disabled={busy || !active} onClick={refresh}>
            <RefreshCw size={12} /> {t("刷新")}
          </button>
        </div>
        {!shell && (
          <div className={css.blockRow}>
            <span className={css.muted}>{t("工作树要跑本机 git，只有桌面应用能做——当前是浏览器访问，看不到也改不了。")}</span>
          </div>
        )}
        {error && (
          <div className={css.blockRow}>
            <span className={css.muted} style={{ color: "#e5484d", whiteSpace: "pre-wrap" }}>{error}</span>
          </div>
        )}
        {shell && loaded && !error && rows.length === 0 && (
          <div className={css.blockRow}>
            <span className={css.muted}>{t("这个目录不是 git 仓库，或者还没有工作树。")}</span>
          </div>
        )}
        {rows.map((row) => (
          <div key={row.path} className={css.blockRow}>
            <Folder size={13} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className={css.rowName}>
                {worktreeLabel(row)}
                {isMainWorktree(row, treeRepo || active) && <span className={css.presetBadge}>{t("主工作树")}</span>}
                {row.locked && <span className={css.presetBadge}>{t("已锁定")}</span>}
                {row.prunable && <span className={css.presetBadge}>{t("可清理")}</span>}
              </div>
              <div className={css.mono}>{row.path}</div>
            </div>
            <div className={css.rowActions}>
              <button className={css.secondaryButton} onClick={() => revealPath(row.path)}>
                {t("在 Finder 中显示")}
              </button>
              {!isMainWorktree(row, treeRepo || active) && (
                <>
                  <button className={css.secondaryButton} onClick={() => void register(row)}>
                    {t("注册为工作区")}
                  </button>
                  <button className={css.dangerButton} onClick={() => void remove(row)}>
                    <Trash2 size={12} /> {t("删除")}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className={css.blockCard}>
        <div className={css.blockHead}>
          <div className={css.blockTitle}>{t("新建工作树")}</div>
          <div className={css.blockDesc}>
            {t("分支已存在、目录被占等情形由 git 拒绝，报错原文会显示在上面——这里不替它猜原因。")}
          </div>
        </div>
        <div className={css.blockRow}>
          <input className={css.textField} style={{ width: 220 }} placeholder={t("分支名")} value={branch} onChange={(e) => setBranch(e.target.value)} />
          <input className={css.textField} style={{ flex: 1 }} placeholder={t("目录（绝对路径）")} value={path} onChange={(e) => setPath(e.target.value)} />
          <button className={css.primaryButton} disabled={busy || !active || !branch.trim() || !path.trim()} onClick={() => void create()}>
            <Plus size={12} /> {t("创建")}
          </button>
        </div>
      </div>
    </div>
  );
}
