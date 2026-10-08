# design/logo — DeepDive Logo 生成器与产物（唯一事实源）

## 是什么

DeepDive 的正式 logo（用户 2026-10-08 定稿）：**白底 + 实心 D + 右侧横向渐变模糊**。纯几何、原创，不派生任何第三方图形。

| 文件 | 作用 |
|---|---|
| `index.html` | **唯一事实源**：几何/模糊配方 + 设计稿板 + 导出（自包含，双击即开，无需服务器） |
| `exports/` | 产物：主 Logo 阶梯（1024…16）、AppIcon 母版与小尺寸剪影版、壳侧剪影路径 |
| `exports/deepdive-mark-path.txt` | 壳侧 `BrandMark.markPath` 的**逐字来源**（`?path=1` 输出，正方形 viewBox）——改配方后重取并粘回 Swift |

## 配方

画布 1024（viewBox），白 `#FFFFFF` 铺底，D 取 `#0b0b0c`（与品牌黑同值）。改 `index.html` 顶部常量即改全部产物。

**实心 D 轮廓**：左侧圆角矩形柄 + 右侧半圆（半径 = 高/2），无字腔；高 = 72% 画布（737.28px），宽/高 = 0.977（柄 0.477 + 半圆 0.5 → 宽 720.32px），左侧两角圆角 = 高 10%（73.73px）。1024 画布里落位：左缘 x 121.43、上缘 y 143.36、实心右缘 x 841.75。

**右侧渐变模糊**：σ 沿 x 从 0（0.42W 处）线性涨到 0.055H（实心右缘），1.05W 处到 σmax = 0.0602H，其外恒定。

**渲染工艺**（三条都不是可选项，换掉就出伪影）：

1. **逐像素求连续 σ 场**：墨量 = `Φ(−sd(x,y)/σ(x))`，`sd` 是到 D 的符号距离（六段边界取最近：左竖边、平顶、平底、左上/左下圆角弧、右大弧）。**不要**用 SVG 滤镜叠层近似——分级 σ 在级间会沿轮廓鼓起可见接缝。
2. **8-bit 量化前加 ±0.5 级 8×8 拜耳抖动**（固定矩阵，无随机种子）。平缓渐变的等墨度线会被整数码阶摞成一层层可见色带（提亮视图里像同心弧），抖动把它打散。
3. σ=0 的实心区用线性覆盖度做 1px 抗锯齿（否则圆角弧出锯齿）；圆弧距离必须按**弧段**算，整圆会让圆的另一半穿进实心内部刻出虚线圈。

## 图标

| 产物 | 配方 |
|---|---|
| `deepdive-logo-{1024…128}.png` | **AppIcon ≥128 档直接用主 Logo**：满幅白底 + D |
| `deepdive-icon-small-{64,32,16}.png` | 16/32 槽位：同样满幅，改用**清晰剪影**（按墨迹居中，D 高 66%）——小尺寸上渐变会糊成一块 |

图标一律是**满幅图**：不切圆角、不留透明边、不烘投影。macOS 26 自己套壳切形；应用自切圆角或留透明边会被系统在背后垫一层底板，在 Dock/Finder 里读成「灰一圈 + 里面白砖」（白底方案尤其明显）。

落地：`apps/macos/Assets.xcassets/AppIcon.appiconset/` 十档（≥128 取主 Logo 对应档，16/32 取 small 档）；DMG 卷图标由 `scripts/package-macos.sh` 复制 `AppIcon.icns`，随资产自动跟随。

## 落点（改 logo 时四处一起改）

| 表面 | 落点 |
|---|---|
| AppIcon（Dock/⌘⇥/访达/DMG 卷） | `apps/macos/Assets.xcassets/AppIcon.appiconset/` 十档 |
| 菜单栏状态图 | `FloatingBubble.swift` → `BrandMark.statusIcon`（模板图：剪影 + 状态点） |
| 悬浮球中央图形 | `FloatingBubble.swift` → `BrandMark.image`（同一剪影，白色填充） |
| 新手引导卡 | `frontend/src/assets/deepdive-logo-256.png`（= `exports/deepdive-logo-256.png`，CSS 切 22.37% squircle） |

## 重渲染

浏览器打开 `index.html`：`⬇ 导出全部 PNG`。定尺寸产物用无头 Chrome 直出（单标模式：整页只有该产物，截图尺寸即产物尺寸）：

```sh
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1024,1024 --default-background-color=00000000 \
  --screenshot=exports/deepdive-logo-1024.png "file://$PWD/index.html?logo=1024"

"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=64,64 --default-background-color=00000000 \
  --screenshot=exports/deepdive-icon-small-64.png "file://$PWD/index.html?small=64"

"$CHROME" --headless --disable-gpu --dump-dom "file://$PWD/index.html?path=1"   # 壳侧剪影路径
```

参数：`?logo=<边长>` 主 Logo（也是 AppIcon ≥128 档的来源）；`?small=<边长>` 小尺寸剪影图标（16/32 槽位）；`?path=1` 壳侧剪影路径。AppIcon 十档写入 `Assets.xcassets` 后由 `make package` 编译。

## 尺寸可读性（实测）

32px 起清晰剪影仍能读作实心 D；16px 收敛为圆角块（形状本身在极小尺寸下的极限，非渲染问题）。带渐变的版本只用于 ≥64 的使用场景；菜单栏与小图标一律走清晰剪影。
