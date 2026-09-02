#!/bin/sh
# DeepDive — Release build + ad-hoc signed .app + DMG.
set -o pipefail
set -e
cd "$(dirname "$0")/.."
VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" apps/macos/Info.plist 2>/dev/null || echo 0.1.0)

(cd apps/macos && xcodegen generate)
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
codesign --force --deep -s - "$APP" >/dev/null 2>&1 || true

mkdir -p dist
DMG="dist/DeepDive-${VERSION}-dev.dmg"
rm -f "$DMG"
hdiutil create -quiet -volname "DeepDive" -srcfolder "$APP" -ov -format UDZO "$DMG"
echo "OK: $DMG"
