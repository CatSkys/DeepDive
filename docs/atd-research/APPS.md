# Atd 个人小应用（My apps）对照调研

> 本文拥有「Atd 的个人小应用」这一件事：它是什么、怎么搭出来的、能给 DeepDive 什么。
> 对象与素材出处见 `assets/atd-apps/SOURCE.md`；线级索引与其余块见 `HANDOVER.md`；项目全局面（架构/铁律/规范）在本仓 `AGENTS.md` 与 `docs/`，本文不重复。
> 结论均以它**仓内源码**与其**立项计划**为证（用户 2026-10-12 定：对照以官方素材与仓内代码为准，不再要实机截图）。素材已固化在本目录。

---

## 1. 这是什么（产品语义）

一句话：**在对话里描述一个小工具，模型把它写出来、构建它，「我的应用」里随时打开**——一个应用 = 一棵源码树，可以有自己独立窗口、自己的后端、自己的桌面组件。

- **血统**：照 Raycast 的 **Glaze** 做（立项计划首行，`assets/atd-apps/plans/2026-10-03-create-app.md:9`，能力映射表在 :26-43）。Glaze 把生成物当 Electron 应用跑、给"full system access"；Atd 能力范围相当，但走能力代理 + 既有授权门，不给生成代码裸系统权限（同上 :43）。
- **与"对话里画个界面"的区别**：产物是**持久实体**——有 id（`app-` + 10 位小写字母数字，兼作 scheme host）、有版本、有数据目录、有图标，不是一次性渲染。

### 1.1 生成物的形态

```
app/                        （agent 写在任务目录下）
  atd-app.json   清单：name/description/accentColor/window/capabilities/purposes/dependencies
  icon.svg       64×64 viewBox，用识别色画；≤256 KiB
  web/           React 页面（index.html + src/）
  server/        可选后端（defineBackend）
  shared/        双端共享的 typebox schema
```

只有 `atd-app.json` 与 `web/index.html` 是必需的（`packages/app-kit/src/node/staging.ts:213-217`）；纯 UI 应用删掉 `server/`。字段契约在 `assets/atd-apps/contracts/app-manifest.ts`：名称 1–64、描述 ≤500、窗口 200–4000 pt、`capabilities` 是 `ai|agent|memory|mcp|web` 的子集（≤5，唯一）、`dependencies` ≤24 个且只接受精确版本/`^`/`~`/x-range、处处 `additionalProperties:false`。

### 1.2 用户可见的面

| 入口 | 做什么 |
|---|---|
| 新任务页三胶囊 **全部命令 / 创建应用 / 我的应用** | 「创建应用」= 起一条预置 `create-app` 技能的新任务；「我的应用」= 面板切到应用列表 |
| 设置 › **应用** | 应用列表 + 详情子页（版本 / 组件 / 权限 / 数据），侧栏导航项 |
| 转录里的**应用卡片** | build 成功后出现：图标、名称、版本、摘要、类型检查提示 + 「打开」「版本历史」 |
| 输入区的**能力同意卡** | 应用首次用某能力时弹出（面板自动前置），允许 / 拒绝，**没有"仅一次"** |
| 任务历史的**来源标记** | `ctx.agent.run` 起的任务标「由 {{应用名}} 发起」 |
| **桌面固定**（拖卡片出面板 / 固定按钮） | 把应用或其组件钉到桌面 |

文案（`i18n/locales/{en,zh-CN}/apps.json`）：My apps / 我的应用 · Create app / 创建应用 · Continue editing / 继续编辑 · Updated {{date}} · v{{version}} / 更新于… · Waiting for permission / 等待授权。

### 1.3 应用详情子页

四个系统设置式分组卡片，各带一句脚注说明模型：

- **版本**：列表 + 每条「回退」；脚注明说「每次你提出的修改成为一个版本，无论中间 build 了几次；回退让旧版本重新成为最新，更新的版本仍列着」。
- **组件**：预览图（按 revision 取）+ 族与刷新周期；未声明则不显示。
- **权限**：逐能力一行（图标 + 开关），答过的还能"再问一次"（相当于忘记答案）；脚注明说「**存储与日志不需要权限**」。
- **数据**：清除数据 / 删除应用，各有二次确认；文案区分得很细——删除「应用、所有版本及其全部数据都会被删除，窗口也会关闭，无法撤销」，清除数据「应用保存的一切被移除、窗口关闭，应用与版本留下」。

---

## 2. 版本模型（它最独特的一条）

**一次请求一个版本**（2026-10-05 修订，起因是案例 837a9d48 首次创建就产生了 7 个版本；`plans/2026-10-03-create-app.md:104`）：

- 同一次 agent 运行里**第一个**成功的 build 发布下一个版本；之后同一运行内的 build **原地替换该版本的文件**（版本号不变，revision +1）。
- 其他运行、没有 runId 的 build、以及回退，各自产生新版本。
- 每次 build 有自己的、不再改动的目录 `versions/.rev-<k>/`；`versions/<n>` 是指向它的符号链接，发布 = 一次 rename。
- **`revision` 每发布一次 +1，`version` 只在运行边界变**。窗口重载、后端重启、组件渲染、图标缓存**都以 revision 为键**——因为"原地替换"时版本号不动，版本号当缓存键就会失灵（`apps.ts:22-29`）。
- **回退** = 把旧版本复制成新版本重新发布：历史不改写，**数据不回滚**（界面明说数据兼容风险，靠后端 `onStart` 的幂等迁移兜）。
- 保留最近 20 个版本（`APP_MAX_VERSIONS`，`packages/agent-contracts/src/apps.ts:35`）；**失败的构建什么都不发布**，返回 422 与全部错误。

---

## 3. 构建管线

工具链由服务提供：**agent 不跑包管理器、不写构建配置、不起服务**（`SKILL.md`「Shape of an app」段）。

- **staging 校验/拒绝**（`packages/app-kit/src/node/staging.ts:66-147`）：隐藏文件、`node_modules`、符号链接、可执行位、非普通文件；以及一切工具配置文件——`package.json`、锁文件、`vite/vitest/tailwind/postcss.config.*`、`tsconfig*.json`、`pnpm-workspace.yaml`；CSS 里的 `@plugin|@config|@source|@reference` 也拒。上限：总量 16 MiB、单文件 8 MiB、2000 文件（`staging.ts:15-17`）。拷贝时带 `O_NOFOLLOW` 复检防 TOCTOU。
- **构建在 Seatbelt 沙盒里跑，且构建器绝不执行 agent 的 JS**：Vite 配置由 app-kit 内联给出（`configFile:false`），插件只有 React、Tailwind 与模块策略（`builder/build.mjs:41-54`）。页面目标 `safari26`；后端走 SSR 构建成**单个 ESM**（`target node24`，`codeSplitting:false`，**所有包内联**——后端运行时根本不读 `node_modules`）。超时 120 s。
- **模块策略**（`builder/resolver.mjs`）：只允许相对文件、白名单包、清单声明的包、SDK 入口（后端另加 `node:` 内建）。页面用 `node:` 内建 = `import_not_allowed`；越界的相对/绝对导入 = `outside_app`。因为 rolldown/oxide/lightningcss 是原生插件、绕过 `--allow-fs-read`，另加一道**加载围栏**（`:164-173`）。
- **类型检查是原生 `tsc`，结果非阻断**（`src/node/typecheck.ts:179-184`）：版本照样发，只记诊断；卡片与版本文案提示「此版本仍可运行，可以让 Atd 修复」。
- **声明依赖（≤24）的安装纪律**（`src/node/deps/*`，本块最值得抄的部分）：
  - `npm install --min-release-age=3`——**只装发布满 3 天的版本**（钉住的 peer 走 `--min-release-age-exclude`）；
  - **锁文件先审计、后下载**（`deps/audit.ts:84-149`）：每条必须来自 registry、带 `sha512-` 完整性、非 link、无 `hasInstallScript`、非 `@atd` 域，≤600 个包；
  - 安装后再审计整棵树（`:187-235`）：无链接、无原生代码（`.node` 或 Mach-O magic）、包内 CSS 无 Tailwind 指令、≤256 MiB / ≤60000 文件；
  - `--ignore-scripts --no-audit --no-fund --allow-git=none --allow-remote=none --allow-file=none --allow-directory=none`，npmrc 每次重写成空；
  - npm 是 **app-kit 自带的锁版本**（`packages/app-kit/package.json` 的 `npm: 12.2.0`，不是用户环境里的）；
  - 依赖树内容寻址缓存（`apps/.cache/deps`），版本目录记下 `package.json` 与锁文件——回退/继续编辑用同一套依赖**可离线重建**，不用再解析。
- **React 版本冲突就地暴露**：`@types/react` 以工具链的精确版本钉在根 `peerDependencies`，让 React 范围不兼容的包直接 ERESOLVE 报错，而不是悄悄装第二份 React（`deps/declared.ts:49-69`）。
- **识别色在构建期算**（`src/node/theme.ts:135-180`）：保留色相、只在 OKLCH 里调亮度，直到识别色对页面 ≥3:1、其上的文字静止与悬停都 ≥4.5:1（玻璃上还要对白底与黑底两种桌面各算一遍）。

---

## 4. 运行时

### 4.1 后端进程（每应用一个）

```
/usr/bin/sandbox-exec -f <profile> <node> --permission \
  --allow-fs-read=<versionDir> --allow-fs-read=<runtimeDir> --allow-fs-read=<dataDir> \
  --allow-fs-write=<dataDir> <runtimeDir>/bootstrap.mjs <versionDir>
```

- cwd = 数据目录；**env 白名单只有 `LANG`/`TZ`/`ATD_APP_ID`**——绝不展开 `process.env`，绝不传 `NODE_OPTIONS`（T1 实测 `NODE_OPTIONS=--allow-fs-read=*` 能放宽权限，而用户 shell 里有 API key）。
- 写只限数据目录；**能出网，但碰不到 loopback**（含本服务）、unix socket、监听端口；禁子进程 / Worker / 原生插件；信号只能发给自己。
- **两层隔离缺一不可**（T1 最重的一条）：只有 `node --permission` 时，`node:sqlite` 的 open / `ATTACH` / `VACUUM INTO` / `backup()` 仍能越界读写，`process.kill` 也拦不住（`process.getBuiltinModule` 能拿到被拦的模块）；Seatbelt 补上这些。
- **启动前 fail-closed 自检**（`src/node/self-check.ts:24-97`）：先用真实 profile 跑探针，必须"界内 sqlite 写成功"且"界外写 / `ATTACH` / `kill(父进程)` 全被拒"，否则**一个后端都不启动**。
- 生命周期：懒启动（首次调用）；窗口全关后空闲 5 分钟停（只为渲染组件的 60 s）；发布新版重启；崩溃 60 s 内最多 3 次退避；服务重启不自动拉起。
- IPC：stdio `ignore,pipe,pipe,ipc`（fd 3），**单条消息 4 MiB**（超限丢包 + 写诊断 + 给等待方回错），api 默认超时 5 分钟、流式不限。
- **凭据与服务 token 永不进入子进程**：`ctx.ai/agent/memory/mcp/web` 全走父进程的能力代理。

**`ctx` 面**（`assets/atd-apps/product-skills/create-app/references/sdk.md` 是权威表）：

| 面 | 授权 | 要点 |
|---|---|---|
| `ctx.db` | 免 | `node:sqlite` `DatabaseSync`，`<data>/app.db` |
| `ctx.kv` / `ctx.files` / `ctx.events` / `ctx.log` / `ctx.widgets.reload` | 免 | kv 是键值 JSON；files 是**同步** API 且路径拒绝绝对/`..`/realpath 逃逸/符号链接 |
| `ctx.ai.generate/stream` | `ai` | 用用户已配置的 provider，凭据留在父进程 |
| `ctx.agent.run` | `agent` | 真的建一条任务（origin 标记应用），副作用照走用户授权门 |
| `ctx.memory.search/read/write` | `memory` | **`write` 未实现**，返回 `not_implemented` 并让它改用 `agent.run` |
| `ctx.mcp.listTools/callTool` | `mcp` | 需逐次审批的工具对应用直接拒绝（没有地方弹确认） |
| `ctx.web.search/fetch` | `web` | 复用 agent 的无密钥搜索与抓取 |

### 4.2 页面（应用窗口）

- 每个应用**一个独立 origin** `ai-userapp://<appId>/` + 独立 `WKWebsiteDataStore(forIdentifier:)`。**绝不放进渲染器的 iframe**——iframe 会继承 `ai-app://renderer` 源，等于拿到完整桥和带 token 的 relay（立项计划 :23）。
- **页面没有网络**：CSP 头 **加** 每应用一份 `WKContentRuleList`，**两层都要**（它实测任一层单独都不够：两层都关掉时，同 scheme 跨应用的 POST 能带着 body 到达处理器）。
- 导航锁：主框架只能停在自己的 origin、子框架一律拒、`window.open` 返回 nil、http(s) 外链经确认后交系统浏览器。
- **请求门不信任 `Origin`**（同源自定义 scheme 请求不带它）：改校验 `mainDocumentURL` + host + 写请求的 `x-ai-relay: 1`；**appId 一律取自窗口注册表，不取页面数据**。
- 二进制只能走 `ArrayBuffer`/`Uint8Array`/Blob 读成字节（WebKit 送来的 Blob/File body 是空的，实测），线上编码 `{"$atd:bytes":"<base64>"}`。
- 窗口表面两种：**glass**（`NSGlassEffectView` + 52 pt 统一标题栏；页面首行 `.atd-titlebar` 留 88 px 给红绿灯，顶部 52 px 非交互处即拖动区，由壳注入脚本算）/ **opaque**（传统窗口，页面自己画）。清单不写 `surface` 的应用（早期建的）保持 opaque。

---

## 5. 能力授权

五类：`ai` / `agent` / `memory` / `mcp` / `web`（`assets/atd-apps/contracts/app-identity.ts:41`）。**存储与日志不需要授权。**

- 声明在清单里，每项配一句 `purposes` 人话（≤300），同意卡上显示"应用为何需要"。
- **判定顺序**（`apps/agent-service/src/apps/capabilities/broker.ts:73-94`）：**没在清单里 → 直接拒，不问**；已拒 → 拒；没答过 → 弹同意并等（5 分钟超时）；否则放行。每次回复都按操作的输出 schema **再校验一遍**。
- 同意按**应用**记（不是按任务），落在 `app.json` 的 `grants`；可在设置里改；写 `null` = 忘记答案，下次再问。
- 撤销按请求生效（不杀正在跑的后端）。
- `agent.run` 与 `ai` 请求按**后台用途**跑，所以 ChatGPT 订阅连接还需要用户单独在设置里开"后台使用"权限——技能明说**不许程序化打开它**。
- 待答的同意在内存里（服务重启即失），会以 `AppSummary`/`AppDetail` 暴露给界面并触发 `apps` 失效。

---

## 6. 桌面组件与桌面固定

- 组件是**原生 SwiftUI 视图树，不是 HTML**：SDK 的 `w.*` 构造器 → TypeBox schema（`assets/atd-apps/contracts/widgets.ts`）→ 导出 JSON Schema → 生成 Swift Codable。
  - 词表：`vstack/hstack/zstack/spacer/divider/text/symbol/image/gauge/progress/date/list/chart/link`；颜色只用语义 token（`primary|secondary|accent|destructive|success|warning`，`accent` 即清单的识别色）。
  - 三族 `systemSmall/Medium/Large`；**刷新 15–1440 分钟**（15 是 WidgetKit 的地板，`WIDGET_MIN_REFRESH_MINUTES`）；快照 ≤64 KB、树深 ≤8、列表 ≤8 行、图表 ≤50 点、时间线 1–24 条。
  - 渲染器 `WidgetTreeView` 抽成独立 SwiftPM target，**扩展、Atd 内预览（`ImageRenderer`）、桌面固定件三处共用**——所以三处长得一样。
- **组件种类在编译期固定两个**（`AtdAppWidget`、`AtdLauncherWidget`）：chronod 只在扩展换版本或重新注册时重读描述符，按应用动态生成条目会**停在安装那一刻**（T1c 实测）。要配置的 `AppEntity`/`EntityQuery` 改从目录文件读应用列表。
- **数据通道是文件**：壳是唯一写者，写 `~/Library/Application Support/<壳 bundle id>/widgets/`（`catalog.json` + `snapshots/` + `images/` + `icons/` + `launcher.json`），扩展以沙盒 + **一条 `temporary-exception.files.home-relative-path.read-only`** 只读。
  - **不用 App Group**：ad hoc 签名下会被拒并弹"访问其他 App 的数据"，而 `group.` 前缀要 provisioning profile，会破坏它们的 ad hoc CI（T1b 把两种签名都验过：临时例外可用、不弹窗）。
- **桌面固定**：macOS 没有用代码添加 WidgetKit 组件的公开 API，所以**固定件是壳自己的桌面层 `NSPanel`**（`kCGDesktopIconWindow + 1`，不激活、跨空间、不可移动，自己判点击 / 拖动 / 缩放角），与扩展共用同一份快照文件和同一个渲染器，按声明族的区间自由缩放（**不缩放内容，重新排布**）。
- **宿主必须装在 `/Applications` 或 `~/Applications`**，否则 App Intents 元数据不被索引，组件永久占位、时间线以 `CHSErrorDomain 1103` 失败，而且**宿主收不到任何错误**。

---

## 7. 与 DeepDive 的对照

### 7.1 我们已经有的近亲：DUI-SPEC 的对话内 UI

| | Atd 个人小应用 | DeepDive 的 `ui`/`widget`/`embed` 围栏（`docs/DUI-SPEC.md`） |
|---|---|---|
| 产物 | **持久实体**（id / 版本 / 数据目录 / 图标） | 会话里的一次性渲染，随消息流走 |
| 生成物 | 一棵源码树 + 清单 + 构建管线 | 模型直接吐 JSON 数组（`ui`）或 HTML（`widget`） |
| 运行 | 独立窗口 + 独立 origin + 可选沙箱后端 + SQLite | 会话内联渲染；`widget` 是 `allow-scripts` 不透明源 iframe |
| 能力 | 五类逐项授权，deny-by-default | 桥四个上行动作（`sendPrompt`/`openLink`/`resize`/`error`）；`allow-same-origin` 结构性剥除 |
| 状态 | 版本 / 回退 / 跨版本共享的数据目录 | **快照语义**：`send` 即用户下一轮逐字发出的文本，组件状态不回传 |
| 存储 | SQLite + kv + files | 无（沙箱页连宿主 localStorage 都读不到） |

**定位不同**：DUI 是**表达**（把模型的话渲染成组件），Atd apps 是**交付物**（给用户一个能反复打开的工具）。两者不冲突，但共用同一句话术："让模型产出界面"——它是这条路的**重形态**。

### 7.2 同构点

两家都是 **Swift 壳 + 常驻 Node 服务 + 自建 React SPA** 三层（本仓 `docs/ARCHITECTURE.md` 逐项对得上），且它的 app 面几乎都能在我们现有结构里找到对应物：壳桥（我们 `host.ts` / `__deepDiveHost`）、relay（我们 `BridgeServer`）、按应用分发的静态资源与 API 转发、设置窗口分区、转录内卡片、能力授权（我们审批卡 / 权限档）。血统上两家还是同源两级派生（`HANDOVER.md §2`）。

### 7.3 关键差异

- **我们没有"应用"这个实体**：无源码树、无构建管线、无每应用后端、无每应用存储与授权、无桌面组件与固定件。
- 我们的 widget 是**网页沙箱**；它的组件是**原生视图树**（schema → codegen → 共享渲染器）。
- 我们的模型产物只有会话内的 DUI；它有一条从「对话生成」到「持久应用」的**完整链路**（创建 → 构建 → 版本 → 回退 → 数据 → 组件 → 固定）。
- **一处语义要注意**：`SPEC-SEMANTICS` 里「❌ 不做应用启动器/计算器/翻译等非 agent 功能」（:84、:200）指的是**启动别的 app**，与 Atd 的"生成应用"不是同一件事；但真要往这条路走，这条语义需要重新讨论——那是产品语义层的决定，不是技术洁癖（同表 D14 那次拍板的性质）。

---

## 8. 借鉴提案（**提案态：未采纳；采纳与否需用户拍板**）

| # | 提案（精炼） | 依据（Atd） | 我们的落点 | 价值评估 |
|---|---|---|---|---|
| 1 | **能力授权三件套**：清单声明 + 一句 purposes + **未申报直接拒、不问** + 按应用记答案可撤销、答过的可"再问一次" | `app-identity.ts` / `consents.ts` / `broker.ts:73-94` | 我们已有的权限档与审批卡（`SPEC-SEMANTICS` 权限胶囊） | **高**——把"能不能做"从提示词约定变成结构 |
| 2 | **模型产物一律"一层沙箱 + fail-closed 自检"**：启动前跑探针，越界没被拒就一个都别启动 | `src/node/self-check.ts:24-97` | 任何"将来要跑模型产物"的决定 | **高**，思路优于"假设沙箱生效" |
| 3 | **供应链接管纪律**整段照抄：只装发布满 3 天、锁文件先审后下、装后再审树、不跑安装脚本、禁 git/file/remote 源、原生代码直接拒、自带锁版本 npm、npmrc 置空、把 React 版本钉在根 peer 让冲突原地暴露 | `src/node/deps/*` | 同上 | **高**（防投毒），且是可直接复用的工程量 |
| 4 | **"一次请求一个版本 + 用 revision 当缓存键"** 的版本语义（原地替换时版本号不动，缓存键必须另设） | `versions.ts` / `publish.ts` | 若我们将来有持久产物（DUI 的进阶形态 / 导出） | **中** |
| 5 | **原生视图树 + schema→codegen + 单一渲染器三点同源**（扩展 / 内预览 / 桌面固定件长得一样） | `contracts/widgets.ts` + `AIWidgetRender` | 我们的通知面 / 浮层若要做组件 | **中** |
| 6 | **桌面固定的务实解法**：没有公开 API 就用桌面层窗口画，与系统组件共用同一份数据与渲染器 | `AIShell/DesktopPins/` | 我们若做桌面 / 浮层信息面 | **中** |
| 7 | **"生成物必须长得像它自己"** 的强制纪律：识别色是唯一来源、构建期按 WCAG 调亮度、图标用识别色画、布局从用途来、每个示例用不同布局避免都教同一种 | `references/starter.md` / `example.md` / `theme.ts:135-180` | 与 `UI-SPEC` 同族，可作 DUI 组件的生成指引 | **中** |

**明确不借**：

- **Seatbelt 沙箱**——Apple 已标弃用、profile 基于路径；它自己把它列为首要风险并要求每次系统升级重跑探针（`plans/2026-10-03-create-app.md:648`）。我们另有引擎与壳，不引入。
- **shadcn/Rhea 预设组件库**——与我们"组件 = 类名配方"定稿冲突（同 `HANDOVER.md §4` 不借项）。
- **每个应用一个独立 `.app`**——它自己也定成子窗口（Q3）。
- **应用商店 / 发布审核 / 积分 / Remix**——它的非目标，我们更不是目标。

---

## 9. 踩坑（它实测出来的、对任何碰 macOS 桌面组件的人都值钱）

- **宿主不在 `/Applications` / `~/Applications`** → App Intents 元数据不被索引，组件永久占位、时间线以 `CHSErrorDomain 1103` 失败，**宿主收不到任何错误**（T1b）。
- **沙盒扩展不能从 `~/Documents` 下启动**（secinitd 拒读可执行文件）；而 xcodebuild 会把产物注册到 LaunchServices，chronod 可能去启动 `~/Documents` 里那个扩展并反复崩溃（`Invalid bundle record for current process`），Atd 从组件库消失直到 chronod 重启。→ Debug 构建把扩展塞进 macOS 不扫描的 `Contents/PlugIns/DevStaging`，只有**安装副本**才放回 `PlugIns` 并重签（`dev-install.mjs`，T1c）。
- **chronod 只在扩展换版本/重新注册时重读组件描述符**；`recommendations()` 在 macOS 上无效（Apple 文档：只用于 watchOS）；`lsregister -u/-f` 是唯一观察到有效的触发手段，但依赖未公开工具，它们**没用**（T1c）。
- **App Group 在 ad hoc 签名下不可用**（会弹"访问其他 App 的数据"），`group.` 前缀又要 profile → 破坏 ad hoc CI；临时例外只读路径两种签名都行、不弹窗（T1b）。
- **同源自定义 scheme 请求不带 `Origin`，也别指望 `Content-Length`**；请求门要换锚点（`mainDocumentURL` + host + 自定义头）（T1）。
- **WebKit 送来的 Blob/File body 是空的**，FormData 文件与流式上传同理；二进制要自己读成字节（T1）。
- **CSP 与内容规则表各自都不够**，要同时上（T1）。
- **没有 web view 时调 `WKWebsiteDataStore` 的静态 API（`remove` / `fetchAllDataStoreIdentifiers`）会段错误**；打开 web view 会重建 store，所以"清除数据"不能靠打开页面来做；`remove` 是异步的，要带退避重试并持久化待删列表（T1 + `UserAppStorage.swift:108-128`）。
- **模型写的 SVG 图标不当场解析**：壳只拷字节、以离屏 WKWebView 栅格化（JS 关、非持久 store、`default-src 'none'`）；扩展侧先做字节检查（大小、必须以 `<` 开头、不得含 `<!ENTITY>`）再用 AppKit 解。

---

## 10. 它自己记下的缺口与风险（引用即可，不代表我们的判断）

- **沙箱碰不到本机 —— 这是它公开的最大缺口**。能力层计划（`assets/atd-apps/plans/2026-10-06-app-capability-layer.md`，**Draft、未授权实现**）的起因是一条「各个软件的音量控制器」任务：agent 正确判断出 app 碰不到本机、手里没有真路，只能给三个模拟或间接选项，任务在提问上等了 1121.8 s 被停。它的结论是做**统一能力层**（一张注册表、一份模块契约、一个能力代理，按使用方套策略），并让运行方式（常驻/按需）、界面（窗口 / 浮层面板 / 菜单栏 / 组件 / 通知）、触发（热键 / 定时 / 模块事件 / 打开文件）由清单声明。**该计划未实现。**
- Seatbelt 被 Apple 标弃用且基于路径，未来 macOS 可能改行为 → 要求每次系统升级重跑探针。
- 供应链接管：`--allow-addons` 意味着工具链依赖一旦被投毒，就能在允许范围内跑原生代码。
- **体积**：工具链约 143 MB + 原生 tsc 30 MB ≈ Release 增加约 170 MB（立项时的账：618 MB app / 421 MB dmg）。
- 依赖天花板：首版固定依赖集，后来才放开到"≤24 个声明依赖且只装发布满 3 天的"。
- 回退不回滚数据 → 靠后端 `onStart` 幂等迁移兜。
- 成本：应用内 AI/agent 调用消耗用户模型额度；首版只做同意与撤销，**不做额度上限**。
- 生成质量：空白或打不开的应用是 Glaze 排障的头号问题 → 靠构建期类型检查、`app.call` 自测、diagnostics 回流缓解。

---

## 11. 未核 / 待补

- 组件数每应用的上限（未取到常量）。
- `memory.write` 的 `not_implemented` 是永久设计还是暂时缺（代码只说记忆权威没有"运行外写入"入口，无文档表态）。
- 应用窗口的默认尺寸常量在服务/清单侧，未读到具体值。
- 它自己的 T10（验证）在计划里标记「结果未记录」。
- 能力层计划只读到「设计与现状」段，其「迁移」与「交付」段未通读。
