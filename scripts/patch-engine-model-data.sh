#!/bin/bash
# DeepDive — overlay a newer generated model-catalog data layer onto the pi-ai
# copy inside an embedded DSH runtime. See engine-model-data/README.md.
#
# Why: the engine pin carries the pi-ai released alongside it, so provider
# model catalogs (the model menu) go stale while the pin stays. This overlay
# replaces ONLY pi-ai's generated pure-data files — no executable code — which
# the pinned engine code reads unchanged. Idempotent by re-copy; no-ops once
# the runtime's own pi-ai is >= the snapshot version (delete the overlay
# directory after a pin bump past that).
set -euo pipefail

RUNTIME_ROOT="${1:?usage: patch-engine-model-data.sh <dsh-package-root (…/Resources/Runtime/dsh)>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/scripts/engine-model-data"
SNAPSHOT_VERSION="0.86.1" # first pi-ai release this snapshot is current against
# 冒烟断言的哨兵：只在快照版次里出现、包内旧目录没有的模型 —— 只断言"非空"
# 会在覆盖没生效时照样通过（旧目录本来就不空）。
SENTINEL_PROVIDER="opencode-go"
SENTINEL_MODEL="deepseek-v4.1-flash"

# RUNTIME_ROOT is the dsh package root (embed ditto's it whole), so the nested
# pi-ai dep sits directly under its node_modules — same relative path whether
# the root is the bundle copy or the npm-install cache layout.
PIAI="$RUNTIME_ROOT/node_modules/@earendil-works/pi-ai"
[[ -d "$PIAI" ]] || { echo "pi-ai not found in runtime: $PIAI" >&2; exit 1; }
PIAI="$(cd "$PIAI" && pwd)" # node require 不能吃非 ./ 开头的相对路径

INSTALLED="$(node -p 'require(process.argv[1]).version' "$PIAI/package.json")"
if [[ "$(printf '%s\n' "$SNAPSHOT_VERSION" "$INSTALLED" | sort -V | head -1)" == "$SNAPSHOT_VERSION" ]]; then
  echo "skip model-data overlay: runtime pi-ai $INSTALLED already >= $SNAPSHOT_VERSION"
  exit 0
fi

cp -f "$SRC/models.generated.js" "$SRC/image-models.generated.js" "$PIAI/dist/"
cp -f "$SRC"/providers/*.models.js "$PIAI/dist/providers/"
rm -rf "$PIAI/dist/providers/data"
cp -R "$SRC/providers/data" "$PIAI/dist/providers/data"

# Smoke: the overlaid data layer must load (a missing per-provider models.js
# crashes pi-ai at require time, i.e. engine boot) and must actually carry the
# snapshot's models.
node --input-type=module -e '
const [piai, provider, sentinel, snapshot] = process.argv.slice(1);
const all = await import(piai + "/dist/providers/all.js");
const img = await import(piai + "/dist/image-models.generated.js");
const models = all.getBuiltinModels(provider).map((m) => m.id);
if (!models.includes(sentinel)) {
  console.error(`model-data overlay smoke failed: ${provider} has no ${sentinel} (got ${models.length} models)`);
  process.exit(1);
}
if (!Object.keys(img.IMAGE_MODELS ?? {}).length) {
  console.error("model-data overlay smoke failed: empty image catalog");
  process.exit(1);
}
const generatedAt = all.getBuiltinModelDataGeneratedAt();
console.log(`model-data overlay OK: snapshot ${snapshot}, catalog generated ${generatedAt === undefined ? "unknown" : new Date(generatedAt).toISOString()}, ${provider} ${models.length} models (incl. ${sentinel})`);
' "$PIAI" "$SENTINEL_PROVIDER" "$SENTINEL_MODEL" "$SNAPSHOT_VERSION"
