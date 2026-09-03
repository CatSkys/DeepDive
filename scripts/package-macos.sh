#!/bin/sh
# DeepDive — Release build + ad-hoc signed .app + DMG.
set -o pipefail
set -e
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

sh scripts/embed-web.sh "$APP"
# Engine embed must precede signing: the embedded MacOS/node executable needs
# to be inside the bundle before codesign (deep) covers it.
sh scripts/embed-engine.sh "$APP"
# 签名失败必须停：曾 `|| true` 吞错，bundle 被 embed 改坏时仍照常出 DMG（AUD-013）
codesign --force --deep -s - "$APP" || { echo "FAIL: codesign $APP"; exit 1; }

mkdir -p dist
DMG="dist/DeepDive-${VERSION}-dev.dmg"
rm -f "$DMG"
hdiutil create -quiet -volname "DeepDive" -srcfolder "$APP" -ov -format UDZO "$DMG"
echo "OK: $DMG"
