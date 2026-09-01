# engine/（P2 引擎运行时）

引擎随 App 分发（SPEC-ENGINE-RUNTIME v2.1）：构建期捆绑 Node + DSH runtime 闭包，运行时自包含，不依赖系统 dsh / 全局 npm。

## 版本引脚（唯一事实源）

- `scripts/dsh-runtime-version.txt`：DSH runtime 版本（当前 `0.1.2-alpha.2`）
- `scripts/node-version.txt`：Node 工具链版本（构建期校验，不符即 fail-loud）

## 构建链

- `scripts/prepare-dsh-runtime.sh`：按引脚准备 runtime 闭包（`DSH_SOURCE` 可复用同版本完整 runtime，严格校验嵌套依赖版本；否则装进 `dist/.dsh-runtime-cache/`，带构建锁）。`DSH_RUNTIME_VERIFY_LATEST=1` 可选校验 npm latest == 引脚。
- `scripts/embed-engine.sh <app>`：把 pinned node（`Contents/MacOS/node`）+ runtime 闭包（`Contents/Resources/Runtime/dsh/`）拷入 .app，附许可文件，并做 `node bin.js --version` 自检。
- 接线：`build-release.sh` / `package-macos.sh`（深签）/ `dev.sh`（`DSHMINI_DEV_ENGINE=1` 时嵌入）。

## 运行时入口（EngineSupervisor）

优先级：`DSHMINI_DSH_ENTRY`（最强覆盖，开发对照用）→ bundled（node + `Runtime/dsh/lib/bin.js`）→ 系统路径探测 → `PATH` 的 `dsh`。

- 启动参数：`--profile web --no-open --port 0`；`DSH_HOME` = `~/Library/Application Support/DSHmini/harness`（完整独立 dsh 安装）
- bundled 缺失/损坏 → 恢复界面提示"重新安装 App"；仅系统 dsh 缺失才提示"请安装 dsh"
- **凭据冷启动**：缺 `.credentials.yaml` 时恢复界面提供「打开设置（配置 API Key）」与「从 ~/.dsh 导入凭据」，配好即自动重启（SPEC-ENGINE-RUNTIME §4.4）

## 其他（沿用 v1）

- **主题覆盖**：`apps/macos/Sources/DSHminiApp/WebViewTheme.swift`（注入 CSS，不动引擎）
- **引擎日志**：`~/Library/Application Support/DSHmini/engine.log`（壳侧）；引擎自身日志在 DSH_HOME 下
- **工作区/沙箱根**：引擎 cwd = 「启动工作区」（sandbox-policy.workspaceRoot 默认 process.cwd()），更改需重启引擎（菜单栏「设置启动工作区…」）
- 版本韧性：稳定面直接用、版本敏感面（provider 管理等）能力探测 + 优雅降级（SPEC-ENGINE-RUNTIME §4.2）
