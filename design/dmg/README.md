# design/dmg — 安装盘（DMG）窗口背景与布局

## 是什么

DMG 打开后那个窗口的样子：背景图（这张）＋ Finder 的图标布局。DMG 内容只有
**DeepDive.app** 与 **Applications 链接**两项，安装引导全部画在背景图上——不随包放
说明文档（给使用者的安装步骤在 `README` 的「安装」节）。

| 文件 | 作用 |
|---|---|
| `background.html` | 背景图**唯一事实源**：660×420 画布，标题/副标题/箭头/脚注。浅底黑字——DMG 窗口不跟随系统外观，暗底图在浅色模式里会跳 |
| `background.png` / `background@2x.png` | 1x / 2x 渲染产物（打包时 `tiffutil` 合成 HiDPI TIFF，Finder 认这个格式） |
| `DS_Store` | **仅兜底**：图标位置/窗口几何（卷无关）。只在构建宿主没有「访问访达」授权时拷进镜像——**背景图它带不过去**，见下 |

## 布局与背景由谁写

`scripts/package-macos.sh` 每轮在**最终镜像**上让 Finder 现场落一次布局（窗口尺寸、
图标位置与大小、背景指向）。两条硬要求：构建宿主被授权控制「访达」；镜像挂在
`/Volumes` 下（`-mountpoint` 挂临时目录时 Finder 的 `disk` 类找不到卷，报 -1728）。

**背景图不能靠拷 .DS_Store 跨卷复用**（2026-09-20 实机踩到，用户报"第一次打开有背景、
第二次没有"）：Finder 把"背景图片"存成指向**该卷身份**的别名，从别的卷（哪怕是同一
份素材烘出来的另一个镜像）拷来的别名解析不到，静默退回白底。图标位置与窗口几何是
卷无关的，所以 `DS_Store` 只在没有授权时兜底（此时脚本会大声告警：包没有引导背景）。

## 改背景图

```sh
node /tmp/render-dmg-bg.mjs   # git 历史里的这个脚本；核心就是 playwright 截 660@1x 与 660@2x
```

画布尺寸、图标坐标与 `scripts/package-macos.sh` 里的窗口 bounds／AppleScript
position 是**四处联动**的（HTML 顶部注释写了对应关系）：图变而布局没变，箭头就会
指着空白处。改完必须挂载**新打出来的 DMG**（不是中间镜像）目检：`open <dmg>` →
截图 → 卸载 → 再挂一次看背景是否还在。

两条实机校准结论（改图前先读，省一轮返工）：

- **Finder 对图标纵坐标有下界**：AppleScript 里设 `{170, 210}`，实测落回 `{170, 255}`
  —— 所以在图上把箭头画在 **y=255**（图标行中线），而不是 position 里那个数。
  想知道某次布局的真实落点，直接读回来：
  `osascript -e 'tell application "Finder" to tell disk "DeepDive" to get position of item "DeepDive.app" of container window'`
- **窗口底部有一条系统画的栏**（约 24pt，显示卷名），会盖住背景图底部：脚注之类的
  内容要留在**距画布底 ≥ 48pt** 的安全区里（脚本里 `statusbar visible` 已设 false，
  但那条栏仍在，别指望它消失）。
