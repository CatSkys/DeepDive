#!/bin/sh
# DSHmini — Release build only (no packaging).
set -o pipefail
set -e
cd "$(dirname "$0")/.."
(cd apps/macos && xcodegen generate)
xcodebuild -project apps/macos/DSHmini.xcodeproj -scheme DSHmini \
  -configuration Release -derivedDataPath .build/release \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build \
  | tail -3
APP=.build/release/Build/Products/Release/DSHmini.app
sh scripts/embed-web.sh "$APP"
echo "OK: $APP"
