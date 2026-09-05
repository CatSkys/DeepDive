#!/bin/bash
# DeepDive — embed the pinned engine (Node binary + DSH runtime closure) into a
# built .app. Counterpart of embed-web.sh; run AFTER xcodebuild.
#
# Bundle layout (SPEC-ENGINE-RUNTIME §3.3/§3.4):
#   Contents/MacOS/node                      — pinned Node executable
#   Contents/lib/libnode*.dylib              — only when node is dynamic
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
NODE="${NODE_SOURCE:-$(command -v node || true)}"

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
mkdir -p "$STAGE/MacOS" "$STAGE/Resources/Runtime" "$STAGE/Resources/Licenses"

# Architecture gate: the node binary must carry the build arch.
ARCH="$(uname -m)"
NODE_ARCHS="$(lipo -archs "$NODE" 2>/dev/null || true)"
case " $NODE_ARCHS " in
  *" $ARCH "*) ;;
  *) echo "node lacks build arch $ARCH: $NODE ($NODE_ARCHS)" >&2; exit 1 ;;
esac

cp "$NODE" "$STAGE/MacOS/node"
chmod 755 "$STAGE/MacOS/node"

# GitHub-hosted node can be dynamically linked against a sibling
# lib/libnode.*.dylib; the app bundle cannot rely on that host path. Static
# distributions have no matches, so this stays a no-op (same as reference).
NODE_LIB_DIR="$(cd "$(dirname "$NODE")/../lib" 2>/dev/null && pwd || true)"
if [[ -n "$NODE_LIB_DIR" ]]; then
  shopt -s nullglob
  node_libraries=("$NODE_LIB_DIR"/libnode*.dylib)
  shopt -u nullglob
  if (( ${#node_libraries[@]} > 0 )); then
    rm -rf "$STAGE/lib"
    mkdir -p "$STAGE/lib"
    cp -f "${node_libraries[@]}" "$STAGE/lib/"
  fi
fi

rm -rf "$STAGE/Resources/Runtime/dsh"
ditto "$RUNTIME_SOURCE" "$STAGE/Resources/Runtime/dsh"

# Model-menu freshness: the pinned engine's pi-ai catalog is frozen at its
# release date. Overlay the newer generated data layer (pure data, no code —
# scripts/engine-model-data/README.md); no-ops once the pin's pi-ai is newer
# than the snapshot.
bash "$ROOT/scripts/patch-engine-model-data.sh" "$STAGE/Resources/Runtime/dsh"

# Re-seal the bundle AFTER all file mutations, BEFORE the self-check.
# xcodebuild leaves an (adhoc) seal over Contents; embed-web + this script
# then add/replace files under it. A stale LaunchServices registration of
# the same .app path + broken seal makes macOS 26 SIGKILL (137, silent —
# no dyld/AMFI message) every exec of the newly embedded binaries. Hit in
# the wild: engine "exited; restart" x3 right after a rebuild in place.
# package-macos.sh 在 DMG 分发前还会做最终 deep seal（build-release.sh 路径则
# 只有本处 seal）；二者顺序勿倒——embed → 本处 re-seal → 自检 → 最终 seal。
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
"$STAGE/MacOS/node" "$STAGE/Resources/Runtime/dsh/lib/bin.js" --version

echo "OK: engine embedded in $APP (node $EXPECTED_NODE_VERSION + $RUNTIME_SOURCE)"
