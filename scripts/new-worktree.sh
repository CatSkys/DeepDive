#!/bin/bash
# DeepDive — 新建并行任务 worktree：目录 DSHmini-<slug>（主仓同级），分支 feat/<slug>.
# 纪律见 docs/WORKING-AGREEMENTS §5：主仓只收合并，任务在树里做，收尾 remove-worktree.sh 清场。
set -euo pipefail
cd "$(dirname "$0")/.."

SLUG="${1:-}"
case "$SLUG" in
  ""|-*|*/*) echo "用法: scripts/new-worktree.sh <slug> [--skip-bootstrap]" >&2; exit 1 ;;
esac
DIR="../DSHmini-${SLUG}"
BRANCH="feat/${SLUG}"

git show-ref --verify --quiet "refs/heads/$BRANCH" && {
  echo "FAIL: 分支 $BRANCH 已存在（先 remove-worktree.sh 清场，或换 slug）" >&2; exit 1;
}
[[ -e "$DIR" ]] && { echo "FAIL: 目录 $DIR 已存在" >&2; exit 1; }

git worktree add -b "$BRANCH" "$DIR"
DIR_ABS=$(cd "$DIR" && pwd)
echo "== worktree 就绪: ${DIR_ABS}（${BRANCH}）=="

if [[ "${2:-}" == "--skip-bootstrap" ]]; then
  echo "跳过引导（--skip-bootstrap）"
else
  # 引导各步独立容错：树已建成，某类任务用不到的依赖失败不致命，按 WARN 指路重跑
  (cd "$DIR/apps/macos" && xcodegen generate) \
    && echo "OK: xcodegen（壳工程已生成）" \
    || echo "WARN: xcodegen 失败——改壳侧前重跑 (cd apps/macos && xcodegen generate)"
  (cd "$DIR/frontend" && npm install) \
    && echo "OK: frontend npm install" \
    || echo "WARN: frontend 依赖没装好——改前端前重跑 (cd frontend && npm install)"
  # tokens.css 是生成产物不入库（tokens.json 唯一事实源）：不生成 vite build 会挂在 CSS @import
  (cd "$DIR/frontend" && npm run gen) \
    && echo "OK: design tokens 已生成" \
    || echo "WARN: tokens 没生成——改前端前重跑 (cd frontend && npm run gen)"
  # 引擎依赖按需装（pnpm install 全量较慢，纯壳/前端任务用不到）
  echo "SKIP: engine 依赖未装——改引擎前跑 (cd $DIR/engine && pnpm install)"
fi

# §5 机械卡点自愈：hooksPath 没配就配上（worktree 与主仓共享 git config，配一次全树生效）
if [[ "$(git config core.hooksPath || true)" != "scripts/git-hooks" ]]; then
  git config core.hooksPath scripts/git-hooks
  echo "OK: core.hooksPath → scripts/git-hooks（§5 主仓拒直提交卡点已启用）"
fi

cat <<EOF

在该树工作：
  cd $DIR_ABS
  提交到 ${BRANCH}（不动 main）；完成后回主仓 merge --no-ff，再 scripts/remove-worktree.sh ${SLUG}
  在树里跑 app 必带隔离支撑目录（PITFALLS §7.2）：DSHMINI_SUPPORT_DIR=$DIR_ABS/.support
  XCTest 测试支撑目录按树隔离（.build/test-support）：多棵树可并行跑 make test
EOF
