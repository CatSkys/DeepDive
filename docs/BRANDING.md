# DeepDive（深潜）品牌定稿（2026-09-02）

> 状态：**品牌名已定（DeepDive · 深潜）**；logo 定稿（白底实心 D + 右侧渐变模糊，2026-10-08）。
> 工程改名已于 2026-09-02 执行（见 §5 清单，全部落地；内部代号 scheme/源码目录按 §5 保留 DSHmini 减少 diff）。仓库：CatSkys/DSH-deck。

## 1. 品牌名

| 项 | 值 |
| --- | --- |
| 英文主名 | **DeepDive** |
| 中文配对 | **深潜** |
| 一句话定位 | DeepDive — 让 DeepSeek 深潜到你的问题里。（桌面深潜舱，监督 dsh 引擎在沙箱工作区作业） |
| 气质 | 硬核工具感；与 DeepSeek 强关联但不冒充官方产品 |

命名语义：Deep(Seek) + Dive——与官方"深度求索"以及 UI 继承的官方 *Deep diving…* 状态文案同构。
（备选：DeepDeck / DeepCore / DeepSeek Dock，见下轮如需再评估。）

## 2. Logo 定稿：白底实心 D + 右侧渐变模糊

- 资产位置：`design/logo/`（生成器 `index.html` 自包含，确定性逐像素渲染，可复现导出；配方、图标工艺与产物清单见该目录 README）
- 形态：**白 `#FFFFFF` 底上实心 D `#0b0b0c`**——左侧圆角矩形柄 + 右侧半圆，无字腔，D 高占画布 72%，左缘两角圆角 = 高 10%
- 右侧渐变模糊：σ 沿 x 从 0（0.42W）线性涨到 0.055H（实心右缘）
- 图标：**Icon Composer 文档** `apps/macos/AppIcon.icon/`（白底放 `fill`、标记为独立图层）——macOS 26 只认带 IconGroup 条目的图标，老式 appiconset/icns 会被系统垫底板
- 出处：**纯几何原创**，不派生任何第三方图形

## 3. 资产清单与落地状态（2026-09-05 复核）

| 资产/场景 | 状态 |
| --- | --- |
| 主 PNG（白底方版，1024…16） | ✅ `design/logo/exports/`（`deepdive-logo-*`） |
| AppIcon | ✅ `apps/macos/Assets.xcassets/AppIcon.appiconset/` 全部 10 档（Icon Composer `.icon` 编译；配方与标定值见 `design/logo/README`）；`project.yml` 已挂 + `LSUIElement` false（进 Dock + ⌘⇥） |
| 悬浮球中央图形 | ✅ `FloatingBubble.swift` `BrandMark.image`（剪影 path，白色填充于黑圆上） |
| 菜单栏状态点 | ✅ `BrandMark.statusIcon`：剪影模板图 + 状态环/点（模板图随明暗外观自动重着色） |
| 新手引导卡左栏 | ✅ `frontend/src/assets/deepdive-logo-256.png`（CSS 切 22.37% squircle） |
| 欢迎页 hero logo | ❌ **已决策移除**（38eb6e3）：hero 仅保留「做点什么？」标题；logo 只出现在 AppIcon/引导卡/分发物料 |
| <128px 简化小标 | ✅ 见 `design/logo/README`：16/32 走清晰剪影（渐变在小尺寸会糊成一块） |

## 4. 使用与分发纪律

- 视觉纪律沿用 UI-SPEC：**黑白单色**；白底方版置于浅色场景时按图标砖形态（22.37% 圆角）呈现
- **出处/许可**：本 logo 为纯几何原创，不派生第三方图形；正式对外分发前按常规做一次商标检索（自我保护），与 THIRD_PARTY_NOTICES（版权声明）分属两事

## 5. 工程改名收口清单（✅ 已执行，2026-09-02）

| 层 | 现值 | 目标 | 备注 |
| --- | --- | --- | --- |
| 显示名 | DSHmini（project.yml `name`/`CFBundle*`/`PRODUCT_NAME`、DMG 名、README） | DeepDive | 分发前定死 |
| Bundle ID | `com.dshmini.app` | `com.deepdive.app` | dev 期换无痛 |
| 壳↔前端桥 | `window.__dshminiHost` / handler `dshmini`·`dshminiHost` | `__deepDiveHost` / `deepdive`·`deepdiveHost` | ✅ 双端同步改 |
| 本地存储键 | `dsh.pinned` / `dsh.unread` / `dsh.workspace` | `deepdive.*` | ✅ 已改名（localStorage 随桥端口轮换本就不持久，接受重置） |
| 数据/日志目录 | `~/Library/Application Support/DSHmini`（AppPaths） | `DeepDive` | ✅ 已迁移：首启动按子项整体搬入新目录，偏好域 com.dshmini.app→com.deepdive.app 一次性拷贝 |
| 内部代号 | `Sources/DSHminiApp/`、scheme `DSHmini`、package `@dshmini/frontend` | 可选保留 | 减少 diff，纯内部 |
| logo 资产文件名 | `dshmini-logo-*` / `dshmini-icon-*` | `deepdive-*` | 与种子生成器同步改后重新导出 |
| 协议层（session.* / workspace.* / question/*） | — | 不动 | 引擎自身契约，与品牌无关 |
