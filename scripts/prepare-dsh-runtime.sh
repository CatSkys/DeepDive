#!/bin/bash
# DSHmini — prepare the pinned DSH runtime closure for bundling.
#
# Aligned with luochenw/deepseek-harness-macos scripts/prepare-dsh-runtime.sh:
#   - `scripts/dsh-runtime-version.txt` is the single version pin.
#   - `DSH_SOURCE` may reuse a same-version full runtime (strictly validated:
#     version + lib/bin.js + nested @deepseek-ai deps all match the pin).
#   - Otherwise installs into an isolated cache
#     `dist/.dsh-runtime-cache/$VERSION/lib/node_modules/@deepseek-ai/dsh`,
#     guarded by a build-dir lock so parallel builds cannot delete each
#     other's stage.
#   - Optional DSH_RUNTIME_VERIFY_LATEST=1 requires `npm view` latest == pin
#     (opt-in; with a prerelease pin this fails by design once npm latest has
#     moved on — that is the "bump pin + test" signal).
# DSHmini addition (SPEC-ENGINE-RUNTIME §3.1): `scripts/node-version.txt`
# pins the Node build-time toolchain; a mismatch fails loud instead of
# silently bundling whatever node the build machine happens to have.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="$ROOT/scripts/dsh-runtime-version.txt"
NODE_VERSION_FILE="$ROOT/scripts/node-version.txt"
PACKAGE="@deepseek-ai/dsh"
EXPECTED_VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"
EXPECTED_NODE_VERSION="$(tr -d '[:space:]' < "$NODE_VERSION_FILE")"
NODE="${NODE_SOURCE:-$(command -v node || true)}"
NPM="${NPM_SOURCE:-$(command -v npm || true)}"

[[ -n "$EXPECTED_VERSION" ]] || {
  echo "DSH runtime version is empty: $VERSION_FILE" >&2
  exit 1
}
[[ -n "$NODE" && -x "$NODE" ]] || {
  echo "Node.js is required to prepare the bundled DSH runtime." >&2
  exit 1
}

# Node toolchain pin (build-time only; the runtime binary is pinned again in
# embed-engine.sh). Fail loud so the builder switches versions (nvm / official
# tarball) rather than shipping an untracked node.
ACTUAL_NODE_VERSION="$("$NODE" -p 'process.versions.node')"
[[ "$ACTUAL_NODE_VERSION" == "$EXPECTED_NODE_VERSION" ]] || {
  echo "Node toolchain mismatch: scripts/node-version.txt pins $EXPECTED_NODE_VERSION, found $ACTUAL_NODE_VERSION ($NODE)." >&2
  echo "Switch to the pinned version (nvm use / official tarball) and retry. No auto-download by design." >&2
  exit 1
}

runtime_version() {
  "$NODE" -e '
    const fs = require("node:fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(String(manifest.version ?? ""));
  ' "$1/package.json"
}

validate_runtime() {
  local source="$1" actual dependency
  [[ -f "$source/package.json" && -f "$source/lib/bin.js" ]] || {
    echo "DSH runtime is incomplete: $source" >&2
    return 1
  }
  actual="$(runtime_version "$source")"
  [[ "$actual" == "$EXPECTED_VERSION" ]] || {
    echo "DSH runtime must be $EXPECTED_VERSION, found ${actual:-unknown}: $source" >&2
    return 1
  }
  for dependency in dsh-subagent dsh-session dsh-web-app; do
    [[ -f "$source/node_modules/@deepseek-ai/$dependency/package.json" ]] || {
      echo "DSH runtime is missing nested @deepseek-ai/$dependency: $source" >&2
      return 1
    }
    actual="$(runtime_version "$source/node_modules/@deepseek-ai/$dependency")"
    # 嵌套依赖须与 pin 完全一致；同 prerelease 线放行漂移的先例与升级对照清单见 docs/PITFALLS.md §7.1。
    [[ "$actual" == "$EXPECTED_VERSION" ]] || {
      echo "@deepseek-ai/$dependency must be $EXPECTED_VERSION, found ${actual:-unknown}: $source" >&2
      return 1
    }
  done
}

# embed-engine.sh 的外部 RUNTIME_SOURCE 复用同一校验：只校验不安装，可用退出 0。
if [[ "${1:-}" == "--validate" ]]; then
  validate_runtime "${2:?usage: prepare-dsh-runtime.sh --validate <runtime-dir>}"
  exit 0
fi

if [[ "${DSH_RUNTIME_VERIFY_LATEST:-0}" == "1" ]]; then
  [[ -n "$NPM" && -x "$NPM" ]] || {
    echo "npm is required to verify and prepare the latest DSH runtime." >&2
    exit 1
  }
  latest="$("$NPM" view "$PACKAGE" version --silent)"
  [[ "$latest" == "$EXPECTED_VERSION" ]] || {
    echo "npm latest for $PACKAGE is $latest, but $VERSION_FILE pins $EXPECTED_VERSION." >&2
    echo "Update the runtime pin and tests before building with the new release." >&2
    exit 1
  }
fi

if [[ -n "${DSH_SOURCE:-}" ]]; then
  validate_runtime "$DSH_SOURCE"
  printf '%s\n' "$DSH_SOURCE"
  exit 0
fi

CACHE_ROOT="${DSH_RUNTIME_CACHE:-$ROOT/dist/.dsh-runtime-cache}"
PREFIX="$CACHE_ROOT/$EXPECTED_VERSION"
SOURCE="$PREFIX/lib/node_modules/$PACKAGE"
LOCK="$CACHE_ROOT/.prepare.lock"
STAGE=""

if validate_runtime "$SOURCE" 2>/dev/null; then
  printf '%s\n' "$SOURCE"
  exit 0
fi

[[ -n "$NPM" && -x "$NPM" ]] || {
  echo "npm is required to install $PACKAGE@$EXPECTED_VERSION." >&2
  exit 1
}

mkdir -p "$CACHE_ROOT"
# 陈锁自检：持有者崩溃后 $LOCK 目录会永久残留，令后来者无限自旋；mtime 超过
# 30 分钟（正常 npm install 远短于此）视为陈锁，删掉重夺并告警。
while ! mkdir "$LOCK" 2>/dev/null; do
  if [[ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]]; then
    echo "warn: stale prepare lock (>30min old): $LOCK — removing and re-acquiring" >&2
    rm -rf "$LOCK"
    continue
  fi
  sleep 1
done
cleanup() {
  [[ -z "$STAGE" ]] || rm -rf "$STAGE"
  rmdir "$LOCK" 2>/dev/null || true
}
trap cleanup EXIT

if validate_runtime "$SOURCE" 2>/dev/null; then
  printf '%s\n' "$SOURCE"
  exit 0
fi

STAGE="$CACHE_ROOT/.stage-$EXPECTED_VERSION-$$"
rm -rf "$STAGE"
"$NPM" install -g --prefix "$STAGE" --no-audit --no-fund "$PACKAGE@$EXPECTED_VERSION" >&2
STAGED_SOURCE="$STAGE/lib/node_modules/$PACKAGE"
validate_runtime "$STAGED_SOURCE"
rm -rf "$PREFIX"
mv "$STAGE" "$PREFIX"
STAGE=""
printf '%s\n' "$SOURCE"
