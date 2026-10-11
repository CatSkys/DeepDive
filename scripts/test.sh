#!/bin/bash
# DeepDive — full test suite: frontend vitest + shell XCTest, 两腿并行（make test）.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .build

# 测试锁预检（PITFALLS §7.2）：被中断的测试运行会留下占着隔离目录锁的测试宿主，
# 本轮宿主一启动就 exit(0)，xcodebuild 只报难对号的 "test runner exited with code
# 0"。宿主按 Debug 产物路径识别（真机包在 release/dist，不持这把锁）；宿主被杀后
# 其 xcodebuild 会重拉一个，所以还要停掉本项目仍在跑的 xcodebuild——同一
# .build/debug 上并发 xcodebuild test 本就互踩。
unlock_test_lock() {
  local lock="/tmp/dshmini-test-support/instance.lock" holder
  holder=$(lsof -t "$lock" 2>/dev/null | head -1 || true)
  if [[ -z "$holder" ]]; then return 0; fi
  if ! ps -p "$holder" -o command= 2>/dev/null | grep -q "Debug/DeepDive.app"; then
    echo "FAIL: 测试锁被非测试宿主占用 (pid $holder)，不自动清：" >&2
    ps -p "$holder" -o command= 2>/dev/null >&2 || true
    return 1
  fi
  echo "test.sh: 清掉占测试锁的残留测试宿主 (pid $holder)"
  kill "$holder" 2>/dev/null || true
  sleep 2
  kill -9 "$holder" 2>/dev/null || true
  holder=$(lsof -t "$lock" 2>/dev/null | head -1 || true)
  if [[ -z "$holder" ]]; then return 0; fi
  pkill -f "xcodebuild test .*DSHmini.xcodeproj" 2>/dev/null || true
  sleep 2
  holder=$(lsof -t "$lock" 2>/dev/null | head -1 || true)
  if [[ -n "$holder" ]]; then
    echo "FAIL: 测试锁仍被占 (pid $holder)：" >&2
    ps -p "$holder" -o command= 2>/dev/null >&2 || true
    return 1
  fi
}

frontend_leg() {
  echo "== frontend leg: vitest + 架构门 + 引擎组合门 =="
  local log=.build/frontend-test.log
  if ! (cd frontend && npm run test) >"$log" 2>&1; then
    tail -30 "$log"; return 1
  fi
  tail -4 "$log"
  # 架构约束门：CSS Module 类名写错、新文件超行数上限这类**不会让构建或测试变红**的
  # 静默失效（TODO §15 的事故类）。只让新增违规失败，存量按指纹在基线里放行。
  node frontend/scripts/check-architecture.mjs || return 1
  # 引擎组合漂移门：engine/profile 是我们自己的行表，上游改了自己那两层不会自动
  # 到达我们这儿，而未命中的 `- id:` 只 warn 不报错（PITFALLS §7.6）——只有重新
  # dump 对比才发现。无 pinned runtime 时它自己 skip（不是静默通过，会打印一行）。
  bash scripts/check-engine-composition.sh || return 1
}

shell_leg() {
  echo "== shell leg: xcodegen + XCTest =="
  unlock_test_lock || return 1
  (cd apps/macos && xcodegen generate) || return 1
  # 输出落盘再截尾：exit code 不经管道丢失（xcodebuild 输出很长）
  if ! xcodebuild test -project apps/macos/DSHmini.xcodeproj -scheme DSHmini \
      -configuration Debug -derivedDataPath .build/debug \
      CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO > .build/xctest.log 2>&1; then
    tail -30 .build/xctest.log; return 1
  fi
  tail -5 .build/xctest.log
}

frontend_leg & FE_PID=$!
shell_leg & SH_PID=$!
LEG_FAIL=0
wait "$FE_PID" || { echo "FAIL: frontend leg"; LEG_FAIL=1; }
wait "$SH_PID" || { echo "FAIL: shell leg"; LEG_FAIL=1; }
exit "$LEG_FAIL"
