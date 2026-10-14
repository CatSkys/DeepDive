#!/bin/bash
# DeepDive — Sparkle 官方命令行工具的引脚化入口。
#
# 只管一件事：把 Sparkle 发布的工具包按引脚版本取到本地、验 sha256，然后把命令转交给它。
#   sparkle-tools.sh generate_keys [参数…]      一次性：生成 EdDSA 密钥对（私钥进钥匙串）
#   sparkle-tools.sh sign_update <文件> [参数…] 发布链：给 DMG 生成 appcast 要的 EdDSA 签名
#   （注意：sign_update 带 -p 只打印裸签名串；要贴进 appcast 的那对
#    `sparkle:edSignature="…" length="…"` 属性是不带 -p 时的输出。）
#
# 传给它的**文件路径按仓库根解释**（本脚本会 cd 到仓库根去找 project.yml 与 dist/），
# 从别处调用时要么先 cd 到仓库根、要么给绝对路径。
#
# 版本从 apps/macos/project.yml 的 Sparkle exactVersion 读（唯一事实源）：**签名工具必须
# 与随包分发的框架同版本**，否则 appcast 的签名/长度属性不保证被那个框架接受。换版本时
# 下表没有对应 sha256 就直接停——这是故意的，逼着换版本的人把新摘要记进来。
set -euo pipefail
cd "$(dirname "$0")/.."

SPARKLE_CONFIG=apps/macos/project.yml
VERSION=$(awk '/exactVersion:/ {print $2; exit}' "$SPARKLE_CONFIG")
[ -n "$VERSION" ] || { echo "FAIL: 从 $SPARKLE_CONFIG 读不到 Sparkle 的 exactVersion" >&2; exit 1; }

case "$VERSION" in
  2.10.0) SHA256=c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c ;;
  *)
    echo "FAIL: 没有为 Sparkle $VERSION 记录官方工具包的 sha256。" >&2
    echo "      先下载 https://github.com/sparkle-project/Sparkle/releases/download/$VERSION/Sparkle-$VERSION.tar.xz" >&2
    echo "      shasum -a 256 校验后，把摘要加进 $0 的 case 里。" >&2
    exit 1
    ;;
esac

CMD="${1:-}"
shift || true
case "$CMD" in
  generate_keys|sign_update) ;;
  *) echo "用法: sparkle-tools.sh <generate_keys|sign_update> [参数…]" >&2; exit 1 ;;
esac

CACHE="dist/.sparkle-tools/$VERSION"
BIN="$CACHE/bin"
if [[ ! -x "$BIN/sign_update" ]]; then
  mkdir -p "$CACHE"
  TARBALL="$CACHE/Sparkle-$VERSION.tar.xz"
  [[ -f "$TARBALL" ]] || curl -fsSL -o "$TARBALL" \
    "https://github.com/sparkle-project/Sparkle/releases/download/$VERSION/Sparkle-$VERSION.tar.xz"
  echo "$SHA256  $TARBALL" | shasum -a 256 -c - >/dev/null \
    || { echo "FAIL: Sparkle $VERSION 工具包 sha256 对不上（下载被篡改或上游换了资产）" >&2; exit 1; }
  tar -xf "$TARBALL" -C "$CACHE"
fi

exec "$BIN/$CMD" "$@"
