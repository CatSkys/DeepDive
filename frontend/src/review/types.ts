// 审查面板的 wire 类型。原先放在 src/types.ts，但那份已经超了架构门的行数上限，
// 再往上堆会把它的基线指纹顶掉（docs/ARCHITECTURE.md §review/）。本模块自闭环，
// 类型跟着模型走。

/* 壳侧跑 git 出数，**行数统计全在后端**（numstat；未跟踪由壳侧读文件数行），
   前端只按字段渲染，不自己数。 */

export type ReviewChangeKind = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";

/** 壳层 git-changes 的单条目：一个有未暂存改动的文件。 */
export interface ReviewChange {
  /** 仓库相对路径（git status 的口径，非绝对路径）。 */
  path: string;
  /** 重命名的原路径；其余为空串。 */
  originalPath: string;
  kind: ReviewChangeKind;
  added: number;
  removed: number;
  /** 二进制（或超限）文件：不给 diff，只在列表上标出来。 */
  binary: boolean;
}

/** 壳层 git-changes 的回包（未暂存档；非 git 仓库 / git 不可用 repo=false）。 */
export interface ReviewChanges {
  repo: boolean;
  branch: string;
  files: ReviewChange[];
}

/** 壳层 git-diff 的形态：patch 整份给，超限/二进制/不可用各报各的——
 *  半截 patch 解析出来是错的，所以没有"截断后照发"这一档。 */
export type ReviewDiffKind = "patch" | "untracked" | "binary" | "truncated" | "unavailable";

export interface ReviewDiff {
  kind: ReviewDiffKind;
  /** kind==="patch" 的 unified diff 原文。 */
  patch: string;
  /** kind==="untracked" 的文件全文（每行都算新增）。 */
  content: string;
}
