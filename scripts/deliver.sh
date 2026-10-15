#!/bin/bash
# DeepDive — 一键日常交付（WORKING-AGREEMENTS §4）：lint → 前端 build → 引擎保鲜 →
# Release 构建+嵌入 → 停旧实例 → open → 日志确认。简单改动这一条就是全部；
# 行为类改动先 make test。分发档（公证+装钉+DMG）仍走 make package。
set -euo pipefail
cd "$(dirname "$0")/.."

(cd frontend && npm run lint)

# 引擎保鲜：engine 源码比当前构建新 → 先重建再嵌入（漏跑 build-engine 会把
# 旧引擎交付出去——2026-10-12 语言修复就这样没送达过）。纯前端/壳改动零开销。
VERSION=$(cat scripts/dsh-runtime-version.txt)
ENGINE_BUILD="dist/.dsh-engine-build/$VERSION"
if [[ -d "$ENGINE_BUILD" ]] && [[ -n $(find engine/packages engine/apps -newer "$ENGINE_BUILD" -name "*.ts" -print -quit 2>/dev/null) ]]; then
  echo "engine 源码比构建产物新 → 先重建"
  bash scripts/build-engine.sh
fi

(cd frontend && npm run build)
bash scripts/build-release.sh

bash scripts/stop-app.sh
open .build/release/Build/Products/Release/DeepDive.app
sleep 2
pgrep -f "DeepDive.app/Contents/MacOS/DeepDive" >/dev/null || { echo "FAIL: 新实例没有起来" >&2; exit 1; }
echo "== 日志确认（engine.log 尾部）=="
tail -3 "$HOME/Library/Application Support/DeepDive/engine.log"
