#!/bin/bash
# DeepDive — build DeepDive's own engine from engine/ (the forked dsh kernel).
#
# Why this exists: the shipped engine used to be the upstream npm closure
# (prepare-dsh-runtime.sh). Owning the kernel is what makes it possible to add
# RPCs, strip dsh product layers, and move the agent plane into this repo —
# none of which is possible while the engine is an opaque external package.
#
# The output has the SAME shape prepare-dsh-runtime.sh's validate_runtime()
# expects, so embed-engine.sh and the boot/组合 gates can consume it unchanged:
#   <out>/package.json          — version must equal scripts/dsh-runtime-version.txt
#   <out>/lib/bin.js            — the spawn entry
#   <out>/node_modules/…        — the flattened closure (pnpm hoists workspace
#                                 links into a real node_modules tree)
#
# Usage:
#   build-engine.sh [--out <dir>] [--skip-install] [--skip-build]
#
# Default out: dist/.dsh-engine-build/<pin>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE_DIR="$ROOT/engine"
PIN="$(tr -d '[:space:]' < "$ROOT/scripts/dsh-runtime-version.txt")"
NODE_VERSION_FILE="$ROOT/scripts/node-version.txt"
EXPECTED_NODE_VERSION="$(tr -d '[:space:]' < "$NODE_VERSION_FILE")"
OUT="$ROOT/dist/.dsh-engine-build/$PIN"
DO_INSTALL=1
DO_BUILD=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT="${2:?--out needs a path}"; shift 2 ;;
    --skip-install) DO_INSTALL=0; shift ;;
    --skip-build) DO_BUILD=0; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

[[ -d "$ENGINE_DIR" ]] || {
  echo "engine/ not found. Run scripts/sync-engine-fork.mjs first." >&2
  exit 1
}

NODE="${NODE_SOURCE:-$(command -v node || true)}"
[[ -n "$NODE" && -x "$NODE" ]] || { echo "node is required" >&2; exit 1; }
ACTUAL_NODE_VERSION="$("$NODE" -p 'process.versions.node')"
[[ "$ACTUAL_NODE_VERSION" == "$EXPECTED_NODE_VERSION" ]] || {
  echo "Node toolchain mismatch: scripts/node-version.txt pins $EXPECTED_NODE_VERSION, found $ACTUAL_NODE_VERSION." >&2
  echo "Switch to the pinned version and retry (nvm use / official tarball)." >&2
  exit 1
}

PNPM="${PNPM_SOURCE:-$(command -v pnpm || true)}"
[[ -n "$PNPM" && -x "$PNPM" ]] || { echo "pnpm is required to build the engine workspace" >&2; exit 1; }

# The forked root manifest must still agree with the pin: validate_runtime()
# and check-dsh-source.sh both read that version, and a silent mismatch here
# would only surface much later as a confusing boot failure.
ENGINE_VERSION="$(sed -n 's/^[[:space:]]*"version": "\(.*\)",\{0,1\}$/\1/p' "$ENGINE_DIR/apps/cli/package.json" | head -1)"
[[ "$ENGINE_VERSION" == "$PIN" ]] || {
  echo "engine/apps/cli is $ENGINE_VERSION but the pin is $PIN." >&2
  echo "Re-run scripts/sync-engine-fork.mjs after bumping scripts/dsh-runtime-version.txt." >&2
  exit 1
}

cd "$ENGINE_DIR"

if [[ "$DO_INSTALL" == "1" ]]; then
  echo "==> pnpm install (frozen lockfile)"
  "$PNPM" install --frozen-lockfile
fi

if [[ "$DO_BUILD" == "1" ]]; then
  echo "==> pnpm run build:lib:host"
  "$PNPM" run build:lib:host
  # The host flock addon is compiled from vendored C sources into
  # native/system/packages/<host>/bin/; without it the npm-tarball's bin/ has no
  # counterpart in the fork and session-persistence's lease fails silently
  # (sent prompts never reach the session — 2026-09-28 acceptance failure).
  # PATH prefix pins both the compiler run and Node-header discovery
  # (build.ts resolves headers next to process.execPath) to the pinned node.
  echo "==> pnpm run build:native-system"
  PATH="$(dirname "$NODE"):$PATH" "$PNPM" run build:native-system
fi

# ── collect the runtime closure ──
# The shipped artifact is a single package root whose node_modules holds every
# transitive dependency. pnpm's workspace links live in per-package
# node_modules, so we assemble the flat tree here: symlink-free copies, since
# the app bundle gets deep-signed and ad-hoc signed as a unit (PITFALLS §4.8/§5.7)
# and a symlink escaping the stage would break that.
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/deepdive-engine-build.XXXXXX")"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

echo "==> assembling runtime closure into $OUT"
rm -rf "$OUT"
mkdir -p "$OUT/lib" "$OUT/node_modules/@deepseek-ai"

cp "$ENGINE_DIR/apps/cli/package.json" "$OUT/package.json"
# LICENSE 缺失会让 embed-engine.sh 的许可嵌入告警（THIRD_PARTY_NOTICES* 同理由
# embed 侧容忍缺失）。MIT 许可证在 fork 根，不在 apps/cli。
for f in LICENSE README.md README.zh.md; do
  if [[ -f "$ENGINE_DIR/apps/cli/$f" ]]; then cp "$ENGINE_DIR/apps/cli/$f" "$OUT/$f";
  elif [[ -f "$ENGINE_DIR/$f" ]]; then cp "$ENGINE_DIR/$f" "$OUT/$f"; fi
done
cp -R "$ENGINE_DIR/apps/cli/lib/." "$OUT/lib/"

# Walk the workspace closure: every @deepseek-ai package the root depends on,
# plus every third-party package reachable from it. `pnpm ls --prod --json`
# reports the resolved tree without us re-deriving dependency resolution.
"$NODE" "$ROOT/scripts/collect-engine-closure.mjs" \
  --engine "$ENGINE_DIR" --out "$OUT"

# The gate every consumer already runs: version + lib/bin.js + nested package
# versions + undici. Failing here means the artifact is unusable, so fail here
# rather than inside embed-engine.sh.
bash "$ROOT/scripts/prepare-dsh-runtime.sh" --validate "$OUT"

# Readiness proves nothing about message delivery (the 2026-09-28 flock
# regression was readiness-green); assert a prompt actually round-trips.
bash "$ROOT/scripts/smoke-engine-prompt.sh" "$OUT" "$ENGINE_DIR/profile"

echo "OK: engine built at $OUT"
