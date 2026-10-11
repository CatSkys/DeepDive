#!/bin/bash
# DeepDive — 清场 worktree：删树 + 删分支（remove-worktree.sh <slug>）。
# 默认拒绝脏树与未合并分支——真要丢弃用 --force 显式给（新 new-worktree.sh 同名 slug 才能复用）。
set -euo pipefail
cd "$(dirname "$0")/.."

SLUG="${1:-}"
FORCE=0
shift || true
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    *) echo "未知参数: $arg" >&2; exit 1 ;;
  esac
done
[[ -n "$SLUG" ]] || { echo "用法: scripts/remove-worktree.sh <slug> [--force]" >&2; exit 1; }
DIR="../DSHmini-${SLUG}"
BRANCH="feat/${SLUG}"

git worktree list --porcelain | grep -q "branch refs/heads/$BRANCH" || {
  echo "FAIL: 没有分支为 $BRANCH 的 worktree" >&2; exit 1;
}

if [[ $FORCE -ne 1 ]] && [[ -n "$(git -C "$DIR" status --porcelain)" ]]; then
  echo "FAIL: $DIR 有未提交改动——先提交/合并，或加 --force 丢弃：" >&2
  git -C "$DIR" status --short | head -5 >&2
  exit 1
fi
git worktree remove "$DIR" ${FORCE:+--force}

if git merge-base --is-ancestor "$BRANCH" main; then
  git branch -d "$BRANCH"
  echo "OK: worktree 与已合并分支 $BRANCH 已清"
elif [[ $FORCE -eq 1 ]]; then
  git branch -D "$BRANCH"
  echo "OK: worktree 已清，未合并分支 $BRANCH 已按 --force 丢弃"
else
  echo "FAIL: 分支 $BRANCH 未合并进 main——先 merge --no-ff，或加 --force 丢弃" >&2
  exit 1
fi
