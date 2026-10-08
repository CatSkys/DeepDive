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
```

**发给他人必须公证**：未公证的包在 macOS 15 及以上会被 Gatekeeper 拦下——新用户双击只看到「未打开 DeepDive」，而那个对话框的默认按钮是「移到废纸篓」，用户按常规操作根本进不去（右键 → 打开 的旧绕过入口自 macOS 15 起已被系统取消）。诊断锚点：`spctl -a -vvv -t exec <app>` 报 `rejected / source=Unnotarized Developer ID`，系统日志见 `syspolicyd: Terminating process due to Gatekeeper rejection`。

启动后：菜单栏出现引擎状态点；`⌥Space` 显示/隐藏窗口；菜单栏「设置启动工作区…」选择沙箱根目录（重启引擎生效）；设置内「外观」（跟随系统/亮/暗）即时生效。

## 数据

- 引擎数据：`~/Library/Application Support/DeepDive/harness`（独立 `DSH_HOME`，与其他 dsh 安装隔离）
- 日志：`~/Library/Application Support/DeepDive/engine.log`
- 配置：`~/Library/Application Support/DeepDive/config.json`

## 结构

```
AGENTS.md                  Agent 常备军令：布局/命令/铁律（会话开始先读；frontend/ 与 apps/macos/ 各有局部版）
apps/macos/                Swift + AppKit 外壳（XcodeGen）：窗口/热键/托盘/悬浮球/通知/引擎监督/恢复界面/Bridge
frontend/                  自建 SPA（React + TS + Vite）：消息流渲染 + /api 客户端 + 标题栏拖拽桥(titlebar.ts)
frontend/packages/design/  tokens.json 唯一事实源 → gen-tokens.mjs → tokens.css / Tokens.swift
design/logo/               DeepDive logo 种子工程与导出（白底实心 D + 右侧渐变模糊；docs/BRANDING.md）
scripts/                   构建/打包/引擎嵌入脚本 + 运行时版本引脚（dsh-runtime-version.txt）
deepseek-harness/          官方 DSH 源码 vendored 副本（版本=引擎引脚，embed 时强校验）：资产源/移植对照，勿当运行时
docs/                      架构(as-built)/UI 规范/语义蓝图/三个 P2 SPEC/踩坑记录/协作约定
```

## 已知限制（见 docs/ARCHITECTURE.md §8 与 docs/REVIEW-P2.md）

工作区切换需重启引擎（sandbox 根=cwd）；自动更新未做。路线待办见 `docs/TODO.md`。

## 许可证

MIT（见 [LICENSE](LICENSE)）。捆绑的 DeepSeek Harness 运行时与其 vendored 源码遵循其自身许可证（`deepseek-harness/LICENSE`、`deepseek-harness/THIRD_PARTY_NOTICES.md`）；本项目与 DeepSeek 无隶属关系。
