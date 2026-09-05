# DeepDive Logo 设计稿 v3

> **品牌名：DeepDive（中文配对「深潜」；前身工程代号 DSHmini，工程改名收口见 `docs/BRANDING.md` §5）。** 本稿为黑底反白鲸鱼 logo 的唯一事实源。
> **状态：已定稿（2026-09-05，用户指定黑底反白方向）。** 改动前先备份 exports/。

**官方 DeepSeek 鲸鱼实心剪影 · 白鲸 `#FFFFFF` · 黑底 `#0b0b0c`。** 纯矢量确定性渲染，无随机种子、无字符纹理。

v1（实心黑鲸 + 玻璃深底）与 v2（ASCII 字符鲸，黑墨透明底）按用户方向变更废弃；v2 的鲸鱼 fit 参数（最长边 72%、光学中心 y 48.5%）沿用为 v3 配方。

## 文件

- `index.html` — 设计稿 + 生成器（自包含，可直接双击打开，无需服务器）
- `exports/` — 全部渲染产物

| 文件 | 说明 |
| --- | --- |
| `deepdive-logo-white-on-black-{1024…32}.png` | 主资产：黑底方版 PNG，白色实心鲸鱼，6 档尺寸 |
| `deepdive-icon-black-1024-squircle.png` | 图标容器：22.37% 圆角黑 squircle + 白鲸（透明画布，无投影） |

`index.html` 页面上有「导出全部 PNG」；主 Logo 区展示黑底方版，图标区展示 squircle 容器，尺寸阶梯为同配方重渲染。

## 生成配方

1. **鲸鱼 path**：官方 favicon.svg（50×50 viewBox，vendored 副本 `deepseek-harness/apps/web/public/favicon.svg`），与壳侧 `FloatingBubble.WhaleAsset` 同源
2. **fit**：鲸鱼包围盒（256px 位图扫 alpha 量测）最长边 = 画布 72%，光学中心 y = 48.5%（水平居中）
3. **主资产**：全幅 `#0b0b0c` 方底 + `#FFFFFF` 实心鲸
4. **图标容器**：22.37% 圆角黑 squircle + 白鲸；AppIcon 由壳侧按 Apple 官方网格切档（见下）

## AppIcon 落地

`apps/macos/Assets.xcassets/AppIcon.appiconset/` 全部 10 档 = 同一黑底反白设计：

- 128×128 及以上 6 档：Apple 官方网格母版（1024 画布 / 824 艺术区 / 185.4 圆角 / 黑 30% 模糊 45px 下移 15px 烘焙投影）缩档
- 16/32 槽位（16/32/64px）：全幅 squircle 直渲、无投影（小尺寸不吃网格，鲸鱼保持 72% 占比）
- 生成：NSImage 原生 SVG 渲染的一次性脚本（未入库，改配色/比例时重写成本极低）；`project.yml` 挂 Assets.xcassets + `ASSETCATALOG_COMPILER_APPICON_NAME`，`LSUIElement` false（进 Dock + ⌘⇥）
- 小尺寸可读性：实心剪影 16px 仍可辨（ASCII 字符版 128px 起失认）
