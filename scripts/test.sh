#!/bin/bash
# DeepDive — full test suite: frontend vitest + shell XCTest (make test).
set -euo pipefail
cd "$(dirname "$0")/.."

(cd frontend && npm run test)

(cd apps/macos && xcodegen generate)
mkdir -p .build
# 输出落盘再截尾：exit code 不经管道丢失（xcodebuild 输出很长）
xcodebuild test -project apps/macos/DSHmini.xcodeproj -scheme DSHmini \
  -configuration Debug -derivedDataPath .build/debug \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO > .build/xctest.log 2>&1 || {
    tail -30 .build/xctest.log
    exit 1
  }
tail -5 .build/xctest.log
