#!/bin/bash
# DeepDive — dump the engine's composed plugin tree as a normalized, diffable
# list. This is the only observable that answers "what does the engine actually
# load", so every composition change (and every pin bump) is judged by diffing
# this output rather than by reading patch files.
#
# Why a script and not a one-off command: the engine probes $DSH_HOME at boot,
# so dumping against the production home would mix in the user's own plugins —
# and worse, DSH_HOME is where the V3 session store lives (one-way format, see
# docs/SPEC-ENGINE-RUNTIME.md §3.4). This always runs against a throwaway home.
#
# Normalization: `--dump-config` interleaves `# == <layer>` provenance headers
# that legitimately change when the bundle list changes, so they are stripped.
# Row order is deliberately preserved — insert order is part of the composition.
#
# Usage:
#   dump-engine-composition.sh [--runtime <dsh package root>] [--bundles a,b,c]
#                              [--local-bundle <dir>]... [--patch <file>]...
#                              [--profile <name>] [--out <file>]
#
# --patch is repeatable and mirrors the engine launcher: overlays apply after
# every bundle layer, so this is how the app's own engine-patch.yml is observed
# in the composition.
#
# --local-bundle is repeatable: each directory is installed as an npm package
# under the throwaway profile's node_modules (its package.json `name` is read
# for the path), so an in-repo bundle can be composed before it is ever
# embedded. A bundle named in dsh.profile.bundles resolves against the dsh
# installation first and the profile directory second — so a bundle must be
# on disk before the manifest names it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="$ROOT/scripts/dsh-runtime-version.txt"
NODE_VERSION_FILE="$ROOT/scripts/node-version.txt"
PIN="$(tr -d '[:space:]' < "$VERSION_FILE")"
NODE_PIN="$(tr -d '[:space:]' < "$NODE_VERSION_FILE")"

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) DIST_ARCH="arm64" ;;
  x86_64) DIST_ARCH="x64" ;;
  *) echo "unsupported arch: $ARCH" >&2; exit 1 ;;
esac

RUNTIME=""
BUNDLES=""
PROFILE="web"
OUT=""
LOCAL_BUNDLES=()
PATCHES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --runtime) RUNTIME="${2:?--runtime needs a path}"; shift 2 ;;
    --bundles) BUNDLES="${2:?--bundles needs a list}"; shift 2 ;;
    --local-bundle) LOCAL_BUNDLES+=("${2:?--local-bundle needs a directory}"); shift 2 ;;
    --patch) PATCHES+=("${2:?--patch needs a file}"); shift 2 ;;
    --profile) PROFILE="${2:?--profile needs a name}"; shift 2 ;;
    --out) OUT="${2:?--out needs a path}"; shift 2 ;;
    -h|--help) sed -n '2,29p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$RUNTIME" ]]; then
  RUNTIME="$ROOT/dist/.dsh-runtime-cache/$PIN/lib/node_modules/@deepseek-ai/dsh"
fi
[[ -f "$RUNTIME/lib/bin.js" ]] || {
  echo "engine runtime not found: $RUNTIME" >&2
  echo "run scripts/prepare-dsh-runtime.sh first, or pass --runtime <dsh package root>." >&2
  exit 1
}
RUNTIME="$(cd "$RUNTIME" && pwd)"

# Prefer the pinned runtime node when the cache has it; fall back to the build
# machine's node (same bargain prepare-dsh-runtime.sh makes — the launcher only
# needs a node to read the profile, it is not the shipped binary).
NODE="$ROOT/dist/.node-runtime-cache/v${NODE_PIN}-${DIST_ARCH}/bin/node"
if [[ ! -x "$NODE" ]]; then
  NODE="$(command -v node || true)"
fi
[[ -n "$NODE" && -x "$NODE" ]] || { echo "node is required to dump the composition" >&2; exit 1; }

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/deepdive-composition.XXXXXX")"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

PROFILE_DIR="$STAGE/profiles/$PROFILE"
mkdir -p "$PROFILE_DIR"

# Install in-repo bundles before the profile names them: bundle resolution is
# anchored at the dsh installation first and the profile directory second, and
# the loader's module-fallback healing deliberately never creates the bundle
# package itself.
for dir in "${LOCAL_BUNDLES[@]+"${LOCAL_BUNDLES[@]}"}"; do
  [[ -d "$dir" ]] || { echo "--local-bundle is not a directory: $dir" >&2; exit 1; }
  name="$("$NODE" -p 'require(process.argv[1]).name' "$(cd "$dir" && pwd)/package.json")"
  [[ -n "$name" && "$name" != "undefined" ]] || {
    echo "--local-bundle has no package.json name: $dir" >&2; exit 1
  }
  target="$PROFILE_DIR/node_modules/$name"
  mkdir -p "$(dirname "$target")"
  cp -R "$dir" "$target"
done

# A minimal profile manifest is written rather than inherited: the point of the
# dump is to observe the composition we ask for, not whatever the user's home
# happens to carry. patchReload is live because the shipped web profile is.
"$NODE" -e '
const fs = require("node:fs");
const [file, bundlesArg] = process.argv.slice(1);
const bundles = bundlesArg.split(",").map((s) => s.trim()).filter(Boolean);
fs.writeFileSync(file, JSON.stringify({
  name: "dsh-profile-" + file.split("/").slice(-2, -1)[0],
  private: true,
  dependencies: {},
  dsh: { profile: { bundles, patchReload: "live" } },
}, null, 2) + "\n");
' "$PROFILE_DIR/package.json" "$BUNDLES"

STDERR_LOG="$STAGE/dump.err"
PATCH_ARGS=()
for patch in "${PATCHES[@]+"${PATCHES[@]}"}"; do
  [[ -f "$patch" ]] || { echo "--patch is not a file: $patch" >&2; exit 1; }
  PATCH_ARGS+=(--patch "$(cd "$(dirname "$patch")" && pwd)/$(basename "$patch")")
done

if ! DSH_HOME="$STAGE" "$NODE" "$RUNTIME/lib/bin.js" --profile "$PROFILE" \
     "${PATCH_ARGS[@]+"${PATCH_ARGS[@]}"}" --dump-config \
     > "$STAGE/dump.raw" 2> "$STDERR_LOG"; then
  echo "engine --dump-config failed:" >&2
  cat "$STDERR_LOG" >&2
  exit 1
fi

# Layer warnings surface drift (an unmatched `- id:` patch only warns, see
# docs/PITFALLS.md §7.6) — never swallow them.
if [[ -s "$STDERR_LOG" ]]; then
  echo "--- engine warnings during dump ---" >&2
  cat "$STDERR_LOG" >&2
  echo "--- end warnings ---" >&2
fi

NORMALIZED="$STAGE/composition.txt"
awk '
  /^# == / { next }                       # provenance header: changes with the bundle list
  { sub(/[ \t]+$/, ""); print }
' "$STAGE/dump.raw" > "$NORMALIZED"

if [[ -n "$OUT" ]]; then
  mkdir -p "$(dirname "$OUT")"
  cp "$NORMALIZED" "$OUT"
  echo "wrote composition dump: $OUT ($(grep -c '^- id:' "$NORMALIZED") rows)"
else
  cat "$NORMALIZED"
fi
