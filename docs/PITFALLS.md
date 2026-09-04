# DSHmini 踩坑记录（必读）

本文件记录开发本客户端时踩过、且**极易复发**的坑。每条都来自真实事故，先读这里再改对应代码，避免重蹈覆辙。

---

## 1. WebKit 的 CSS 陷阱（反复踩）

### 1.1 `border-radius: 999px` / 巨大圆角会触发合成伪影
- 症状：用户气泡/卡片渲染成"超大圆角椭圆/大圆圈"，无论怎么改样式都消不掉。
- 根因：WebKit 对超大 border-radius 做 layer 合成时产生怪异几何。
- 处置：**圆角用安全值（24px），不要用 999px**。需要用"胶囊"时用接近的高度值（如 24px）而非无穷大。

### 1.2 `*::selection` 全选会渲染整块圆角
- `::selection` 加 `background:transparent` 只对 `.flow` 内生效，遗漏会全选成色块。
- 处置：需要选中透明的地方逐层加（`.flow ::selection`, `.md ::selection`, `.agent-message ::selection`）。

### 1.3 backdrop-filter 在 WebKit 需 `-webkit-` 前缀
- 只用 `backdrop-filter: blur(...)` 在 WebKit 不生效（悬浮菜单模糊失效）。
- 处置：**白名单化**——只对需要的元素加 `-webkit-backdrop-filter` + `backdrop-filter` 双前缀，其余保持无 blur（避免全局 blur 导致性能/视觉污染）。

### 1.4 CSS 选择器未闭合粘连
- 症状：一条规则没写完（如注释把选择器截断），会把 `.flow *` 这种通配规则吞进来，导致某类元素整体被改样式。
- 事故：`.flow *, /* comment */ .user-bubble {…}` → `.flow *` 吞了 user-bubble 样式，agent 每段变卡片。
- 处置：改 CSS 后**先 grep 目标选择器在 dist css 里出现几次 / 是否被合并**，再截图。

### 1.5 壳注入 CSS（WebViewTheme）与前端样式层
- 自建 SPA 的样式唯一事实源是 `frontend/src/theme.css`。壳级 `WebViewTheme` 只保留 `html/body` 透明（vibrancy 依赖；`color-scheme` 由前端 `theme.css` 声明 `light dark`，外观三态跟随）；曾在其上叠的 `--dsw-alias-*` token 覆盖是官方 UI 套壳时代的遗物，SPA 零引用，已清除。**不要再往 WebViewTheme 加样式**。

### 1.6 flex 嵌套"百分比宽 input"在 WKWebView 塌缩成细条
- 现象：`.fieldRow{display:flex}` 里套 `<div style={{flex:1}}><input style={{width:"100%"}}>`，WKWebView 实测把兄弟列压成 ~12px 细条且相互重叠（用户截图"编辑栏都重叠了"）；同结构在 Chrome 正常。
- 处置：这类"标签+输入"并排字段直接用 **grid**（`grid-template-columns: 1.2fr 1fr 110px` + input `width:100%`），见 ModelDialog 的 `fieldGrid`；不要用 flex 子项嵌百分比宽表单控件。

### 1.7 body 级 portal 浮层（position:fixed）双坑：类遗留 top 双约束 + React 事件沿 React 树冒泡
- **定位**：Dropdown 菜单 portal 到 body、内联 `position:fixed`，但 `.ddMenu` 类自带 `top: calc(100% + 4px)`（absolute 时代遗留）。内联只设 `bottom`（向上翻转分支）时类里的 `top` 仍然生效，top/bottom 双约束把菜单压成视口底边外一条 10px 细条——表现就是"下拉没法点击"（提供方 39 项必然翻转中招；项数少走 top 分支所以语言下拉正常）。翻转分支必须显式 `top:"auto"` 并 `right:"auto"`；长清单再加 `max-height` 内滚（settings/controls.tsx）。在真实 DOM 里量 rect + 读内联 style（bridge URL + 浏览器驱动）一次就能钉死，别靠截图猜。
- **事件**：React portal 的点击沿 **React 树**冒泡，不沿 DOM 树——菜单在 DOM 上挂 body，选中项的点击仍会路过组件树上的 modal overlay；overlay 用 `onClick` + `.modal` 上 DOM 级 `stopPropagation` 拦不住（选提供方第一下整个弹窗就被关掉）。modal"点空白关闭"必须用 `onMouseDown` 且判 `e.target === e.currentTarget`。

### 1.9 React 内联 style 静默丢弃 `maskImage`（vendor 属性）
- 现象：`style={{ maskImage: url(...), WebkitMaskImage: url(...) }}` 渲染后 style 属性里两个键**都不存在**（width/height 等正常写入），computed mask 为 none——只在部分页面状态/内核组合下出现，极难从源码看出。
- 处置：**不要用内联 style 传 mask**——① 优先 `?raw` 内联 svg（根节点自带 `fill="currentColor"`，颜色随主题）；② 需要 mask 时经 CSS 变量传递（`style={{ ["--mask" as string]: url(...) }}` + 类内 `mask-image: var(--mask)`），并在真实引擎里读 computed 验证（`getComputedStyle` 的 `backdropFilter`/`maskImage` 在 Chromium 读标准属性、WebKit 读 `-webkit-` 别名，两个都要看）。

### 1.8 弹层模糊被全局 `*` 禁用核弹 + 压缩器 -webkit 合并静默杀掉
- 旧方案：`* { backdrop-filter:none !important }` 全局禁用 + theme.css 白名单类（!important）恢复。两个死法：① CSS module 里的弹层类（如设置 `.ddMenu`）无法进 theme 白名单，自带 blur 不带 `!important` 就被 `*` 压掉；② 压缩器（lightningcss）把同规则内"标准 + `-webkit-`"属性对合并成**只剩 `-webkit-`**，Chromium 系内核不认 `-webkit-backdrop-filter` → 模糊静默失效，且 `getComputedStyle().backdropFilter` 读标准属性会误报 none/正常，测量时两个都要读。
- 处置（2026-09-04）：**全局核弹已删**——弹层统一自带标准 `backdrop-filter: blur(40px) saturate(160%)`（macOS 26 WebKit 支持无前缀），材质统一 `var(--panel-strong)`（.92 毛玻璃，比 .78 实、比 .97 有玻璃感）；**勿恢复全局禁用**，新增弹层自带 blur 即可。`.flow *` 的禁用保留（消息流合成隔离用途，弹层均不挂在 flow 内）。

---

## 2. 引擎事件载荷（反复踩）

### 2.1 assistant 内容在 `data.chunk.text` / `data.message.content`，不是 `data.text` / `data.content`
- 事故：assistant 回复全部渲染为空。根因：`textOf` 读 `event.data.text` / `event.data.content`，而引擎放在 `data.chunk.text`（流式）与 `data.message.content`（完整）。
- 处置：**先 dump 真实事件 JSON** 再写解析；类型化到 `types.ts` 的 union 里（见 2.3）。

### 2.2 unary `rpcId` 必须是 string
- 用了 number 会返回 `invalid-request`（`bad-request / invalid client-request message`）。
- 处置：`crypto.randomUUID()`。

### 2.3 事件应有可辨识联合，不要 `data: any`
- 官方 `SessionEventMap` 是 union，`switch (event.type)` 直接收窄 `data`。我们用 `data:any` 导致到处 `as any`，靠运行时试错才找到字段位置。
- 处置：`types.ts` 里 `SessionEvent` 改为按 type 分发的 union；已知 case 用窄化守卫（引擎载荷以 `as` 到具体类型，因 union 尾部 catch-all 为 `unknown`，`as` 是安全收窄非散落 `as any`）。
- 注意：union 里若保留 `{ type: string; data: unknown }` 兜底项，`switch (event.type)` **无法**对已知 case 自动收窄 `data`——需在每个 case 内显式 `as`。

### 2.4 注入上下文也是 `user/message`（source.kind=plugin/skill-catalog）
- 引擎把运行时上下文（`source.kind:'plugin'`, 467 字符）与技能目录（`source.kind:'skill-catalog'`, 15405 字符 `<system-reminder>`）作为 `user/message` 广播。
- 事故：全被渲染成右对齐大气泡，旧会话回放时满屏巨型卡片。
- 处置：`user/message` 只对 `source.kind === 'user'`（真正用户输入）渲染气泡；注入消息（plugin/skill-catalog/agent-instructions/goal…）**不渲染**（2026-09-04 用户拍板：注入折叠行也已整体移除，事件直接丢弃； Pitfall 本体=它们绝不能渲染成右对齐大气泡）。

---

## 3. 消息流（多 step / 乱序 / 重复）

### 3.1 assistant/message 替换 chunk 时不要回接被替换的 tail
- 事故：多 step turn 里消息穿插错位（"1. 总结"跑到"计划如下"前面）。根因：`out.push(...pushed, ...tail)` 把被替换的旧 chunk 又接回。
- 处置：被 `assistant/message` 取代的 chunk 应**丢弃**，只推入最终 blocks。

### 3.2 Think（reasoning）在同一 assistant 容器内渲染一次，不要拆两遍
- 事故：Think 行重复出现。根因：reasoning 既在 `assistant/message` 里被拆成独立 `think` item，又由 `Item` 的 assistant 分支用 `blocks.think` 再渲染一次。
- 处置：官方 `AssistantMarkdown` 把 reasoning 和 text 放**同一容器**。`assistant/message` 不再生成独立 think 项，统一由 assistant block 渲染。

### 3.3 整窗扫描找 tool-call → 违背官方"热路径不扫描窗口"
- 事故：`ingest` 里 `out.find(x => x.kind==='tool-call' && x.toolCallId===callId)` 扫描整条数组；官方明令"append 热路径不得遍历完整事件窗口/Context/Node 集合"。
- 处置：用 **Map<callId, index>**（`callIndex`）+ **Map<callId, path>**（`callPaths`）O(1) 索引。

### 3.4 turn-tail 用 index 定位会因 splice 错乱
- 事故：多 turn 时 turn-tail 跑到数组开头/中间。根因：`finalizeTurns` 用 `assistantIndex.get(turn)` 记录的 index，先前 turn 的 `splice` 插入使后续 index 全部偏移。
- 处置：**按 turn 边界从左到右扫描**，在该 turn 最后一项后插入 tail；不依赖会变的绝对 index。空 turn（无任何 item）不发 tail（官方也无内容可挂）。

### 3.5 全量重放比增量 push 更健壮
- 直接对组件内 `RenderItem[]` 增量 push 时，history 与 mux 双路径有 seqFloor 竞态（history 返回前 mux 帧先进 store）。
- 处置：**eventLog 缓存全量事件（按 seq 升序）+ 每次 rebuild 从全量 ingest**。日志天然升序、乱序/重复由"严格递增守卫"规避。mux 帧 seq ≤ log 末尾则丢弃。

---

## 4. Engine / 壳端

### 4.1 独立 harness home 需自带 `.credentials.yaml`
- 事故：`DSH_HOME` 指向独立 harness home（现为 `~/Library/Application Support/DeepDive/harness`；改名前 `…/DSHmini/…`，首启动已自动迁移），无 `~/.dsh/.credentials.yaml` → LLM 每轮返回**空回复**（assistant 文本为空），且无报错。
- 处置：`EngineSupervisor.start()` 前**断言凭据存在**，缺失即 `state = .failed(...)` fail-loud，不再静默空引擎；恢复屏提供「配置 API Key / 从 ~/.dsh 导入凭据」，配好自动重启（冷启动闭环）。

### 4.2 mux 帧是 `server-request` wrapper，需解包 `payload`
- `frame = (raw.payload) || raw` 解包正确；帧类型在 `payload.type`（session/event / approval/requested …）。

### 4.3 标题栏拖拽是「穿透 hitTest + JS rect 表」的双端契约
- 架构：webview 对顶部 52px 条带内的**空白**返回 nil（穿透到下层 TitlebarDragView 拖窗），按钮区返回自身可点；「哪里是按钮」由前端 `titlebar.ts` 每 300ms + resize/transitionend 推送全量 rect 表（CSS 视口坐标，y-down），壳端在 hitTest 时用**实时 bounds.height** 换算。
- 曾用「didFinish 时一次性采样固定选择器（.window-top-btn）」：收起边栏按钮位移/窗口 resize 后 rect 全错，`.session-header .model` 不在选择器里被整条吞掉 → 误触/按钮失灵。
- 铁律：① strip=52 与 rectPadding 双端常量必须同步（titlebar.ts ↔ MainWindowController）；② 壳端 **fail-open**（没收到 rect 表前不穿透不吞点击），收到前整条可点、不可拖是预期行为；③ 改动顶层布局（window-top/session-header）必须在壳内实测按钮可点 + 空白可拖。

### 4.4 FileHandle.readabilityHandler 在 EOF 会忙等
- 引擎进程退出后 availableData 恒为空；handler 不置 nil 会被反复空读调用（CPU 空转）。空数据分支必须 `handle.readabilityHandler = nil`。

### 4.5 桥的 Origin 校验必须 scheme+host+port 全等
- 曾用 `hasSuffix(":\(port)")`：任何恰好同端口的其他站点（`http://evil.com:5000`）都能过闸；WebSocket 握手不受 CORS 限制，对方页面可读走整条会话事件流。必须是 `origin == "http://127.0.0.1:\(port)"`。

### 4.6 alpha.2 引擎 wire 契约（实测 0.1.2-alpha.2 内嵌 runtime，换引擎必查）
- **HTTP unary 面没有删**：`POST /api/<点号方法>`（`/api/session.list`）+ envelope `method` 必须与路径派生名一致（点号），payload 为**扁平参数**（`session.prompt` = `{sessionId,mode,content}`；`session.history` 的翻页锚叫 **`beforeSeq`** 不是 `atSeq`）。曾把点号转斜杠探测 → 404 → **误判 "HTTP 面已删"** → 整个前端切到 `/api/remote.mux` —— 而该引擎**根本没注册这个升级路由**（只有 `/api/events.mux`、`/api/events.host`，未注册路径直接 destroy socket）→ 所有 RPC 静默失败（表现为"发消息没反应"）。
- **信任闸里没有 cookie/token**：`isTrustedApiRequest` 只查 Host 回环 + `sec-fetch-site` + Origin==Host。alpha.2 的 `dsh web:` 打印 URL **不带 token**（`localWebUrl` 就是裸回环地址），EngineAuth 的 cookie 交换无害但非必需。
- 判定接口面用引擎源码：内嵌 runtime 的 `node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js` 的 `UNARY_ROUTES` 是**全部** HTTP 方法的权威清单（含每个 payload 的 zod schema），不要靠猜。

### 4.7 主窗口大圆角来自「可见的空 NSToolbar」（删掉/隐藏即退回小圆角档）
- macOS 26 (Tahoe) 窗口圆角分两档（本机 26.5 截图实测，2x 拟合）：纯标题栏窗口 ≈16pt；**带可见 toolbar 的窗口 ≈26pt**（连续曲率，WindowServer 裁切，与 Finder/Notes 同款）。`toolbar.isVisible = false` 也会退回小档。
- DSHmini 标题栏整个画在 web 层，壳里那个 `NSToolbar`（`EmptyToolbarDelegate`，0 item）唯一作用就是**把窗口选进大圆角档**：`titlebarAppearsTransparent` 让它不可见、0 item 不交互，空白条 hitTest 与无 toolbar 完全一致（实测）。副产物：挂上后红绿灯默认中心线 16→26pt，恰好等于前端 26px 头部中心线，`alignTrafficLights()` 成为 no-op 兜底。
- 铁律：不要"清理"这个空 toolbar；前端圆角阶梯以 26 为锚（tokens.json v5 `radius.window`，`.main` 18 = 26−8 同心）。改动后必须截图自检圆角档位（对比 Finder 窗口角）。

### 4.8 每次重打包 = adhoc 签名变化 → TCC 授权重置、启动弹系统授权框
- `make package` 每次重签 bundle，macOS 按（code signature, bundle id）记 TCC 授权，签名一变「文稿访问」等授权全部重置：启动即弹"DeepDive 想访问文稿"系统框，**模态挡住应用初始化**（表现为 AX 查不到窗口/菜单栏、状态项缺失，像启动失败）。
- 处置：预期行为，点"允许"即可，不是回归；自动化验证前先确认没有授权框挡着。

---

## 5. 版本角标 / 交付自检

### 5.1 角标必须是构建时烘焙的真实 git SHA
- 曾发生角标显示非本仓库的假 SHA（"58ecf97 之谜"），用户据此判断"不是你要的版本"。根因：角标硬编码。
- 处置：`vite.config.ts` 用 `define` 烘焙 `git rev-parse --short HEAD`，Sidebar 渲染 `v-{__DSH_BUILD_SHA__}`。角标永远等于真实构建 SHA。
- 交付前用 `grep -o "v-<sha>" dist/assets/index-*.js` 核对。

### 5.2 验收对象必须是 .build/release 最新包——Debug 实例会混入
- `xcodebuild test` 会产出 `.build/debug` 的 Debug app；它可能被 launchd/误点启动，**内嵌前端是旧的**，在它上面调试/验收会看到与最新代码不符的行为（2026-09-04 事故：快捷键轮在 Debug 残留实例上测，行为对不上源码）。
- 处置：验收前 `pgrep -f DeepDive.app` 核对路径含 `.build/release`；发现 Debug 实例直接杀掉换最新 Release 包。

### 5.3 交付前必截图自检（WORKING-AGREEMENTS）
- 改完样式/渲染 → 构建 → 打包 → 启动 → 用 Playwright（channel chrome headless 打开 bridge URL）截图，核对：消息流居中、无卡片、tool 行/产物/turn-tail/meta 位置、用户消息右对齐等。
- 只改用户指出的项；不质疑用户、不拿"旧实例"当借口。

---

## 6. 调试技巧

### 6.1 抓真实事件流
先 `curl engine/session.history` dump 事件再写解析；用 `python3 -c` 提取 `tool/call`、`assistant/message`、`turn/*` 的真实 `data` 形状。

### 6.2 Playwright 打开 bridge URL 做 DOM/交互验证
```js
import { chromium } from '/opt/homebrew/lib/node_modules/playwright/index.mjs';
await chromium.launch({ channel:'chrome', headless:true });
await page.goto(`http://127.0.0.1:<bridge>/?sid=<sid>`, ...);
```
- 用 `?sid=` 深链打开指定会话（store boot 支持）。
- eval 读取 `.flow-inner > *` 的渲染顺序/`turn-tail`/`produced-file`/`load-older` 等，截图验证。
- 必须装浏览器：`npx playwright install` 或复用系统 Chrome（`channel:'chrome'`）。
- **tab.reload/页面刷新后 evaluate 的 JS realm 会换新**：`new MouseEvent/Event/HTMLInputElement.prototype` 等构造器要用 `document.defaultView.*` 取页面自己的，用注入侧旧 realm 的构造器会抛 `Illegal invocation`（2026-09-04 快捷键验证踩过）。构造 React 输入事件用原生 value setter + input 事件的标准组合。

### 6.3 后台 subagent 在此环境会静默失败
- 观察：`subagent`/`subagent_fork` 后台多次启动后 `failed before it finished. No closing message.`
- 处置：需要委派时用**前台等待**（`run_in_background:false`），或改为本人直接读官方源码对比。

---

## 7. 引擎跨版本协议断裂（P2 实测，2026-08-31）

### 7.1 alpha.2 两大破坏：mux 改名 + cookie 鉴权 + unary RPC 移除
- **mux 端点改名**：rc.2 = `ws://…/api/events.mux`；alpha.2 = `ws://…/api/remote.mux`（Gateway-owned WS mux，unary RPC 也走它）。
- **浏览器鉴权强制**：`dsh web:` 打印的根 URL `?token=` 只用于 `GET /` 换**签名 cookie**（303+Set-Cookie，绑定 Host authority）；之后所有 `/api` 只认 cookie，token 放在 `/api` 路径上**无效**。无 cookie 的 unary `/api/<method>` 在 rc.2 直通、在 alpha.2 回 401 "unauthorized"；再往上 alpha.2 的 unary RPC 干脆不存在（全部 404 "not found"，官方 web 客户端走 remote.mux 流）。
- **处置**：壳侧 `EngineAuth` 每次引擎就绪先做 token→cookie 交换，`BridgeServer` 两跳（unary+WS upgrade）、`EngineGateway`、`EngineEventObserver` 统一注入 Cookie；观察器 mux 路径按候选表自适应（events.mux → remote.mux）。**引脚保持 rc.2**（SPA 的 unary 协议面成立），升 alpha.2 前必须先把前端 RPC 层移植到 mux 流协议。

- **✅ 已解决（2026-08-31 协议移植完成，引脚切 0.1.2-alpha.2）**：unary HTTP 仍在但形状变了——endpoint 斜杠形 `/api/settings/describe`（点形 404）；信封不变（client-request）；**payload 必须包成 `{args:{…具名参数}}`**。`remote.mux` 只承载流方法与 `$events` 事件流（unary 开流被拒 `gateway/signature-invalid`）。前端传输层 `settings/models/mux.ts` + `api.ts` 探测自动切；BridgeServer WS 盲转发扩展 `/api/remote.mux`；观察者在 remote.mux 上开 `$events`。嵌套依赖漂移（pin alpha.2 拉 dsh-session alpha.3）在同 prerelease 段内警告放行（`DSH_STRICT_NESTED=1` 恢复拒绝）。**embed 必须在实例停止后执行**——覆盖运行中的 node/引擎文件会被 SIGKILL（自检/启动全 137）。
- 判定代码：`dsh-client-connection/lib/index.js` 的 `BrowserAuth`（`requestRejection` 403/401 分级、`authorizeIndex` 换 cookie）、`dsh-api-gateway/lib/index.js:11` `REMOTE_STREAM_MUX_PATH = "/api/remote.mux"`。
- **↩️ 后续回退（c590653，现行状态）**：引脚**回退 0.1.1-rc.2**——alpha.2 的 UNARY 面实测不可用。`api.ts` 回到点形 endpoint + 扁平参数 + `events.mux` 下行，同时保留 beforeSeq/atSeq 映射与能力探测，两版兼容；上面的 alpha.2 记录留作下次升级的对照清单。引脚现值永远以 `scripts/dsh-runtime-version.txt` 为准。

### 7.2 引擎并存的第二实例会被单实例锁拦掉（exit 0 无声）
- main.swift 的 flock 单实例守卫：已有一份 DSHmini 运行时，第二个直接 `exit(0)`，无任何输出——测试新构建时极易误判"app 秒退"。
- 处置：`DSHMINI_SUPPORT_DIR=<dir>` 隔离支撑目录（P2 新增 dev 钩子），或先退掉运行中的实例。

### 7.3 settings.describe 的真实 namespace 图谱（rc.2 实测）
- `agent-default-model` = `{provider, model, reasoningEffort}`（对象，不是字符串）；`permission` = `{defaultPreset}`；`ui-theme` = `{preference}`——**都不是以 ns 名直接存标量**，写值要 `settings.update(ns, patch=整值改路径, expectedRevision)` 或 mutate ops 指向子路径。
- 凭据 ref 名从命名空间的 `apiKeyEnv` 字段发现（如 `llm-deepseek.apiKeyEnv = "DEEPSEEK_API_KEY"`），不要按 provider id 拼猜。
