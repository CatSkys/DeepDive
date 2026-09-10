#!/bin/bash
# DeepDive — Release build + Developer ID signed .app + DMG（无证书环境回退 adhoc）.
set -euo pipefail
cd "$(dirname "$0")/.."

(cd apps/macos && xcodegen generate)
# Info.plist 由 xcodegen 生成：版本必须在生成之后读取，且读不到即停——
# 曾静默回退 0.1.0，新 clone 的 DMG 恒以 0.1.0 命名（AUD-013）。
VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" apps/macos/Info.plist 2>/dev/null) || {
  echo "FAIL: cannot read CFBundleShortVersionString from generated apps/macos/Info.plist"
  exit 1
}
xcodebuild -project apps/macos/DSHmini.xcodeproj -scheme DSHmini \
  -configuration Release -derivedDataPath .build/release \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build \
  | tail -3

APP=.build/release/Build/Products/Release/DeepDive.app
test -d "$APP" || { echo "build failed"; exit 1; }

bash scripts/embed-web.sh "$APP"
# Engine embed must precede signing: the embedded Runtime/node executable needs
# to be inside the bundle before codesign (deep) covers it.
bash scripts/embed-engine.sh "$APP"
# 签名失败必须停：曾 `|| true` 吞错，bundle 被 embed 改坏时仍照常出 DMG（AUD-013）。
# embed-engine 已在其自检前 re-seal 一次；此处再签是 DMG 分发前的最终 seal，
# 二者顺序勿倒（embed → 最终 seal → DMG）。
# 用本机 Developer ID 固定身份而非 adhoc：macOS 按（签名, bundle id）记 TCC
# 授权，adhoc 每次重打包签名都变 → 授权反复重置、启动弹「访问文稿」框模态
# 挡住初始化（PITFALLS §4.8）。固定身份后授权跨构建持久。无证书的环境回退 adhoc。
IDENTITY="${DSHMINI_CODESIGN_IDENTITY:-Developer ID Application: HANGBIN JIN (49LSZKN27V)}"
if security find-identity -v -p codesigning | grep -q "$IDENTITY"; then
  # 公证要求包内每个 Mach-O 都有 Developer ID 签名 + hardened runtime + secure
  # timestamp。--deep 只覆盖 Frameworks/PlugIns 等标准嵌套位置，Resources/Runtime
  # 下 node_modules 的 rg/pty.node/sharp 等一律漏签（2026-09-06 notarytool log
  # 实锤），故先逐个签散文件、最后整体 seal bundle。node 带 JIT entitlements：
  # hardened runtime 默认禁可执行内存，V8/koffi 没有它运行即崩（见 plist 注释）。
  find "$APP" -type f -exec sh -c 'file -b "$1" | grep -q Mach-O' _ {} \; -print0 |
  while IFS= read -r -d '' bin; do
    case "$bin" in
      */Resources/Runtime/node)
        codesign --force -s "$IDENTITY" --options runtime --timestamp \
          --entitlements scripts/node-entitlements.plist "$bin" \
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
else
  echo "WARN: '$IDENTITY' not in keychain, falling back to ad-hoc signing"
  codesign --force --deep -s - "$APP" || { echo "FAIL: codesign $APP"; exit 1; }
fi

# 公证（可选）：DSHMINI_NOTARY_PROFILE = notarytool 钥匙串 profile 名
# （一次性配置：xcrun notarytool store-credentials <名字> --apple-id … --team-id 49LSZKN27V）。
# 未设置 → 显式跳过（无凭据环境照常出包）；设置后任何一步失败必须停——
# 静默交付未公证包与 AUD-013 同型。只公证 .app（zip 提交）并装钉：票据随
# app 走，离线首启也过 Gatekeeper；DMG 由已装钉的 app 组装，不再重复提交。
if [ -n "${DSHMINI_NOTARY_PROFILE:-}" ]; then
  test "$IDENTITY" != "-s -" || { echo "FAIL: notarization needs a Developer ID identity, got ad-hoc"; exit 1; }
  rm -f .build/notary-upload.zip
  ditto -c -k --keepParent "$APP" .build/notary-upload.zip
  xcrun notarytool submit .build/notary-upload.zip --keychain-profile "$DSHMINI_NOTARY_PROFILE" --wait \
    || { echo "FAIL: notarytool submit（详情：xcrun notarytool log <id> --keychain-profile $DSHMINI_NOTARY_PROFILE）"; exit 1; }
  xcrun stapler staple "$APP" || { echo "FAIL: stapler staple $APP"; exit 1; }
  xcrun stapler validate "$APP" || { echo "FAIL: stapler validate $APP"; exit 1; }
  echo "OK: notarized + stapled"
else
  echo "SKIP: notarization（设置 DSHMINI_NOTARY_PROFILE 后启用）"
fi

mkdir -p dist
DMG="dist/DeepDive-${VERSION}-dev.dmg"
rm -f "$DMG"
# DMG 内容 = 应用 + Applications 拖拽链接 + 使用说明（scripts/dmg-guide.txt），
# 说明文案引用的菜单项/热键/路径须与 README 和壳侧实现保持一致。
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
ditto "$APP" "$STAGE/DeepDive.app"
ln -s /Applications "$STAGE/Applications"
cp scripts/dmg-guide.txt "$STAGE/使用说明.txt"
hdiutil create -quiet -volname "DeepDive" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
echo "OK: $DMG"
