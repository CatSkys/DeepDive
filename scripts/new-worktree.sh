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
  (cd "$DIR/engine" && pnpm install) \
    && echo "OK: engine pnpm install（引擎侧 vitest 用）" \
    || echo "WARN: engine 依赖没装好——改引擎前重跑 (cd engine && pnpm install)"
fi

cat <<EOF

在该树工作：
  cd $DIR_ABS
  提交到 ${BRANCH}（不动 main）；完成后回主仓 merge --no-ff，再 scripts/remove-worktree.sh ${SLUG}
  在树里跑 app 必带隔离支撑目录（PITFALLS §7.2）：DSHMINI_SUPPORT_DIR=$DIR_ABS/.support
  XCTest 测试支撑锁全机共享（/tmp/dshmini-test-support）：两棵树同时跑 make test 会排队等锁
EOF
