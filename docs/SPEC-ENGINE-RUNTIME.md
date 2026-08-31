# ENGINE-RUNTIME — 引擎捆绑与版本韧性 spec（P2 · 待确认）

> 工程流 A。目标：**用户无需安装 dsh** + **引擎版本变化对客户端无感**。
> 参考：`luochenw/deepseek-harness-macos` 的 `scripts/prepare-dsh-runtime.sh`、`scripts/build-macos-app.sh`、`scripts/dsh-runtime-version.txt`、`DSHHostProtocol` 的 settings/credentials 端点。

---

## 1. 背景与根因

- DSHmini 现为**系统级浮动 `dsh`**：`EngineSupervisor.resolveDshEntry()` 只探测 `/opt/homebrew/bin/dsh` → `/usr/local/bin/dsh` → `/usr/bin/dsh` → PATH，找不到即 `failed` 并提示"请安装 dsh"。**无 dsh 无法运行。**
- 引擎网关对 `@Remote` 端点做认领（`claimsEndpoint`），非 Remote 方法直接回 HTTP 404。**`llm.listProviders`/`listConfigurableProviders` 在 0.1.1-rc.2 是普通方法（`dsh-llm/lib/index.js:1240` 前无 `@Remote`），0.1.2-alpha.2 起才升级为 `@Remote`**。→ 客户端依赖"一组方法名"必然被版本卡住。

## 2. 目标

1. 引擎随 App 分发：`App` 自带 Node LTS + DSH runtime 闭包。
2. 启动默认用 bundled 引擎；`DSHMINI_DSH_ENTRY`/系统 dsh 仅作覆盖。
3. 版本可管理：`dsh-runtime-version.txt` 为唯一版本引脚；构建校验 = npm `latest`（可关）；缓存命中跳过安装。
4. 客户端对引擎版本**无感**：稳定面直接可用，版本敏感面**能力探测**，缺则隐藏、绝不崩溃。

## 3. 引擎捆绑（构建期）

### 3.1 运行时来源引脚
- 文件：`scripts/dsh-runtime-version.txt`，内容为单一版本号（当前 `0.1.2-alpha.2`）。

### 3.2 准备脚本 `scripts/prepare-dsh-runtime.sh`（对齐参考项目）
- 读 `dsh-runtime-version.txt` 得到 `EXPECTED_VERSION`。
- 可选 `DSH_RUNTIME_VERIFY_LATEST=1`：`npm view @deepseek-ai/dsh version` 须等于引脚，否则报错提示"更新 runtime 与测试后再构建"。
- 可用 `DSH_SOURCE` 复用**同版本完整 runtime**（严格校验版本 + `lib/bin.js` + 嵌套依赖 `@deepseek-ai/dsh-subagent`/`dsh-session`/`dsh-web-app` 版本一致）。
- 否则安装到隔离缓存：`dist/.dsh-runtime-cache/$VERSION/lib/node_modules/@deepseek-ai/dsh`（加 build 目录锁防并行构建互删）。
- 输出缓存中的 runtime 源路径。

### 3.3 嵌入 App `scripts/embed-engine.sh`
- 在 `build-release.sh` / `package-macos.sh` / `dev.sh` 中追加一步（与 `embed-web.sh` 平级）。
- 将：
  - `node` 可执行（构建机 `command -v node`）→ `Contents/MacOS/node`（校验架构匹配、复制 `libnode*.dylib` 到 `Contents/lib`）。
  - 准备好的 DSH runtime 闭包（`prepare-dsh-runtime.sh` 输出）→ `Contents/Resources/Runtime/dsh`。
- 记录/声明运行时许可（Node LICENSE、DSH runtime THIRD_PARTY_NOTICES）。

### 3.4 入口解析 `EngineSupervisor.resolveDshEntry()` 调整
- 优先：`Bundle.main.url(forResource: "dsh", withExtension: nil, subdirectory: "Runtime/Contents")`（或按构建布局）下的可执行。
- 其次：`DSHMINI_DSH_ENTRY`（若可执行）。
- 其次：系统路径探测（现状）→ `PATH` 的 `dsh`。
- 运行时子命令仍为 `--profile web --no-open --port 0`；`DSH_HOME` 仍指向应用数据目录（隔离）。无 Dock（LSUIElement）沿用。

## 4. 版本韧性

### 4.1 稳定面（跨版本，直接使用）
`settings.describe`（返回 `{writable,hasDocument,namespaces:[{ns,schema,value,base,user,applies,secrets,revision}]}`）、`settings.update(ns,patch,rev)`、`settings.mutate(ns,ops,rev)`、`settings.replace(ns,section,rev)`、`credentials.describe(refs)`、`credentials.set(ref,value)`、`credentials.unset(ref)`、`llm.models`（模型目录）、`agentPreset.list`。
> 注：读取 settings 文档打开端点名称可能在版本间漂移（源码 `settings.openSettingsDocument` vs 参考项目 `settings.openDocument`）——作为版本敏感面处理，**能力探测**其是否存在再展示"打开配置文件"入口。

### 4.2 版本敏感面（能力探测 + 优雅降级）
- `llm.listProviders` / `llm.listConfigurableProviders` / `llm.discoverModels`（provider 管理器/模型发现）。
- 客户端**先探测**：调用一次，若 `HTTP 404` 或 `gateway/invocation-unavailable`/`gateway/definition-unavailable` → 判定该能力缺失，隐藏对应增强（如"添加/删除 provider"），回退到 `llm.models` 驱动的默认模型 + 凭证管理。
- 所有 Remote 调用包一层（`probe(call)`）：方法缺失时返回降级结果，绝不抛到 UI，绝不因单个方法 404 影响整个页面。
- 探测结果作为能力信号缓存（本次会话）。引擎升级后能力自动出现，**无需客户端改代码**。

### 4.3 写防串写（revision 围栏）
- 一切 `settings.update/mutate/replace` 都带 `expectedRevision`（读自 `settings.describe` 的 `revision`）。
- 返回 `settings/conflict` 时：UI 给两选一恢复——"放弃修改，载入最新" / "保留修改，基于最新版本重试"（对齐参考项目 `SettingsEditorView`）。不做静默覆盖。

## 5. 引擎升级与更新

- 引擎版本随**应用整体发布**（当前规格）——升级 bundled runtime = 发新版 App。
- 长期：**App 自更新（Sparkle，`ARCHITECTURE §12` 已选型）**随更新带新内核；配合 §4 能力探测，双保险使引擎更新无感。
- 开发：`DSHMINI_DSH_ENTRY` 指向任意目标版本 dsh，用于对照不同版本 API 面。

## 6. 文件变更（实现起参考）

| 文件 | 变更 |
|---|---|
| `engine/README.md` | 更新为"已捆绑/版本引脚/覆盖方式" |
| `scripts/prepare-dsh-runtime.sh` | 新增（对齐参考项目） |
| `scripts/embed-engine.sh` | 新增 |
| `scripts/dsh-runtime-version.txt` | 新增（`0.1.2-alpha.2`） |
| `scripts/build-release.sh` / `package-macos.sh` / `dev.sh` | 追加 embed-engine |
| `apps/macos/Sources/DSHminiApp/EngineSupervisor.swift` | `resolveDshEntry()` 优先 bundled |
| `apps/macos/Sources/DSHminiApp/AppDelegate.swift` | 必要时校验 bundled 存在/凭据提示 |

> 依赖：DSHmini 需在构建机有 Node/npm（仅构建时）。运行时自包含，不依赖全局 npm/PATH。
