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
- 处置：只对需要的元素加双前缀（`-webkit-backdrop-filter` + `backdrop-filter`，`-webkit-` 固定在前），其余保持无 blur；压缩器合并顺序坑与现行材质口径见 §1.8。

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
- **第二个实例：模型菜单（`ModelMenu`）**。它当初是 `.left` 里的 `position:absolute; top:45px; left:-6px`，右侧边栏的会话设置里只能退化成"内联展开"——菜单把下面的分区顶下去（用户报告"点下拉内容都下移了"）。现统一成同一配方：portal 到 body、`.model-menu` 改 `position:fixed`（类里不再留 top/left，全部内联）、`z-index:1100` 与 `.ddMenu` 同层。两处要点：① 定位要**先量触发器再画**（`useLayoutEffect`），否则首帧闪在左上角；② 外部点击判定要把**触发器**也算内部（`anchorRef.current.contains`），否则 mousedown 先关、click 再开，看着像"点不动"。

### 1.9 React 内联 style 静默丢弃 `maskImage`（vendor 属性）
- 现象：`style={{ maskImage: url(...), WebkitMaskImage: url(...) }}` 渲染后 style 属性里两个键**都不存在**（width/height 等正常写入），computed mask 为 none——只在部分页面状态/内核组合下出现，极难从源码看出。
- 处置：**不要用内联 style 传 mask**——① 优先 `?raw` 内联 svg（根节点自带 `fill="currentColor"`，颜色随主题）；② 需要 mask 时经 CSS 变量传递（`style={{ ["--mask" as string]: url(...) }}` + 类内 `mask-image: var(--mask)`），并在真实引擎里读 computed 验证（`getComputedStyle` 的 `backdropFilter`/`maskImage` 在 Chromium 读标准属性、WebKit 读 `-webkit-` 别名，两个都要看）。

### 1.8 弹层模糊被全局 `*` 禁用核弹 + 压缩器 -webkit 合并静默杀掉
- 旧方案：`* { backdrop-filter:none !important }` 全局禁用 + theme.css 白名单类（!important）恢复。两个死法：① CSS module 里的弹层类（如设置 `.ddMenu`）无法进 theme 白名单，自带 blur 不带 `!important` 就被 `*` 压掉；② 压缩器（lightningcss）把同规则内"标准 + `-webkit-`"属性对合并成**只剩 `-webkit-`**，Chromium 系内核不认 `-webkit-backdrop-filter` → 模糊静默失效，且 `getComputedStyle().backdropFilter` 读标准属性会误报 none/正常，测量时两个都要读。
- 处置（2026-09-04）：**全局核弹已删**——弹层统一自带标准 `backdrop-filter: blur(40px) saturate(160%)`（macOS 26 WebKit 支持无前缀），材质统一 `var(--panel-strong)`（.92 毛玻璃，比 .78 实、比 .97 有玻璃感）；**勿恢复全局禁用**，新增弹层自带 blur 即可。`.flow *` 的禁用保留（消息流合成隔离用途，弹层均不挂在 flow 内）。
- 补充（2026-09-05，配方组实测）：合并删哪个**取决于顺序**——标准属性在前、`-webkit-` 在后 → 标准被删只剩 `-webkit-`（配方组七浮层 Chromium 预览因此长期无模糊）；`-webkit-` 在前、标准在后 → 双双保留（lightbox 因顺序相反逃过）。**双前缀固定 `-webkit-` 在前**，改完 grep dist 确认两条都在。

### 1.10 transform 动画 `fill: both` 让弹层祖先成为常驻堆叠上下文 + backdrop root
- 事故（两起同型）：会话入场动画上在 `.left`（ModelMenu 祖先）→ 菜单 z50 被困其内、被 `.flow`（isolation、DOM 靠后）整体盖住，磨砂只能采到 `.left` 自身绘制（=空）——合成「菜单纯透明」；`hero-title` 的 row-in 同理把 ProjectMenu(z60) 困住、被 composer 区「标准模式」胶囊盖住。
- 处置：**弹层的祖先不做 transform 动画**（挪到无弹层的子行，如 `.title-row`）；必须用时 `fill: backwards`（结束即摘除，不残留上下文），禁用 `both`。判定口诀：弹层 getBoundingClientRect 中心 `elementFromPoint` 不属于菜单子树 = 被困。

### 1.11 同名选择器在文件后段重复定义，会覆盖前面的修改
- 事故：`.hero-title` 在 theme.css 前段改了 `fill: backwards`，L2273 还有第二处同名规则用 `both`，级联后者胜出——修复「无效」，页面 computed 一直是 both。
- 处置：改任何样式前 `grep -n '<selector>' theme.css` 看**全部出现处**（3000 行单文件已有多处历史重复块）；CSSOM 侧 `document.styleSheets` 遍历同名选择器能直接暴露两套规则打架。

### 1.13 删 CSS 变量前必须连 `*.module.css` 一起查：未定义引用会整条静默失效
- 事故（2026-09-12 用户报告「使用统计里这类窗口都变成透明了」）：统计页图表悬浮提示 `.tip` 的 `background: var(--menu-solid)`——而该变量在更早一轮「删无消费者的 token」时已被清掉（那条只 grep 了 theme.css，没查 CSS module）。未定义变量让 `background` 整条 invalid-at-computed-value-time → 提示框全透明（同 AUD-002 那一类）。
- 处置：**删任何 CSS 变量/颜色 token 前，用全量审计**（含 `frontend/src/**/*.module.css` 与生成的 tokens.css）：
  `python3 - <<'EOF'` 遍历所有 css 收集 `--x:` 定义与 `var(--x)` 引用，差集即断链（本轮据此还捞出 `.load-error button` 的 `--line-2`、`.att-chip` 的 `--danger` 与 `.effort-tick` 里已被内联 style 取代的死声明）。
- 注意：JS 运行期写入的变量（如 `--dsh-sidebar-w`）不在审计差集里算错，但**必须在引用处带兜底值**（`var(--dsh-sidebar-w, 240px)`）。

### 1.14 消息流里的 `background` 是白费的：`.flow/.md * { background: transparent !important }` 会把按钮也一起清掉
- 事故（2026-09-12，做「定时任务建议」卡时量出来的）：卡里的主按钮原本照抄全局 `.btn-primary`，实测 `getComputedStyle` 是 `background: rgba(0,0,0,0)`（theme.css:1698 那条 `.flow, .flow-inner, .md, .md *, .agent-message, .agent-message * { background: transparent !important }` 连着 `!important` 一起清），而 `.btn-primary` 的文字色是**反相面色**（暗色主题下 `--dsh-surface-inverted` = #2A2A2E）——深灰字压在深色卡上，等于隐形；亮色主题同理（白字压白底）。用户看到的只是「一块淡淡的字」。
- 处置：**流内动作按钮一律走「描边 + 亮字」**（`border: 1px solid var(--line-heavy)` + `color: var(--ink-bright)`），别指望实底；给流内元素写 `background` 就是死代码。要让实底在流内成立，得给那条 `!important` 开显式例外（`.flow .btn-primary { background: … !important }`）——目前没开，别偷偷绕。
- 附带事实（同源）：流内卡片（`.question-card` / `.approval-card` / `.plan-review-card` / `.auto-proposal`）的 `linear-gradient` 底色同样被清掉，它们在应用里本来就是**只有描边**的形态——别照着"应该有个底色"去调它们的层级。**已知同类隐患**：审批卡的「允许」用的是 `.btn-primary`，落在这条规则下同样是隐形文字（本轮未改，用户没提；要改就是上面那条例外或把它换成描边钮）。

### 1.15 会话日志是多帧 zstd：fzstd 的一次性 `decompress` 只解第一帧（静默给 1 行，不报错）
- 事故（2026-09-13，写读会话日志的统计脚本时）：`decompress(await readFile(session.v3.jsonl.zstd))` 对一份 432KB 的日志返回了**一行**，而 `zstd -dc | grep -c` 在同一文件上数出 14 处命中——脚本于是报"0 命中"，看着像"这个坑没再出现"（最坏的方向：假有效）。根因：会话日志是**逐次追加**写出来的，文件里是多帧 zstd；fzstd 的 `decompress(dat, buf)` 只在**给了输出缓冲**时才连解多帧（README 原话），不给就停在第一帧且**不抛错**。
- 处置：用流式 `Decompress`（`new Decompress((chunk) => chunks.push(Buffer.from(chunk))); inflater.push(raw)`）把所有帧拼起来。凡是要读会话日志的脚本都只有这一条路。
- 通用教训：**压缩流的"部分解码"往往不报错**——凡是数命中/做统计的地方，先拿 `zstd -dc` 之类的全量解码做一次交叉对账（本次正是靠这个对账才发现差 14 vs 0）。

### 1.12 content-visibility 估高让 scrollHeight 漂移：编程滚动落点必须二次校准
- 现象：`.msg-block` 用 `content-visibility: auto`（离屏跳过排版），跳到底部后估高被真实高度替换、scrollHeight 变化，一次性 `scrollTop = scrollHeight` 的落点偏短，末条消息仍被悬浮输入框盖住。
- 处置：编程滚动（回到底部等）落点后**当前帧 + 下一帧各校准一次** `scrollTop = scrollHeight`；动画中改用 rAF 缓动时，终点 settle 同样双校准。

### 1.16 `overflow-x: auto` 会把 `overflow-y` 算成 `auto`：绝对定位的下拉在横向滚动容器里被整条裁掉
- 事故（2026-09-26 用户报"浏览器地址栏的补全列表看不见也点不着"）：补全列表是
  `position:absolute`，挂在标签行里那一枚地址框的祖先 `.panel-browser-chrome-run` 是
  `overflow-x: auto` 的横向滚动容器。CSS 规定 overflow 的两轴不能一轴 `auto` 一轴 `visible`
  （`visible` 会被算成 `auto`），于是**纵向也成了裁切盒**：列表挂在框下方 6px，落在容器
  （高 28px）之外，`scrollHeight 80 > clientHeight 28`——整条被裁掉。它还叠在原生槽位之上
  （见 §4.32），两层坏在同一处，看起来像"被浏览器页面压住了"。
- 判据：在真实 DOM 里量列表 `getBoundingClientRect()` 与它那个滚动祖先的 rect，看列表是不是
  落在祖先盒外；再比 `scrollHeight` 与 `clientHeight`。**看不见的浮层有两种死法**：被裁、
  被原生视图盖，前者量 rect 与 `scrollHeight` 就能分开。
- 处置：这类浮层一律 portal 到 `body` + `position: fixed` 按框摆位（与 §1.7 的 `.ddMenu`
  同一层 1100），摆位用 `useLayoutEffect` 量**输入框本身**（不是它那层 flex 盒子，盒子量出来
  窄一截），并挂 `ResizeObserver` 跟着框动。本仓**没有全局 `box-sizing: border-box` 复位**，
  摆位给的是边框盒宽，列表侧要自己写 `box-sizing: border-box`，否则宽出 padding + 边框 14px。

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

### 2.5 引擎帧字段以 vendored schema 为准，不按字段名猜
- 事故：壳侧 EngineEventObserver 读 `frame["questionId"]`——引擎 `question/requested` 载荷根本没有这个键（该载荷只有 `{sessionId, questions[]}`；vendored schema 的文件名与位置随引擎升级会变，以现查为准），nil 落到 `?? UUID().uuidString` 兜底，每次插入都是随机新 id；`question/resolved`（键为 `questionRpcId`）又未处理——pending 只进不出，一次提问后"需注意"状态卡死到引擎重启。
- 处置：**挂起身份 = server-request 信封的 rpcId**（与前端 store 同一语义）；帧解析前先查 vendored schema（`packages/*/src/api/*.schema.ts`），契约字段直取、缺即 return，不做 UUID/空串兜底掩盖漂移（铁律 9/10）。表驱动 XCTest 钉住配对语义（EngineEventObserverTests）。

### 2.6 session/follow live 帧就是 SessionEventEntry 本体，勿多剥一层
- 引擎 `SessionFollowFrame = snapshot | SessionEventEntry`，而 `SessionEventEntry = {type:'event', event: SessionEvent}`（`deepseek-harness/packages/api/session-controller/src/types.ts:382`）。mux item 的 `value` 即该帧。
- 事故（2026-09-10 实机）：`api.followSession` 写成 `onEvent(frame.event.event)`——live 帧多剥一层得到 `undefined`，`onEvent` 访问 `ev.type` 抛错被 mux `onmessage` 的 try/catch 吞掉。快照路径（`type==='snapshot'`）完全正常，所以冷读/刷新有内容、直播正文永远空白；WS 表面健康、引擎在推、独立探针全收到，极像桥中继假死。
- 处置：`onEvent(frame.event as SessionEvent)`。契约钉测在 `api.test.ts`「session/follow 帧解包」。官方 client 测试同款形状：`frame.type === 'event' && frame.event.type === ...`。

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

### 3.6 `user/message` 事件不带 turn——零 assistant 输出的轮没有 tail 锚点，轮终错误整轮静默
- 事故（2026-09-06 新用户实测）：无凭据发消息，引擎 `turn/end` 带完整 `MISSING_CREDENTIAL` 错误，但 UI 零提示。根因：turn-tail 只插在「该 turn 最后一个**带 `turn` 字段的 item**」之后，而 wire 上 `user/message` 不含 turn，renderModel 的 user item 因此一直没标——一步失败（缺 key/401/网络错）的轮没有任何 assistant item，tail 无处可插，「本轮失败」永不渲染。§5.6 同型：错误通了，渲染前提没被端到端验证过。
- 处置：ingest 上下文记 `currentTurn`（`turn/start` 时更新），user item 标注归属；空 turn（无任何 item）仍不发 tail（§3.4 口径不变）。回归钉在 `session-ingest.test.ts` 一步失败轮夹具。

---

### 3.7 流式中途的围栏不是"渲染失败"：未闭合就别去渲染（2026-09-16 实测）

- 现场：让模型画一张 168 行的手写 SVG，逐行到达的过程中，正文里一直挂着
  **「SVG 渲染失败，已按源码显示」**，写完才变成图——用户看到的是"渲染坏了"，实际上
  渲染器没问题，是**半截围栏本来就渲染不出来**（mermaid 同理：半截语法必然解析失败）。
- 处置：`parseBlocks` 给未闭合的围栏打 `unclosed?: true`（标记式，闭合后不出现，历史
  断言形状不变），三个富输出块在该状态下显示「正在读取…」并**跳过渲染尝试**（mermaid 连
  异步渲染都不发起；widget 不挂 iframe——半截 HTML 跑起来等于让模型边写边执行）。
  闭合后 flag 翻转，effect 重跑，图自然出现。
- 通用教训：**流式场景里"渲染失败"必须区分"内容还没到"与"内容真的坏了"**；把前者报成
  后者，用户会以为功能坏了（本次就是这样被报上来的）。

### 3.8 内联 SVG 的 `<style>` 要连图一起关进 shadow root（2026-09-16 / 2026-09-24 两次实测）

- 现场（一，2026-09-16）：模型手写的 SVG 靠 `<style>` 里的 class 与 `:root` 变量配色（白底
  主流程、靛蓝判断、琥珀返工…）。旧的消毒把 `<style>` 整个剥掉（怕文档级样式表改整个应用
  排版），结果形状全部回落到默认 fill → **一片纯黑**、标签字色也丢，比不渲染更糟。
- 现场（二，2026-09-24）：改成把 `<style>` 包进 `@scope (#<svg-id>) { … }` 之后，**mermaid
  图依旧整张全黑**（黑块 + 黑色实心箭头，只有框外的边标签露着）——用户报"回答的消息渲染的
  内容看不清"。根因：`@scope` 给块内每个选择器加的是隐式 `:scope ` **后代**前缀，**指名作用域
  根自身**的选择器因此永远匹配不上（根不是自己的后代）。而 mermaid 产物与手写 SVG 的规则几乎
  全是 `#<svg-id> .node rect {…}` 这种以图自己的 id 打头的写法：整片规则静默失效，形状回落成
  默认 `fill: black`，连边（`path` 默认被填充）都变成黑色实心楔形。真 WebKit 26 实测：
  `@scope (#s) { rect {…} }` 生效、`@scope (#s) { #s rect {…} }` 不生效（规范行为，非引擎缺陷）。
- 处置：图整个进 **shadow root**（`rich/ScopedSvg.tsx`）——影子树本身就是 CSS 作用域边界，作者
  样式原样生效（`#<svg-id> …` 一字不改），又天然改不到应用排版（`*{display:none}` 只能命中影子
  树内元素，实测宿主与文档不受影响）。`sanitizeSvg` 只留三件事：DOMPurify 的 svg profile（禁
  `script`/`foreignObject`）、摘 `@import`/`@charset`、把 `:root` 改写成 `svg`（影子树里 `:root`
  指文档根、匹配不到任何元素，调色板变量取不到值又变黑；落在 svg 上照样往下继承）。原先的
  `@scope` 包裹与 `md-svg-N` id 注入随之删除；尺寸规则（`max-width:100%`）跨不过影子边界，跟图
  一起写进影子树。
- 通用教训：**"限定作用域"必须验证规则还在匹配**——`@scope` 的隐式 `:scope ` 前缀会静默废掉
  一整类选择器；而 jsdom 不做层叠求值，只断言"样式字符串还在"的测试一个都拦不住这种全黑回归，
  得在真浏览器里量 computed style（本次用 WebKit + 同一条围栏源码复现与验收）。

## 4. Engine / 壳端

### 4.1 独立 harness home 需自带 `.credentials.yaml`
- 事故：`DSH_HOME` 指向独立 harness home（现为 `~/Library/Application Support/DeepDive/harness`；改名前 `…/DSHmini/…`，首启动已自动迁移），无 `~/.dsh/.credentials.yaml` → LLM 每轮返回**空回复**（assistant 文本为空），且无报错。
- 处置：缺凭据**不再拒启**（照常 spawn，引擎侧容忍缺文件且热发布；冷启动闭环改由 SPA 的新手引导卡接管，见 §5.6）。老 dsh CLI 的凭据由壳在**启动期一次性迁移**进 harness home（`LegacyCredentials.perform()`，已有/无来源静默；成功与失败各落一行日志）。

### 4.2 mux 帧是 `server-request` wrapper，需解包 `payload`
- `frame = (raw.payload) || raw` 解包正确；帧类型在 `payload.type`（session/event / approval/requested …）。

### 4.3 标题栏拖拽是「穿透 hitTest + JS rect 表」的双端契约
- 架构：webview 对顶部 52px 条带内的**空白**返回 nil（穿透到下层 TitlebarDragView 拖窗），按钮区返回自身可点；「哪里是按钮」由前端 `titlebar.ts` 每 300ms + resize/transitionend 推送全量 rect 表（CSS 视口坐标，y-down），壳端在 hitTest 时用**实时 bounds.height** 换算。
- 曾用「didFinish 时一次性采样固定选择器（.window-top-btn）」：收起边栏按钮位移/窗口 resize 后 rect 全错，`.session-header .model` 不在选择器里被整条吞掉 → 误触/按钮失灵。
- 铁律：① strip=52 与 rectPadding 双端常量必须同步（titlebar.ts ↔ MainWindowController）；② 壳端 **fail-open**（没收到 rect 表前不穿透不吞点击），收到前整条可点、不可拖是预期行为；③ 改动顶层布局（window-top/session-header）必须在壳内实测按钮可点 + 空白可拖。
- **双击要自己补**（2026-09-14 用户报「标题栏双击无法自适应放大」）：标准标题栏的双击由 AppKit 处理，而这条自绘标题栏把条带内所有 mouseDown 都交给 `performDrag`——双击的第二击（clickCount 才到 2）同样被当成一次拖拽，系统偏好（`AppleActionOnDoubleClick`）永远不生效。`TitlebarDragView.mouseDown` 里显式分派：clickCount==2 → Maximize 缩放 / Minimize 最小化 / None 不动（默认分支走缩放）。改拖拽逻辑时别把它再吞回去。

### 4.4 FileHandle.readabilityHandler 在 EOF 会忙等
- 引擎进程退出后 availableData 恒为空；handler 不置 nil 会被反复空读调用（CPU 空转）。空数据分支必须 `handle.readabilityHandler = nil`。

### 4.5 桥的 Origin 校验必须 scheme+host+port 全等
- 曾用 `hasSuffix(":\(port)")`：任何恰好同端口的其他站点（`http://evil.com:5000`）都能过闸；WebSocket 握手不受 CORS 限制，对方页面可读走整条会话事件流。必须是 `origin == "http://127.0.0.1:\(port)"`。

### 4.6 alpha.2 引擎 wire 契约（实测 0.1.2-alpha.2 内嵌 runtime，换引擎必查）
- **HTTP unary 面没有删**：`POST /api/<点号方法>`（`/api/session.list`）+ envelope `method` 必须与路径派生名一致（点号），payload 为**扁平参数**（`session.prompt` = `{sessionId,mode,content}`；`session.history` 的翻页锚叫 **`beforeSeq`** 不是 `atSeq`）。曾把点号转斜杠探测 → 404 → **误判 "HTTP 面已删"** → 整个前端切到 `/api/remote.mux` —— 而该引擎**根本没注册这个升级路由**（只有 `/api/events.mux`、`/api/events.host`，未注册路径直接 destroy socket）→ 所有 RPC 静默失败（表现为"发消息没反应"）。
- **信任闸里没有 cookie/token**：`isTrustedApiRequest` 只查 Host 回环 + `sec-fetch-site` + Origin==Host。alpha.2 的 `dsh web:` 打印 URL **不带 token**（`localWebUrl` 就是裸回环地址），EngineAuth 的 cookie 交换无害但非必需。
- 判定接口面一律查引擎源码，不要靠猜：`UNARY_ROUTES` 已随包消亡（现行契约见 `docs/DSH-WIRE.md` 与 §7.1）；权威参数清单 = 生成客户端各包 `lib/typert.remote-client.js` 的 `parameters[].wire`。

### 4.7 主窗口大圆角来自「可见的空 NSToolbar」（删掉/隐藏即退回小圆角档）
- macOS 26 (Tahoe) 窗口圆角分两档（本机 26.5 截图实测，2x 拟合）：纯标题栏窗口 ≈16pt；**带可见 toolbar 的窗口 ≈26pt**（连续曲率，WindowServer 裁切，与 Finder/Notes 同款）。`toolbar.isVisible = false` 也会退回小档。
- DSHmini 标题栏整个画在 web 层，壳里那个 `NSToolbar`（`EmptyToolbarDelegate`，0 item）唯一作用就是**把窗口选进大圆角档**：`titlebarAppearsTransparent` 让它不可见、0 item 不交互，空白条 hitTest 与无 toolbar 完全一致（实测）。副产物：挂上后红绿灯默认中心线 16→26pt，恰好等于前端 26px 头部中心线，`alignTrafficLights()` 成为 no-op 兜底。
- 铁律：不要"清理"这个空 toolbar；前端圆角阶梯以 26 为锚（tokens.json v5 `radius.window`，`.main` 18 = 26−8 同心）。改动后必须截图自检圆角档位（对比 Finder 窗口角）。

### 4.8 重打包换签名 → TCC 授权重置、启动弹系统授权框
- macOS 按（code signature, bundle id）记 TCC 授权，签名一变「文稿访问」等授权全部重置：启动即弹"DeepDive 想访问文稿"系统框，**模态挡住应用初始化**（表现为 AX 查不到窗口/菜单栏、状态项缺失，像启动失败）。
- **根因要治，不是忍着**（2026-09-13 用户报告：重建必弹、人不在跟前没法点、点了还要等退避重试才起来，观感是"过一会才授权"）。ad-hoc 签名没有 Team ID，系统的 designated requirement 只能落到 cdhash 上——**每次重建都是新面孔**，授权必然重来。
- 处置：**两条构建链统一走 `scripts/sign-app.sh`**（Developer ID 固定身份，逐 Mach-O 签 + hardened runtime；无证书环境回退 adhoc 并明说授权会丢）。授权从此绑 (bundle id + 团队)，跨构建持久。
- 症状辨识：引擎**零输出**，`sample` 看得到卡在 `process.cwd()` 的 `getcwd()`（`__getcwd` → `open$NOCANCEL`），或零输出即退。壳的退出日志记 `exited (signal N|status N)`——静默 SIGKILL 与引擎自己报错退出才分得开。
- 换身份后的**第一次**仍会弹一次（对系统而言是新应用），点一次即长期有效。

### 4.9 监督状态机的动作必须幂等：退避定时器 × 手动 start 并发 = 双 spawn
- 事故：引擎退出后排了 restartWorkItem 退避重启；退避窗内用户点"重启引擎"直达 `start()`——`start()` 有 `process == nil` 守卫但不取消挂起的定时器，而 `spawn()` 无守卫、`self.process = process` 无条件覆盖——定时器稍后再 spawn 一次，首个引擎成孤儿进程，两引擎共用 DSH_HOME 交错写会话（恰是单实例锁要防的事）。
- 处置：状态机的每个入口（start/stop/定时器回调）都要幂等：start 先 cancel 挂起项；spawn 前置 `guard process == nil`。同类纪律适用于一切"手动操作 × 自动重试"并存的状态机。

### 4.10 手写 socket 泵的 fd 属主：双 close 在 fd 复用窗口误伤无关连接
- 事故：WS 盲中继两条 detached 线程退出时各自 `close(upstream); close(client)`——先退的一侧把两个 fd 都关了，内核可能已把其中之一复用给新连接/引擎管道，第二次 close 关的是别人的 socket；且 close 不保证唤醒对端阻塞中的 recv（要 shutdown 才会）。
- 处置：**每个 fd 只有一个属主线程**，退出时 close 自己一侧、对另一侧只 `shutdown(SHUT_RDWR)` 唤醒对端退出。
  - **变种（AUD-071 修复仍不够，2026-09-10 实机二连事故）**：「close 自己 + shutdown 对侧」在对侧线程已先 close 该 fd 时同样误伤——fd 号被内核复用给新 accept 的连接后，迟到的 shutdown 关掉的是别人。表现：受害连接表面完全健康（无 close/error 帧），快照后**一帧不再到达**，直播转录冻结而 HTTP 轮询照常（用户连日报「发的消息看不到」）；帧级日志（预启动 WebSocket 包装器）+ 并行探针对照钉死断点在桥中继。终修：**双泵线程合并为单线程 `poll()` 双 fd 循环**——任一侧 EOF 都在同一线程内依次 shutdown/close 两个 fd，跨线程 fd 信号全灭，整类竞态不存在。另配期望看门狗兜底：`store` 3s 轮询发现任一会话 running 而整条 mux 连接静默超窗（`mux.stalled`，窗口常量在 `mux.ts`）即 `recycle()` 重建——任何未知形态的连接哑火都 ≤「窗口 + 3s」自愈（重建代价仅各流重发快照）；静默计时在重连时复位，哑火连接不会被每个轮询 tick 连环重建。

### 4.11 主线程同步 Process + 不排空 stderr = 死锁面
- 事故：run-git 聚合在主线程同步跑 3 条 git（readDataToEndOfFile + waitUntilExit），且 stderr Pipe 从不读取——子进程 stderr 写满 64KB 管道缓冲后阻塞写，进程不退出，主线程 `readDataToEndOfFile` 永等 → 整 app 冻结。
- 处置：磁盘/子进程 IO 一律后台队列（gitRun 样板）；两侧管道**都要排空且不能顺序读**——顺序读有互锁面（先读的一侧等 EOF，子进程可能正阻塞在另一侧的满缓冲上），stderr 用独立线程排空。

### 4.12 NSNumber.intValue 是 Int32 语义，大整数静默截断
- JSON 反序列化的整数经 `NSNumber.intValue` 进 `case int(Int)`：intValue 按 Int32 截断，毫秒时间戳等 Int64 值高位丢失且无任何报错。
- 处置：统一走 `Int(n.int64Value)`（JSONValue.swift）。

### 4.13 引擎 cwd 绝不落到用户主目录：home 工作区 = TCC 弹窗风暴
- 事故（2026-09-10 用户报告）：接连弹「媒体资料库/Apple Music」「照片图库」「其他App的数据」授权框，且开窗后延迟数秒陆续冒出。根因链：`launchWorkspace` 未配置时引擎以 home 启动（引擎进程 cwd=home，而 `@` 索引的扫描根与 agentless 调用的兜底根取它——会话自己另有 cwd）；home 作用域会话里输入 `@` 触发引擎**整库递归文件索引**（vendored `context/file-reference-local/search.ts` scanWorkspace，BFS），索引走到 ~/Music、照片图库、~/Library/Application Support 其他 App 容器、桌面/文稿，逐保护区触发 TCC——延迟即遍历到达时间差。叠加 §4.8（adhoc 重签→授权重置），每个新包都全套重来。
- 处置：`EngineSupervisor.resolveLaunchWorkspace` 三级解析——显式 `launchWorkspace` 配置 → harness 存储 `storages/workspace.json` 首个注册空间（`global.workspaceIds[0]`，与侧栏同序）→ 新用户兜底 `~/DeepDive`（不存在则建；**不放进 `~/Documents`**：那是受保护目录，首启在那里建目录会弹「文稿」授权框，而弹框出现在主窗口之前、主线程上——用户忽略就卡住整个启动，点了拒绝引擎连 cwd 都进不去，见 §4.8/§7.1.2）。侧栏空间仍是项目单位，多项目经空间注册/切换，不受影响。
- 排查实录（勿重复走弯路）：引擎 AI 工具调用与子代理命令全部只在项目目录内（逐条核对 tool/call 事件），`@` 索引才是家目录扫描源；lsof 抓不到瞬态访问，tccd 统一日志私有不可读，结论靠引擎源码 + workspace 注册表 + 事件日志三角钉死。

### 4.15 引擎把归档集与会话列表缓存在内存：改状态文件只能在停机时，UI 侧走本地覆盖
- 背景（2026-09-12）：引脚的 0.1.5-rc.1 wire 面只有 `workspace/archiveSession`（单向），**没有取消归档、也没有删除会话**（官方 `ui-workspace/README.md` 明写 "No Session deletion or unarchive control"；`workspace/delete` 删的是**工作区注册**、明确不删会话）。归档页的「取消归档 / 删除」因此由壳配合实现。
- **实测（本轮踩到的第一版设计错在哪）**：`session/list` 来自引擎**内存缓存**——运行中删掉 `sessions/<bucket>/<id>/` 目录后，`session/list` 照样列它。所以"改完文件指望引擎自己发现"不成立；而运行期改 `storages/*.json` 又会被内存状态在下次 `setState` 时整份覆写。**结论：引擎状态文件只能在停机时（启动空窗期）写**。第一版做法是"停引擎 → 改 → 起引擎"，实测体验很差（几秒断连横幅 + 重启期的 `session/list` 502 报错弹窗），已废弃。
- 现设计（用户定稿）：**UI 即时生效 + 延迟落账**——① 前端持本地覆盖集（`deepdive.unarchived` / `deepdive.removed`，`sessionOverrides.ts` 纯函数过滤，导出层统一口径，轮询**存原始列表**）；② 删除时壳立刻删日志目录（毫秒级、不需引擎配合）；③ 覆盖集同步给壳登记在 UserDefaults，**下次启动的空窗期**（`applicationDidFinishLaunching` 里、`supervisor.start()` 之前）一次落账，成功后清登记（失败留到下轮重试）；④ 覆盖项在引擎不再报告它已归档 / 不再列出时自动收敛，避免无限增长。
- 落盘事实（改前必读）：归档集 = `DSH_HOME/storages/workspace.json` 的 `global.archivedSessionIds`（带 `unit:{name,version}`，写前校验）；投影缓存 = `storages/session_projcache/sessions/<sessionId>.json`（**per-record 布局**：一个会话一份文档，见引擎 `session-projection-cache/src/spec.ts` 的 `layout: 'per-record'`。同目录下那个同名的整文件 `session_projcache.json` 是旧布局，只在「新树里一个文档都没有」时做 bootstrap，引擎此后**永不读写**——别去改它）；会话日志 = `sessions/<转义 cwd>/<sessionId>/`（**目录名就是 sessionId**，别复刻引擎的 cwd 转义规则——扫一层同名目录即可）。写盘一律临时文件 + `replaceItemAt`，结构不符拒绝写入并报错。

### 4.18 清理验收痕迹只能按显式 id：用"最近更新的会话"挑，会误删用户会话（2026-09-13 事故）
- 事故：做完一次验收后清理测试会话，脚本按 **mtime 取最近两个**当作"我的痕迹"，结果第一个是刚建的验收会话、第二个是**用户自己的「帮我实现 Deepdive 构建」**（更新于前一天 13:14）——`rmtree` + 覆盖集登记后，会话目录、归档集、投影缓存三处同时被清，**不可恢复**（本机无 APFS 本地快照）。
- 根因不是命令，是**选择器**：验收痕迹的正确来源是"本轮我自己创建的那些 id"（建会话时记下来），而不是"看上去最新的"。任何"推断式选择器"（最近 N 个 / 最近 N 分钟）在用户数据上都可能误伤。
- 处置（纪律）：清理只允许**显式 id 列表**，且删前逐个打印 id、标题与创建时间让人看清；删除动作与登记覆盖集同批执行，不做"先删后想"。**删会话类操作一旦执行不可逆——宁可留着问用户，也不要推断。**
- 附带事实：删目录 + 登记覆盖集之后，该会话的投影文档（`storages/session_projcache/sessions/<id>.json`）也随删（立即删除时同步删，落账时补删），所以「从投影缓存里恢复标题/摘要」这条路也断了。

### 4.16 逐会话读历史很贵：统计类页面必须"记录在前、打开直接展示"
- 实测（2026-09-12，用户报"使用统计加载非常慢"）：引擎没有 history RPC，读一条会话的历史要 `session/follow` 开窗 + `session/page` 回翻，**且必须逐会话开流**——本机 159 个会话、并发 24 也要 ~17s（加大并发无用：引擎侧读取基本串行）。另有悬挂面：本地已删除但引擎仍列出的会话，follow 流既不开也不报错，promise 永不 settle → 整轮收集永不完成（页面靠渐进上报看着不慢，但缓存写不进去、刷新钮一直转）。
- 处置（用户定稿的数据模型）：**用量按会话记录在本地**（`deepdive.usageFold`，localStorage，键 sessionId、值含 updatedAt 做失效判定），与归档/删除解耦（归档或删掉聊天不抹账，只要那段时间用过就算）；页面第一帧折缓存直接出数（复访实测 506ms 出全量），引擎侧只在后台补 `updatedAt` 变过的会话、合并写回（不 prune，历史不丢）。配套：每会话读加超时（超时按失败、不写缓存），调用方传"已排除本地已删除"的会话清单。
- 通用教训：**同一份事实要在多个入口出现（统计/列表/搜索）时，别在入口处现读全量历史**；能增量记录的就在使用路径上记，打开即展示。

### 4.17 桥端口一变，网页 origin 就换一套 localStorage——SPA 的本地状态会"每次启动清零"
- 现场（2026-09-12，做自动化页时发现）：桥监听端口原为内核随机分配（每次启动都不同，实测 56697/57555/61604/62408/64274…），而 SPA 的 origin 就是 `http://127.0.0.1:<port>/` —— **origin 一换，WebKit 的 localStorage 就是另一套**（`~/Library/WebKit/com.deepdive.app/WebsiteData/Default/<origin 哈希>/…`，实测同一台机积了 113 个 origin 目录）。后果是所有走 localStorage 的状态跨启动全丢：`deepdive.pinned` / `deepdive.unread` / `deepdive.workspace` / `deepdive.unarchived`·`removed` 覆盖集 / `deepdive.usageFold`（统计页的"打开即出"缓存每次重启都要重折一遍——正是用户报"统计加载慢"的隐藏放大器）/ 自动化任务。**症状是静默的**：单次会话内一切正常，只有跨重启才丢。
- 处置：**把端口固定下来**（`MiniHTTPServer.start(port:)` + `DSHAppPrefs.bridgePort`）。实测：重启后端口不变（64274 → 64274），localStorage 里 `keepAwake=1` 与已建任务都还在。固定本身还不够（2026-09-13 复发：被占→回退内核分配→**把新端口记成 pin**，origin 永久搬家，前一天写下的 `usageFold` 全量账本搁浅在旧 origin）：首选端口被占改为短暂重试（交付链 pkill→open 竞态几百毫秒即释放）；仍被占才临时回退且**不改写 pin**——临时端口只活本次，下次启动回原 origin；只有首次运行（pin==0）才记端口。
- 通用教训：**任何"存在浏览器存储里的本机状态"都隐含依赖 origin 稳定**；端口/主机/协议任一漂移都会把存储清零，且不会报错。改动监听方式（端口、host、http↔https）前先想清楚它是不是某个持久层的键。

### 4.19 比较路径必须同一把尺子：git 回的是 realpath（2026-09-16，工作树分区实测）

- 现象：工作树列表里"哪一条是主工作树"判错——工作区填 `/var/folders/…/proj`，而
  `git worktree list --porcelain` 回 `/private/var/folders/…/proj`（macOS 上 `/var` 是
  `/private/var` 的符号链接）。字符串不等 → 主工作树被当成普通工作树，界面于是给出
  「删除 / 注册为工作区」这对**对主工作树不该有的**动作。
- 处置：解析符号链接只有壳做得到（`FileManager`），所以 `worktree-list` 的回复里带上
  `resolvedRepo`（`URL(fileURLWithPath:).resolvingSymlinksInPath()`），前端拿它当
  "同一把尺子"再比（`isMainWorktree` 的注释里写明这个前提）。
- 通用教训：**凡是要把两个来源的路径做相等的判断，先问"这两串是不是同一种形态"**
  （realpath / 尾斜杠 / 大小写 / 相对路径）。本仓已有同源先例：session 目录名按转义 cwd、
  workspace 成员资格按 realpath 比较（`workspace/entity.ts`）。

### 4.14 bundled node 绝不能放进 `Contents/MacOS/`
- 事故（2026-09-10 用户实测）：引擎 node 放在 `Contents/MacOS/node`，Launch Services 把同 bundle `MacOS/` 下的额外可执行文件当成第二个 app——引擎一拉起（含重启）Dock 就闪出独立的 node 图标/窗口，用户连报「不停弹 node 窗口」。
- 处置：node 落在 `Contents/Resources/Runtime/node`（与 dsh 闭包同级）；`EngineSupervisor.bundledRuntimeState()` / `embed-engine.sh` / `package-macos.sh` 签名 case 同步。`Contents/MacOS/` 只保留 app 主可执行文件。
- 旧布局残留：嵌过旧布局（`MacOS/node`）的 .app 在新自查下呈「残缺」（`Resources/Runtime/node` 缺、`Runtime/dsh` 在）而被判「引擎程序不完整」拒启——处置是重新打包（或删掉旧 .app 重构建），别去追引擎为什么不再启动。

### 4.20 App 未声明本地化 → `Locale.current` 落回开发语言，与系统语言无关（2026-09-21 用户实测）

- 事故：听写在中英文混合使用下**一直识别成英文**。根因不是识别器，是取语言的方式——
  `SFSpeechRecognizer()` 的默认构造取 `Locale.current`，而 macOS 上 `Locale.current` 是
  **"用户偏好 ∩ App 自身本地化"**：本 app 没声明任何本地化（`CFBundleDevelopmentRegion`
  = 开发语言 `en`，工程无 `knownRegions`/`.lproj`），于是恒落回英文。在 app 包上下文里实测：
  `Bundle.main.localizations == ["en"]`、`Locale.current == en_CN`（**语言英文、区域中国**）、
  而 `Locale.preferredLanguages == zh-Hans-CN`。代码里那句"识别区域语言跟随系统"的注释是错的。
- 处置：识别语言显式解析（`DictationController.resolveLocale`），**用 `Locale.preferredLanguages`
  而不是 `Locale.current`**。另在开始听写时落一行 `[dictation] locale …`——选中的语言是
  "看不见的决定"，这类问题这行日志是第一现场。
- 匹配别自己写：偏好语言是**脚本形式**（`zh-Hans-CN`），识别器支持的是**区域形式**
  （实测这台机器 zh 只有 `zh-CN`/`zh-HK`/`zh-TW`），前缀匹配必然失败；
  `Bundle.preferredLocalizations(from:forPreferences:)` 就是干这个的。**一个反直觉的兜底**：
  一个都匹配不上时（含支持集为空）它回的是 **bundle 的开发语言**（`en`），不是空数组——
  我第一版测试就按"空集 → nil"断言，是测试写错而不是实现错。
- 通用教训：**任何"跟随系统"的行为都要问一句"它取的到底是哪一个 locale"**——
  `Locale.current` / `Locale.preferredLanguages` / `Locale.autoupdatingCurrent` 三者语义不同，
  而 App 未本地化时第一者会静默退回开发语言。本仓同类面还有：引擎/SPA 的语言（我们自建
  `i18n`，不看系统）、`pdf.js` 与 `mermaid` 的本地化。

### 4.21 原生槽位这条链有五份契约，任一份"忘了设/发错"都表现为"浏览器坏了"而不是报错（2026-09-25 用户报"浏览器显示好像没有正常使用"）

- 事故：agent 已经把页面开在小红书（它还读得到页面内容），面板里却是"还没有打开的网页"。
  五个独立缺陷叠在同一条链上，逐个查才拆开：
  0. **发错通道（真凶，且一直没工作过）**：SPA 的 `nativeSlot.ts` 用 `sendToShell`（`deepdiveHost`
     指令通道）推 `native-slot`，而壳只在 `deepdive`（rect 表通道）那一支调 `handleNativeSlot`
     → `setSlot` **一次都没被调用过** → 原生视图永远摆在 idleViewport、alpha 0。两个通道由
     `MainWindowController.userContentController` 按 `message.name` 分派，发错不报错、只是"没人接"。
     修：rect 表类消息统一走 host.ts 新导出的 `sendRects`（`titlebar.ts` 与 `nativeSlot.ts` 共用
     一份通道访问，不再各写一份 `webkit.messageHandlers` 取用）。
     **判据**：壳侧临时打点 `handleNativeSlot` 的入参，或直接看 `[bridge] host message: native-slot`
     是否每 300ms 刷在**指令**通道的日志里（刷了就是发错通道）。
  1. **壳的观察是"变化才推"**（WKWebView 的 didStart/didFinish）。面板关着时 agent 导航过的
     那一条没人收，而 SPA 没有"要一次当前状态"的路 → 后挂载的 SPA 地址恒空 → 走空态、连槽位
     都不渲染 → 壳里已经打开的页面看不见。修：`browser-sync` 消息 + `BrowserHost.resync()`，
     `useNativeBrowser` 挂载即要一次。
  2. **自家遮罩把自家槽位判成"被盖住"**：缩略图态的展开遮罩当时是槽位元素的**兄弟**，而可见性
     判定是"最上层元素是否仍在槽位内"（`unobstructed`）→ 推 `visible:false` → 缩略图永远空白。
     修：遮罩装进槽位元素**里面**——要挡的是点击，那由 `interactive` 交壳的 `hitTest`，
     不需要靠"遮住"表达。
  3. **探针内缩小于容器圆角**：`unobstructed` 原用 4px 内缩，而宿主是 `border-radius: 14px` +
     `overflow:hidden` ——探针落进圆角被裁掉的角区，命中的是父级本身，于是恒判"被盖住"（与 2
     叠加，两个都在同一处失效）。修：内缩量按圆角定（12px，槽位小时按 1/4 边长收窄）。
     量法：`document.elementsFromPoint` 在距角 3px/4px 各打一次，栈顶从槽位变成父级的那个
     偏移量就是圆角的裁切边界。
  4. **`data-native-slot-interactive` 定义了但从来没人设**：壳侧 `acceptsInput = visible &&
     interactive` 于是恒 false → 展开后的页面看得见、点不动（`hitTest` 返回 nil，事件穿透回
     SPA）。修：`NativeCarrier interactive={expanded}`。
- 纪律：槽位这条链的契约是五份——**发对通道** / rect / visible / interactive / **未挂载也要显式表达**。
  `pushNativeSlots` 原来只遍历"现在还在 DOM 里"的元素，槽位整块卸载（面板收起、浏览器页换成
  空态）时什么都不发，壳沿用旧 rect 把原生视图留在原地盖住界面；现在按上一轮推过的 id 补发
  `visible:false`。**新增槽位时按这五份逐条核对**，它们的失效方式都是"看着像没生效"。
- **验证方法上的教训（比缺陷本身更值钱）**：桥接 URL 够不到原生槽位（纯浏览器 `inShell()`
  为假、走 iframe），所以我造了个"伪壳"（`addInitScript` 立起 webkit.messageHandlers +
  `__deepDiveHost.dispatch`）来端到端验证——**伪壳只实现了 `deepdiveHost` 通道，把槽位消息
  照单全收**，于是缺陷 0（发错通道）在它面前完全隐形，五项里四项"验证通过"而真机仍然全黑。
  教训：**伪壳必须照真实分派逐通道复刻**（按 `message.name` 分流），否则它验的是"我以为的
  契约"而不是"壳的契约"；能用真机日志（`handleNativeSlot` 打点）就先上真机。
  遮挡判定的探针与层序另有两条续坑：§4.32（探针太稀漏浮层）与 §1.16（浮层被滚动容器裁掉）。

### 4.22 WKWebView 的默认 UA 没有任何浏览器身份：按 UA 认浏览器的站点直接把我们弹走（2026-09-26 用户报"为什么会被显示版本过低"）

- 症状：在内置浏览器打开 B 站首页，被跳到 `bilibili.com/blackboard/fe/activity-….html`
  的"您的浏览器版本过低哦"。**同一个 URL 直接打开时连 Chrome 也看到同一段文案**——那张页面
  本身就是"提示页"（title「浏览器下载建议」），谁直接访问都是它。**别拿它当判据**：判据要看
  首页会不会被跳过去（`location.href` 是否还停在 `www.bilibili.com/`）。
- 根因：`WKWebView` 的默认 UA 是
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)`
  —— **只有引擎与系统，没有 `Version/x.y`、没有 `Safari/605.1.15`**（App 内嵌 WebView 的
  默认形态）。按 UA 判浏览器的站点于是归到"未知/过旧"。实测矩阵（同一 URL、只换 UA）：
  默认 UA → 被弹走；补 `Version/18.0 Safari/605.1.15` / `Version/26.0 …` / `Version/17.0 …`
  → 三条全部正常；Chrome UA → 正常。也就是说站点要的是**身份标记**，不是某个版本阈值。
- 处置：`BrowserHost.init` 里给配置加 `applicationNameForUserAgent = BrowserHost.safariIdentity`
  （`Version/<本机 Safari 真实版本> Safari/605.1.15`）。**只补身份尾巴**：引擎与系统版本仍由
  WebKit 自己报，不伪造引擎。版本号读 `/Applications/Safari.app/Contents/Info.plist` 的
  `CFBundleShortVersionString`（读不到退回系统大版本）——**不要写死**：Safari 版本号与 macOS
  版本号并不总是同号（本机 27.0 同号，历史上 macOS 15 对应 Safari 18）。
- 复核方式（不需要点界面）：`BrowserControl` 的 token 在 MCP server 进程的环境里，
  `ps eww -p <browser-use-server pid>` 拿到 `DEEPDIVE_BROWSER_TOKEN` 后直接
  `curl -X POST http://127.0.0.1:<bridge>/browser-control -H "authorization: Bearer $TOKEN"`，
  `method: evaluate` 读 `navigator.userAgent`、`method: navigate` 换页——用户报"某个站点打不开"
  时这是最快的第一现场。修后实测：`location.href` 停在 `https://www.bilibili.com/`、标题是
  真首页、`navigator.userAgent` 末段为 `Version/27.0 Safari/605.1.15`。


### 4.23 原生网页之上浮不了 HTML：悬浮输入框只能让壳再叠一层**透明** webview（2026-09-26 用户要"浏览器全屏时的悬浮输入框"）

- 症状与根因同 §4.21：侧栏浏览器的页面是壳里的 `WKWebView`，**恒画在 SPA 的 HTML 之上**。
  所以"把输入框浮在网页上面"这件事，HTML 里做不到（同一条原因也让缩略图那层悬停蒙层看不见）。
- 走通的路：壳在浏览器视图**之后**再叠一层 `WKWebView`（`ComposerOverlayHost`），它：
  ① 透明——壳侧 `setValue(false, forKey: "drawsBackground")` + `underPageBackgroundColor = .clear`
  （与主 SPA 那个 webview 同一配方，见 `MainWindowController`），页面侧 `[data-overlay] body`
  也不画底；② 里面跑的是**同一份 SPA**（`?composer=<sid>` 只挂输入框那一支），所以输入能力
  与配色没有第二份实现；③ 只在自己那块矩形里收事件，其余透传（见下一条）。
- **透明层会吞掉底下的点击与滚轮**：整层若照单全收，网页在那块区域就点不动了。做法是页面把
  胶囊（含上方浮条）的 rect 报上来（`composer-pill`），壳把它换算成 AppKit 坐标存进
  `interactiveRect`，`hitTest` 只在那块返回自己，其余返回 nil。坐标翻转是这层唯一的算术，
  写错不报错、只表现为"胶囊点不动/网页点不动"，所以 `BrowserHostTests` 里钉了一条。
- 位置由主 SPA 算（它知道面板网页那一格的几何）后推 `composer-overlay`（含 rect）；会话为
  nil 即收起。同屏只允许一个活着的 composer：浏览器全屏时会话列自己那份不再渲染。
- 又一条 CSS 坑：百分比 `max-height` 需要**确定高度的父**。悬浮卡片原来只写
  `bottom: 0`（父高 auto），`max-height: calc(100% - 96px)` 被整条忽略——一条长回复把卡片
  撑到 1681px、顶边跑到视口外 y=-1108。改成 `inset: 0`（高度确定）+ `justify-content:
  flex-end` 贴底才对。
- **别再写第二套会话流渲染**：悬浮卡最早自己挑 `Item` 拼了一份"只显示最后一轮"的渲染，
  于是轮内过程折叠（"已工作 x" 披露条）在卡里没有、在会话页里有——用户一眼看出"两套"。
  正确做法是把会话流的轮渲染抽成 `session/TurnList.tsx`（会话页与卡片共用，卡片只传
  `groups={[最后一轮]}` 与自己的折叠开关），实测两边现在都是"1 条披露条 + 过程项收起 + 答案展开"。
- 顺带一条 CSS 坑：`Composer` 的根是 `.composer-wrap`（`flex: 1` 的弹性项）。把它放进
  `flex-direction: column; align-items: center` 的容器里，它会被缩成"内容宽"——实测 1110 宽的
  带子里胶囊只有 312px。容器要 `align-items: stretch`，再让需要收窄的浮条自己
  `align-self: center`。


### 4.24 页面脚本经 `evaluate` 回壳的形态：字符串是裸串，布尔/数字是 NSNumber 的 `String(describing:)`（2026-09-26 一天踩两次）

- `BrowserHost.evaluate` 把页面结果转成字符串，只有三个分支：能当 JSON 顶层容器（数组/字典）走
  `JSONSerialization`；`NSNull` 给 `"null"`；**其余一律 `String(describing:)`**。于是：
  · `return "abc"` → `abc`（裸串：没有引号，也不是 JSON 文本）；
  · `return true` → `1`（WebKit 把 JS 布尔交成 `NSNumber`，description 就是 1/0）；
  · `return 3.5` → `3.5`。
- 症状：把脚本写成回布尔、壳侧再按 `result == "true"` 比较——**永远不成立**；或者把裸串当 JSON 用
  `JSONDecoder().decode(String.self,)`——**永远解不出来**。同一天里同一根因踩了两次：标签休眠前
  "页面里有没有没发出去的输入"那一问（写成回布尔 → 判据不成立 → 半填的表单照样被睡掉，
  人打了一半的字差点没了，实测复现），以及站点图标地址的提取（按 JSON 解 → 永远没有图标）。
- 规矩：页面脚本要比真值就**回字符串**（`String(expr)` 或直接 `"true"`/`"false"`）——
  `browser-page-scripts.mjs` 的 `READY_STATE = String(document.readyState !== 'loading')` 早就是
  这条老规矩；要回结构化数据就回对象/数组（走 JSON 分支）。壳侧比较直接 `== "true"`、
  解析直接用裸串，**别再套一层 JSON 解码**。

### 4.25 控制面里"把主线程堵在等 WebKit 写 cookie"上会死锁（2026-09-26 实测）

- 症状：`import_cookies` 这条控制面命令把读到的 cookie 交给 `WKHTTPCookieStore.setCookie` 之后
  一条也写不进去——日志里"读到了 2 条"清清楚楚，`setCookie` 的完成回调永远不来，60s 后命令超时。
- 根因：控制面的 `execute` 本来就跑在主线程上（桥的读线程用信号量等它），而导入的**写**也必须在
  主线程（`WKHTTPCookieStore` 是 UI actor 的）。于是在主线程里"泵 runloop 等它写完"= 让 WebKit
  回不到主队列同步自己的状态。同一条路在 XCTest 里是通的（那里用的是 `wait(for:)`，主线程没有被
  我们自己的循环占着），所以这个坑只在真机上现形。
- 走通的路：**起活与取状态分成两条命令**——`import_cookies` 起一次就返回 `{status:"running"}`，
  写完由 `import_cookies_status` 报 `{status:"done", code, total, imported}`（SDK 的
  `browser.cookies.import()` 负责轮询）。不要把"异步 + 必须回主线程"的活在同步命令里硬等。

### 4.26 macOS 14 起"别的应用的数据"是独立一道 TCC 闸：列不出目录 ≠ 没装（2026-09-26 实测）

- 实测：同一个 `~/Library/Application Support/Google/Chrome`，终端里的 python 列得出来，签名过的
  DeepDive 里 `contentsOfDirectory` 回 "Operation not permitted"；Edge / Brave 同样，而 Arc / Dia 能读。
- 后果：把"列不出来"当成"没装"，设置页就会在 Chrome 明明装着的时候说"没检测到可导入的浏览器"——
  用户按这句话去排查只会更糊涂。
- 规矩：**目录不在（ENOENT）= 没装；列不出来（EPERM）= 装了但被系统挡着**。后者照样列出来、
  标 `blocked`、导入时报 `permission` 码。（Safari 那支是另一半：文件 stat 得到、读内容被拒，
  同一个 `permission` 码，但指向的是「完全磁盘访问权限」。）

### 4.27 Swift 方法少写调用括号 → 值是个闭包 → JSONSerialization 抛异常 → 应用一启动就崩（2026-09-26 实测）

- 症状：包一打开就退，`~/Library/Logs/DiagnosticReports` 里那一份的栈顶是
  `AppDelegate.pushPrefs()` → `NSJSONSerialization.dataWithJSONObject` → `_writeJSONValue`
  抛异常（不是崩溃信号，是 ObjC 异常）。
- 根因：偏好快照里写了 `BrowserShield.shared.enabled`——`enabled` 是方法（`func enabled(_:)`），
  少写 `()` 时它被当成**函数引用**塞进 `[String: Any]`；Swift 编译通过（`Any` 收得下闭包），
  到序列化才炸。
- 规矩：给前端的载荷（prefs / 桥消息）**只放 JSON 能写的类型**，方法一律带括号。
  `pushPrefs` 的载荷因此拆成 `AppDelegate.prefsPayload()`，由 `BrowserShieldTests` 里
  "prefs 必须 JSON 可写"那一条钉住（这类错编译期看不出来，只能靠测试或真机崩溃报告）。

### 4.28 "空 CSS 不注入" ≠ "把注入过的样式撤掉"（2026-09-26 实测：按站隐藏的"放回来"没生效）

- 症状：按站隐藏里点"恢复"，记忆里确实空了，但页面上的元素还是 `display: none`——要等下一次导航
  才看得见。
- 根因：恢复走的是"重新计算 CSS → 注入"。那次的实现里 CSS 为空时**直接返回不注入**，而页面上
  上一次注入的那张 `<style id="deepdive-veils">` 还挂在那儿。
- 规矩：**注入式改造的撤销要显式做**——注入脚本永远跑，空 CSS 时它的职责就是把旧表撤掉
  （`old.remove()`）；"没有新东西要加"和"把加过的拿掉"是两件事。

### 4.29 标题不在导航事件里：WebKit 的 `title` 是稍后解析的，只有 KVO 能听见（2026-09-26 实测）

- 症状：浏览历史里每一条的标题都是一串 URL；标签栏/地址栏的标题也停在"那一刻"的值上
  （同一个站点，切一下标签才变对）。
- 根因：壳的观察只在导航代理事件（didCommit/didStart/didFinish）里推，而 `view.title` 常常在
  这些事件之后才解析出来；没有任何事件会再叫我们一次。于是"标题"这个字段只在有人手动
  `resync()` 时才追上。
- 走通的路：在 `BrowserHost.init` 里给 `view.title` 挂 KVO（`observe(\.title)`）→ 变了就
  `publish()`。历史那条"先写地址、真标题到了再补"（`BrowserHistory.updateTitle`）是它的下游。
- 教训：**"数据是稍后才有的"这类字段，要给它一个事件源**，别指望导航事件刚好在你需要的那一刻。

### 4.30b 严格 CSP 会拦掉注入的 `<style>`：按站隐藏"藏了但没反应"（2026-09-26 实测）

- 症状：在 `style-src 'self'`（不给 `unsafe-inline`）的页面上点"隐藏页面上的元素"，选择器记下了、
  元素却还在——`<style id="deepdive-veils">` 在 DOM 里，但它的规则不生效（实测 `display` 仍是 `block`）。
- 根因：CSP 的 `style-src` 管的是**内联样式表**，注入的 `<style>` 元素正落在这条上；而通过
  **脚本写 CSSOM**（`element.style.setProperty`）不受它管（实测 `display: none`）。
- 走通的路：注入脚本两条腿——① `<style>` 表管"以后才出现的元素"（能过 CSP 的站点）；
  ② 直接给匹配元素写 CSSOM 并打标记 `data-deepdive-veiled`（过不去 CSP 的站点靠它，撤销时按
  自己打的标记清，不碰页面自己的 inline style）。
- 教训：**"注入的样式"与"注入的脚本"受不同的策略管**——CSP 拦样式表不拦 CSSOM。凡是靠注入改页面
  外观的功能（隐藏/阅读模式/主题），都要在严格 CSP 的页面上真机试一次。

### 4.30 同步读模块缓存的地方，不会因为缓存变了而重画（2026-09-26 实测：地址栏补全漏掉刚访问的页）

- 症状：浏览历史已经在壳里（补全源从"SPA 自己的 localStorage"改成"壳推来的历史"之后），
  推也推到了，但地址栏的补全列表还是空的——要用手指再敲一个字符才出来。
- 根因：补全是在 **render 里同步读模块缓存**算出来的（`completeVisits()`）。壳推来新数据时
  模块缓存换了、订阅者也被通知了，可地址栏本身**没有订阅**，React 自然不会重画它。
- 走通的路：模块里加一个版本号（推送 +1）+ `useVisitsRevision()`（`useSyncExternalStore`），
  地址栏调一次，只为"缓存变了就重画"。
- 教训：凡"同步读模块级缓存"的渲染，都要问一句**谁负责在缓存变化时重画**；订阅不是给
  数据本身用的，是给 React 看的。

### 4.31 冷启动的推送走"单槽暂存"，连推两条会互相顶掉（2026-09-26 实测：地址栏补全永远是空的）

- 症状：壳在 `installBrowser`（页面还没加载）里连推 history 与 bookmarks，SPA 只收到后一条；
  地址栏补全读的就是那份被顶掉的缓存 → 普通用户不进「设置 › 浏览器」就**永远补不出东西**。
- 根因：`pushHostCommand` 在 `webView.url == nil` 时把命令放进 `pendingHostCommand`——那是
  **单条、后到覆盖**的暂存槽（为"点击意图只在新鲜时重放"设计的）。两条一起推，先到的被吃掉。
- 规矩：**冷启动不能靠壳主动推多条**。要么由 SPA 在挂载时请求（`browser-sync` 那种拉模型），
  要么把暂存槽做成队列。浏览器这一族选的是前者（`useNativeBrowser` 挂载时请求 history/bookmarks）。

### 4.32 槽位遮挡判定：探针太稀会漏掉"只压住上沿一条"的浮层（2026-09-26 用户报"面板被网页盖住"）

- 承接 §4.21 的第 3 条：可见性判定 `unobstructed` 原来只有三个探针（正中 + 两个下角）。
  能压到槽位上的浮层绝大多数**只探进页面上沿一条**——地址栏补全列表（从标签行挂下来，
  340px 宽）、工具行末尾的「…」菜单（176px）。这三根针一根都不落在它们的覆盖范围内，
  `visible` 照旧推 true，原生视图继续盖着菜单，人看到的就是"z-index 加了也没用"。
- 处置：**上沿密排一排**（步长 48px，最窄那档浮层也有 176px，谁都不漏），加正中与两个下角，
  约 30 次命中测试、每 300ms 一轮。整格均匀铺要 400+ 次，不划算——能压到槽位上的浮层只有
  "从顶条挂下来的"与"落在正中的"两类。
- 关键性质（别改坏）：`elementFromPoint` **跳过 `pointer-events: none` 的元素**，所以 tooltip
  与拾取模式的提示行天然不参与判定。收页面的前提是"有个能收指针的东西挡住了它"——这两样
  本来就点不到，收起页面只会把人正指着的东西弄没（拾取模式尤其致命：页面没了就没得点）。
- 浏览器菜单和地址补全使用同源子文档的 React portal，由 `BrowserPopupHost` 把透明 WKWebView 放到网页之上；样式与回调仍归原组件。不要在网页上裁矩形来露出底层菜单：阴影和圆角外必然露出 App 灰底，而非网页。浮层只在组件矩形内命中，点外部、Esc 或窗口尺寸变化关闭。
- 同一次事故的另一半在 §1.16：补全列表还被自己的横向滚动祖先裁掉了。**浮层被原生视图盖住**
  要分清两种死法（量 rect / 比 `scrollHeight`），只修一种会以为修完了。
- 顺带一条层序规矩：标签行 `.panel-browser-chrome` 要显式 `position: relative; z-index: 4`

### 4.33 浏览器设置页扫描 cookie 来源：主线程同步遍历 9 个浏览器 × 多个 profile = 卡死（2026-09-27 用户报"设置页打开就卡死"）

- 症状：打开「设置 → 浏览器」，整个应用卡死不响应（鼠标转圈、窗口灰掉）。
- 根因：`BrowserCookies.installed()` 在**主线程同步执行**（`MainWindowController+BrowserPrivacy.swift:77`），
  而它要遍历 **9 个浏览器**（Chrome / Edge / Arc / Brave / Dia / Vivaldi / Chromium / Firefox / Safari）
  × 每个浏览器的多个 profile（Chromium 系扫 `Default` / `Profile *` / `Guest Profile`，Firefox 扫
  `Profiles/` 下所有目录），每个都要 `contentsOfDirectory` 列目录 + `fileExists` 检查文件——
  几十次文件系统调用堆在主线程上。叠加 **macOS 14+ 的 TCC 权限检查**（"别的应用的数据"）：
  首次访问 Chrome / Edge / Brave 的数据目录时系统会做权限判定（可能触发弹窗），这是**同步阻塞**的。
- 处置：`handleBrowserCookies` 的 `.sources` / `.importSource` 两条分支都改成
  `DispatchQueue.global(qos: .userInitiated).async` 扫描，结果回主线程推送。清除数据（`.clear`）
  本来就是异步回调，不动。
- 教训：**凡是要遍历用户磁盘上"别的应用的目录"的操作，一律后台线程**——TCC 权限检查 + 多目录扫描
  在主线程上就是卡死；设置页一打开就触发的 `useEffect(() => { refresh() })` 尤其致命。
  抬到槽位之上。原生视图恒在 SPA 之上，DOM 里 z-index 再大也画不过它；浮层能从标签行探进
  页面那一格，就靠这条层序。

### 4.34 fork 引擎闭包缺原生产物：会话租约静默失败，prompt 文本被吞（2026-09-28 验收事故）

- 症状：fork 引擎构建（Stage 0）交付后，**发消息对话区全空**——用户消息和回复都不出现；引擎照常
  ready、cookie/mux 握手全绿、无任何错误事件。壳与前端零改动。
- 根因链：`collect-engine-closure.mjs` 沿 pnpm 符号链接拷「真实目录」，把
  `native/system/packages/darwin-arm64` 的**工作区源码目录**当作已发布包拷进了闭包，而
  `build:native-system` 从没跑过 → 闭包里 `@deepseek-ai/node-addon-system-darwin-arm64`
  **没有 bin/**（npm tarball 一定带）。`session-persistence-jsonl` 的文件租约用该包的 flock
  FFI：锁拿不到 → 用户消息**静默不进会话日志**。可观测特征：`session/list` 的 turnOutline
  有 turn 行但 `prompt:""`、`sessionStats.turns:0`、`tokenUsage` 全 0、会话不落盘、全程无错。
- 处置（三件套，缺一不可）：① `build-engine.sh` 增加 `build:native-system` 步骤（PATH 钉
  pinned node——build.ts 靠 `process.execPath` 找 Node-API 头文件）；② 收集器按 os/cpu 过滤
  非本机平台包（对齐 npm optional-deps 语义）+ **平台包缺 bin/ 构建期 fail-loud**；
  ③ 新增 `scripts/smoke-engine-prompt.sh`（真起引擎 → create + prompt + 断言文本回录
  turnOutline）接进构建链——**boot 冒烟全绿不证明消息能落**，readiness 只是组合装载证明。
- 排查路径存档（同类问题照走）：排除壳/前端 → 活体探针（对运行中引擎直接发 RPC 看
  turnOutline）→ 同 profile 双沙箱 A/B（fork 闭包 vs npm 闭包，逐字节 diff 引擎自有代码
  全一致，锁定第三方）→ 混合闭包（fork 结构 + npm 包覆盖）二分到单一包。
- 教训：闭包完整性必须**构建期验证**（声明的产物存在才算数），不能指望运行时静默降级兜底；
  「引擎健康」的判据是**真实 prompt 回录**，不是 readiness 行。

---

## 5. 版本角标 / 交付自检

### 5.1 版本号的唯一呈现是包名与 Info.plist（buildSha define 是死码，已删）
- 曾有"角标显示假 SHA"事故（58ecf97 之谜），当时的处置是在 vite.config define 烘焙 `__DSH_BUILD_SHA__`；后续 UI 改版角标被移除，define 变成零消费死码、其注释还在宣称存在 sidebar badge——2026-09 体检（AUD-033）删除。
- 现状态：版本以 `scripts/package-macos.sh` 从生成的 Info.plist 读取并进 DMG 文件名（xcodegen 先行、读取 fail-loud）；**不要再往 vite.config 加无人消费的 define**，加了也查不到消费者（grep src 为准）。

### 5.2 验收对象必须是 .build/release 最新包——Debug 实例会混入
- `xcodebuild test` 会产出 `.build/debug` 的 Debug app；它可能被 launchd/误点启动，**内嵌前端是旧的**，在它上面调试/验收会看到与最新代码不符的行为（2026-09-04 事故：快捷键轮在 Debug 残留实例上测，行为对不上源码）。
- 处置：验收前 `pgrep -f DeepDive.app` 核对路径含 `.build/release`；发现 Debug 实例直接杀掉换最新 Release 包。
- **macOS 26 路径级 SIGKILL（137）缓存**：同一 `.app` 路径上重嵌二进制后，内核可能对该路径缓存击杀决定——重签（`codesign --force --deep`）不解除，`node --version`/自检每次 137，而同一字节集拷到新路径正常运行（2026-09-10 实机，embed 自检 Killed:9）。处置三步：`lsregister -u <app路径>` 注销 LS 注册 → `rm -rf` 旧 app → 从可运行的副本 `cp -R` 回原路径；恢复后打包自检立即转绿。并发两条会话同时 `make package` 会互相撕封签放大此坑——打包前 `pgrep -fl "xcodebuild|embed-engine"` 确认无并行构建。
- **改包内容会破封签 —— 破签的包里嵌套 node 一启动就被内核杀（Code Signature Invalid）**：手动把新 dist 嵌进已签好的 Release 包（`sh scripts/embed-web.sh <app>`）后 `pkill`+`open`，引擎 3 连崩（日志 `failed after 3 consecutive attempts` + 「引擎异常」告警），`~/Library/Logs/DiagnosticReports/node-*.ips` 写着 `SIGKILL (Code Signature Invalid)` / `Taskgated Invalid Signature`（2026-09-12 实机两次）。**判据三步**（今天按这个顺序才定对因）：① 崩报告 signal 是 `Code Signature Invalid`；② `codesign --verify --verbose=2 <app>` —— 报 `Contents/Resources/web/**` 的 `file added/modified/missing` 说明**封签被签后写入破坏**，报 `valid on disk` 则不是这条、走上一条的路径击杀缓存；③ 把同一份 `.app` `cp -R` 到新路径跑 `Runtime/node --version` —— 能跑 = 路径级问题（上一条），照样 137 = 内容/签名问题（本条）。
  - 本条实测现场：手动 embed 后重启，引擎 3 连崩且 `make app` 的自检也 `Killed: 9`（137），但 `codesign --verify` 已是 valid（说明此时是上一楼的路径击杀，不是封签）。处置按上一条三步（`lsregister -u` → `rm -rf` → 从可运行副本 `cp -R` 回原路径）当场转绿：`node --version` 出 `v26.7.0`、引擎 ready。
  - 结论：**别把「embed-web + pkill + open」当日常快路径**——它会毒化该路径；走自带自检+重签的 `make app`，或照上一条三步把路径换干净。
  - 补充（同日复现）：**原地重建也会触发**——一次普通 `make app`（当日第二次）同样在 embed 自检处 137，`codesign --verify` 是 valid，处置仍是上一条三步（`lsregister -u` → `rm -rf` → 从 `/tmp` 的新副本 `cp -R` 回原路径），换回来即 `node --version` 正常、引擎 ready。所以这条不是"手动 embed 才会有"，而是**同一路径上反复重建**的概率事件——交付前见到 137 就按三步走，别去查代码。
  - 诊断锚点：引擎 3 连崩 / 自检 137 + `node --version` 在新路径可跑 → 路径击杀；`codesign --verify` 报 web 资源增删 → 封签。

### 5.3 交付前必截图自检（WORKING-AGREEMENTS）
- 改完样式/渲染 → 构建 → 打包 → 启动 → 截图，核对：消息流居中、无卡片、tool 行/产物/turn-tail/meta 位置、用户消息右对齐等。
- 只改用户指出的项；不质疑用户、不拿"旧实例"当借口。
- **看真实会话的配方（2026-09-24 定稿并实测，照这个走别再摸）**：`DSHMINI_OPEN_SID=session-<uuid> <app>/Contents/MacOS/DeepDive`（要直接跑二进制才带得上环境变量）→ 等 ~16s → `osascript -e 'tell application "System Events" to tell process "DeepDive" to get {position, size} of window 1'` 现取窗口矩形 → `screencapture -x -R<x,y,w,h> <png>` → PIL **粗步长**采样量边缘（逐像素全图扫会跑几分钟）。三个关键点：① **id 必须带 `session-` 前缀**——wire 上的 `sessionId` 本就带前缀（拿 `storages/workspace.json` 的 `archivedSessionIds` 对），裸 uuid 会被 `store.tsx` 的深链判定静默忽略，页面停在草稿页且**零报错**；② **窗口矩形每次现取**——位置/尺寸随用户拖动变化，写死会截到桌面；③ 屏幕上是这条会话的**哪一段取决于它的尾部**，要看工具行/代码块就挑一条尾部含 ``` 的会话（`cd $DSH_HOME/sessions && du -sk ./*/*/ | sort -rn | head -12 | awk '{print $2}' | while read d; do zstd -dc "${d}session.v3.jsonl.zstd" 2>/dev/null | tail -8 | grep -c '```'; done`——**`./` 前缀不能省**：工作区目录名以 `--` 开头，`du */*/` 会被当成选项吃掉），别去滚动（`.flow` 不吃 End/PageDown）；最后一条消息很长时视口停在这条消息的开头，看不到尾部的代码块——换一条尾部消息短的。另：启动后落在哪个界面还受 SPA 现有状态影响（实测有一次停在设置页），**截图先确认画面确实是会话流再下结论**。
- **三条死路别再试**（2026-09-24 各烧掉十几分钟）：① 无头 Chrome 开 bridge URL——没有壳就没有 vibrancy、渲染成**亮色草稿页**，深链也打不开会话（只对草稿页/纯布局改动有效）；② 发键盘或 `CGEvent` 合成滚轮——滚不动 `.flow`，且事件落在**当时最前的那个 App** 上（本日两次打进用户正在用的别的窗口，属事故级）；③ 手动 `embed-web` + `pkill` + `open` 当快路径（封签/路径击杀，见 §5.2）。
- **成本纪律（同次复盘）**：单条 grep/read 占一轮 = 5–15s 模型时间 + 每轮约 5s 固定开销；查代码/查文档要**一轮并发发多条探针**。只改样式时中间用浏览器看（草稿页足够验布局与字号），**最后一次才 `make package`**——本日为一个 `clamp` 打了两次包（各约 2.5 min）。
- 截图通道不可用时（Read 返回 CDN 回执而非像素）：如实说明"像素级目检未完成"，改用 DOM/computed-style 断言覆盖改动面（类存在性、token 变量解析值、原生 title= 归零等），绝不假装看过图。
- **假壳桥配方（2026-09-26 实测，验 SPA 半场与 wire 契约用）**：本地起一个透传代理（把桥的 `127.0.0.1:<bridge port>` 原样代理到另一个端口）并在 `</head>` 前插一段
  `window.webkit = { messageHandlers: { deepdiveHost: { postMessage }, deepdive: { postMessage } } }`，
  再用 Playwright(WebKit) 或壳里的浏览器视图打开代理 URL——SPA 以为自己跑在壳里，于是渲染原生载体那一支，
  发往壳的消息全部落进数组可供断言。两条必守：① **代理必须把 `Origin`/`Referer` 改回桥的
  `http://127.0.0.1:<bridge port>`**（桥的 Origin 全等闸会 403 掉模块脚本，页面白屏且根节点空，容易被误读成"SPA 崩了"）；
  ② **不要预先定义 `window.__deepDiveHost`**——它是 SPA 自己装的（`host.ts` 幂等 mount），抢着定义会把
  壳→SPA 那条路整条断掉（表现为"设置页读不到壳下发的值"，看着像产品 bug）。要推壳消息就调 SPA 自己那个 `dispatch`。
- **合成输入这条路是不通的**：System Events 读窗口矩形/发按键要辅助功能授权（本机实测 `不允许辅助访问` / `不允许发送按键`），
  所以"点真按钮 → 真消息进壳"这一段没法自动跑——SPA 半场用上面的假壳桥验，壳半场用 XCTest 钉解析与状态，
  剩下那条桥的投递按通用桥行为推证，并在汇报里写明未端到端跑过。

### 5.4 `xcodebuild | tail` 吞退出码：管线截尾必须落盘再截
- 事故：test.sh 先修了（输出落盘 + `|| { tail; exit 1; }`），dev.sh 漏网——`xcodebuild … | tail -5` 的管线退出码是 tail 的 0，构建失败被洗白后 embed-web 把新 web 嵌进旧 .app、`open` 成功、脚本退出码 0，坏构建静默交付。
- 处置：任何"长输出只看尾巴"的场景统一落盘法：`cmd > log 2>&1 || { tail -30 log; exit 1; }`；同类坑会复发在每一个新写的构建脚本上，评审时见 `| tail` 就要查 pipefail。

### 5.5 并行会话同仓库工作：打包竞态会打断 DSH 运行时缓存
- 事故（2026-09-05）：两个会话同时在仓库里构建/打包，`dist/.dsh-runtime-cache/<ver>` 被打断后 lib 级兄弟依赖丢失——嵌入自检通过（只验 bin.js 存在）但启动 `ERR_MODULE_NOT_FOUND: @deepseek-ai/dsh-app-boot`，引擎 3 连崩后 app 空转；同窗口还出现过另一版本号新缓存，证明确有并行写入。
- 处置：先 `rm -rf dist/.dsh-runtime-cache/<版本> && bash scripts/prepare-dsh-runtime.sh` 重建再打包；**多会话并行时打包/构建类命令前确认对方没在跑**。已知盲区：`validate_runtime` 只查 3 个嵌套 @deepseek-ai 依赖、不查 lib/node_modules 兄弟包，坏缓存能过校验（待补校验）。

### 5.6 全新机器首启黑屏：桥接把静态页也挡在引擎 503 后面，凭据拒启又焊死了闭环
- 事故（2026-09-06，分享给新用户后报告）：主窗纯黑，恢复窗「打开设置」点了还是黑。两个叠加根因：① `BridgeServer.route` 的 `guard let engineBase else 503` 排在 `serveStatic` 之前——引擎没起来时连 `index.html` 都 503，WKWebView 拿到空 body 的 503 也算导航完成（日志有 `didFinish`、无任何 JS 报错），页面就是空的、透出底层 tint；② `EngineSupervisor` 缺 `.credentials.yaml` 直接 `.failed` 不 spawn，而设置页配 Key 走的 `credentials.set` 是**引擎 RPC**——恢复窗引导的「打开设置配 Key」在设计上就不可能走通。开发机永远有凭据，这条路从未被端到端跑过。
- 处置：静态资源一律不看引擎状态（只有 `/api` 保留 503）；缺凭据照常启动引擎（引擎侧对文件缺失容忍且 watch 热发布，见 vendored `packages/credentials/credentials-local`），首启由 SPA 的新手引导卡接管（`credentials.describe` 正向确证无任何已配置密钥才出门，读失败绝不冒充"未配置"）。
- 复现/验收手法：`DSHMINI_SUPPORT_DIR=/tmp/fresh <app>/Contents/MacOS/DeepDive` 用空目录模拟全新机器（隔离锁/harness/日志，不动真实实例）；引擎 ready 后打开 bridge URL 走完配 Key → 检查 `/tmp/fresh/harness/.credentials.yaml` 落盘 → 门放行。**显示器休眠/合盖时 `screencapture -l` 截 WKWebView 只有原生 tint 层（纯黑）**——那是采集假象不是页面黑，以 `host-ready`/`[titlebar] control rects` 日志与浏览器同源渲染为准，显示器亮后再补像素图。

### 5.7 公证的签名要求：`--deep` 漏签 Resources 下散文件；hardened runtime 还需 JIT entitlements，否则公证过了引擎也崩
- 事故（2026-09-06 首跑公证）：notarytool 判 Invalid，两类错——①主程序/内嵌 node 无 hardened runtime（只有 `codesign --deep`，没带 `--options runtime --timestamp`）；②`Resources/Runtime/dsh/node_modules` 的 rg/pty.node/spawn-helper/sharp「未签名」：**`--deep` 只覆盖 Frameworks/PlugIns 等标准嵌套位置，散文件一律不碰**。
- 处置：`package-macos.sh` 最终 seal = find 全部嵌套 Mach-O **逐个签**（Developer ID + `--options runtime --timestamp`）→ 整体 seal bundle；node 单独挂 `scripts/node-entitlements.plist`——`allow-jit` 供 V8 MAP_JIT、`allow-unsigned-executable-memory` 供 koffi/libffi trampoline，**hardened runtime 默认禁可执行内存，缺一则公证通过后引擎运行即崩**。启用：`DSHMINI_NOTARY_PROFILE=DSHMINI_NOTARY make package`（凭据 `DSHMINI_NOTARY` 已存钥匙串）。
- 附（同轮踩）：Makefile 用 `sh` 调脚本（POSIX 模式 bash），脚本里进程替换 `< <()` 直接语法错——构建脚本写 POSIX 安全写法（`find -print0` 管道 + case）。

### 5.8 嵌入的运行时 node 绝不能取机器本地安装：绝对路径 dylib 在用户机器必死、库校验下连开发机都死
- 事故（2026-09-06 公证冒烟测试）：嵌入的 node 是构建机 Homebrew 的动态链接版，拖 14+ 个 `/opt/homebrew` 绝对路径 dylib。hardened runtime 自带**库校验**（只许同 Team ID/Apple 签名的库），开发机上 dyld 直接拒载（SIGABRT，引擎入口都到不了）；干净用户机器上文件根本不存在——**引擎在分发包里本来必死**，此前从未暴露，因为「缺凭据不 spawn」的 fail-loud 挡在前面，引擎 spawn 路径从未被真机端到端跑过（与 §5.6 同型：开发机成立的前提没被验证过）。
- 处置：`embed-engine.sh` 运行时二进制默认走 `scripts/prepare-node-runtime.sh`——按 `scripts/node-version.txt` 引脚拉 nodejs.org 官方发行版（自包含、仅系统框架），SHASUMS256 校验 + `dist/.node-runtime-cache` 缓存 + 并行锁；嵌入后 otool **自包含门**（只许 `@rpath/@loader_path/@executable_path`、`/usr/lib`、`/System`）挡住任何来源混入。教训：**构建机的 node/npm 只是工具链**（prepare-dsh-runtime 用的），与随包分发的运行时二进制是两回事；**公证通过 ≠ 能跑**——spctl/staple 过了还必须用签名后的二进制实跑引擎入口 + 原生模块加载（`bin.js --version` + require koffi/pty/sharp）。

### 5.9 判定"哪些文件是二进制"别对整包逐个 fork：三万文件的闭包，扫一遍要五分半
- 事故（2026-09-14 用户报告）：重建交付链（pkill → embed → 签 → open）每次都要等很久，用户点名"有点浪费时间"。
- 实测：包内文件 **3 万余**，真正的 Mach-O 只有 **12** 个。旧 `sign-app.sh` 用 `find -exec sh -c 'file -b "$1"'` 逐个判定——**每个文件起一个 shell + file 进程**，**光扫描就 5 分 33 秒**（`time` 实测），而它嵌在**每次 embed** 里，`make package` 还会再跑一遍完整签名。
- 处置（两条一起）：
  1. **分档**：开发链只需要 ①有效封印 ②稳定 code identity（TCC 按 designated requirement 记，§4.8），**逐个签嵌套是公证的要求**——所以开发档只签 bundle 本体（实测 **7.5s**，`codesign --verify --deep --strict` 通过），逐个 Mach-O + `--timestamp` 只在打包链的 `sign-app.sh --distribution` 档跑。
  2. 分发档的判定改**批量** `find -print0 | xargs -0 file`（xargs 按 ARG_MAX 自动分批），扫描 5:33 → ~1min。
- 教训：**对"几万文件的树"做逐文件外部命令判定，先算 fork 次数**——`-exec ... {} \;` 的代价是 O(文件数) 次进程创建，与文件多小无关；同类写法（grep/file/stat）在构建脚本里一律批量喂。

---

### 5.10 开发档签名：给 bundle 加 hardened runtime 却不签嵌套 = 引擎被静默 SIGKILL
- 事故（2026-09-14，本会话）：为修 TCC 把开发档签名换成 Developer ID 后，顺手加了 `--options runtime`（想"和分发包一致"），但没逐个签嵌套。结果**引擎每次启动被内核静默杀掉**：日志只有 `[engine] exited (signal 9)`，零输出，应用弹「引擎连续启动失败」恢复屏。
- 根因：包里的 `Runtime/node` 是 **Node.js Foundation** 签的（另有 node_modules 里若干原生模块），而 `--deep` 够不到 `Resources/Runtime` 这类非标准位置（§5.7 同源）。**hardened runtime 的父进程去 exec/加载跨团队签名的嵌套代码就被杀**——不加 runtime 则无此约束。
- 处置：`sign-app.sh` 分档写清——
  - **开发档**＝`codesign --force --deep -s <Developer ID>`，**不带 `--options runtime`**（与仓库原来的 adhoc `--deep` 开发档同构，只是身份换成 Developer ID 以保住 TCC 授权）。实测 7.8s。
  - **分发档**（`--distribution`）＝逐个 Mach-O + `--options runtime` + `--timestamp`，node 补 JIT entitlements。实测 ~1:20。
- 判别式：**"分发包要求"与"开发档够用"是两回事**——把分发档的严格配置照搬到开发档，换来的是"编译通过、应用装死"。
- 附带修掉的一个自伤：批量判定 Mach-O 时不能用默认的「路径: 描述」分隔去 `cut -d: -f1`——**胖二进制**会多出一行 `路径 (for architecture x86_64): ...`，路径尾巴挂着后缀，签的是不存在的文件（`FAIL: ... (for architecture x86_64)`）。改成 `file -F $'\t'` + 去后缀 + `sort -u`。

---

---

### 5.11 `embed-web` 不会替你构建前端：dist 陈旧会静默嵌旧包（2026-09-16 实踩）

- 事故：改完前端直接 `make app`，应用起来还是旧界面——`embed-web.sh` 只把 `frontend/dist`
  拷进包，**不跑 `npm run build`**；`make test` 也不构建（只跑 vitest）。dist 是上一次
  build 的产物，于是"改动没生效"而构建日志一路绿色。
- 处置：交付链里那条「前端 build」不是修饰语，是**必须自己先跑**的一步：
  `cd frontend && npm run build` → `make app`。判据：`ls -l frontend/dist/index.html` 的
  时间戳要新于你最后一次源码改动；`make app` 日志里的 `OK: embedded web` 只说"拷过去了"，
  不说"拷的是新的"。

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

### 6.4 hdiutil attach 报「资源暂时不可用」= 僵尸磁盘注册，重试无用
- 现象：DMG 挂载失败后反复 attach 全部同样报错，`/Volumes/<名>` 也不存在；失败的 attach 会在 diskimagesd 留下**无挂载点的注册**（`hdiutil info` 能看到对应 /dev/diskX 和 diskimages-helper 进程），把同名镜像的所有后续挂载全部挡死。
- 处置：`hdiutil info` 找到该镜像的 dev 节点 → `hdiutil detach diskX -force` 逐个清掉（helper 进程随之退出）再挂；别对着 EAGAIN 反复重试。

---

### 7.6 插件清单的 entryId 不是 patch 的 id；「未挂载」不等于「被关掉」（2026-09-16 实测）

- **patch 的 id 是「行 id」**（如 `hmr`、`session-log-deepseek`），而 `pluginInventory/list`
  给的是**运行时 entryId**（`include:hmr`）。拿 entryId 直接写 `- id: …` 的结果是引擎每条
  warn `patch: entry "include:hmr" not found`——**只 warn 不炸**，所以看着像"改了没生效"
  而不是报错。实测对照：写 `- id: hmr` + `disabled: false` 时 `--dump-config` 里那一行
  确实翻成 `disabled: false` 且零警告。
- **`enabled:false` 的正确读法是「本层没挂载它」**：本机 Loader 层 160 行里有 27 行如此
  （`tool-bash` / `tool-fs` / `skill-filesystem` / `plan-mode` …），而它们在应用里明明能用
  ——因为**模型面对的工具挂在 agent preset 组合里**（默认 `standard` 预设的 `tool-bash`
  是 `active`）。所以对工具行开关无效（拨的是那一层空壳）：插件页因此**只给真正挂载的行
  开关**，未挂载的行只显示状态文字（`frontend/src/plugins/model.ts` 的 `pluginTogglable`）。
- **注意别再把这条读成"插件不能启停"**：曾据上一段结论把设置页做成只读，2026-09-17 实机
  验证后推翻了它——启停可行且**热生效**（见下条）。
- **开关的落点与生效**：写引擎 **home 级** patch 层 `<DSH_HOME>/cordis.patch.yml` 的托管块
  （`- id: <行id>` + `disabled:`）。web profile 是 `patchReload: live`，引擎监视 profile 与
  home 两层并事务性重应用——实测写入后 ≤4s `pluginInventory/list` 即翻转
  （`enabled` true → false → true 可逆），**不需要重启引擎**。app 自有的 `engine-patch.yml`
  走 `--patch` overlay：每次启动被重写、也不在 live 监视之列，不能拿来存用户开关。
  同一个文件里 DeepDive 还写第二块托管段（MCP server 的 `- insert` 行），两块互不干扰：
  块读写原语在 `ManagedPatchBlock`，段外内容（用户手写的 patch）逐字保留。
- 「用户关掉的」与「本层没挂载」在 inventory 里都是 `enabled:false`，**必须分开**：前者靠
  托管块里有没有该行 id 判定（壳的 `PluginPatchAdmin`），混在一起会让开关看着"点了没反应"。
- 顺带：`pluginInventory/list` 的快照还带 `agentPresets`（本 profile 有 4 个 preset），
  要判断"某个工具在这台机器上开没开"，查的是预设组合行而不是 Loader 条目。
- 另一条（2026-09-17 实测）：MCP server 行用 `- insert:` 插 `@deepseek-ai/dsh-mcp-client`
  （`config: {serverName, transport, command/args 或 url}`），行 id 取 `mcp-<名字>`；同一份
  home 层 patch 里插入后同样热挂载（实测 `include:mcp-probe` → `fiberPhase: active`），
  行上的 `disabled` 字段照常生效。三个易错点：① **`transport` 的取值是
  `stdio` / `streamable-http`**（不是 `http`，写错挂不上）；② `serverName` 限
  `[A-Za-z0-9_-]{1,32}`；③ `env`/`headers` 的**值**只能是 `!!js process.env.X` 这种
  环境变量引用 —— 所以密钥由壳存进 app 侧密钥文件、spawn 引擎时注入环境变量，绝不能
  写进 patch 文件（那份是明文）。**bundle 成员的增删（如卸载插件）有启动边界**——
  引擎 README 明写 running Profile 保留启动时的 Bundle 集合，那条路必须停起进程。

### 7.7 补丁的 config 是整体替换；部署级 persona 会被 agent preset 遮蔽（2026-09-21 实测）

- **`config` 整体替换、不深合并**（`applyEntryPatches`：`target[key] = value`）。上游自己的
  补丁头就在警告这件事，而我们踩了：`EngineSupervisor.enginePatchBody` 对 `system-prompt`
  只写 `personaPrefix`，于是一经应用，web 层设的 `personaSuffix` 整段消失、退回引擎
  schema 默认的空串。实测（`scripts/dump-engine-composition.sh --patch`）：带 overlay 时
  该行 config 只剩 `personaPrefix` 一个键。
  **写任何带 config 的补丁行，必须写全该行**——不是"改哪个键写哪个键"。
- **但这不等于模型收不到那句 persona**：随包的四个 agent preset 都挂 `@deepseek-ai/dsh-persona`，
  而它 `import { PERSONA_PREFIX_SECTION } from "@deepseek-ai/dsh-system-prompt"`
  （`dsh-persona/lib/index.js:2`）并以**同一个 section 名**注册（`:37`）——即按设计
  "shadowing the deployment-wide defaults for that session"。`standard`（`agent-presets`
  的 `default`）自己就带 `suffix: Your working directory is {{cwd}}.`，所以运行时那句工作
  目录来自 preset、不是那条被改坏的宿主行。
- **已实测（2026-09-21）：部署级 `personaPrefix` 确实被遮蔽，模型收不到。** 隔离 DSH_HOME 起
  引擎 → `session/create`（回来的 `agentPreset: "standard"` 坐实会话跑在预设下）→
  `session/prompt` → 用 `Decompress` 解 `sessions/<bucket>/<id>/session.v3.jsonl.zstd`
  （多帧 zstd，一次性解只出第一帧，§1.15），读其中的 `system/message`（组装好的系统提示词）。
  四个探针串的结果：overlay 注入的 `personaPrefix` **不在**；preset 的
  `You are a coding agent powered by` 与 `Your working directory is` **都在**。
  → 壳当时那条 `systemPromptPrefix`（自动化协议、富输出围栏词表）在当前链路上
  **到不了模型**。
- **这条已在发货产品里造成过假修复**：2026-09-16 用户报"画个 svg 结果模型交付了 .svg 文件、
  对话里看不见"，当时的处置是往 `richOutputProtocolPrompt` 补一句"想让人在对话里看见就用
  围栏"——那句话经同一条 personaPrefix 注入，**在结构上不可能生效**。同类"改了没生效"
  请先按上一条实测，别只读 `--dump-config`。
- **可用的替代通道（同轮实测）**：`$DSH_HOME/AGENTS.md` 经 agent-instructions 进系统提示词，
  **不经过 persona section、不被预设遮蔽**（同一实验里把标记写进该文件，命中）。
  往这个文件写要**用托管块**（`ManagedPatchBlock`），因为用户自己也会往这个文件写
  ——整段重写会把他的内容抹掉。
- 另：**preset 是独立的 agent-plane 组合**，按包名自己挂工具（`presets/<name>/agent.cordis.yml`），
  其中 `@deepseek-ai/dsh-persona`、`dsh-tool-ask-user`、`dsh-tool-present`、`dsh-terminal*`、
  `dsh-tool-cordis` 等**不在宿主组合里**。裁剪闭包时只按宿主组合判断可达性，
  会把 preset 要用的包当成死包删掉——静态扫描（只读 JS 的 import）尤其不可信，
  它看不见这些 YAML 组合。

## 8. React 状态与表单（2026-09-05 全量体检批次沉淀）

### 8.1 手写 Context value 的 useMemo deps 是新增 state 的盲区
- 事故：store.tsx 的 value memo deps 数组漏了后加的 `keybinds/hotkeyOn`——运行中在设置页改快捷键后 memo 不重建，消费者（按键 effect）拿旧值**改键不生效**；启动期被 prefs 批量下发掩盖（lang/appearance 同时变会顺带重建 value），只在会话中改键复现。
- 处置：往 store 加 state 时**必须同步把它（和稳定 setter）写进 deps 数组**，那条 eslint-disable 挡不住漏项——改完用"运行中改这个值"手测一次，别只依赖启动路径。

### 8.2 编辑弹窗必须回填原值：空字段 ≠ 保持不变
- 事故：ModelDialog 编辑目录条目时 modelName/modelContext 初始化为空串，保存按「空值省略字段」整条替换——只改一项就把原有 name/contextWindow 静默丢掉。
- 处置：打开编辑时从数据源回填全部字段（`knownModels.find(origId)`）；「留空=省略」语义只允许用于**新增**路径。同型坑：编辑改 id 要先滤掉与新 id 撞车的其他条目，否则造出重复行。

### 8.3 setState updater 必须是纯函数：副作用靠 ref 镜像 + 快照
- 事故：mux 增量摄取把 `log.push/ingest/finalizeTurns` 写进 `setItems(prev => …)`——StrictMode dev 双调用 updater，副作用跑两遍，当时靠 seq 守卫碰巧兜住。
- 处置：副作用全部在 handler 内完成（itemsRef 同步镜像取最新列表），setState 只收快照 `setItems(itemsRef.current.slice())`。任何"现在没炸"的 updater 副作用都是定时炸弹。

### 8.4 in-flight 状态在失败路径也要复位
- 事故：自动发现模型的 catch 分支 `setError; setSaving(false); return;` 漏了 `setDiscovering(false)`——失败后"发现模型"按钮永久禁用，恰好锁死了重试入口。
- 处置：每个 setLoading/setBusy 配对检查**所有** return/catch 路径；评审口诀："搜 setState(true) 的下一处 setState(false) 在不在同一个 try 的 finally 语义里"。

### 8.5 指标先写夹具再写公式：分子分母要一眼可对
- 事故：tokensPerSecond 写成了 `解码秒数`（公式里没有 tokens 分子），渲染成 "12.5 tok/s" 实为 12.5 秒——现有测试只钉了 runMs/ttftMs，恰好漏过。
- 处置：新增派生指标时夹具必须带全输入（含 usage）并断言**带量纲的结果**；官方口径以 vendored `ui-conversation/turn-metrics` 为准（outputTokens ÷ 解码墙钟秒）。

### 8.6 依赖渲染节奏的 DOM 接线在 WS 断连期静默死亡：必须自愈，不能只靠 React 生命周期
- 事故：回到底部按钮「失效」——贴底布局的 padding-bottom 靠 ref 回调 + ResizeObserver 维护，引擎/WS 断连期间 React 长期不重渲染，ref 不重触发、RO 落在失去接线的状态上，padding 静默丢失，滚到底时末条消息被悬浮输入框盖住 ~40px（观感即「没回到最底」）。桥接页实证：悬浮区 44↔122px 变化而 pad 恒为污染值。
- 处置：这类「保测量值同步」的接线（贴底 padding、悬浮位置等）加 **1s 看门狗兜底**（syncBottomPad 每秒跑、检测观察目标变更即重挂 RO），任何断线/换节点一秒内自愈；不要赌「React 会及时重渲染」。
- **新实例（2026-09-12，测量型接线）**：统计页趋势图用「挂载期 effect 读 ref 再 `ResizeObserver`」量宽度——页面改成**缓存优先 + 渐进渲染**后，首帧还没数据（走空态分支、plot 不挂载），观察器就永远没挂上，数据到了 SVG 因 `width=0` 也不渲染（用户报"趋势图怎么坏了"）。处置：**测量类接线一律用 callback ref**（元素出现/换新即重挂 + 先给一帧实测兜底 + 旧 observer 显式 disconnect），不要赌"挂载那一刻元素已在"。

## 7. 引擎跨版本协议断裂（P2 实测，2026-08-31）

### 7.1 alpha.2 两大破坏：mux 改名 + cookie 鉴权 + unary RPC 移除
- **mux 端点改名**：rc.2 = `ws://…/api/events.mux`；alpha.2 = `ws://…/api/remote.mux`（Gateway-owned WS mux，unary RPC 也走它）。
- **浏览器鉴权强制**：`dsh web:` 打印的根 URL `?token=` 只用于 `GET /` 换**签名 cookie**（303+Set-Cookie，绑定 Host authority）；之后所有 `/api` 只认 cookie，token 放在 `/api` 路径上**无效**。无 cookie 的 unary `/api/<method>` 在 rc.2 直通、在 alpha.2 回 401 "unauthorized"；再往上 alpha.2 的 unary RPC 干脆不存在（全部 404 "not found"，官方 web 客户端走 remote.mux 流）。
- **处置**：壳侧 `EngineAuth` 每次引擎就绪先做 token→cookie 交换，`BridgeServer` 两跳（unary+WS upgrade）、`EngineGateway`、`EngineEventObserver` 统一注入 Cookie；观察器 mux 路径按候选表自适应（events.mux → remote.mux）。**引脚保持 rc.2**（SPA 的 unary 协议面成立），升 alpha.2 前必须先把前端 RPC 层移植到 mux 流协议。

- **✅ 已解决（2026-09-09 引脚升 0.1.2-rc.1，全量落地）**：unary HTTP 斜杠形 + `{args:{…}}` 包裹 + 信封 `method` 必须与端点逐字一致；`remote.mux` 多路流（`$events`/`session/follow`/`session/control`/`workspace/follow`，上行 open/cancel、下行 item/error/end）；审批/提问改 waterfall + `$events/result` 应答；改名批（`goals/*`、`subagents/*`、`agentPresets/list`、`llm/listProviders|listConfigurableProviders`、`settings/openSettingsDocument`）。现行契约全文见 `docs/DSH-WIRE.md`。历史轨迹（2026-08-31 alpha.2 移植 → c590653 回退 rc.2 → 本次二次升级）留档：alpha.2 时代 unary 面确不可用，回退是当时的正确决策；0.1.2-rc.1 的 unary 面完整（权威参数清单 = 生成客户端各包 `lib/typert.remote-client.js` 的 `parameters[].wire`——`dsh-host-apiproxy`/`UNARY_ROUTES` 已随包消亡，勿再按旧文寻址）。**embed 必须在实例停止后执行**——覆盖运行中的 node/引擎文件会被 SIGKILL（自检/启动全 137；本轮再次复证：打包竞态下引擎以 `ERR_MODULE_NOT_FOUND` 循环崩溃）。

### 7.1.1 0.1.2 升级实测新增坑（2026-09-09，全在本轮撞上并修复）
- **macOS Foundation 跟随 303 会丢 Set-Cookie**：`GET /?token=` → 303+Set-Cookie，URLSession 自动重定向后 cookie storage 为空（curl 同请求正常）——token→cookie 交换必须禁跟随重定向、直接截获 303 响应头（`EngineAuth`）。
- **remote.mux 只收文本帧**：URLSessionWebSocketTask 发二进制帧（`.data`）被引擎直接断连；开流帧必须 `.string`（`EngineEventObserver`）。
- **wire 参数不是一律扁平**：`session/*`、`workspace/*` 多为单层 `request` 包裹；`session/list` 需保留参数 `_request:{}`；`goals/*` 却是扁平 `{agentId, ref?, request?}`——**逐一对照生成客户端的 `parameters[].wire`，勿按直觉统一**。
- **chunk 打包行有两层包裹**：wire 记录是 `{type:'chunks', event:{type:'chunkrow/…', seq, time, data}}`，锚点字段在 `event` 上（非裸 ChunkRow 的 `seq0/time0`）；`frontend/src/chunkRows.ts` + `api.ts expandRecords` 负责归一展开。
- **`session/page` 的 `throughSeq` 不可猜**：必须取自 follow 开窗帧 `cursor`，超出实际值报 `gateway/bad-request "past cursor"`。
- **title 投影冷启动渐进填充**：引擎只对小 artifact 内联冷观察（`coldBlankProbeMaxBytes`），大会话标题打开观察前缺席——侧栏回退标题属官方同款行为，勿当缺陷修。
- **WKWebView 睡眠后 WS 假死（onclose 缺位）**：系统睡眠唤醒后 webview 里的 WebSocket 可能既不 `onclose` 也不 `onerror` 而帧已停（HTTP fetch 每次新连接，一切如常）——只把重连挂在 close 事件上就永不自愈，表现为会话转录永远「历史加载失败」而侧栏正常（2026-09-10 实机）。`mux.ts` 开流应答看门狗：任何开流后 5s 整条连接零下行帧即弃 socket 立即重建（每条流开流必收首帧——ready/快照/基线；静默空闲不开流、永不误杀）。后续做长驻推送类连接同坑同理：**不能只信 close 事件**。
  - **变种：快照已收、流已建立后再假死**——看门狗只护「开流等首帧」窗口，流已建立后的静默死亡没有任何 JS 侧迹象，直播事件永不抵达而 HTTP 轮询照常（状态胶囊照转、转录不动，用户报告「看不到过程和发的消息，重启才恢复」，2026-09-10 实机）。处置：壳层 `NSWorkspace.didWakeNotification` → `pushHostCommand("systemWake")` → 前端 `mux.recycle()` 无条件弃旧重建（重连每流重发快照、消费方全量替换，误杀代价为零）。
  - **变种：引擎侧流级终止（跳号 throw）**——引擎 `session/end-seed` 标记事件**占 seq 但不发布到 session/event 通知流**（`core/session/src/index.ts` firstLiveSeq 注释），follow 生成器要求通知流严格连续、跳号即抛 `gateway/internal`（`session-controller/src/history.ts` follow 循环）；`session/created` 的种子回放与后续事件通知存在竞态，长会话轮边界**间歇性**炸流（error 帧）。旧 mux 收 error/end 只注销注册、永不重开 → 该会话直播永久黑（切走再切回重挂才复活，2026-09-10 实机同日两案）。处置：`mux.dispatch` 对 error/end 按退避（1s 起步倍增至 8s 封顶，出帧复位）重开同 streamId——重开后引擎重发快照、消费方全量替换，间隙由构造补齐；这是官方客户端「可重连代际流」语义的单流简化版（`gateway/src/client/journal-stream.ts`）。**引擎侧竞态属 vendored 引脚仓，不在本仓修**。

### 7.1.2 0.1.5-rc.1 升级实测新增坑（2026-09-10，全在本轮撞上并处理）
- **会话格式 V3 是单行道**：旧日志引擎侧自动迁移（保留原文件、seq 重编号、chunk 行聚合成 settlement），**迁移后不支持降级读取**——升引脚前先整备 harness 目录（`.build/harness-backup-*`），回退 = 换回旧引擎 + 还原备份，光换引擎救不回已迁移的日志。
- **`commands/execute` 附件键改名 `images`→`submittedAttachments`**：0.1.5 参数名变了，旧键直接 `gateway/arguments-invalid missing "submittedAttachments"`——升引脚后凡带附件的调用全要改（空数组也必填）。
- **V3 直播流换通道**：流式增量不再以日志事件下发（chunk 行整体消亡），改走 follow 流的 `assistant-stream` 帧且**必须开流带 `assistantStream:true`**；快照 `assistantStream.activeAttempt.stream` 是重连基线。旧「chunk 事件→直播渲染」路径在 0.1.5 上表现为回复只在轮末一次性出现——不是 UI bug，是通道换了。
- **`/api/file?path=…` 需要桥转查询串**：壳桥 MiniHTTPServer 原本把请求行 query 剥掉，GET /api/file 经桥丢参 404——`Request.query` 保留并在 relayUnary 与引擎 token 合并（`&`拼接）。
- **TCC「文稿」授权随 adhoc 重签失效，子进程表现为 getcwd 挂死**：每次重打包换签名身份，TCC 重新要授权；弹窗被忽略/误点拒绝后，**app 自己 spawn 的子进程**（引擎）对 cwd（工作区在 ~/Documents 下）的首个 `open` 无限挂起——引擎永远打不出 `dsh web:`，表面是「引擎起不来」（2026-09-10 实机；`sample` 主线程钉在 `__getcwd → open$NOCANCEL`，shell 手动起同一二进制秒起——父进程归属不同）。处置：`tccutil reset SystemPolicyDocumentsFolder com.deepdive.app` → 重启 app → System Events 点掉弹窗「允许」（或系统设置→隐私→文件与文件夹→DeepDive 手动开）。**验收引擎起不来时先查 TCC，别先怀疑代码**。
  - **变种：授权后仍挂死（时间变异性）**——`tccutil reset` + 点「允许」后新 spawn 的子进程（乃至 zsh 直接起的）仍可能 100% CPU 钉在 `__getcwd → open$NOCANCEL`（对 cwd 的 open 悬挂；同一命令早先秒起、稍后必挂）。此时是 macOS 26 目录句柄/门控态已损坏，重启机器（或注销重登）清除。**诊断锚点：`sample <pid>` 主线程钉在 `__getcwd → open` 即为此症，勿再排查代码**。
- **`credentials/describe` 返回值从包裹变裸 map → 首启门误判「一个密钥都没配」**：0.1.2 返回 `{credentials:{ref:CredentialInfo}}`，0.1.5 直接返回 `Record<string, CredentialInfo>`（权威：钉住运行时的生成客户端声明 `dsh-api-settings-controller/lib/typert.remote-client.d.ts` 的 `describe: refs => Promise<RemoteResult<Record<string, CredentialInfo>>>`）。SPA 的 `api.credentialsDescribe` 仍按旧包裹取 `cr.credentials`，于是密钥态恒空、`configuredKnown && !anyConfigured` 成立，**每次启动都弹首启引导页**（密钥明明配好，引擎侧 `credentials/describe` 实况 configured:true）；设置页「测试连通」同样恒判「未配置」。处置：类型改裸 map、三处消费（useModelCatalog/ModelsManage）同步。（2026-09-11 撞上：重打包后交付链自检时页面上就是那道门。**升级引擎后凡"包裹层"契约都要按生成客户端 d.ts 复读一遍**，0.1.5 已有多处这类去包裹。）

### 7.2 引擎并存的第二实例会被单实例锁拦掉（exit 0 无声）
- main.swift 的 flock 单实例守卫：已有一份 DSHmini 运行时，第二个直接 `exit(0)`，无任何输出——测试新构建时极易误判"app 秒退"。
- 处置：`DSHMINI_SUPPORT_DIR=<dir>` 隔离支撑目录（P2 新增 dev 钩子），或先退掉运行中的实例。

### 7.3 settings.describe 的真实 namespace 图谱（rc.2 实测）
- `agent-default-model` = `{provider, model, reasoningEffort}`（对象，不是字符串）；`permission` = `{defaultPreset}`；`ui-theme` = `{preference}`——**都不是以 ns 名直接存标量**，写值要 `settings.update(ns, patch=整值改路径, expectedRevision)` 或 mutate ops 指向子路径。
- 凭据 ref 名从命名空间的 `apiKeyEnv` 字段发现（如 `llm-deepseek.apiKeyEnv = "DEEPSEEK_API_KEY"`），不要按 provider id 拼猜。

### 7.4 llm-pi-ai 配置段会被静默丢弃 + YAML `off` 键变布尔（2026-09-05 实测）
- 症状：`settings.describe` 没有 `llm-pi-ai` 命名空间、`llm.models` 只剩 deepseek-official，**引擎日志零报错**。
- 根因两起叠加：①引擎落盘 settings.yaml 时 `reasoningEfforts` 的 `off` 键不加引号，YAML 1.1 重读成布尔键 `false`（此后每轮启动都带着损坏键）；②配置条目在目录数据更换（嵌入时覆盖 pi-ai 数据层，见 `ARCHITECTURE §5` 模型目录新鲜度）后令路由解析失败，引擎对 llm-pi-ai 段的解析/决议失败一律**静默丢段**。
- 处置：隔离 home 二分（同配置 × 旧/新引擎对跑 + 逐条目字段矩阵）定位；先查 `settings.describe` 的 ns 清单判断段是否被丢。修复 = 把 `llm-pi-ai.providers.<id>` profile **置空**（空 profile 服务完整引擎目录，模型菜单随目录数据走）；勿再手写 models 快照——配置 models 非空即整体替换目录（`dsh-llm-pi-ai` catalog 的 `resolveRouteModels`），且混合协议路由下配置新增陌生 id 会令整路由解析失败。


### 7.5 dsh 的「导入会话」是社区插件，不是引擎内置——契约查证从 profiles/web 入手
- 事故（2026-09-06）：用户指认 dsh 有「导入会话」面板，但 vendored 源码、npm 主包 `@deepseek-ai/dsh`（含最新 0.1.2-rc.1）与官方 web 资产 grep 全部 0 命中，一度误判为"ZCode 自有功能"。真相：入口来自 **web profile 插件层**（`~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 列了社区包 `dsh-chat-import`），引擎只提供插件挂载点。
- 查证路径：先看 `~/.dsh/profiles/web/package.json` 的 bundles/dependencies，再读插件包源码（`lib/panel.mjs` 等）拿真实路由契约——不要在引擎源里死磕。
- 同场加映：`/api-import/import` 的结果条目在整源失败时只有 `status:"failed"+error` 没有数值字段，前端汇总要归一化否则 NaN；前端渐进扫描（逐来源 append）在「导入后立即 rescan」时与上一轮并发，来源行整组重复——世代守卫（ref 计数）是这类并发 setState 的最小修法。

## 9. 原生视图槽位（侧栏浏览器，2026-09-25 起）

### 9.1 原生视图恒在 SPA 之上——浮层会被它压住
- 现象：侧栏浏览器那一格是壳摆的原生 `WKWebView`（在 SPA 的 webview 之后 = 最上层）。任何与它重叠的 DOM 浮层（命令面板、模态弹窗、下拉菜单）都画在它**下面**，看不见也点不到。
- 处置：`frontend/src/nativeSlot.ts` 每次推 rect 时做**命中测试**（`elementFromPoint` 取槽位中心与两个偏差点，最上层元素不在槽位内就置 `visible:false`）。这样新增浮层不必逐个登记，槽位自己让位。
- 别改成"遍历已知浮层列表"：那是漏一个就瞎一处的写法。

### 9.2 rect 换算必须乘 pageZoom
- 现象：前端给的是 CSS px，AppKit 要的是 point；`webView.pageZoom` 是两者之间的系数。不乘它，⌘+/⌘− 之后原生视图与页面里挖的洞立刻错位。
- 另一处同源陷阱：`titlebar.ts` 的 52px 条带判定同样没有乘 pageZoom（既有的，尚未修）——缩放后条带深度在两端不一致。
- 处置：`MainWindowController.applyBrowserSlot()` 乘 `pageZoom`；窗口 resize / 全屏 / pageZoom 变化时都重算（前端重推有 300ms 兜底节奏，拖窗期间会看到原生视图浮在旧位置）。

### 9.3 缩略图态要让点击落回 SPA
- 现象：缩略图要"点它展开面板"，但原生视图在最上层，点击直接进了网页。
- 处置：`BrowserHostView.hitTest` 在 `acceptsInput == false` 时返回 nil，点击穿透到下面的 SPA；收点击与否由前端在槽位元素上声明（`data-native-slot-interactive`）。展开态才置 1，让人直接操作网页。

### 9.4 MCP 的 request 绝不能回 202
- 现象：`@deepseek-ai/dsh-mcp-client` 用 SDK 的 Streamable HTTP 客户端；对**含 id 的请求**回 202 会被客户端当成"已受理、无响应"，此后一直等到 `toolCallTimeoutMs`（默认 60s）超时——表现是"工具调用卡死一分钟然后报超时"。
- 处置：我们的 stdio server 不回 HTTP，但同样的纪律适用于任何自定义 MCP 端点：request → 200 + JSON；notification → 200 空体。
- 附带两条：不下发 `mcp-session-id`（客户端 404 后不会重新握手，壳重启就会全线失败）；`tools/list` 的 cursor 若给了就必须每次推进（重复 cursor 会让整批工具不注册）。

### 9.5 ATS 会拦内嵌浏览器的 http 站点
- 现象：`Info.plist` 只有 `NSAllowsLocalNetworking` 时，侧栏浏览器加载 `http://` 公网站点被 ATS 直接拒绝，而引擎侧的 `web_fetch` 却正常——看着像浏览器坏了。
- 处置：加 `NSAllowsArbitraryLoadsInWebContent`（只放宽 Web 内容，应用自身网络仍走默认策略）。`Info.plist` 与 `project.yml` 两处都要改（后者是生成源）。

### 9.6 表单 onChange 里"先 setState 再读 state"：查到的是上一帧的串（2026-09-26 实测）
- 事故：页内查找条 `onChange` 写成 `setQuery(e.currentTarget.value); onStep(true)`，而 `onStep` 读的是
  渲染闭包里的 `query`——每次按键查的都是**少一个字**的串，最后一个字符永远没查过；粘贴/程序化填值
  （一次 input 事件）更是整个查找都不发出去（实测 wire 上零条 `browser-find`，页面上却看不出异常）。
- 处置：把新值显式沿参数交出去（`onStep(forward, next)`），别让回调去读刚 set 的那个 state。
  凡是"事件里 setState 之后立刻要用新值"的地方，一律走参数或 ref，不留这种一帧延迟。
