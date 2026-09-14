#!/bin/bash
# DeepDive — seal the .app with a stable identity。
#
# 两档，按用途分开（这是本脚本存在的理由）：
#
#   sign-app.sh <app>                  开发链（embed-web/embed-engine、make app）
#     只签 bundle 本体，**秒级**。开发链要的只有两件事：① 有效的封印（封印破了
#     macOS 26 会静默 SIGKILL 新嵌入的二进制）；② 稳定的 code identity（TCC 授权
#     按 designated requirement 记，ad-hoc 无 Team ID → 每次重建都重置，见
#     PITFALLS §4.8）。两者都不需要逐个签包内每个 Mach-O。
#
#   sign-app.sh <app> --distribution   打包/公证链（package-macos.sh）
#     包内每个 Mach-O 逐个签 + hardened runtime + secure timestamp。公证硬要求，
#     且 `codesign --deep` 覆盖不到 Resources/Runtime 下的散件（node_modules 里的
#     rg/pty.node/sharp 一律漏签，2026-09-06 notarytool log 实锤），所以只能遍历。
#
# 为什么要分档（2026-09-14 实测）：整包有 3 万多个文件（dsh 运行时闭包），
# 而真正的 Mach-O 只有 12 个。旧写法用 `find -exec sh -c 'file -b "$1"'` 逐个
# 起 shell + file 进程做判定——**光是扫描就要 5 分 33 秒**，而打包链会跑两次；
# 开发链每次 embed 也白付这笔钱（用户报"每次 pkill 那套要等很久"）。
# 现在：开发链 7.5s（只签本体），分发链的扫描也从 5:33 降到 ~1min（见下）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${1:?usage: sign-app.sh <app> [--distribution]}"
MODE="${2:-dev}"
IDENTITY="${DSHMINI_CODESIGN_IDENTITY:-Developer ID Application: HANGBIN JIN (49LSZKN27V)}"

if ! security find-identity -v -p codesigning | grep -q "$IDENTITY"; then
  echo "WARN: '$IDENTITY' not in keychain; falling back to ad-hoc signing" >&2
  echo "WARN: ad-hoc 无稳定身份 → 「文稿」等 TCC 授权每次重建都会重置" >&2
  codesign --force --deep -s - "$APP" || { echo "FAIL: codesign $APP"; exit 1; }
  exit 0
fi

if [[ "$MODE" != "--distribution" ]]; then
  codesign --force -s "$IDENTITY" --options runtime "$APP" || { echo "FAIL: codesign $APP"; exit 1; }
  echo "signed (dev seal): bundle only, Developer ID → TCC 授权跨构建持久"
  exit 0
fi

# ── 分发档：包内每个 Mach-O 逐个签 ──
# 判定用**批量** file（一个进程吃一批路径），不要 `-exec ... {} \;`：后者每个文件
# 起一个 shell + file，三万文件就是五万次 fork——旧写法 5:33 全花在这里。
# xargs 在 ARG_MAX 处自动分批；`file` 每行输出 `<path>: <type>`，故按冒号取路径。
find "$APP" -type f -print0 | xargs -0 file 2>/dev/null | grep "Mach-O" | cut -d: -f1 |
while IFS= read -r bin; do
  case "$bin" in
    */Resources/Runtime/node)
      # node 带 JIT entitlements：hardened runtime 默认禁可执行内存，
      # V8/koffi 没有它运行即崩（scripts/node-entitlements.plist 内有注释）。
      codesign --force -s "$IDENTITY" --options runtime --timestamp \
        --entitlements "$ROOT/scripts/node-entitlements.plist" "$bin" \
        || { echo "FAIL: codesign $bin"; exit 1; }
      ;;
    *)
      codesign --force -s "$IDENTITY" --options runtime --timestamp "$bin" \
        || { echo "FAIL: codesign $bin"; exit 1; }
      ;;
  esac
done
codesign --force -s "$IDENTITY" --options runtime --timestamp "$APP" \
  || { echo "FAIL: codesign $APP"; exit 1; }
echo "signed (distribution): 逐个 Mach-O + secure timestamp（公证要求）"
