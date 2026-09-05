# ENGINE-RUNTIME — 引擎捆绑与版本韧性 spec（P2 · v2.1 复审收口）

> **状态（2026-09-03）：已实现**（构建链/入口优先级/能力探测/凭据冷启动均落地，见 `ARCHITECTURE §5` 与 `scripts/`）。本文保留为行为契约与决策依据。
> 工程流 A。目标：**用户无需安装 dsh** + **引擎版本变化对客户端无感**。
> 参考：`luochenw/deepseek-harness-macos` 的 `scripts/prepare-dsh-runtime.sh`、`scripts/build-macos-app.sh`、`scripts/dsh-runtime-version.txt`、`DSHHostProtocol` 的 settings/credentials 端点。
> v2 变更：钉死 bundled 入口形状（node + `lib/bin.js`，修 v1 的路径自相矛盾）；node 二进制版本同样引脚化；新增 §4.4 凭据冷启动闭环。
> v2.1 变更：入口优先级修正（`DSHMINI_DSH_ENTRY` 显式 env 最强覆盖、压过 bundled，否则 §5"对照不同版本"失效）；子命令形状以实测为准；`PATH` 注入 bundled node；`package-macos.sh` 签名改 `--deep`；node 引脚不符改 fail-loud（不做自动下载）。
> **引脚版本以 `scripts/dsh-runtime-version.txt` 为唯一事实源，不在本文内联数字**。版本史：rc.2 → 0.1.2-alpha.2 协议移植试验 → c590653 **回退 rc.2**（alpha.2 UNARY 面实测不可用）；前端 `api.ts` 保留 beforeSeq/atSeq 映射与能力探测回退，两版兼容。

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
- 文件：`scripts/dsh-runtime-version.txt`，内容为单一版本号（**当前值以文件为准**）。
- **node 二进制版本同样引脚化**：`scripts/node-version.txt` 单一版本号（对齐 `ARCHITECTURE §5.4`"启动时禁止复用系统 Node，保证版本钉死"的精神——只钉 dsh 不钉 node 会随构建机漂移）。构建机 node 与引脚不符时**直接报错**（提示切到引脚版本后重试，如 nvm / 官方 tarball 手动安装），**不静默用本机版本**；不做自动下载（控制实现面——参考项目亦只用构建机 node，自动下载是超出参考的新逻辑）。

### 3.2 准备脚本 `scripts/prepare-dsh-runtime.sh`（对齐参考项目）
- 读 `dsh-runtime-version.txt` 得到 `EXPECTED_VERSION`。
- 可选 `DSH_RUNTIME_VERIFY_LATEST=1`：`npm view @deepseek-ai/dsh version` 须等于引脚，否则报错提示"更新 runtime 与测试后再构建"（对齐参考项目；opt-in。prerelease 引脚下 npm `latest` 前移后此校验按设计失败，提示的正是"该升引脚+回归测试了"）。
- 可用 `DSH_SOURCE` 复用**同版本完整 runtime**（严格校验版本 + `lib/bin.js` + 嵌套依赖 `@deepseek-ai/dsh-subagent`/`dsh-session`/`dsh-web-app` 版本一致）。
- 否则安装到隔离缓存：`dist/.dsh-runtime-cache/$VERSION/lib/node_modules/@deepseek-ai/dsh`（加 build 目录锁防并行构建互删）。
- 输出缓存中的 runtime 源路径。

### 3.3 嵌入 App `scripts/embed-engine.sh`
- 在 `build-release.sh` / `package-macos.sh` / `dev.sh` 中追加一步（与 `embed-web.sh` 平级）。
- 将：
  - `node` 可执行（按 §3.1 `node-version.txt` 引脚取，非本机随手版）→ `Contents/MacOS/node`（校验架构匹配、复制 `libnode*.dylib` 到 `Contents/lib`）。
  - 准备好的 DSH runtime 闭包（`prepare-dsh-runtime.sh` 输出）→ **`Contents/Resources/Runtime/dsh/`（整目录拷入，入口脚本为 `Runtime/dsh/lib/bin.js`）**。
- 记录/声明运行时许可（Node LICENSE、DSH runtime THIRD_PARTY_NOTICES）。

### 3.4 入口解析与 spawn 形状（`EngineSupervisor`）
- **入口形状改变**：bundled 场景不再是"单一 `dsh` 可执行直启"，而是 **bundled node + 入口脚本**——`executableURL = <bundle>/Contents/MacOS/node`，`arguments = [<bundle>/Contents/Resources/Runtime/dsh/lib/bin.js, "--profile", "web", "--no-open", "--port", "0"]`。**子命令形状以实测为准**：现状系统 dsh 用 `--profile web` 标志式，参考项目 bin.js 用 `web` 子命令式（`bin.js web --host 127.0.0.1 --port 0 --no-open`）——两者应等价，验收标准是能输出 `dsh web:` URL 行。`DSH_HOME` 仍指向应用数据目录（隔离）；环境 `PATH` 前置 bundled node 所在目录（runtime 内子进程需要，对齐参考项目）；无 Dock（LSUIElement）沿用。
- `resolveDshEntry()` 优先级（返回入口形状枚举，供 spawn 区分）：
  1. `DSHMINI_DSH_ENTRY`（若可执行）→ 单可执行直启（现状形状）。**显式 env 是最强覆盖、压过 bundled**——§5"对照不同版本 API 面"依赖此优先级（若 bundled 更高，设了 env 仍启动 bundled，覆盖即失效）；普通用户无此 env，不受影响。
  2. **bundled**：`Bundle.main` 下 `Resources/Runtime/dsh/lib/bin.js` 存在**且** `Contents/MacOS/node` 存在 → node + bin.js 形状。（注意 `Bundle.main.url(forResource:subdirectory:)` 相对 `Contents/Resources` 解析，subdirectory 应为 `Runtime/dsh/lib`——v1 写的 `Runtime/Contents` 有误。）
  3. 系统路径探测（现状）→ `PATH` 的 `dsh`。
- **失败文案随来源区分**：bundled 缺失/损坏（bin.js 或 node 不存在、启动即崩）提示"引擎程序不完整，请重新安装 App"；仅系统 dsh 找不到时才提示"请安装 dsh"（现状文案）。

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

### 4.4 凭据冷启动闭环（首启引导）
- 引擎**不因缺凭据而拒启**：DSH_HOME 缺 `.credentials.yaml` 时 `EngineSupervisor` 只记一行日志、照常 spawn。依据是引擎自身的契约——`credentials-local` 对文件缺失容忍（ENOENT 视为空），且 watch 文件热发布；而配 Key 的 `credentials.set` 是引擎 RPC，引擎不在跑就没有任何合法途径写出第一把 Key（PITFALLS §5.6）。
- 桥接静态资源与引擎状态无关：SPA 在引擎启动期/失败期都能加载，只有 `/api` 在引擎未就绪时 503。
- 首启由 SPA 的 `FirstRunGate`（`frontend/src/settings/FirstRunGate.tsx`）接管：引擎连上后经 `credentials.describe` 对全部提供方 keyRef 确证「没有任何已配置密钥」→ 整窗替换为 guided 模式的 `ModelDialog`（不可关闭，卡顶品牌欢迎头，保存钮「保存并开始」）；保存后重新 describe，配出密钥即放行主界面，未配出（如留空 Key）则换新表单并给提示行。读取失败 ≠ 未配置（`useModelCatalog.configuredKnown`），引擎瞬断绝不把老用户锁进引导页。目录与密钥态数据源与设置页「模型」共用 `useModelCatalog`。
- 恢复窗（`RecoveryWindowController`）只服务真实引擎故障（入口缺失/连续崩溃）；其「打开设置」「从 ~/.dsh 导入」按钮按凭据文件是否存在显隐，导入路径保留为老用户迁移的旁路。

## 5. 引擎升级与更新

- 引擎版本随**应用整体发布**（当前规格）——升级 bundled runtime = 发新版 App。
- 长期：**App 自更新（Sparkle，`ARCHITECTURE §12` 已选型）**随更新带新内核；配合 §4 能力探测，双保险使引擎更新无感。
- 开发：`DSHMINI_DSH_ENTRY` 指向任意目标版本 dsh，用于对照不同版本 API 面。

## 6. 文件变更（实现起参考）

| 文件 | 变更 |
|---|---|
| ~~`engine/README.md`~~ | 已收口：内容并入 `docs/ARCHITECTURE.md §5`，目录删除 |
| `scripts/prepare-dsh-runtime.sh` | 新增（对齐参考项目） |
| `scripts/embed-engine.sh` | 新增 |
| `scripts/dsh-runtime-version.txt` | 新增（运行时版本引脚） |
| `scripts/node-version.txt` | 新增（node 二进制引脚，§3.1） |
| `scripts/build-release.sh` / `package-macos.sh` / `dev.sh` | 追加 embed-engine；`package-macos.sh` 签名改 `codesign --force --deep`（现有浅签不覆盖嵌入的 `MacOS/node`，参考项目 embed 后即深签） |
| `apps/macos/Sources/DSHminiApp/EngineSupervisor.swift` | 入口解析优先 bundled + spawn 形状（node+bin.js）+ 失败文案区分（§3.4） |
| `apps/macos/Sources/DSHminiApp/EngineSupervisor.swift` / `BridgeServer.swift` | 缺凭据只记日志、照常 spawn；静态资源不受引擎状态门控（§4.4） |
| `apps/macos/Sources/DSHminiApp/RecoveryWindowController.swift` | 恢复界面加"配置 API Key"入口 + 一键导入（§4.4） |

> 依赖：DSHmini 需在构建机有 Node/npm（仅构建时）。运行时自包含，不依赖全局 npm/PATH。
