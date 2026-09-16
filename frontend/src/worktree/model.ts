// 工作树分区的纯逻辑：默认分支名与目录、行摘要。目录取仓库的**同级**路径——工作树放进
// 仓库内部会被自己的 git 状态扫到；分支名的合法性交给 git 判定，我们只给不撞车的默认值。
import type { WorktreeRow } from "../host";

/** 默认分支名：`worktree-<yyyymmdd>-<hhmm>`（给个一眼能认出来的、不撞车的名字）。 */
export function defaultBranchName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `worktree-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** 默认工作树目录：仓库的**同级**目录 `<父目录>/<仓库名>-<分支>`（分支里的 `/` 换 `-`）。 */
export function defaultWorktreePath(repo: string, branch: string): string {
  const trimmed = repo.replace(/\/+$/, "");
  const parent = trimmed.slice(0, trimmed.lastIndexOf("/"));
  const name = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return `${parent}/${name}-${branch.replace(/\//g, "-")}`;
}

/** 主工作树 = 路径就是仓库本身（git porcelain 不标谁主谁次，但这条判据是确定的）。
 *  **前提**：两个路径要同一把尺子——`git worktree list --porcelain` 给的是 realpath
 *  （macOS 上 `/var/…` 会写成 `/private/var/…`），所以要传壳回推的 resolvedRepo，
 *  不能拿用户输入的原样路径比字面量。 */
export function isMainWorktree(row: Pick<WorktreeRow, "path">, repo: string): boolean {
  const norm = (p: string) => p.replace(/\/+$/, "");
  return norm(row.path) === norm(repo);
}

/** 一行的分支标签：分支名 → detached 时给短提交 id。 */
export function worktreeLabel(row: Pick<WorktreeRow, "branch" | "detached" | "head">): string {
  if (row.branch) return row.branch;
  return row.detached ? row.head : "—";
}
