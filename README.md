# DSHmini — macOS 客户端（套壳 v1）

按 `docs/PLAN-P1.md` 实现的 DeepSeek Harness 桌面壳：原生玻璃窗口 + 系统 WebView 加载官方 `dsh web`，黑白单一色调，无客户端新功能。

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

- 引擎数据：`~/Library/Application Support/DSHmini/harness`（独立 `DSH_HOME`，与其他 dsh 安装隔离）
- 日志：`~/Library/Application Support/DSHmini/engine.log`
- 配置：`~/Library/Application Support/DSHmini/config.json`

## 结构

```
apps/macos/                Swift + AppKit 外壳（XcodeGen）
frontend/packages/design/  tokens.json 唯一事实源 → gen-tokens.mjs → tokens.css / Tokens.swift
docs/                      架构/语义/UI 规范 + P1 计划与评审
```

## 已知限制（v1，见 docs/PLAN-P1.md §4）

官方 UI 信息架构原样保留；工作区切换需重启引擎（sandbox 根=cwd）；系统通知/Keychain/自动更新属 P2。
