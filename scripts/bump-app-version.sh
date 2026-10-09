#!/bin/bash
# DeepDive — 应用版本号递增。唯一事实源是 apps/macos/project.yml 的两个键
# （CFBundleShortVersionString + CFBundleVersion，两处必须同步；Info.plist 与 DMG
# 文件名都由 xcodegen/package-macos.sh 从它取，别在别处再写版本号）。
#
# 用户 2026-10-09 定稿的规则：
#   · **每次分发只动最后一位**（patch：0.1.0 → 0.1.1）。分发档（带公证的 package）
#     由 package-macos.sh 自动调 `patch`，不需要谁记得。
#   · **前两位（major / minor）只有用户明确确认过才能动**，所以这里要 --user-confirmed；
#     没有这个旗标就直接停——这条规则值得机器来守，别靠下一个 agent 记得。
#
# 用法：scripts/bump-app-version.sh [patch|minor|major] [--user-confirmed]
set -euo pipefail
cd "$(dirname "$0")/.."
FILE=apps/macos/project.yml
PART="${1:-patch}"

case "$PART" in
  patch|minor|major) ;;
  *) echo "usage: bump-app-version.sh [patch|minor|major] [--user-confirmed]" >&2; exit 1 ;;
esac
if [ "$PART" != "patch" ] && [ "${2:-}" != "--user-confirmed" ]; then
  echo "FAIL: $PART 动的是前两位，按用户定稿的规则要用户确认过才能改。" >&2
  echo "      确认过了就再加 --user-confirmed 跑一次（用法见本脚本头部）。" >&2
  exit 1
fi

CUR=$(awk -F'"' '/CFBundleShortVersionString/ {print $2; exit}' "$FILE")
[ -n "$CUR" ] || { echo "FAIL: $FILE 里读不到 CFBundleShortVersionString" >&2; exit 1; }
case "$CUR" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "FAIL: 版本号 '$CUR' 不是 x.y.z，本脚本只认三位" >&2; exit 1 ;;
esac

IFS=. read -r MAJ MIN PAT <<< "$CUR"
case "$PART" in
  patch) PAT=$((PAT + 1)) ;;
  minor) MIN=$((MIN + 1)); PAT=0 ;;
  major) MAJ=$((MAJ + 1)); MIN=0; PAT=0 ;;
esac
NEW="$MAJ.$MIN.$PAT"

# 两处键一起写：只改一个会让 Info.plist 里两个版本字段打架（CFBundleVersion 是系统
# 判定"更新"用的那个）。
sed -i '' -E \
  -e "s/(CFBundleShortVersionString: \")[^\"]*/\1$NEW/" \
  -e "s/(CFBundleVersion: \")[^\"]*/\1$NEW/" "$FILE"

GOT=$(awk -F'"' '/CFBundleShortVersionString/ {print $2; exit}' "$FILE")
[ "$GOT" = "$NEW" ] || { echo "FAIL: 写回后读到的还是 '$GOT'（期望 $NEW）" >&2; exit 1; }
echo "app version: $CUR -> $NEW ($PART)"
