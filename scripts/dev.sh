#!/bin/sh
# DSHmini — development build (Debug, open the app).
set -e
cd "$(dirname "$0")/.."
sh scripts/build-frontend.sh
(cd apps/macos && xcodegen generate)
xcodebuild -project apps/macos/DSHmini.xcodeproj -scheme DSHmini \
  -configuration Debug -derivedDataPath .build/debug \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build \
  | tail -5
APP=.build/debug/Build/Products/Debug/DSHmini.app
sh scripts/embed-web.sh "$APP"
echo "OK: $APP"
open "$APP"
