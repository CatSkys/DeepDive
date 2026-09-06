#!/bin/bash
# DeepDive — prepare the pinned dsh-chat-import plugin closure for bundling.
#
# `dsh-chat-import`（社区插件，MIT）为引擎提供「导入其他 Agent 会话」的
# HTTP 面板路由（/api-import/*，见 docs/DSH-PLUGIN-CHAT-IMPORT.md）。与
# prepare-dsh-runtime.sh 同一套机制：版本引脚 scripts/dsh-chat-import-version.txt
# 是唯一事实源；安装进隔离缓存 dist/.chat-import-cache/<version>/ 后把插件包与
# 其运行时依赖（fzstd）复制成嵌入目录。stdout 输出暂存目录路径（供 embed 取用）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="$ROOT/scripts/dsh-chat-import-version.txt"
PACKAGE="dsh-chat-import"
EXPECTED_VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"
NPM="${NPM_SOURCE:-$(command -v npm || true)}"

[[ -n "$EXPECTED_VERSION" ]] || { echo "chat-import pin is empty" >&2; exit 1; }
[[ -n "$NPM" && -x "$NPM" ]] || { echo "npm is required to prepare dsh-chat-import" >&2; exit 1; }

CACHE="$ROOT/dist/.chat-import-cache/$EXPECTED_VERSION"
STAGE="$CACHE/stage"
mkdir -p "$STAGE"

if [[ -f "$STAGE/dsh-chat-import/package.json" && -d "$STAGE/fzstd" ]]; then
  echo "$STAGE"
  exit 0
fi

# 独立前缀安装拿到完整依赖闭包（插件自身零构建纯 ESM，依赖只有 fzstd）。
"$NPM" install --prefix "$CACHE/prefix" \
  "$PACKAGE@$EXPECTED_VERSION" --registry https://registry.npmjs.org \
  --no-audit --no-fund --loglevel=error

rm -rf "$STAGE/dsh-chat-import" "$STAGE/fzstd"
cp -R "$CACHE/prefix/node_modules/$PACKAGE" "$STAGE/dsh-chat-import"
if [[ -d "$CACHE/prefix/node_modules/fzstd" ]]; then
  cp -R "$CACHE/prefix/node_modules/fzstd" "$STAGE/fzstd"
else
  echo "dsh-chat-import dependency fzstd missing from closure" >&2
  exit 1
fi

# 版本强校验：装出来的必须与引脚一致。
INSTALLED="$(node -p "require('$STAGE/dsh-chat-import/package.json').version")"
[[ "$INSTALLED" == "$EXPECTED_VERSION" ]] || {
  echo "dsh-chat-import mismatch: pin $EXPECTED_VERSION, installed $INSTALLED" >&2
  exit 1
}

echo "$STAGE"
