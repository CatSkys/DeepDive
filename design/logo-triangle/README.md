# design/logo-triangle — 倒三角 Logo 候选集 v1（2026-10-08）

## 是什么

白底 **黑倒三角** 方向的 logo 候选：纯几何、确定性渲染（无随机种子）。与 `../logo/`（已定稿的黑底反白鲸鱼）并列的**提案集，尚未定稿**；用户选定后再收口进 `docs/BRANDING.md`。

与鲸鱼方向的关键差别：**不派生官方 DeepSeek 图形**（倒三角是通用几何），因此不带 `docs/BRANDING.md` §4 那条「logo 派生自官方 favicon，正式分发前需评估商标」的出处负担。

| 文件 | 作用 |
|---|---|
| `index.html` | **唯一事实源**：几何配方 + 设计稿板 + 导出按钮（自包含，双击即开，无需服务器） |
| `exports/` | 全部产物：5 个变体各一份 1024 PNG + SVG，基准变体另有 512…16 尺寸阶梯 PNG |

## 配方

画布 1024（viewBox），白 `#FFFFFF` 铺底，三角黑 `#0b0b0c`（与品牌黑同值）。改 `index.html` 顶部配方常量即改全部产物。

| 变体 | 几何 | 长边 | 高 |
|---|---|---|---|
| `equilateral` 基准 | 等边倒三角 | 737.28px（72% 画布） | 638.51px |
| `wide` 扁平 | 等腰 80% × 58%，顶点角 71.6° | 819.2px | 593.92px |
| `rounded` 圆角 | 等边 + 6% 长边圆角（r 44.24px） | 737.28px | 638.51px |
| `rings` 同心 | 内挖白三角（按内切圆心缩至 52%，环宽均匀 102.16px） | 737.28px | 638.51px |
| `squircle` 容器 | 22.37% 圆角白容器（与壳侧 AppIcon 同值），透明画布 | 737.28px | 638.51px |

**光学居中**：倒三角重心偏上，包围盒居中（y 50.0%）读起来偏高，故整体下移 1.5%（y 51.5%）；设计稿板第二行是二者并排对照。基准变体 1024 画布的落位：上缘 y 208.11、下顶点 y 846.61。

## 产物（exports/）

`deepdive-triangle-<变体>-1024.png` 与 `.svg`（5 变体各一份），
`deepdive-triangle-equilateral-{512,256,128,64,32,16}.png`（基准变体尺寸阶梯）。

`squircle` 的 PNG 是透明画布（圆角外无像素），其余四个为满幅白底。

## 重渲染

浏览器打开 `index.html`：`⬇ 导出全部 PNG` / `⬇ 导出全部 SVG`（Chrome 会问一次是否允许多文件下载）。定尺寸产物不必点击，无头 Chrome 直接截图：

```sh
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1024,1024 --default-background-color=00000000 \
  --screenshot=exports/deepdive-triangle-equilateral-1024.png \
  "file://$PWD/index.html?mark=equilateral&size=1024"
```

`?mark=<变体>[&size=<边长>]` 是单标模式：整页只有该标记，截图尺寸即产物尺寸。SVG 版用 `--dump-dom` 取 `<svg>…</svg>` 再加一行 XML 声明。

## 待用户定

- 变体选型（5 选 1，或再调比例 / 圆角 / 环宽）
- 是否替换已定稿的鲸鱼方向——替换则牵动 AppIcon、DMG 背景、菜单栏状态点等落地面
