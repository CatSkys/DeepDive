#!/bin/bash
# DeepDive — embed the pinned engine (Node binary + DSH runtime closure) into a
# built .app. Counterpart of embed-web.sh; run AFTER xcodebuild.
#
# Bundle layout (SPEC-ENGINE-RUNTIME §3.3/§3.4):
#   Contents/Resources/Runtime/node           — pinned Node executable
#     （勿放 Contents/MacOS/：LS 会当成第二个 app，Dock 闪 node 窗口）
#   Contents/Resources/Runtime/lib/libnode*.dylib — only when node is dynamic
#   Contents/Resources/Runtime/dsh/          — DSH runtime closure (whole dir)
#     └─ lib/bin.js                          — engine entry (spawn: node bin.js)
#   Contents/Resources/Licenses/Node.js-LICENSE
#   Contents/Resources/Licenses/dsh-THIRD_PARTY_NOTICES*
#
# Aligned with luochenw/deepseek-harness-macos scripts/build-macos-app.sh,
# including the post-embed self-check (`node bin.js --version`) that proves
# the node+bin.js spawn shape works before the bundle ships.
set -euo pipefail

APP="${1:?usage: embed-engine.sh <path-to-.app>}"
RUNTIME_SOURCE="${2:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_VERSION_FILE="$ROOT/scripts/node-version.txt"
EXPECTED_NODE_VERSION="$(tr -d '[:space:]' < "$NODE_VERSION_FILE")"
# 运行时二进制默认取官方 nodejs.org 发行版（自包含、可在用户机器独立运行），
# 不取构建机 PATH 上的 node——Homebrew/nvm 的 node 拖绝对路径 dylib 依赖，
# 干净机器上引擎必死，hardened runtime 库校验下连开发机都死（2026-09-06）。
NODE="${NODE_SOURCE:-$(bash "$ROOT/scripts/prepare-node-runtime.sh")}"

[[ -d "$APP" ]] || { echo "app bundle not found: $APP" >&2; exit 1; }
[[ -n "$NODE" && -x "$NODE" ]] || { echo "node is required to embed the engine" >&2; exit 1; }

ACTUAL_NODE_VERSION="$("$NODE" -p 'process.versions.node')"
[[ "$ACTUAL_NODE_VERSION" == "$EXPECTED_NODE_VERSION" ]] || {
  echo "Node toolchain mismatch: pin $EXPECTED_NODE_VERSION, found $ACTUAL_NODE_VERSION" >&2
  exit 1
}

# The vendored reference source must match the runtime pin before we embed it.
bash "$ROOT/scripts/check-dsh-source.sh"

if [[ -z "$RUNTIME_SOURCE" ]]; then
  RUNTIME_SOURCE="$(bash "$ROOT/scripts/prepare-dsh-runtime.sh")"
else
  # 外部传入的 runtime 也过仓内同一校验（版本 + lib/bin.js + 嵌套依赖），
  # 不再只查 bin.js 存在（AUD-107）。
  bash "$ROOT/scripts/prepare-dsh-runtime.sh" --validate "$RUNTIME_SOURCE"
fi
[[ -f "$RUNTIME_SOURCE/lib/bin.js" ]] || { echo "runtime missing lib/bin.js: $RUNTIME_SOURCE" >&2; exit 1; }

STAGE="$APP/Contents"
mkdir -p "$STAGE/Resources/Runtime" "$STAGE/Resources/Licenses"

# Architecture gate: the node binary must carry the build arch.
ARCH="$(uname -m)"
NODE_ARCHS="$(lipo -archs "$NODE" 2>/dev/null || true)"
case " $NODE_ARCHS " in
  *" $ARCH "*) ;;
  *) echo "node lacks build arch $ARCH: $NODE ($NODE_ARCHS)" >&2; exit 1 ;;
esac

# Self-containment gate: the shipped engine binary must only depend on
# rpath-family and system libraries. Machine-local absolute deps (homebrew
# etc.) are dead on user machines and rejected by hardened-runtime library
# validation even on the build machine.
while IFS= read -r dep; do
  case "$dep" in
    @rpath/*|@loader_path/*|@executable_path/*|/usr/lib/*|/System/*) ;;
    *) echo "embedded node is not self-contained: $NODE depends on $dep" >&2; exit 1 ;;
  esac
done < <(otool -L "$NODE" | tail -n +2 | awk '{print $1}')

rm -f "$STAGE/MacOS/node"
cp "$NODE" "$STAGE/Resources/Runtime/node"
chmod 755 "$STAGE/Resources/Runtime/node"

# GitHub-hosted node can be dynamically linked against a sibling
# lib/libnode.*.dylib; the app bundle cannot rely on that host path. Static
# distributions have no matches, so this stays a no-op (same as reference).
# 兄弟目录必须与 node 同处 `Resources/Runtime/`——动态 node 的
# `@executable_path/../lib` 才解析得到；旧布局遗留在 Contents/lib 的一并清掉。
NODE_LIB_DIR="$(cd "$(dirname "$NODE")/../lib" 2>/dev/null && pwd || true)"
rm -rf "$STAGE/Resources/Runtime/lib" "$STAGE/lib"
if [[ -n "$NODE_LIB_DIR" ]]; then
  shopt -s nullglob
  node_libraries=("$NODE_LIB_DIR"/libnode*.dylib)
  shopt -u nullglob
  if (( ${#node_libraries[@]} > 0 )); then
    mkdir -p "$STAGE/Resources/Runtime/lib"
    cp -f "${node_libraries[@]}" "$STAGE/Resources/Runtime/lib/"
  fi
fi

rm -rf "$STAGE/Resources/Runtime/dsh"
ditto "$RUNTIME_SOURCE" "$STAGE/Resources/Runtime/dsh"

# Chat-import plugin（导入其他 Agent 会话，社区包 MIT）：独立引脚
# scripts/dsh-chat-import-version.txt，prepare 脚本给出含 fzstd 的暂存目录。
# 运行时由 ChatImportPlugin 装进 harness home 的 web profile（引擎启动前）。
CHAT_IMPORT_SOURCE="$(bash "$ROOT/scripts/prepare-chat-import.sh")"
rm -rf "$STAGE/Resources/Runtime/chat-import"
mkdir -p "$STAGE/Resources/Runtime/chat-import"
cp -R "$CHAT_IMPORT_SOURCE/dsh-chat-import" "$STAGE/Resources/Runtime/chat-import/dsh-chat-import"
cp -R "$CHAT_IMPORT_SOURCE/fzstd" "$STAGE/Resources/Runtime/chat-import/fzstd"

# Re-seal the bundle AFTER all file mutations, BEFORE the self-check.
# xcodebuild leaves an (adhoc) seal over Contents; embed-web + this script
# then add/replace files under it. A stale LaunchServices registration of
# the same .app path + broken seal makes macOS 26 SIGKILL (137, silent —
# no dyld/AMFI message) every exec of the newly embedded binaries. Hit in
# the wild: engine "exited; restart" x3 right after a rebuild in place.
# package-macos.sh 在 DMG 分发前还会用 Developer ID 做最终 seal（逐个签 +
# hardened runtime，公证要求；build-release.sh 路径则只有本处 adhoc seal）；
# 二者顺序勿倒——embed → 本处 re-seal → 自检 → 最终 seal。
codesign --force --deep --sign - "$APP" >/dev/null

# Licenses: prefer files shipped inside the runtime closure; fall back to the
# official source for the Node license only.
cp -f "$RUNTIME_SOURCE/LICENSE" "$STAGE/Resources/Licenses/dsh-LICENSE" 2>/dev/null || \
  echo "warn: could not embed dsh LICENSE from $RUNTIME_SOURCE" >&2
for n in "$RUNTIME_SOURCE"/THIRD_PARTY_NOTICES*; do
  if [[ -f "$n" ]]; then
    cp -f "$n" "$STAGE/Resources/Licenses/dsh-THIRD_PARTY_NOTICES.${n##*.}"
    break
  fi
done
if [[ ! -f "$STAGE/Resources/Licenses/Node.js-LICENSE" ]]; then
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 \
      "https://raw.githubusercontent.com/nodejs/node/v$EXPECTED_NODE_VERSION/LICENSE" \
      -o "$STAGE/Resources/Licenses/Node.js-LICENSE" || \
      echo "warn: could not fetch Node.js LICENSE (offline build?)" >&2
  else
    echo "warn: curl unavailable; Node.js LICENSE not embedded" >&2
  fi
fi

# Post-embed self-check: proves the exact node+bin.js spawn shape the app
# uses at runtime (SPEC-ENGINE-RUNTIME §3.4) before the bundle is signed.
"$STAGE/Resources/Runtime/node" "$STAGE/Resources/Runtime/dsh/lib/bin.js" --version

echo "OK: engine embedded in $APP (node $EXPECTED_NODE_VERSION + $RUNTIME_SOURCE)"
