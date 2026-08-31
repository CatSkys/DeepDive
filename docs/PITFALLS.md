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

### 1.5 壳注入 CSS（WebViewTheme）与主题层叠加
- 壳级 WebViewTheme 注入的 `.agent-message{background:transparent!important}` 只是兜底；真正样式在 `frontend/src/theme.css`。两层都要同步改，不要只改一层。

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
- 处置：`user/message` 只对 `source.kind === 'user'`（真正用户输入）渲染气泡；其余注入消息过滤。

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

### 4.1 DSHmini 独立 harness home 需自带 `.credentials.yaml`
- 事故：`DSH_HOME` 指向 `~/Library/Application Support/DSHmini/harness`，无 `~/.dsh/.credentials.yaml` → LLM 每轮返回**空回复**（assistant 文本为空），且无报错。
- 处置：`EngineSupervisor.start()` 前**断言凭据存在**，缺失即 `state = .failed(...)` fail-loud，不再静默空引擎。启动时若缺，需 `cp ~/.dsh/.credentials.yaml <harness-home>/`。

### 4.2 mux 帧是 `server-request` wrapper，需解包 `payload`
- `frame = (raw.payload) || raw` 解包正确；帧类型在 `payload.type`（session/event / approval/requested …）。

---

## 5. 版本角标 / 交付自检

### 5.1 角标必须是构建时烘焙的真实 git SHA
- 曾发生角标显示非本仓库的假 SHA（"58ecf97 之谜"），用户据此判断"不是你要的版本"。根因：角标硬编码。
- 处置：`vite.config.ts` 用 `define` 烘焙 `git rev-parse --short HEAD`，Sidebar 渲染 `v-{__DSH_BUILD_SHA__}`。角标永远等于真实构建 SHA。
- 交付前用 `grep -o "v-<sha>" dist/assets/index-*.js` 核对。

### 5.2 交付前必截图自检（WORKING-AGREEMENTS）
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

### 6.3 后台 subagent 在此环境会静默失败
- 观察：`subagent`/`subagent_fork` 后台多次启动后 `failed before it finished. No closing message.`
- 处置：需要委派时用**前台等待**（`run_in_background:false`），或改为本人直接读官方源码对比。
