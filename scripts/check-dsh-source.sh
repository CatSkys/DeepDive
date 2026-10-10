#!/bin/bash
# DeepDive — vendored DSH source version guard.
#
# `deepseek-harness/` is the porting/reference copy of the official DSH
# monorepo and must always match the engine version (scripts/dsh-runtime-version.txt).
# A mismatch once shipped silently (vendored 0.1.2-alpha.2 vs embedded runtime
# 0.1.1-rc.2), so wire-contract and UI-porting lookups read the wrong engine
# version. Fail the build instead.
#
# The engine is owned in-repo now (engine/), so this copy is the frozen fork
# baseline reference — no upstream syncs; the guard only pins the pairing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIN_FILE="$ROOT/scripts/dsh-runtime-version.txt"
SOURCE_MANIFEST="$ROOT/deepseek-harness/package.json"

PIN="$(tr -d '[:space:]' < "$PIN_FILE")"
ACTUAL="$(sed -n 's/^[[:space:]]*"version": "\(.*\)",\{0,1\}$/\1/p' "$SOURCE_MANIFEST" | head -1)"

[[ -n "$PIN" ]] || { echo "runtime pin is empty: $PIN_FILE" >&2; exit 1; }
[[ -n "$ACTUAL" ]] || { echo "cannot read version from $SOURCE_MANIFEST" >&2; exit 1; }
[[ "$ACTUAL" == "$PIN" ]] || {
  echo "vendored DSH source mismatch: deepseek-harness/ is $ACTUAL, runtime pin is $PIN." >&2
  echo "Replace deepseek-harness/ with the dsh-v$PIN tag from github.com/deepseek-ai/deepseek-harness (see docs/DSH-SOURCE-MAP.md)." >&2
  exit 1
}
