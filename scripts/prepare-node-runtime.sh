#!/bin/bash
# DeepDive — prepare the pinned official Node.js runtime binary for bundling.
#
# The embedded engine binary ships to user machines, so it must be
# self-contained (system libs only). A machine-local node (Homebrew / nvm)
# drags absolute /opt/homebrew dylib deps that neither exist on clean
# machines nor survive hardened-runtime library validation (2026-09-06:
# notarized build's node died in dyld on libllhttp). Therefore the runtime
# source defaults to the official nodejs.org dist tarball pinned by
# scripts/node-version.txt, checksum-verified against the dist SHASUMS256.
#
# Output: absolute path of the prepared node binary (stdout only).
# NODE_RUNTIME_SOURCE may point at an alternative node binary dir (must pass
# the same self-containment gate); DSH_RUNTIME-style lock guards parallel
# builds (PITFALLS §5.5).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$ROOT/scripts/node-version.txt")"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) DIST_ARCH="arm64" ;;
  x86_64) DIST_ARCH="x64" ;;
  *) echo "unsupported build arch: $ARCH" >&2; exit 1 ;;
esac
TARBALL="node-v${VERSION}-darwin-${DIST_ARCH}.tar.gz"
URL="https://nodejs.org/dist/v${VERSION}/${TARBALL}"

# 自包含门：运行时二进制只许依赖 rpath 系与系统库；宿主机绝对路径依赖
# （/opt/homebrew、/usr/local）在干净用户机器上必炸。
self_contained() {
  local binary="$1" dep
  while IFS= read -r dep; do
    case "$dep" in
      @rpath/*|@loader_path/*|@executable_path/*|/usr/lib/*|/System/*) ;;
      *) echo "node runtime is not self-contained: $binary depends on $dep" >&2; return 1 ;;
    esac
  done < <(otool -L "$binary" | tail -n +2 | awk '{print $1}')
}

version_of() { "$1/bin/node" -p 'process.versions.node'; }

CACHE_ROOT="${NODE_RUNTIME_CACHE:-$ROOT/dist/.node-runtime-cache}"
PREFIX="$CACHE_ROOT/v${VERSION}-${DIST_ARCH}"
LOCK="$CACHE_ROOT/.prepare.lock"
STAGE=""

if [[ -x "$PREFIX/bin/node" ]] \
  && [[ "$(version_of "$PREFIX")" == "$VERSION" ]] \
  && self_contained "$PREFIX/bin/node"; then
  printf '%s\n' "$PREFIX/bin/node"
  exit 0
fi

mkdir -p "$CACHE_ROOT"
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

if [[ -x "$PREFIX/bin/node" ]] \
  && [[ "$(version_of "$PREFIX")" == "$VERSION" ]] \
  && self_contained "$PREFIX/bin/node"; then
  printf '%s\n' "$PREFIX/bin/node"
  exit 0
fi

STAGE="$CACHE_ROOT/.stage-${VERSION}-$$"
rm -rf "$STAGE"
mkdir -p "$STAGE"
curl -fsSL --retry 3 -o "$STAGE/$TARBALL" "$URL"
curl -fsSL --retry 3 -o "$STAGE/SHASUMS256.txt" "https://nodejs.org/dist/v${VERSION}/SHASUMS256.txt"
(
  cd "$STAGE"
  grep " ${TARBALL}\$" SHASUMS256.txt | shasum -a 256 -c - >/dev/null
)
tar -xzf "$STAGE/$TARBALL" -C "$STAGE"
EXTRACTED="$STAGE/node-v${VERSION}-darwin-${DIST_ARCH}"
[[ "$(version_of "$EXTRACTED")" == "$VERSION" ]] || {
  echo "downloaded node reports $(version_of "$EXTRACTED"), pin is $VERSION" >&2
  exit 1
}
self_contained "$EXTRACTED/bin/node"
rm -rf "$PREFIX"
mv "$EXTRACTED" "$PREFIX"
STAGE=""
printf '%s\n' "$PREFIX/bin/node"
