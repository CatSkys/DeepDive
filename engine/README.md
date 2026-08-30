# engine/（v1 注释区）

套壳 v1 的引擎侧不做任何修改：直接用官方 `web` profile。

- **主题覆盖**：`apps/macos/Sources/DSHminiApp/WebViewTheme.swift`（注入 CSS，不动引擎）
- **引擎日志**：`~/Library/Application Support/DSHmini/engine.log`（壳侧）；引擎自身日志在 DSH_HOME 下
- **DSH_HOME**：`~/Library/Application Support/DSHmini/harness`（完整独立 dsh 安装）
- **引擎入口覆盖**：环境变量 `DSHMINI_DSH_ENTRY`（默认探测 /opt/homebrew/bin/dsh → /usr/local/bin/dsh）
- **工作区/沙箱根**：引擎 cwd = 「启动工作区」（sandbox-policy.workspaceRoot 默认 process.cwd()），更改需重启引擎（菜单栏「设置启动工作区…」）
- 未来：`dshmini` profile / 插件（keychain、通知等）在此目录扩展，v1 明确不做
