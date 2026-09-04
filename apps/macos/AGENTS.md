# apps/macos/AGENTS.md

Swift + AppKit 原生壳（XcodeGen）。根规则见 [../../AGENTS.md](../../AGENTS.md)；本文件只放壳层局部军令。

## 工程生成

- `DSHmini.xcodeproj/` 与 `Info.plist` 是 XcodeGen 生成物（已 ignore）：改 `project.yml` 后跑 `xcodegen generate`，勿手改生成物。

## 勿动的"看起来像死代码"（PITFALLS §4.7、§1.5）

- `MainWindowController` 的**空 NSToolbar**（`EmptyToolbarDelegate`，0 item）唯一作用是把窗口选进 Tahoe 26pt 大圆角档，红绿灯中心线也随之对齐 26pt 头部线——删除/隐藏即退回小圆角档。改动后截图对比 Finder 角部。
- `WebViewTheme.swift` 只保留 html/body 透明（`color-scheme` 由前端 `theme.css` 声明，外观三态跟随）；SPA 样式唯一事实源在 `theme.css`，勿往壳注入加样式。

## 引擎（EngineSupervisor 一族）

- 版本引脚唯一事实源：`scripts/dsh-runtime-version.txt`；代码与文档不内联版本号。
- 入口优先级：`DSHMINI_DSH_ENTRY`（开发对照，最强覆盖）→ bundled（node + `Runtime/dsh`）→ 系统探测 → PATH。
- **embed 必须在实例停止后执行**：覆盖运行中的 node/引擎文件会被 SIGKILL（自检/启动全 137，PITFALLS §7.1）。
- 第二实例被 main.swift 单实例锁拦掉（exit 0 无声）：调试新构建先退运行中实例，或 `DSHMINI_SUPPORT_DIR=<dir>` 隔离（PITFALLS §7.2）。
- 缺 `.credentials.yaml` 会静默空回复：启动断言凭据，缺失走恢复屏冷启动闭环（PITFALLS §4.1）。

## 桥与标识符

- 宿主消息统一在 `AppDelegate.handleHostMessage` 加 case，并同步 `MainWindowController` 的指令清单注释；壳→前端经 `window.__deepDiveHost.dispatch`（pending 单条暂存 + 时限丢弃，SPEC-NOTIFICATIONS §3.1）。
- 偏好键用 `deepdive.*` 命名空间（`DSHAppPrefs`）；桥标识符 `__deepDiveHost`/`deepdive`/`deepdiveHost`，勿用旧名 dshmini。
- 数据目录 `~/Library/Application Support/DeepDive`（`AppPaths`，含自 DSHmini 的一次性迁移），勿在别处硬编码路径。

## 进程纪律

- 引擎进程退出后 `FileHandle.readabilityHandler` 必须置 nil（EOF 忙等，PITFALLS §4.4）。
- 桥 Origin 校验必须 scheme+host+port 全等（`http://127.0.0.1:<port>`），勿用 hasSuffix（PITFALLS §4.5）。
