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
# Engine embed must precede signing: the embedded MacOS/node executable needs
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
  codesign --force --deep -s "$IDENTITY" "$APP" || { echo "FAIL: codesign $APP"; exit 1; }
else
  echo "WARN: '$IDENTITY' not in keychain, falling back to ad-hoc signing"
  codesign --force --deep -s - "$APP" || { echo "FAIL: codesign $APP"; exit 1; }
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
