#!/bin/bash
# DeepDive — boot the engine against a given runtime + composition and assert it
# reaches readiness. This is the gate that a prune cannot fake.
#
# Why it is not optional: `bin.js --version` never loads a plugin, and
# `--dump-config` only parses the patch layers — neither notices a package that a
# row still needs but the closure no longer has. Only a real boot loads every row
# and every service they inject. Owning the composition means owning this proof.
#
# Runs against a throwaway DSH_HOME: the production home holds the V3 session
# store (a one-way format, docs/SPEC-ENGINE-RUNTIME.md §3.4) and would also fold
# the user's own plugins into what we are trying to observe.
#
# Usage: smoke-engine-boot.sh <dsh package root> <bundle dir> [timeout seconds]
set -euo pipefail

RUNTIME_ROOT="${1:?usage: smoke-engine-boot.sh <dsh package root> <bundle dir> [timeout seconds]}"
BUNDLE_DIR="${2:?usage: smoke-engine-boot.sh <dsh package root> <bundle dir> [timeout seconds]}"
TIMEOUT="${3:-60}"

[[ -f "$RUNTIME_ROOT/lib/bin.js" ]] || { echo "not a dsh runtime root: $RUNTIME_ROOT" >&2; exit 1; }
[[ -f "$BUNDLE_DIR/package.json" ]] || { echo "not a bundle directory: $BUNDLE_DIR" >&2; exit 1; }
# node's require() rejects a relative path that does not start with ./, so
# hand it an absolute one.
BUNDLE_DIR="$(cd "$BUNDLE_DIR" && pwd)"

BUNDLE_NAME="$(node -p 'require(process.argv[1]).name' "$BUNDLE_DIR/package.json")"
[[ -n "$BUNDLE_NAME" && "$BUNDLE_NAME" != "undefined" ]] || { echo "bundle has no package.json name: $BUNDLE_DIR" >&2; exit 1; }

NODE="${NODE_SMOKE_SOURCE:-$(command -v node || true)}"
[[ -n "$NODE" && -x "$NODE" ]] || { echo "node is required to boot-smoke the engine" >&2; exit 1; }

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/deepdive-boot-smoke.XXXXXX")"
PID=""
cleanup() {
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    sleep 1
    kill -9 "$PID" 2>/dev/null || true
  fi
  rm -rf "$STAGE"
}
trap cleanup EXIT

PROFILE_DIR="$STAGE/profiles/web"
mkdir -p "$PROFILE_DIR/node_modules"
# The bundle must be on disk before the manifest names it: resolution is anchored
# at the dsh installation first and the profile directory second, and the loader's
# module-fallback healing never creates the bundle package itself.
cp -R "$BUNDLE_DIR" "$PROFILE_DIR/node_modules/$BUNDLE_NAME"
"$NODE" -e '
const fs = require("node:fs");
const [file, profileName, bundleName] = process.argv.slice(1);
fs.writeFileSync(file, JSON.stringify({
  name: profileName, private: true, dependencies: {},
  dsh: { profile: { bundles: [bundleName], patchReload: "live" } },
}, null, 2) + "\n");
' "$PROFILE_DIR/package.json" "dsh-profile-web" "$BUNDLE_NAME"

DSH_HOME="$STAGE" "$NODE" "$RUNTIME_ROOT/lib/bin.js" --profile web --no-open --port 0 \
  > "$STAGE/boot.log" 2>&1 &
PID=$!

# Readiness is the launcher's own `dsh web:` URL line — the same signal the shell
# supervisor waits on, so this asserts the production boot path, not a proxy for it.
deadline=$((SECONDS + TIMEOUT))
ready=""
while (( SECONDS < deadline )); do
  if ! kill -0 "$PID" 2>/dev/null; then break; fi
  if grep -q 'dsh web: http' "$STAGE/boot.log" 2>/dev/null; then ready=yes; break; fi
  sleep 0.5
done

if [[ -z "$ready" ]]; then
  echo "engine did not reach readiness within ${TIMEOUT}s against $BUNDLE_NAME:" >&2
  tail -40 "$STAGE/boot.log" >&2
  exit 1
fi

# Patch warnings are how a stale row id announces itself (an unmatched `- id:`
# only warns — docs/PITFALLS.md §7.6). Surface them rather than passing quietly.
warnings="$(grep -i 'patch: \|not found\|cannot resolve' "$STAGE/boot.log" || true)"
if [[ -n "$warnings" ]]; then
  echo "warn: engine logged composition warnings:" >&2
  printf '%s\n' "$warnings" >&2
fi

echo "OK: engine boot smoke ($BUNDLE_NAME reached readiness)"
