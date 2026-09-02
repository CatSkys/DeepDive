#!/bin/sh
# DeepDive — development build (Debug, open the app).
set -e
cd "$(dirname "$0")/.."
sh scripts/build-frontend.sh
(cd apps/macos && xcodegen generate)
xcodebuild -project apps/macos/DSHmini.xcodeproj -scheme DSHmini \
  -configuration Debug -derivedDataPath .build/debug \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build \
  | tail -5
APP=.build/debug/Build/Products/Debug/DeepDive.app
sh scripts/embed-web.sh "$APP"
# Dev default: skip the engine embed (needs npm install of the pinned runtime).
# Set DSHMINI_DEV_ENGINE=1 to build a self-contained dev bundle.
if [[ "${DSHMINI_DEV_ENGINE:-0}" == "1" ]]; then
  sh scripts/embed-engine.sh "$APP"
else
  echo "skip embed-engine (DSHMINI_DEV_ENGINE=1 to include; DSHMINI_DSH_ENTRY still works for dev)"
fi
echo "OK: $APP"
open "$APP"
