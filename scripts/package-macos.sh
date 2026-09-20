#!/bin/bash
# DeepDive — Release build + Developer ID signed .app + DMG（无证书环境回退 adhoc）.
set -euo pipefail
cd "$(dirname "$0")/.."

(cd apps/macos && xcodegen generate)
# Info.plist 由 xcodegen 生成：版本必须在生成之后读取，且读不到即停——
# 曾静默回退 0.1.0，新 clone 的 DMG 恒以 0.1.0 命名（AUD-013）。
VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" apps/macos/Info.plist 2>/dev/null) || {
  echo "FAIL: cannot read CFBundleShortVersionString from generated apps/macos/Info.plist"
  exit 1
}
xcodebuild -project apps/macos/DSHmini.xcodeproj -scheme DSHmini \
  -configuration Release -derivedDataPath .build/release \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build \
  | tail -3

APP=.build/release/Build/Products/Release/DeepDive.app
test -d "$APP" || { echo "build failed"; exit 1; }

bash scripts/embed-web.sh "$APP"
# Engine embed must precede signing: the embedded Runtime/node executable needs
# to be inside the bundle before codesign (deep) covers it.
bash scripts/embed-engine.sh "$APP"
# 签名失败必须停：曾 `|| true` 吞错，bundle 被 embed 改坏时仍照常出 DMG（AUD-013）。
# embed-engine 已在其自检前 re-seal 一次（快档：只签本体）；此处是 DMG 分发前的
# 最终 seal，走 **--distribution**（逐个 Mach-O + secure timestamp，公证硬要求）。
# 二者顺序勿倒（embed → 最终 seal → DMG）。
bash scripts/sign-app.sh "$APP" --distribution

# 公证（可选）：DSHMINI_NOTARY_PROFILE = notarytool 钥匙串 profile 名
# （一次性配置：xcrun notarytool store-credentials <名字> --apple-id … --team-id 49LSZKN27V）。
# 未设置 → 显式跳过（无凭据环境照常出包）；设置后任何一步失败必须停——
# 静默交付未公证包与 AUD-013 同型。只公证 .app（zip 提交）并装钉：票据随
# app 走，离线首启也过 Gatekeeper；DMG 由已装钉的 app 组装，不再重复提交。
if [ -n "${DSHMINI_NOTARY_PROFILE:-}" ]; then
  # 公证前置：封签必须是 Developer ID（adhoc 没有 Team ID，notarytool 直接拒收）。
  # 判定读**刚签好的包**，不比对身份字符串——身份的唯一事实源在 sign-app.sh，
  # 这里引用它的局部变量 `$IDENTITY` 会随 set -u 直接 "unbound variable" 退出
  #（2026-09-13「签名身份统一」把身份搬进 sign-app.sh 时留下的悬空引用）：
  # 后果是**但凡设了这个开关就打包失败**，于是此后发出去的 DMG 全是未公证包，
  # 新用户在 macOS 15+ 被 Gatekeeper 拦在「未打开 DeepDive」上（实况见 README 开发节）。
  # 先取文本再判，不要 `codesign … | grep -q`：grep -q 命中即退出会把 codesign 顶成
  # SIGPIPE（141），pipefail 下整条管道判负——一个"检查通过"的包会被它误杀
  # （PITFALLS §5.4 同族：管线的退出码不是你以为的那个）。
  SEAL="$(codesign -dv --verbose=2 "$APP" 2>&1 || true)"
  case "$SEAL" in
    *"Authority=Developer ID Application"*) ;;
    *) echo "FAIL: notarization needs a Developer ID signature, got ad-hoc — 检查钥匙串里的证书（sign-app.sh 会 WARN）"; exit 1 ;;
  esac
  rm -f .build/notary-upload.zip
  ditto -c -k --keepParent "$APP" .build/notary-upload.zip
  xcrun notarytool submit .build/notary-upload.zip --keychain-profile "$DSHMINI_NOTARY_PROFILE" --wait \
    || { echo "FAIL: notarytool submit（详情：xcrun notarytool log <id> --keychain-profile $DSHMINI_NOTARY_PROFILE）"; exit 1; }
  xcrun stapler staple "$APP" || { echo "FAIL: stapler staple $APP"; exit 1; }
  xcrun stapler validate "$APP" || { echo "FAIL: stapler validate $APP"; exit 1; }
  echo "OK: notarized + stapled"
else
  echo "WARN: SKIP notarization —— 此包**不能发给他人**：未公证包在 macOS 15+ 会被 Gatekeeper 拦下，"
  echo "      新用户双击只看到「未打开 DeepDive」（对话框默认按钮还是「移到废纸篓」）。"
  echo "      发给他人请用：DSHMINI_NOTARY_PROFILE=<profile> make package（见 README 开发节）"
fi

mkdir -p dist
DMG="dist/DeepDive-${VERSION}-dev.dmg"
RW=".build/dmg-rw.dmg"
BG=".build/dmg-background.tiff"
rm -f "$DMG" "$RW"

# DMG = 应用 + Applications 拖拽链接，**只有这两项**：不随包放说明文档，安装引导
# 画在窗口背景上（浅底黑字——窗口不跟随系统外观，暗底图在浅色模式里会跳）。
# design/dmg/ 是背景图的唯一事实源，见其 README。
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
ditto "$APP" "$STAGE/DeepDive.app"
ln -s /Applications "$STAGE/Applications"

# Finder 的背景图要 **HiDPI TIFF**：单张 PNG 会被按像素当点画，Retina 上糊；
# tiffutil 把 1x/2x 两张打成一个多表示 TIFF。tiffutil 系统自带，不是新依赖。
tiffutil -cathidpicheck design/dmg/background.png "design/dmg/background@2x.png" -out "$BG" >/dev/null

# 先做可写镜像 → 挂载后落背景与布局 → 再压成只读 UDZO。布局（窗口尺寸、图标
# 位置与大小、背景指向）是 Finder 的 .DS_Store，**只能由 Finder 自己写**，所以走
# 「模板优先、现场布局兜底」：
#   · design/dmg/DS_Store 存在（正常情况）→ 直接拷进去，构建完全确定、不要任何授权；
#   · 不存在（首次）→ osascript 让 Finder 现场布局，成功后把结果烘成模板（提交即可）。
# 现场布局有两条硬要求，缺一即失败：① 构建宿主拿到「访问访达」自动化授权（系统设置
# → 隐私与安全性 → 自动化）；② 镜像必须挂在 **/Volumes 下**——Finder 的 `disk` 类
# 不认挂到别处的卷（用 -mountpoint 临时目录会报 -1728「不能获得 disk」）。
if [[ -d /Volumes/DeepDive ]]; then hdiutil detach /Volumes/DeepDive -quiet 2>/dev/null || true; fi
hdiutil create -quiet -volname "DeepDive" -srcfolder "$STAGE" -ov -format UDRW -fs HFS+ "$RW"
hdiutil attach "$RW" -quiet
MP=/Volumes/DeepDive
[[ -d "$MP" ]] || { echo "FAIL: 镜像没挂到 $MP"; exit 1; }
mkdir -p "$MP/.background"
cp -f "$BG" "$MP/.background/background.tiff"
# 卷图标：挂载后显示成应用图标（SetFile -a C 打「有自定义图标」位；工具缺失则跳过）
if cp -f "$APP/Contents/Resources/AppIcon.icns" "$MP/.VolumeIcon.icns" 2>/dev/null && command -v SetFile >/dev/null; then
  SetFile -a C "$MP" || true
fi

LAYOUT_ERR=""
if [[ -f design/dmg/DS_Store ]]; then
  cp -f design/dmg/DS_Store "$MP/.DS_Store"
else
  # 成功时 osascript 不输出任何东西，所以"输出为空"即成功
  LAYOUT_ERR="$(osascript <<'APPLESCRIPT' 2>&1
tell application "Finder"
  tell disk "DeepDive"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    -- 窗口 = 背景图 660×420 的内容区 + 标题栏 28
    set the bounds of container window to {280, 200, 940, 648}
    set opts to the icon view options of container window
    set arrangement of opts to not arranged
    set icon size of opts to 128
    set text size of opts to 12
    set background picture of opts to file ".background:background.tiff"
    set position of item "DeepDive.app" of container window to {170, 210}
    set position of item "Applications" of container window to {490, 210}
    update without registering applications
    delay 1
    close
  end tell
end tell
APPLESCRIPT
)" || true
  if [[ -z "$LAYOUT_ERR" ]]; then
    # 现场布局成功 → 烘成模板：此后（含别人机器）无需「访问访达」授权即可复现同一布局
    cp -f "$MP/.DS_Store" design/dmg/DS_Store 2>/dev/null && \
      echo "note: 已把本次布局烘成 design/dmg/DS_Store（提交它，后续构建不再需要访达授权）"
  fi
fi
sync
hdiutil detach "$MP" -quiet

if [[ -n "$LAYOUT_ERR" ]]; then
  echo "WARN: 窗口布局没落上——此包**没有拖拽引导**，别就这么发出去。"
  echo "      Finder 报：$LAYOUT_ERR"
  echo "      两条硬要求：① 系统设置 → 隐私与安全性 → 自动化，给构建宿主打开「访达」；"
  echo "                  ② 镜像须挂在 /Volumes 下（脚本已这么做，别改成 -mountpoint 临时目录）。"
fi

hdiutil convert "$RW" -format UDZO -imagekey zlib-level=9 -o "$DMG" -quiet
rm -f "$RW" "$BG"
echo "OK: $DMG"
