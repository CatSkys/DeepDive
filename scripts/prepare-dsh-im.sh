#!/bin/bash
# DeepDive — prepare the pinned @xmanrui/dsh-im closure for bundling.
#
# `@xmanrui/dsh-im`（社区插件，MIT）给引擎挂上 IM 渠道面：每个渠道一个 HTTP
# 面 `POST /api/dsh-im/<渠道>`（body 形如 {type:"client-request", rpcId,
# method:"dsh-im/<渠道>", payload:{method:<端点>, payload:<参数>}}），微信 /
# 飞书 / 钉钉 / 企业微信 / Slack / Telegram 等渠道的机器人就靠它跑起来；
# 我们只自建设置面，不引它的官方 web 客户端。契约见 docs/SPEC-MOBILE-REMOTE.md。
#
# 与 prepare-chat-import.sh 同一套机制：版本引脚 scripts/dsh-im-version.txt 是
# 唯一事实源；装进隔离缓存后把**整棵依赖闭包**（插件 + qrcode/undici/
# dingtalk-stream 等运行时依赖）复制成嵌入目录。stdout 输出暂存目录路径。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="$ROOT/scripts/dsh-im-version.txt"
PACKAGE="@xmanrui/dsh-im"
EXPECTED_VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"
NPM="${NPM_SOURCE:-$(command -v npm || true)}"

[[ -n "$EXPECTED_VERSION" ]] || { echo "dsh-im pin is empty" >&2; exit 1; }
[[ -n "$NPM" && -x "$NPM" ]] || { echo "npm is required to prepare dsh-im" >&2; exit 1; }

CACHE="$ROOT/dist/.dsh-im-cache/$EXPECTED_VERSION"
STAGE="$CACHE/stage"
MODULES="$STAGE/node_modules"
mkdir -p "$STAGE"

if [[ -f "$MODULES/$PACKAGE/package.json" ]]; then
  echo "$STAGE"
  exit 0
fi

# 独立前缀安装拿到完整闭包（插件 host 面是自包含 bundle，运行时依赖走 node_modules）。
"$NPM" install --prefix "$CACHE/prefix" \
  "$PACKAGE@$EXPECTED_VERSION" --registry https://registry.npmjs.org \
  --no-audit --no-fund --loglevel=error

rm -rf "$MODULES"
cp -R "$CACHE/prefix/node_modules" "$MODULES"

# 版本强校验：装出来的必须与引脚一致。
INSTALLED="$(node -p "require('$MODULES/$PACKAGE/package.json').version")"
[[ "$INSTALLED" == "$EXPECTED_VERSION" ]] || {
  echo "dsh-im mismatch: pin $EXPECTED_VERSION, installed $INSTALLED" >&2
  exit 1
}

# 渠道面靠运行时动态 import 拉这几家 SDK，缺了对应渠道在启动时报错——装机时
# 就把它当硬前置（不猜、不静默降级）。
for dep in qrcode undici dingtalk-stream @wecom/aibot-node-sdk; do
  [[ -d "$MODULES/$dep" ]] || { echo "dsh-im dependency $dep missing from closure" >&2; exit 1; }
done

echo "$STAGE"
