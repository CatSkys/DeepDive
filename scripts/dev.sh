#!/bin/bash
# DeepDive — development build (Debug, open the app).
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/build-frontend.sh
(cd apps/macos && xcodegen generate)
mkdir -p .build
# 输出落盘再截尾：exit code 不经管道丢失（xcodebuild 输出很长，同 test.sh 的做法）
xcodebuild -project apps/macos/DeepDive.xcodeproj -scheme DeepDive \
  -configuration Debug -derivedDataPath .build/debug \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build > .build/xcodebuild-dev.log 2>&1 || {
    tail -30 .build/xcodebuild-dev.log
    exit 1
  }
tail -5 .build/xcodebuild-dev.log
APP=.build/debug/Build/Products/Debug/DeepDive.app
bash scripts/embed-web.sh "$APP"
# Dev default: skip the engine embed (needs npm install of the pinned runtime).
# Set DEEPDIVE_DEV_ENGINE=1 to build a self-contained dev bundle.
if [[ "${DEEPDIVE_DEV_ENGINE:-0}" == "1" ]]; then
  bash scripts/embed-engine.sh "$APP"
else
  echo "skip embed-engine (DEEPDIVE_DEV_ENGINE=1 to include)"
  echo "  无随包引擎时入口走系统 dsh，版本门要求它与 scripts/dsh-runtime-version.txt 逐字一致；"
  echo "  对照其他版本请设 DEEPDIVE_DSH_ENTRY（异版本仅告警），并配 DEEPDIVE_SUPPORT_DIR 隔离。"
fi
echo "OK: $APP"
open "$APP"
