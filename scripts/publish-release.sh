#!/bin/bash
# DeepDive — 把 dist 里那份公证过的 DMG 发布成一次应用更新。
#
# 三件事必须一起做（缺一件就会把用户挂在坏状态上）：
#   ① 核验待发布的包：Developer ID 签名 + 已装订公证票据 + 两个版本键都等于版本号
#      —— 发出去的更新是**装到别人机器上**的，坏包没有第二次机会；
#   ② 用 Sparkle 的 EdDSA 私钥签 DMG，写出 appcast.xml（装好的应用认的是这个签名）；
#   ③ 传到公开发布仓：装好的 DeepDive 读的就是那里的 appcast（Info.plist 的 SUFeedURL）。
#
# 用法：DSHMINI_NOTARY_PROFILE=DSHMINI_NOTARY make package && make publish
# 前置：gh 已登录（有 repo 权限）；EdDSA 私钥已在钥匙串（scripts/sparkle-tools.sh
#       generate_keys --account com.deepdive.app，一次性，见 README 开发节）。
set -euo pipefail
cd "$(dirname "$0")/.."

# 更新的落点：一个只放 Release 的公开仓。源码仓是私有的——装好的用户读不到它的
# Release（GitHub 要鉴权），所以 feed 必须落在这里。
RELEASES_REPO="${DSHMINI_RELEASES_REPO:-CatSkys/DeepDive-releases}"
# 与 apps/macos/project.yml 的 SUPublicEDKey 配对的私钥所在账户。
SPARKLE_KEY_ACCOUNT="${DSHMINI_SPARKLE_ACCOUNT:-com.deepdive.app}"

VERSION=$(awk -F'"' '/CFBundleShortVersionString/ {print $2; exit}' apps/macos/project.yml)
[ -n "$VERSION" ] || { echo "FAIL: 读不到 apps/macos/project.yml 里的 CFBundleShortVersionString" >&2; exit 1; }

# package-macos.sh 的产物名带 -dev（那是"本地构建"的标记）；上传的资产名不带，
# 用户看到的文件名就是它的版本号。
DMG="dist/DeepDive-${VERSION}-dev.dmg"
APP=.build/release/Build/Products/Release/DeepDive.app
ASSET="DeepDive-${VERSION}.dmg"
TAG="v${VERSION}"

[ -f "$DMG" ] || { echo "FAIL: 找不到 $DMG —— 先跑 DSHMINI_NOTARY_PROFILE=DSHMINI_NOTARY make package" >&2; exit 1; }
[ -d "$APP" ] || { echo "FAIL: 找不到 $APP —— 先跑 make package" >&2; exit 1; }

# ── ① 核验待发布的包 ──
# 公证：票据没装订的话，用户首次联网前过不了 Gatekeeper（README 开发节记了这条）。
xcrun stapler validate "$APP" >/dev/null 2>&1 \
  || { echo "FAIL: $APP 没有装订公证票据 —— 这个包发出去用户双击打不开。" >&2
       echo "      用 DSHMINI_NOTARY_PROFILE=DSHMINI_NOTARY make package 重出一份。" >&2; exit 1; }
SEAL="$(codesign -dv --verbose=2 "$APP" 2>&1 || true)"
case "$SEAL" in
  *"Authority=Developer ID Application"*) ;;
  *) echo "FAIL: $APP 不是 Developer ID 签的（adhoc 无稳定身份，更新会掉 TCC 授权）" >&2; exit 1 ;;
esac
# Sparkle 拿 appcast 的 sparkle:version 与包的 CFBundleVersion 比大小 —— 两者必须同源
# （本仓的规则是两个版本键一起改，见 scripts/bump-app-version.sh），这里把它钉死。
for key in CFBundleShortVersionString CFBundleVersion; do
  built=$(/usr/libexec/PlistBuddy -c "Print :$key" "$APP/Contents/Info.plist")
  [ "$built" = "$VERSION" ] \
    || { echo "FAIL: 包里的 $key 是 $built，不是 $VERSION —— 更新会比较不到新版本。" >&2; exit 1; }
done

# 同一个版本号只能发一次：再发一次会把已经装上的用户晾在"同版本"上，
# 而 Sparkle 认为那不算更新。
if gh release view "$TAG" --repo "$RELEASES_REPO" >/dev/null 2>&1; then
  echo "FAIL: $RELEASES_REPO 已经有 $TAG 了。" >&2
  echo "      package-macos.sh 只在带公证档时才递增版本号——确认上一版是否已发布过。" >&2
  exit 1
fi

# ── ② 签 DMG + 写 appcast ──
# sign_update **不带 -p**：不带时它打印的正是能直接贴进 XML 的那对属性
# （`sparkle:edSignature="…" length="…"`），带 -p 只打印裸签名串——拼进 appcast
# 就不是良构 XML 了（2026-10-14 实测踩到，下面那道 xmllint 门就是拦这个的）。
SIGNATURE=$(bash scripts/sparkle-tools.sh sign_update --account "$SPARKLE_KEY_ACCOUNT" "$DMG") \
  || { echo "FAIL: sign_update 失败 —— 钥匙串里没有账户 $SPARKLE_KEY_ACCOUNT 的私钥？" >&2
       echo "      一次性生成：bash scripts/sparkle-tools.sh generate_keys --account $SPARKLE_KEY_ACCOUNT" >&2; exit 1; }

cp -f "$DMG" "dist/$ASSET"

# ── 发布说明（Markdown）──
# 取数：本版自上一个发布 tag 以来的提交主题（`--no-merges`——本仓一个任务一个合并提交，
# 300 条里 51 条是它，不进说明）。tag 打在本仓（app-v<版本>），发布成功后创建；
# 下一版就靠它算「自上一版以来」。
PREV_TAG=$(git describe --tags --abbrev=0 --match 'app-v*' 2>/dev/null || true)
NOTES=dist/release-notes.md
{
  echo "## 本版变更"
  echo
  if [ -n "$PREV_TAG" ]; then
    echo "自 $PREV_TAG 以来："
    echo
    git log --no-merges --pretty='- %s' "$PREV_TAG..HEAD" -- .
  else
    echo "首个发布版。"
  fi
} > "$NOTES"
echo "== 发布说明（上次基准：${PREV_TAG:-无}）=="
cat "$NOTES"

APPCAST=dist/appcast.xml
cat > "$APPCAST" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>DeepDive</title>
    <item>
      <title>$VERSION</title>
      <pubDate>$(LC_ALL=C date -u '+%a, %d %b %Y %H:%M:%S +0000')</pubDate>
      <sparkle:version>$VERSION</sparkle:version>
      <sparkle:shortVersionString>$VERSION</sparkle:shortVersionString>
      <link>https://github.com/$RELEASES_REPO/releases/tag/$TAG</link>
      <sparkle:releaseNotesLink>https://github.com/$RELEASES_REPO/releases/download/$TAG/release-notes.md</sparkle:releaseNotesLink>
      <enclosure url="https://github.com/$RELEASES_REPO/releases/download/$TAG/$ASSET" type="application/octet-stream" $SIGNATURE/>
    </item>
  </channel>
</rss>
EOF
echo "== appcast =="
cat "$APPCAST"

# 上传前必须是一份良构 XML：feed 是**所有已装用户**的更新入口，发一份坏的出去，
# 他们从此收不到任何更新（而本地看不出问题）。xmllint 随 macOS 自带，不引新依赖。
xmllint --noout "$APPCAST" \
  || { echo "FAIL: $APPCAST 不是良构 XML —— 别发（上面那对签名属性的拼法见 sign_update 那一段）" >&2; exit 1; }
# 签名与长度必须真的进了 enclosure：少了它们，Sparkle 会拒收这个更新。
grep -q 'sparkle:edSignature="' "$APPCAST" && grep -q "length=\"$(wc -c < "$DMG" | tr -d ' ')\"" "$APPCAST" \
  || { echo "FAIL: appcast 的 enclosure 缺 edSignature 或 length 与 DMG 字节数对不上" >&2; exit 1; }
# 说明链接必须在：应用的「有更新」那张卡正文就是从它指的资产拉回来的；漏了不会报错，
# 只是卡片永远少一段正文（症状很轻、原因很远）。
grep -q "<sparkle:releaseNotesLink>https://github.com/$RELEASES_REPO/releases/download/$TAG/release-notes.md</sparkle:releaseNotesLink>" "$APPCAST" \
  || { echo "FAIL: appcast 缺 releaseNotesLink（或它指的不是本版那份说明）" >&2; exit 1; }

# ── ③ 发布 ──
# 正文 = 说明 + 装机要求。同一份说明既进 GitHub Release 正文（人看），也作为资产上传
# （应用看）——一处产出，两个消费者，不各写一份。
BODY=dist/release-body.md
{
  cat "$NOTES"
  echo
  echo "macOS 26 及以上，Apple 芯片（arm64）。"
  echo
  echo "装好的 DeepDive 会自己更新（每小时后台查一次，下载完在退出时装上）；也可以从"
  echo "标题栏那颗更新钮、菜单里的「检查更新…」或「设置 → 关于」手动装。"
} > "$BODY"

# appcast、说明与 DMG 同一个 Release：enclosure 与 releaseNotesLink 都指向 versioned 资产，
# feed 走 releases/latest/download/appcast.xml 这条永久链接（每次发布自动换到最新那份）。
gh release create "$TAG" --repo "$RELEASES_REPO" \
  "dist/$ASSET" "$APPCAST" "$NOTES" \
  --title "$TAG" \
  --notes-file "$BODY"

# 永久链接必须真的能拉到这一份：它是 Info.plist 里 SUFeedURL 的落点，
# 拉不到等于所有已装用户从此收不到更新。
FEED_URL="https://github.com/$RELEASES_REPO/releases/latest/download/appcast.xml"
echo "== 核对永久 feed 链接：$FEED_URL =="
for attempt in 1 2 3 4 5; do
  if curl -fsSL "$FEED_URL" 2>/dev/null | grep -q "<sparkle:version>$VERSION</sparkle:version>"; then
    echo "OK: $TAG 已发布，feed 指向 $VERSION"
    # 说明的资产也要真的能匿名拉到：应用就是去那儿取正文的。
    NOTES_URL="https://github.com/$RELEASES_REPO/releases/download/$TAG/release-notes.md"
    if curl -fsSL "$NOTES_URL" 2>/dev/null | grep -q "本版变更"; then
      echo "OK: 发布说明可读（$NOTES_URL）"
    else
      echo "WARN: $NOTES_URL 拉不到或内容不对——应用的更新卡会少一段正文。" >&2
    fi
    # 打基准 tag（下一版算「自上一版以来」靠它）。发布已经成功了，所以这一步失败
    # 只告警不判负——但要说清后果：不打 tag，下一版的说明会把这一版又列一遍。
    if git tag "app-v$VERSION" && git push origin "app-v$VERSION"; then
      echo "OK: 基准 tag app-v$VERSION 已打并推送"
    else
      echo "WARN: app-v$VERSION 没打上/没推上去——手动补：" >&2
      echo "      git tag app-v$VERSION && git push origin app-v$VERSION" >&2
      echo "      不补的话，下一版的发布说明会把这一版以来的提交再列一遍。" >&2
    fi
    exit 0
  fi
  sleep 3
done
echo "FAIL: 发布了 $TAG，但 $FEED_URL 还读不到 $VERSION（GitHub 缓存？手查一次再决定要不要重发）" >&2
exit 1
