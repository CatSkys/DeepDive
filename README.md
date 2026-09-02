# DeepDive（深潜）— macOS 客户端

DeepSeek Harness 桌面客户端：原生玻璃窗口（Swift + AppKit + WKWebView）+ 自建极简 React SPA（会话流/工具行/审批，按 DSH 官方 UI 对齐移植）。SPA 由壳内 BridgeServer 同源托管（静态文件 + `/api` 反代 + WebSocket 盲中继），引擎 `dsh` 为被监督的子进程。黑白单一色调。

## 环境

- macOS 14+，Xcode 26（或 16+），[XcodeGen](https://github.com/yonaskolb/XcodeGen)（`brew install xcodegen`）
- `dsh` CLI：`npm i -g @deepseek-ai/dsh`（v1 使用系统 dsh；`DSHMINI_DSH_ENTRY` 可覆盖路径）

## 开发

```sh
make dev          # 构建 Debug 并打开应用
make app          # Release 构建并打开
make package      # 生成 dev 签名 DMG（dist/）
```

启动后：菜单栏出现引擎状态点；`⌥Space` 显示/隐藏窗口；菜单栏「设置启动工作区…」选择沙箱根目录（重启引擎生效）；「黑白主题」开关即时生效。

## 数据

- 引擎数据：`~/Library/Application Support/DeepDive/harness`（独立 `DSH_HOME`，与其他 dsh 安装隔离）
- 日志：`~/Library/Application Support/DeepDive/engine.log`
- 配置：`~/Library/Application Support/DeepDive/config.json`

## 结构

```
apps/macos/                Swift + AppKit 外壳（XcodeGen）：窗口/热键/托盘/引擎监督/恢复界面/Bridge
frontend/                  自建 SPA（React + TS + Vite）：消息流渲染 + /api 客户端 + 标题栏拖拽桥(titlebar.ts)
frontend/packages/design/  tokens.json 唯一事实源 → gen-tokens.mjs → tokens.css / Tokens.swift
docs/                      架构/语义/UI 规范/踩坑记录 + 计划与评审
```

## 已知限制（见 docs/PLAN-P1.md §4 与 docs/REVIEW-P2.md）

工作区切换需重启引擎（sandbox 根=cwd）；系统通知/Keychain/自动更新属 P2。
