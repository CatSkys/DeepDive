#!/bin/bash
# DeepDive — prompt round-trip smoke for a built engine runtime.
#
# Boot-smoke (smoke-engine-boot.sh) proves the engine reaches readiness; it
# cannot prove a prompt actually lands in the session. The 2026-09-28 fork
# acceptance failure shipped exactly that gap: the closure's flock addon was
# missing, session-persistence's lease failed silently, and sent messages
# vanished — readiness was green the whole time. This gate creates a session,
# submits one text prompt over the real unary wire, and asserts the engine
# records the text back in the session's turnOutline.
#
# Runs against a throwaway DSH_HOME, same discipline as smoke-engine-boot.sh.
#
# Usage: smoke-engine-prompt.sh <dsh package root> <bundle dir> [timeout seconds]
set -euo pipefail

RUNTIME_ROOT="${1:?usage: smoke-engine-prompt.sh <dsh package root> <bundle dir> [timeout seconds]}"
BUNDLE_DIR="${2:?usage: smoke-engine-prompt.sh <dsh package root> <bundle dir> [timeout seconds]}"
TIMEOUT="${3:-60}"

[[ -f "$RUNTIME_ROOT/lib/bin.js" ]] || { echo "not a dsh runtime root: $RUNTIME_ROOT" >&2; exit 1; }
[[ -f "$BUNDLE_DIR/package.json" ]] || { echo "not a bundle directory: $BUNDLE_DIR" >&2; exit 1; }
BUNDLE_DIR="$(cd "$BUNDLE_DIR" && pwd)"

NODE="${NODE_SMOKE_SOURCE:-$(command -v node || true)}"
[[ -n "$NODE" && -x "$NODE" ]] || { echo "node is required to prompt-smoke the engine" >&2; exit 1; }

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/deepdive-prompt-smoke.XXXXXX")"
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
cp -R "$BUNDLE_DIR" "$PROFILE_DIR/node_modules/deepdive-engine-profile"
"$NODE" -e '
const fs = require("node:fs");
const [file, bundleName] = process.argv.slice(1);
fs.writeFileSync(file, JSON.stringify({
  name: "web-profile", private: true, dependencies: {},
  dsh: { profile: { bundles: [bundleName], patchReload: "live" } },
}, null, 2) + "\n");
' "$PROFILE_DIR/package.json" "deepdive-engine-profile"

DSH_HOME="$STAGE" "$NODE" "$RUNTIME_ROOT/lib/bin.js" --profile web --no-open --port 0 \
  > "$STAGE/boot.log" 2>&1 &
PID=$!

deadline=$((SECONDS + TIMEOUT))
base=""
token=""
while (( SECONDS < deadline )); do
  if ! kill -0 "$PID" 2>/dev/null; then break; fi
  line="$(grep 'dsh web: http' "$STAGE/boot.log" 2>/dev/null | tail -1 || true)"
  base="$(printf '%s' "$line" | sed -n 's/.*dsh web: \(http:\/\/[^? ]*\).*/\1/p' || true)"
  token="$(printf '%s' "$line" | sed -n 's/.*token=//p' | tr -d '[:space:]' || true)"
  [[ -n "$base" && -n "$token" ]] && break
  sleep 0.5
done
[[ -n "$base" && -n "$token" ]] || { echo "engine did not reach readiness within ${TIMEOUT}s:" >&2; tail -40 "$STAGE/boot.log" >&2; exit 1; }

"$NODE" - "$base" "$token" "$STAGE" <<'EOF'
const { execFileSync } = require("node:child_process");
const base = process.argv[2].replace(/\/$/, ""), token = process.argv[3], stage = process.argv[4];
const post = (method, args, cookie) => JSON.parse(execFileSync("curl", [
  "-s", "--max-time", "10", "-X", "POST", `${base}/api/${method}`,
  "-H", "content-type: application/json", "-H", `Cookie: ${cookie}`,
  "-d", JSON.stringify({ type: "client-request", rpcId: "s1", method, payload: { args } }),
]).toString());
const fail = (msg) => {
  console.error(`prompt smoke FAILED: ${msg}`);
  process.exit(1);
};

const root = execFileSync("curl", ["-si", "--max-time", "5", `${base}/?token=${token}`])
  .toString().split("\n").find((l) => /^set-cookie/i.test(l));
const cookie = root?.replace(/^set-cookie:\s*/i, "").split(";")[0];
if (!cookie) fail("engine minted no auth cookie");

const created = post("session/create", { request: { cwd: stage } }, cookie);
if (!created.result?.ok) fail(`session/create: ${JSON.stringify(created.result?.error)}`);
const sessionId = created.result.value.sessionId;

const text = `engine prompt smoke ${Date.now()}`;
const ack = post("session/prompt", {
  request: { requestId: "smoke-1", sessionId, mode: "queue", content: [{ type: "text", text }] },
}, cookie);
if (!ack.result?.ok) fail(`session/prompt: ${JSON.stringify(ack.result?.error)}`);

const readOutline = () => {
  const list = post("session/list", { _request: {} }, cookie);
  const s = list.result?.value?.items?.find((x) => x.sessionId === sessionId);
  return s?.projections?.values?.turnOutline;
};
let recorded;
// The turn row lands before the user-message event does — poll until the
// text itself appears (a turn that stays "" forever IS the failure mode this
// gate exists for).
for (let waited = 0; waited < 20000; waited += 1000) {
  const outline = readOutline();
  recorded = outline?.[0]?.prompt;
  if (recorded === text) break;
  execFileSync("sleep", ["1"]);
}
if (recorded !== text) {
  fail(`turnOutline.prompt = ${JSON.stringify(recorded)} (expected the submitted text; ` +
    `a "" here means the prompt never reached the session log — ` +
    `check the runtime's native flock addon and session-persistence lease)`);
}
console.log("OK: engine prompt smoke (submitted text round-tripped through session log)");
EOF
