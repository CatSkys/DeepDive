#!/bin/bash
# DeepDive — full test suite: frontend vitest + shell XCTest, 两腿并行（make test）.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .build

# 测试锁预检（PITFALLS §7.2）：被中断的测试运行会留下占着本树测试支撑目录锁的
# 测试宿主，本轮宿主一启动就 exit(0)，xcodebuild 只报难对号的 "test runner
# exited with code 0"。支撑目录按树隔离（.build/test-support，AppPaths 认
# XCTest 环境派生），所以锁的持有者只能是本树自己的测试宿主；宿主被杀后
# 其 xcodebuild 会重拉一个，所以还要停掉本树仍在跑的 xcodebuild。
unlock_test_lock() {
  local lock="$PWD/.build/test-support/instance.lock" holder cmd
  holder=$(lsof -t "$lock" 2>/dev/null | head -1 || true)
  if [[ -z "$holder" ]]; then return 0; fi
  cmd=$(ps -p "$holder" -o command= 2>/dev/null || true)
  if [[ "$cmd" != *"$(pwd)/.build/debug/"* ]]; then
    echo "FAIL: 测试锁被非本树测试宿主占用 (pid $holder)，不自动清：" >&2
    echo "$cmd" >&2
    return 1
  fi
  echo "test.sh: 清掉占本树测试锁的残留测试宿主 (pid $holder)"
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
  if ! xcodebuild test -project "$PWD/apps/macos/DSHmini.xcodeproj" -scheme DSHmini \
      -configuration Debug -derivedDataPath "$PWD/.build/debug" \
      CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO > .build/xctest.log 2>&1; then
    tail -30 .build/xctest.log; return 1
  fi
  tail -5 .build/xctest.log
}

frontend_leg & FE_PID=$!
shell_leg & SH_PID=$!

# 用户 2026-10-11 定稿：单次测试严禁超过 2 分钟，超时直接杀（宁红勿挂）。
# xcodebuild 走绝对工程路径，看门狗的 pkill 才只命中本树（WORKING-AGREEMENTS §5）；
# 被杀的残留宿主占的测试锁由下轮起跑的预检清场。
watchdog() {
  sleep 120
  echo "FAIL: 测试超过 120s——按用户口径直接杀" >&2
  pkill -9 -f "xcodebuild test -project $PWD/apps/macos/DSHmini.xcodeproj" 2>/dev/null
  pkill -9 -f "$PWD/.build/debug/Build/Products/Debug/DeepDive.app" 2>/dev/null
  kill -9 "$FE_PID" "$SH_PID" 2>/dev/null
  exit 1
}
watchdog & WD_PID=$!

LEG_FAIL=0
wait "$FE_PID" || { echo "FAIL: frontend leg"; LEG_FAIL=1; }
wait "$SH_PID" || { echo "FAIL: shell leg"; LEG_FAIL=1; }
kill "$WD_PID" 2>/dev/null || true
exit "$LEG_FAIL"
