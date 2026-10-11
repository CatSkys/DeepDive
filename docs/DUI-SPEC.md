# DUI-SPEC — 对话流智能组件（Intelligent UI）契约

> 状态：M1/M2/M4 已实现（2026-10-11）；widget 桥行为细节以 `frontend/src/rich/widgetBridge.ts` 与本契约为准。

模型在回复正文里输出两种可渲染围栏，由前端拦截渲染为"对话里的原生 UI"——对齐 OpenAI Intelligent UI 的产品形态（文本 + 交互组件混排、随流式渐进出现、交互直接变成后续回合）：

| 围栏 | 管什么 | 实现 |
|---|---|---|
| ` ```ui ` | **结构化交互组件**（词表八种）：统一设计基调、免沙箱、直接回调 | `frontend/src/rich/ui/` |
| ` ```widget ` | **自由 HTML**（媒体播放器、自定义布局）：沙箱 iframe + 受控桥 | `frontend/src/rich/WidgetBlock.tsx` + `widgetBridge.ts` |

路由偏好由壳侧部署提示词（`apps/macos/Sources/DSHminiApp/DeploymentPrompt.swift` 的 `uiComponentPrompt`，落在 `<DSH_HOME>/AGENTS.md` 托管块，PITFALLS §7.7）教给模型：**结构化交互优先 `ui`；词表表达不了的自由 HTML（含媒体）才走 `widget`**。词表教学段落必须与本文及 `types.ts` 同步改动。

## 1. `ui` 围栏

围栏体是 **JSON 数组**，每项一个组件。解析（`rich/ui/parse.ts`）：

- **流式（围栏未闭合）**：已闭合的项逐个解析渲染——组件随生成逐个出现；最后一项是暂定态，合规就提前上屏、不合规只挂占位，**绝不判失败**（PITFALLS §3.7）。
- **闭合后严格**：任何一项 JSON.parse 失败或形状校验不过、数组没闭合、`]` 后有残渣 → 整块退回代码块显示原文（与其他富输出围栏同一降级纪律，不吞内容）。
- 单围栏 200KB 总闸（`RICH_FENCE_MAX_CHARS`），超限退回源码。

## 2. 组件词表 v1

形状的唯一事实源是 `frontend/src/rich/ui/types.ts`，形状校验的唯一实现是 `frontend/src/rich/ui/validate.ts`（校验函数 `componentOf`）；超限/类型不符 = 该项无效。字段上限的意图是挡滥用，不是协议版本。

| type | 字段 | 说明 |
|---|---|---|
| `card` | `title?` `text?`(Markdown) `tone?`("neutral"\|"warn") `actions?` | 摘要卡；text 经 Markdown 渲染链（不执行 HTML） |
| `actions` | `buttons[]` | 独立按钮组 |
| `stat` | `label` `value`(string\|number) `hint?` | 大数字卡 |
| `table` | `columns[]` `rows[][]` | ≤8 列 × ≤200 行；单元格 string\|number |
| `compare` | `title?` `options[]` | 2–4 列对比，每列 `title` + `points[]` |
| `form` | `title?` `fields[]` `submit{label,send}` | 受控表单；字段 `type`: text\|number\|select\|slider，`name` 必须是 `[a-zA-Z_][a-zA-Z0-9_]{0,31}` |
| `steps` | `items[]` `active?` | 步骤器；active 越界拒收 |
| `chart` | `chart`("bar"\|"line"\|"pie") `title?` `labels[]` `series[]` | 手绘 SVG；每条 series 的 `values` 长度必须等于 `labels` 长度；色板 = tokens 的 chart series1..5 |

按钮统一 `{ label, send }`。**send 是点击后作为用户下一轮逐字发出的消息**——所选值必须由模型显式嵌进这句话（快照语义：组件状态不回传、旧组件不跨调用更新，与 OpenAI/CopilotKit 同一口径）。表单的 `send` 用 `{{字段名}}` 占位，提交时按当前值填充（`form.tsx` 的 `fillTemplate`）。

发送通道：会话页与悬浮卡共用 `useSessionSend`（`session/useSessionActions.ts`）——会话运行中走 `steer`（插队）、空闲走 `queue`（开轮），与 Composer 空闲分支同一语义。回调引用稳定的契约见 `useSessionActions.ts` 头注。

样式纪律（PITFALLS §1.14）：`.flow/.md *` 的 background 被全局 `!important` 清掉——组件卡只有描边，动作按钮一律"描边 + 亮字"；样式全走语义变量（`--ink*`/`--line*`/`--dsh-radius-*`/`--dsh-font-size-*`/`--dsh-signal-warn`/`--dsh-chart-series*`），不手写主题数值。

## 3. `widget` 沙箱与通信桥

沙箱不变：`sandbox="allow-scripts"`（无 same-origin 的不透明源——读不到 SPA 的 DOM/localStorage/cookie，无弹窗/表单提交/顶层跳转）。桥是对齐 OpenIntelligentUI `generateSandboxedUi` 的**最小受控回调面**，唯一实现 `frontend/src/rich/widgetBridge.ts`：

**媒体引用（M4）**：模型在 widget HTML 里写 `src="/api/file?path=<绝对路径>"`，挂载前 `resolveWidgetUrls` 补上 SPA origin（沙箱页相对 URL 解析不到宿主 origin）。字节走引擎 `/api/file`（video/audio 独立 512MB 上限 + RFC 7233 单段 Range，见 `engine/README.md` 偏差清单）；认证不依赖浏览器 cookie——引擎 cookie 是 `SameSite=Strict`、沙箱页带不动它，靠壳 BridgeServer 在转发侧注入（`BridgeServer.relayUnary`）。

**桥动作**（iframe → parent postMessage；父侧逐条校验后才执行）：

| 动作 | 校验 | 落点 |
|---|---|---|
| `{dsh:"sendPrompt", text}` | `event.source === iframe.contentWindow`；text 为 1..2000 字符串 | `onSend(text)` → 与 ui 按钮同一条发送路径 |
| `{dsh:"openLink", url}` | 同上；**仅 `https://`**（javascript:/http/data: 显式丢弃） | `openExternalUrl`（与 Markdown 外链同一出口） |
| `{dsh:"resize", height}` | 同上；有限数夹到 40..4000 | iframe 自适应高度（未上报时保持默认 360px） |
| `{dsh:"error", message}` | 同上；message 非空（bootstrap 限 500 字符/实例 3 条） | 错误条（用户可见）+ **运行中自动插队告知模型**；空闲出「告知 AI」按钮 |

**Agent 自声明权限（2026-10-11，用户定稿「能力交给 Agent、绝对危险自己把控」）**：模型在 widget HTML 头部写 `<meta name="dsh-perms" content="forms popups downloads modals">`，前端按白名单应用沙箱旗标（`widgetSandboxAttr`）。**`allow-same-origin` 永远结构性剥除**——srcdoc 同源旗标 = 模型 HTML 拿到宿主页面完整权限（DOM/localStorage/cookie），meta 声明了也没用，这是代码层把控不是提示词约定。摄像头/麦克风/定位无授权通路，不给。

**模型可见性**：沙箱内的 `window.error` / `unhandledrejection` 经桥回传（每实例至多 3 条），WidgetBlock 出错误条；会话**运行中**自动插队告知模型（`useWidgetErrorReport`，自愈即时），空闲时出「告知 AI」按钮——不自动开新轮。

**外观与背景（2026-10-11，交 Agent 决定）**：iframe 画布默认透明——模型画不画背景、画什么背景自己定（不画即透明融入对话）。宿主经 bootstrap 把应用外观写到沙箱的 `<html data-theme="dark|light">`（沙箱自己的 `prefers-color-scheme`，随外观切换即时翻转，PITFALLS §4.37 同一机制），模型 CSS 按主题键控即可。

iframe 内入口是注入的 bootstrap 暴露的 `window.dshui.sendPrompt/openLink`；bootstrap 同时周期上报内容高度。注入位置确定（`<head>`/`<html>` 后、纯片段串首），**同一输入永远同一输出**——srcDoc 引用稳定，iframe 不因重渲重载。目标 origin 一律 `"*"`：沙箱页本就不透明，父侧按 `event.source` 认身份而不是 origin。

安全边界（改动前必读）：桥只上行、不下行；iframe 仍是 `allow-scripts` 孤岛；`sendPrompt` 上限即用户下一轮的一条文本，不携带任何宿主状态；`openLink` 的 https 白名单是显式决定。要加第三个动作前先在这里写清它的校验与上限。

**已知边界（2026-10-11 实测，不可修复只能绕行）**：沙箱的不透明源（opaque origin）使一切依赖 storage/cookie 的跨源页面初始化即抛 SecurityError——B站等 App 类站点嵌入必黑屏；开 `allow-same-origin` 在 srcdoc 场景等于沙箱逃逸（模型 HTML 将拿到宿主同源权限），不做。B站图床/视频 CDN 另有 referer 防盗链，外链素材也拉不到。此类内容的正确形态：封面卡 + `openLink` 跳转，或直接媒体文件 URL（无防盗链的 mp4 可播）。

## 4. `embed` 围栏——外链直嵌（2026-10-11 新增，用户定稿"基于权限放开"）

` ```embed ` 围栏体是**一行 https URL**（如 B站官方外播页 `https://player.bilibili.com/player.html?bvid=<BV id>`），实现 `rich/EmbedBlock.tsx`。这类页面**不能进 srcdoc 沙箱**（不透明源必死，见上）——它们是跨源文档，用独立 URL iframe 承载：

- **许可闸门 = 用户的点击**：默认只渲染封面卡（host + URL + 说明 + 「加载外部内容」钮），点击才挂 iframe——模型不能自动内嵌任意站点。
- **加载后的隔离是结构性的**：跨源文档保留**其自身 origin**，storage/cookie 是它自己的（WebKit 分区），与宿主零共享；iframe 非 srcdoc，无同源逃逸面。沙箱旗标 `allow-scripts allow-same-origin allow-forms allow-popups` 对跨源页面只是恢复其自身能力。
- URL 校验：仅 https、单行（多余残渣整块退回源码）；`allow` 属性给 autoplay/fullscreen/PiP/encrypted-media（播放器需要）。
- 高度固定 16:9（aspect-ratio），与 widget 桥无关（跨源页面量不了高度，也不该量）。
