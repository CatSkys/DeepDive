#!/bin/sh
# DSHmini — development build (Debug, open the app).
set -o pipefail
set -e
cd "$(dirname "$0")/.."
(cd apps/macos && xcodegen generate)
xcodebuild -project apps/macos/DSHmini.xcodeproj -scheme DSHmini \
  -configuration Debug -derivedDataPath .build/debug \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build \
  | tail -5
APP=.build/debug/Build/Products/Debug/DSHmini.app
echo "OK: $APP"
open "$APP"
