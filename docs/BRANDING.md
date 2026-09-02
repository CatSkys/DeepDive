# DeepDive（深潜）品牌定稿（2026-09-02）

> 状态：**品牌名已定（DeepDive · 深潜）**；logo 定稿（ASCII 鲸鱼，种子 20260902）。
> 工程改名已于 2026-09-02 执行（见 §5 清单，全部落地；内部代号 scheme/源码目录按 §5 保留 DSHmini 减少 diff）。仓库：CatSkys/DSH-deck。

## 1. 品牌名

| 项 | 值 |
| --- | --- |
| 英文主名 | **DeepDive** |
| 中文配对 | **深潜** |
| 一句话定位 | DeepDive — 让 DeepSeek 深潜到你的问题里。（桌面深潜舱，监督 dsh 引擎在沙箱工作区作业） |
| 气质 | 硬核工具感；与 DeepSeek 强关联但不冒充官方产品 |

命名语义：Deep(Seek) + Dive——与官方"深度求索"、鲸鱼 logo、以及 UI 继承的官方 *Deep diving…* 状态文案同构。
（备选：DeepDeck / DeepCore / DeepSeek Dock，见下轮如需再评估。）

## 2. Logo 定稿：ASCII 鲸鱼

- 资产位置：`design/logo/`（生成器 `index.html` 自包含，种子 `20260902`，确定性算法，可复现导出）
- 形态：**ASCII 字符构成官方 DeepSeek 鲸鱼**（`+ * x` 剪影骨架 / `.` `'` 镂空点晕 / `#` 眼位签名），黑墨 `#0b0b0c`、透明底，7 档尺寸 1024→32
- 图标容器：浅磨砂玻璃 squircle（`deepdive-icon-frosted-1024-squircle.png`），已切 AppIcon 落地
- 出处：鲸鱼 path 派生自官方 `favicon.svg`（50×50 viewBox）——**派生自官方图形，非原创**（分发注意见 §4）

## 3. 资产清单与落地状态（2026-09-02）

| 资产/场景 | 状态 |
| --- | --- |
| 主 PNG（透明底黑墨，1024…32） | ✅ `design/logo/exports/`（文件名前缀随工程改名统一，种子固定产物可复现） |
| AppIcon | ✅ `apps/macos/Assets.xcassets/AppIcon.appiconset/`（Apple 网格母版 1024/824/185.4 圆角，10 档）；`project.yml` 已挂 + `LSUIElement` false（进 Dock + ⌘⇥） |
| 菜单栏状态点 | ✅ 不占用简化小标（沿用圆点） |
| 深色场景反白版 | ⬜ 未做（同算法换 `INK` 即可；深色底黑墨不可见） |
| <128px 简化小标 | ⬜ 未做（Dock 以下无场景；如未来有需按 judge 建议 2 出简化版） |

## 4. 使用与分发纪律

- 视觉纪律沿用 UI-SPEC：**黑白单色**；墨字资产用于浅底，深底必须先出反白版
- 黑墨主资产 128px 起失认，小尺寸用 AppIcon/圆点，不硬缩主资产
- **商标/许可**：logo 与命名均派生/关联 DeepSeek 官方（ASCII 鲸鱼派生自官方 path）。个人项目随意；**正式对外分发（Sparkle/商店）前单独评估**——官方 logo 占位属商标使用问题，与 THIRD_PARTY_NOTICES（版权声明）分属两事

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
