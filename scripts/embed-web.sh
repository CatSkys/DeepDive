#!/bin/bash
# Embed the built SPA into the app bundle (Contents/Resources/web).
# XcodeGen copies groups flat, which breaks vite's ../assets/ layout, so the
# shell scripts copy the dist tree verbatim after the build.
set -euo pipefail
cd "$(dirname "$0")/.."
APP="${1:?usage: embed-web.sh <path/to/DeepDive.app>}"

# 守卫：dist 比源码旧就**别嵌**。这条链上没人会替你跑 `npm run build`
# （AGENTS.md 的交付链写的是"前端 build → package"，脚本只 embed），漏掉那一步的表现
# 是"改的东西一个都没生效"——壳是新的、SPA 是上一轮的，看日志看不出、看包名看不出
# （用户 2026-10-09 实报的正是这个：文件夹修好了、chip 两处没生效）。
# 静默嵌旧包是这条链上最贵的错，所以宁可停。
DIST=frontend/dist
test -f "$DIST/index.html" || {
  echo "FAIL: $DIST 还没构建 —— 先 cd frontend && npm run build" >&2
  exit 1
}
newest_mtime() { find "$@" -type f -not -path '*/node_modules/*' -exec stat -f '%m' {} + 2>/dev/null | sort -rn | head -1; }
SRC_NEWEST=$(newest_mtime frontend/src frontend/packages frontend/index.html frontend/vite.config.ts frontend/package.json)
DIST_NEWEST=$(newest_mtime "$DIST")
if [ -n "$SRC_NEWEST" ] && [ -n "$DIST_NEWEST" ] && [ "$SRC_NEWEST" -gt "$DIST_NEWEST" ]; then
  echo "FAIL: $DIST 比前端源码旧 —— 先 cd frontend && npm run build（否则嵌进去的是上一轮的 SPA）" >&2
  exit 1
fi

mkdir -p "$APP/Contents/Resources/web"
rm -rf "$APP/Contents/Resources/web"/*
cp -R frontend/dist/. "$APP/Contents/Resources/web/"
echo "OK: embedded web into $APP"
