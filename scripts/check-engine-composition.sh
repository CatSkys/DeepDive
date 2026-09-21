#!/bin/bash
# DeepDive — fail when the engine's composed plugin tree no longer matches what
# the repo says it composes.
#
# This is the mechanical half of owning the composition tree: because engine/profile
# lists every row ourselves, an upstream release that adds, removes or reconfigures
# a row does NOT reach us automatically — and an `- id:` that matches nothing only
# warns (docs/PITFALLS.md §7.6), so nothing else would notice. Dumping and diffing
# against the checked-in expectation is what turns that silence into a reviewable
# diff at exactly the moment it matters (a pin bump, or an edit to the row list).
#
# It runs wherever a pinned runtime is available (the build chain boots the engine
# for real; scripts/test.sh runs this). Without one it SKIPS rather than fails, so a
# frontend-only checkout is not blocked — the skip is printed, never silent.
#
# Usage: check-engine-composition.sh [--runtime <dsh package root>]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED="$ROOT/engine/profile/composition.expected.txt"
[[ -f "$EXPECTED" ]] || { echo "missing expectation: $EXPECTED" >&2; exit 1; }

RUNTIME_ARGS=()
if [[ "${1:-}" == "--runtime" ]]; then
  RUNTIME_ARGS=(--runtime "${2:?--runtime needs a path}")
fi

ACTUAL="$(mktemp "${TMPDIR:-/tmp}/deepdive-composition-check.XXXXXX")"
trap 'rm -f "$ACTUAL"' EXIT

DUMP_LOG="$(mktemp "${TMPDIR:-/tmp}/deepdive-composition-dump.XXXXXX")"
trap 'rm -f "$ACTUAL" "$DUMP_LOG"' EXIT

if ! bash "$ROOT/scripts/dump-engine-composition.sh" \
      "${RUNTIME_ARGS[@]+"${RUNTIME_ARGS[@]}"}" \
      --bundles "deepdive-engine-profile" \
      --local-bundle "$ROOT/engine/profile" \
      --out "$ACTUAL" > "$DUMP_LOG" 2>&1; then
  # No runtime here is a normal state (frontend-only checkout, fresh clone before
  # the first build), not a composition failure — say so and let the caller pass.
  if grep -q "engine runtime not found" "$DUMP_LOG"; then
    echo "skip composition check: no pinned runtime prepared yet (run scripts/prepare-dsh-runtime.sh)"
    exit 0
  fi
  cat "$DUMP_LOG" >&2
  exit 1
fi

if diff -u "$EXPECTED" "$ACTUAL" > "$DUMP_LOG"; then
  echo "OK: engine composition matches engine/profile/composition.expected.txt ($(grep -c '^- id:' "$ACTUAL") rows)"
  exit 0
fi

cat >&2 <<'EOF'
engine composition DRIFTED from engine/profile/composition.expected.txt.

Two legitimate readings, and the diff below says which:
  · you edited engine/profile/cordis.patch.yml on purpose → re-generate the
    expectation and commit both together:
      scripts/dump-engine-composition.sh --bundles deepdive-engine-profile \
        --local-bundle engine/profile --out engine/profile/composition.expected.txt
  · you bumped scripts/dsh-runtime-version.txt → upstream changed its own layers.
    Adjudicate each line (a new core row we are missing, a row that vanished, a
    changed config) and decide per row before updating the expectation.
    engine/profile/README.md has the full procedure.

A removal you do not recognise is the one that matters: it means upstream dropped
or renamed a row we still carry.

EOF
cat "$DUMP_LOG" >&2
exit 1
