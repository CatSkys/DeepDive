# design/dmg — 安装盘（DMG）窗口背景与布局

## 是什么

DMG 打开后那个窗口的样子：背景图（这张）＋ Finder 的图标布局。DMG 内容只有
**DeepDive.app** 与 **Applications 链接**两项，安装引导全部画在背景图上——不随包放
说明文档（给使用者的安装步骤在 `README` 的「安装」节）。

| 文件 | 作用 |
|---|---|
| `background.html` | 背景图**唯一事实源**：660×420 画布，标题/副标题/箭头/脚注 |
| `background.png` / `background@2x.png` | 1x / 2x 渲染产物（打包时 `tiffutil` 合成 HiDPI TIFF，Finder 认这个格式） |
| `DS_Store` | Finder 布局模板：窗口尺寸、图标位置与大小、背景指向。**打包时优先拷它**，所以常规构建不需要任何 Finder 自动化授权 |

## 改背景图

```sh
# 改 background.html 里的文案/配色/箭头后重新渲染（需要能跑 Chromium 的本机工具链；
# 只是出图用，不进构建链——构建只拷现成的 PNG）
node /tmp/render-dmg-bg.mjs        # 见 git 历史；核心就是 playwright 截图 660@1x 与 660@2x
```

画布尺寸、图标坐标与 `scripts/package-macos.sh` 里的窗口 bounds／AppleScript
position 是**四处联动**的（HTML 顶部注释写了对应关系）：图变而布局没变，箭头就会
指着空白处。改完必须挂载新 DMG 目检（`hdiutil attach` → 截图 → `hdiutil detach`）。

两条实机校准结论（2026-09-20，改图前先读，省一轮返工）：

- **Finder 对图标纵坐标有下界**：AppleScript 里设 `{170, 210}`，实测落回 `{170, 255}`
  —— 所以在图上把箭头画在 **y=255**（图标行中线），而不是 position 里那个数。
  想知道某次布局的真实落点，直接读回来：
  `osascript -e 'tell application "Finder" to tell disk "DeepDive" to get position of item "DeepDive.app" of container window'`
- **窗口底部有一条系统画的栏**（约 24pt，显示卷名），会盖住背景图底部：脚注之类的
  内容要留在**距画布底 ≥ 48pt** 的安全区里（脚本里 `statusbar visible` 已设 false，
  但那条栏仍在，别指望它消失）。

## 布局模板（DS_Store）怎么来

首次（模板不存在时）打包脚本让 Finder 现场布局一次，成功后自动把结果烘成
`design/dmg/DS_Store` 并提示提交；此后所有构建（含别人的机器）直接拷模板，
**不再需要「访问访达」自动化授权**。

现场那一次需要授权：系统设置 → 隐私与安全性 → 自动化，给构建宿主打开「访达」。
没有授权时脚本会大声告警（`-1743`）并照常出包——**那种包没有拖拽引导，别发出去**。
