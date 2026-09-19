#!/bin/bash
# DeepDive — seal the .app with a stable identity。
#
# 两档，按用途分开（这是本脚本存在的理由）：
#
#   sign-app.sh <app>                  开发链（embed-web/embed-engine、make app）
#     `--deep` + Developer ID，**不带 --options runtime**，秒级。开发链要的只有
#     两件事：① 有效的封印（封印破了 macOS 26 会静默 SIGKILL 新嵌入的二进制）；
#     ② 稳定的 code identity（TCC 授权按 designated requirement 记，见 PITFALLS §4.8）。
#     为什么**不能**在开发档加 hardened runtime：包里的 Runtime/node 是 Node.js
#     Foundation 签的（另有若干 node_modules 原生模块），而 --deep 够不到
#     Resources/Runtime 这类非标准位置（§5.7）——hardened 的父进程去 exec/加载
#     跨团队签名的嵌套代码就被内核静默杀掉（实测：`exited (signal 9)` 三连，
#     应用弹恢复屏）。不加 runtime 就与仓库原来的开发档（adhoc + --deep）同构，
#     只是把身份换成 Developer ID 以保住 TCC 授权。
#
#   sign-app.sh <app> --distribution   打包/公证链（package-macos.sh）
#     包内每个 Mach-O 逐个签 + hardened runtime + secure timestamp。公证硬要求，
#     且 `--deep` 覆盖不到 Resources/Runtime 下的散件（node_modules 里的
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
  # --deep 覆盖标准嵌套位置并重封整个 bundle；不带 runtime 见文件头（跨团队嵌套
  # 代码在 hardened 父进程下会被静默杀掉）。
  codesign --force --deep -s "$IDENTITY" "$APP" || { echo "FAIL: codesign $APP"; exit 1; }
  # macOS 27 实测（2026-09-19）：--deep 够不到 Resources/Runtime/node（非标准
  # 嵌套位），它保持 Node.js Foundation 原签（hardened runtime）——处于被重封
  # 的 bundle 内时 exec 即被内核 SIGKILL(137)，自检与应用内启动双双死。开发链
  # 把 node 按同档身份补签（无 runtime，与父进程一致；无 runtime 才不需要
  # JIT entitlements——那对是 --distribution 档的搭配）。
  NODE_BIN="$APP/Contents/Resources/Runtime/node"
  if [[ -f "$NODE_BIN" ]]; then
    codesign --force -s "$IDENTITY" "$NODE_BIN" || { echo "FAIL: codesign node"; exit 1; }
  fi
  echo "signed (dev seal): Developer ID + --deep，无 hardened runtime → 秒级且 TCC 授权跨构建持久"
  exit 0
fi

# ── 分发档：包内每个 Mach-O 逐个签 ──
# 判定用**批量** file（一个进程吃一批路径），不要 `-exec ... {} \;`：后者每个文件
# 起一个 shell + file，三万文件就是五万次 fork——旧写法 5:33 全花在这里。
# 两处易错（都踩过）：
#   · 必须 `-F $'\t'` 指定制表符分隔再按第一个字段取路径。默认是「路径: 描述」，
#     路径里带冒号（或描述里的冒号）就切错；而且**胖二进制**会多出一行
#     `路径 (for architecture x86_64): ...`，路径尾巴挂着后缀——要去掉并去重。
#   · 不能用 `find -exec sh -c 'file -b "$1"'`：那是每文件一个进程（见上）。
MACHO_LIST="$(find "$APP" -type f -print0 | xargs -0 file -F $'\t' 2>/dev/null \
  | awk -F'\t' '$2 ~ /Mach-O/ {print $1}' \
  | sed -E 's/ \(for architecture [^)]*\):?$//' \
  | sort -u)"
while IFS= read -r bin; do
  [[ -n "$bin" ]] || continue
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
done <<< "$MACHO_LIST"
codesign --force -s "$IDENTITY" --options runtime --timestamp "$APP" \
  || { echo "FAIL: codesign $APP"; exit 1; }
echo "signed (distribution): 逐个 Mach-O + secure timestamp（公证要求）"
