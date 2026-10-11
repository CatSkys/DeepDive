#!/bin/bash
# DeepDive — 一键交付链（WORKING-AGREEMENTS §4）：前端 build → Release 构建+嵌入 →
# pkill 旧实例 → open → 日志确认。分发档（公证+装钉+DMG）仍走 make package。
set -euo pipefail
cd "$(dirname "$0")/.."

(cd frontend && npm run build)
bash scripts/build-release.sh

pkill -f "DeepDive.app/Contents/MacOS/DeepDive" 2>/dev/null || true
sleep 1
open .build/release/Build/Products/Release/DeepDive.app
sleep 2
pgrep -f "DeepDive.app/Contents/MacOS/DeepDive" >/dev/null || { echo "FAIL: 新实例没有起来" >&2; exit 1; }
echo "== 日志确认（engine.log 尾部）=="
tail -3 "$HOME/Library/Application Support/DeepDive/engine.log"
