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
rm -f "$DMG"
# DMG 内容 = 应用 + Applications 拖拽链接 + 使用说明（scripts/dmg-guide.txt），
# 说明文案引用的菜单项/热键/路径须与 README 和壳侧实现保持一致。
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
ditto "$APP" "$STAGE/DeepDive.app"
ln -s /Applications "$STAGE/Applications"
cp scripts/dmg-guide.txt "$STAGE/使用说明.txt"
hdiutil create -quiet -volname "DeepDive" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
echo "OK: $DMG"
