# DeepDive（深潜）— macOS 客户端

DeepSeek Harness 桌面客户端：原生玻璃窗口（Swift + AppKit + WKWebView）+ 自建极简 React SPA（会话流/工具行/审批，按 DSH 官方 UI 对齐移植）。SPA 由壳内 BridgeServer 同源托管（静态文件 + `/api` 反代 + WebSocket 盲中继），引擎 `dsh` 为被监督的子进程。黑白单一色调。

## 环境

- macOS 14+，Xcode 26（或 16+），[XcodeGen](https://github.com/yonaskolb/XcodeGen)（`brew install xcodegen`）
- `dsh` CLI：`npm i -g @deepseek-ai/dsh`（`make dev` 默认用系统 dsh，Release/package 构建捆绑引脚版运行时；`DSHMINI_DSH_ENTRY` 可覆盖路径）

## 安装（把 DMG 给使用者）

DMG 里只有两项：**DeepDive.app** 与 **Applications 链接**，安装引导画在窗口背景上（背景图源在 `design/dmg/`，改图见该目录 README）。

1. 打开 DMG，把 DeepDive 拖进「应用程序」；
2. 从「启动台」或「应用程序」打开——**公证过的包双击即进主界面**，没有额外步骤（未公证的自建包会撞 Gatekeeper，见下节）。

系统要求：**macOS 14 及以上，且仅 Apple 芯片（arm64）**。包内只带 Apple 芯片的 Node 运行时，Intel（x86_64）Mac 上引擎起不来，会给出明确提示。

## 开发

```sh
make dev          # 构建 Debug 并打开应用
make app          # Release 构建并打开
make package      # 生成 Developer ID 签名 DMG（dist/）
DSHMINI_NOTARY_PROFILE=DSHMINI_NOTARY make package   # 带公证与装钉（发给他人必须用这条）
make publish      # 把刚打包的那份发成一次应用更新（签 appcast + 传到发布仓）
```

**发给他人必须公证**：未公证的包在 macOS 15 及以上会被 Gatekeeper 拦下——新用户双击只看到「未打开 DeepDive」，而那个对话框的默认按钮是「移到废纸篓」，用户按常规操作根本进不去（右键 → 打开 的旧绕过入口自 macOS 15 起已被系统取消）。诊断锚点：`spctl -a -vvv -t exec <app>` 报 `rejected / source=Unnotarized Developer ID`，系统日志见 `syspolicyd: Terminating process due to Gatekeeper rejection`。

**版本号（用户 2026-10-09 定稿）**：唯一事实源是 `apps/macos/project.yml` 的 `CFBundleShortVersionString` + `CFBundleVersion`（两处同步，别在别处再写；`Info.plist` 与 DMG 文件名都从它取）。**每次分发只递增最后一位**（0.1.0 → 0.1.1），由上面那条公证命令在 xcodegen 之前自动做（`scripts/bump-app-version.sh patch`），不需要谁记得；**前两位（major / minor）只有用户确认后才能动**，脚本对这两个要 `--user-confirmed`，没带旗标直接停。不带公证的本地 `make package` 不动版本号（那不算分发）。

启动后：菜单栏出现引擎状态点；`⌥Space` 显示/隐藏窗口；菜单栏「设置启动工作区…」选择沙箱根目录（重启引擎生效）；设置内「外观」（跟随系统/亮/暗）即时生效。

## 应用更新

装好的 DeepDive 自己更新（Sparkle）：每小时后台查一次，静默下载，**退出时装上**（也可从菜单「检查更新…」或「设置 → 关于」立刻装）。Debug 构建不更新（`make dev` 的开发包不该被 Release 覆盖），也不摆入口。

- **状态可见**：找到新版本**标题栏就多一颗更新钮**（红绿灯旁那排，收起侧栏/搜索的右边），hover 出的卡在下载期报「正在下载 x.y.z」，下载完变成版本、发布日期、本版变更正文（Markdown，可点链接，可收起）、一句「退出 DeepDive 时自动安装」与卡底那颗「重启以安装」。没有更新在途时那颗钮不存在。菜单里那一项同源：待装时是「重启以更新（x.y.z）」且点了就装，下载期是「正在下载 x.y.z…」并禁用。状态来自壳（`Sources/DSHminiApp/AppUpdater.swift`）经桥推给界面（`components/UpdateBadge.tsx`、设置→关于）。
- **说明正文**：首选仓库里**撰写的** `docs/release-notes/<版本>.md`（面向用户的人话，用 `.agents/skills/release-notes` 那个 skill 写）；没有它才退回「自上一个 tag 以来的提交主题」并告警。无论哪一档都随发布上传，应用读 appcast 的 `sparkle:releaseNotesLink` 拉回来。
- **更新源**：公开发布仓 [CatSkys/DeepDive-releases](https://github.com/CatSkys/DeepDive-releases) 的 `appcast.xml`，应用读它的永久链接（`…/releases/latest/download/appcast.xml`，就是 Info.plist 的 `SUFeedURL`）。源码仓是私有的，装好的用户读不了它的 Release——所以 feed 落在那个只放产物的公开仓。**更新不需要对象存储**：客户端只做一件事——匿名 HTTPS 拉下 appcast 与 DMG 两个文件，任何能匿名读的 HTTPS 托管都行，GitHub Release 就是这种托管（Atd 另有一层 Cloudflare R2 镜像，那是给官网永久下载链接与 CDN 用的，不是更新的前置）。
- **可信度**：更新包是否被接受由 appcast 里的 EdDSA 签名决定，公钥固化在 `project.yml` 的 `SUPublicEDKey`。私钥在钥匙串（账户 `com.deepdive.app`，一次性生成：`bash scripts/sparkle-tools.sh generate_keys --account com.deepdive.app`）——**它不在仓库里，丢了就只能靠旧版本的用户手动重装**。
- **发布**：`DSHMINI_NOTARY_PROFILE=… make package` 出包（这一步会递增版本号）→ `make publish`。后者会先核验包里是 Developer ID + 已装订的公证票据 + 两个版本键都等于版本号，再签 DMG、准备发布说明（优先取撰写的 `docs/release-notes/<版本>.md`，见 `.agents/skills/release-notes`；没有才退回自上一个 `app-v*` tag 以来的提交主题并告警）、写 appcast、上传（说明既进 Release 正文也作为资产给应用读），最后拉一次永久 feed 链接确认它真的指向新版本，发布成功后打新 tag 作为下一版的基准。**上传是外部动作**，没人替你兜底，所以每道核验都是硬失败。

## 数据

- 引擎数据：`~/Library/Application Support/DeepDive/harness`（独立 `DSH_HOME`，与其他 dsh 安装隔离）
- 日志：`~/Library/Application Support/DeepDive/engine.log`
- 配置：`~/Library/Application Support/DeepDive/config.json`

## 结构

```
AGENTS.md                  Agent 常备军令：布局/命令/铁律（会话开始先读；frontend/ 与 apps/macos/ 各有局部版）
apps/macos/                Swift + AppKit 外壳（XcodeGen）：窗口/热键/托盘/悬浮球/通知/引擎监督/恢复界面/Bridge
frontend/                  自建 SPA（React + TS + Vite）：消息流渲染 + /api 客户端 + 标题栏拖拽桥(titlebar.ts)
frontend/packages/design/  tokens.json 唯一事实源 → gen-tokens.mjs → tokens.css
design/logo/               DeepDive logo 种子工程与导出（白底实心 D + 右侧渐变模糊；docs/BRANDING.md）
scripts/                   构建/打包/引擎嵌入脚本 + 运行时版本引脚（dsh-runtime-version.txt）
docs/                      架构(as-built)/UI 规范/语义蓝图/三个 P2 SPEC/踩坑记录/协作约定
```

## 已知限制（见 docs/ARCHITECTURE.md §8 与 docs/REVIEW-P2.md）

工作区切换需重启引擎（sandbox 根=cwd）。更新是整包替换（无差分包），且只在 Release 构建里生效。路线待办见 `docs/TODO.md`。

## 许可证

MIT（见 [LICENSE](LICENSE)）。`engine/` 是 DeepSeek Harness（MIT）的 fork，随其自身许可证（`engine/LICENSE`）；本项目与 DeepSeek 无隶属关系。
