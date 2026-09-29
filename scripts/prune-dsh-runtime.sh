#!/bin/bash
# DeepDive — remove engine-closure packages that the owned composition
# (engine/profile) does not load, from the copy being embedded.
#
# Why this exists: the closure is prepared from `@deepseek-ai/dsh`'s own
# dependency tree, so it carries every package any shipped profile could want —
# including ~47 MB of official-GUI client packages whose only job is shipping
# browser modules to the official web page DeepDive never loads. Ownership of the
# composition (engine/profile) is what makes those removals stateable; this
# script is the mechanical half of that decision.
#
# Discipline mirrors patch-engine-model-data.sh: a version gate against the
# runtime pin, an explicit list, and a smoke. It does NOT sign — embed-engine.sh
# re-seals after every mutation, and this runs before that seal.
#
# Each removal is judged by a real boot (scripts/smoke-engine-boot.sh), not by
# reading imports: static reachability over a bundled closure is unreliable — it
# cannot see plugin rows or the agent-preset YAML compositions, so it both
# over- and under-reports. A package a kept row still needs fails the boot.
set -euo pipefail

RUNTIME_ROOT="${1:?usage: prune-dsh-runtime.sh <dsh-package-root (…/Resources/Runtime/dsh)>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIN="$(tr -d '[:space:]' < "$ROOT/scripts/dsh-runtime-version.txt")"

[[ -f "$RUNTIME_ROOT/lib/bin.js" ]] || { echo "not a dsh runtime root: $RUNTIME_ROOT" >&2; exit 1; }
# node's require() rejects a relative path that does not start with ./ — the build
# chain passes a relative .app path (the same trap patch-engine-model-data.sh hits).
RUNTIME_ROOT="$(cd "$RUNTIME_ROOT" && pwd)"
ACTUAL="$(node -p 'require(process.argv[1]).version' "$RUNTIME_ROOT/package.json")"
[[ "$ACTUAL" == "$PIN" ]] || {
  echo "runtime is $ACTUAL but the pin is $PIN — this list is written for one pin's shape; re-derive it before pruning." >&2
  exit 1
}

# RUNTIME_ROOT is the dsh *package* root (what embed-engine.sh dittos into
# Resources/Runtime/dsh), so the engine's own packages sit one level under its
# node_modules — same shape whether the root is the bundle copy or the npm cache.
NM="$RUNTIME_ROOT/node_modules"
[[ -d "$NM/@deepseek-ai" ]] || { echo "runtime has no nested engine packages: $NM/@deepseek-ai" >&2; exit 1; }

# The 38 rows engine/profile deliberately does not carry, by their implementing
# package. Kept in step with the human-readable list in
# engine/profile/cordis.patch.yml — the two are one decision in two forms.
REMOVE=(
  # 34 official-GUI-only rows: empty `apply() {}` node halves that exist only to
  # ship browser modules to the official page.
  @deepseek-ai/dsh-client-ui-agent-preset
  @deepseek-ai/dsh-client-ui-approval
  @deepseek-ai/dsh-client-ui-attachment
  @deepseek-ai/dsh-client-ui-brand-official
  @deepseek-ai/dsh-client-ui-commands
  @deepseek-ai/dsh-client-ui-cordis
  @deepseek-ai/dsh-client-ui-goal
  @deepseek-ai/dsh-client-ui-input-trigger
  @deepseek-ai/dsh-client-ui-jobs
  @deepseek-ai/dsh-client-ui-layout
  @deepseek-ai/dsh-client-ui-message-feedback
  @deepseek-ai/dsh-client-ui-model-selection
  @deepseek-ai/dsh-client-ui-open-in-app
  @deepseek-ai/dsh-client-ui-permission-presets
  @deepseek-ai/dsh-client-ui-plan
  @deepseek-ai/dsh-client-ui-reference
  @deepseek-ai/dsh-client-ui-renderer
  @deepseek-ai/dsh-client-ui-schedule
  @deepseek-ai/dsh-client-ui-session
  @deepseek-ai/dsh-client-ui-settings
  @deepseek-ai/dsh-client-ui-settings-models
  @deepseek-ai/dsh-client-ui-settings-plugin-inventory
  @deepseek-ai/dsh-client-ui-settings-plugins
  @deepseek-ai/dsh-client-ui-sidebar
  @deepseek-ai/dsh-client-ui-sidebar-documentpreview
  @deepseek-ai/dsh-client-ui-sidebar-files
  @deepseek-ai/dsh-client-ui-sidebar-right
  @deepseek-ai/dsh-client-ui-skill
  @deepseek-ai/dsh-client-ui-subagent
  @deepseek-ai/dsh-client-ui-tool
  @deepseek-ai/dsh-client-ui-trajectory
  @deepseek-ai/dsh-client-ui-user-questions
  @deepseek-ai/dsh-client-ui-workflow-run
  @deepseek-ai/dsh-client-ui-workspace
  # Client plumbing for that same page.
  @deepseek-ai/dsh-client-modules
  @deepseek-ai/dsh-client-hmr
  @deepseek-ai/dsh-cordis-client-runner
  @deepseek-ai/dsh-client-resources
  # 2026-09-29: five official-GUI client rows whose host halves our SPA does not
  # consume (their namespaces are gone from the profile; the system-prompt section
  # ui-deliverables registered moved into the deployment prompt).
  @deepseek-ai/dsh-client-ui-theme
  @deepseek-ai/dsh-client-locale
  @deepseek-ai/dsh-client-ui-settings-general
  @deepseek-ai/dsh-client-ui-chat
  @deepseek-ai/dsh-client-ui-deliverables
  # 2026-09-29 (second round): the SPA's busyEnter namespace is registered by
  # @deepdive/engine-host now, so the official conversation shell goes too.
  @deepseek-ai/dsh-client-ui-conversation
  # A GitHub webhook surface no composition of ours mounts. Kept out of the
  # patch-file list (it never had a row); removed here so the tree goes with it.
  @deepseek-ai/dsh-webhook-github
  # 2026-09-29: the two never-wired groups from docs/PLAN-NATIVE-ENGINE.md §3.2,
  # judged here rather than kept as dead weight. Both reach the closure only
  # through apps/cli's dependency list (they serve its `acp` profile and the
  # external-CLI hooks bridge); no profile row and no agent preset names them.
  # LSP and the SDK are not shipped at all, so there is nothing to prune there.
  @deepseek-ai/dsh-hooks-claude-code
  @deepseek-ai/dsh-hooks-codex
  @deepseek-ai/dsh-acp
  # The feedback channel, all three faces (see the rationale in
  # engine/profile/cordis.patch.yml): DeepDive has no feedback UI, so the OTLP
  # transport can never fire, and the two feedback packages import each other.
  @deepseek-ai/dsh-message-feedback
  @deepseek-ai/dsh-command-feedback
  @deepseek-ai/dsh-session-telemetry-otel
)
# Third-party trees reached only through the removals above.
REMOVE_SCOPED=(
  @octokit
  # The OTLP stack: 11 packages, ~34 MB, reached only by session-telemetry-otel.
  @opentelemetry
)

kb() { du -sk "$1" 2>/dev/null | awk '{print $1}'; }
before="$(kb "$NM")"

removed=0
absent=()
for name in "${REMOVE[@]}" "${REMOVE_SCOPED[@]}"; do
  if [[ -d "$NM/$name" ]]; then
    rm -rf "$NM/$name"
    removed=$((removed + 1))
  else
    # Not a failure — an upstream reshuffle may have renamed or dropped it. It is
    # a drift signal: re-derive the list before the next prune.
    absent+=("$name")
  fi
done
after="$(kb "$NM")"

if (( ${#absent[@]} > 0 )); then
  echo "warn: ${#absent[@]} listed package(s) absent from this runtime — the removal list has drifted from the pin:" >&2
  printf '  %s\n' "${absent[@]}" >&2
fi

# Smoke: the launcher must still load. This only reaches bin.js — a package a
# plugin row needs is caught by the boot smoke, which is where these removals are
# actually judged.
node "$RUNTIME_ROOT/lib/bin.js" --version >/dev/null

echo "OK: pruned $removed package trees, closure $((before / 1024)) MB → $((after / 1024)) MB (freed $(( (before - after) / 1024 )) MB)"
