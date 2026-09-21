#!/bin/bash
# DeepDive — full test suite: frontend vitest + shell XCTest (make test).
set -euo pipefail
cd "$(dirname "$0")/.."

(cd frontend && npm run test)

# 引擎组合漂移门：engine/profile 是我们自己的行表，上游改了自己那两层不会自动
# 到达我们这儿，而未命中的 `- id:` 只 warn 不报错（PITFALLS §7.6）——只有重新
# dump 对比才发现。无 pinned runtime 时它自己 skip（不是静默通过，会打印一行）。
bash scripts/check-engine-composition.sh

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
