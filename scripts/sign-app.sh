#!/bin/bash
# DeepDive — seal the .app with a stable identity（embed 后 / 打包前共用一份）。
#
# 为什么不是 ad-hoc：macOS 按（code signature, bundle id）记 TCC 授权。ad-hoc
# 签名没有 Team ID，系统的 designated requirement 只能落到 cdhash 上——**每次
# 重建都是一张新面孔**，于是「文稿」这类受保护目录的授权反复重置，启动时弹
# 系统框挡住初始化（引擎卡在 process.cwd() 的 getcwd 上等那张框；人不在跟前
# 就是"引擎起不来"，且恢复屏要等退避重试才出现，观感是"过一会才授权"）。
# 用 Developer ID 固定身份后，授权绑 (bundle id + 团队)，**跨构建持久**
# （PITFALLS §4.8）。无证书的环境退回 ad-hoc（并明说授权会每次丢）。
#
# 不能用 `codesign --deep` 一遍过：--deep 只覆盖 Frameworks/PlugIns 等标准嵌套
# 位置，Resources/Runtime 下 node_modules 里的 rg/pty.node/sharp 一律漏签，
# 公证会拒（2026-09-06 notarytool log 实锤）。所以先逐个签包内每个 Mach-O，
# 最后整体 seal bundle。node 带 JIT entitlements：hardened runtime 默认禁可
# 执行内存，V8/koffi 没有它运行即崩。
#
# 用法：sign-app.sh <path-to-.app>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${1:?usage: sign-app.sh <app>}"
IDENTITY="${DSHMINI_CODESIGN_IDENTITY:-Developer ID Application: HANGBIN JIN (49LSZKN27V)}"

if security find-identity -v -p codesigning | grep -q "$IDENTITY"; then
  find "$APP" -type f -exec sh -c 'file -b "$1" | grep -q Mach-O' _ {} \; -print0 |
  while IFS= read -r -d '' bin; do
    case "$bin" in
      */Resources/Runtime/node)
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
  echo "signed with Developer ID（TCC 授权跨构建持久）"
else
  echo "WARN: '$IDENTITY' not in keychain; falling back to ad-hoc signing" >&2
  echo "WARN: ad-hoc 无稳定身份 → 「文稿」等 TCC 授权每次重建都会重置" >&2
  codesign --force --deep -s - "$APP" || { echo "FAIL: codesign $APP"; exit 1; }
fi
