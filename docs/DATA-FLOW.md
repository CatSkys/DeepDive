# 外向数据流披露 — 什么东西会离开这台机器

> 这份文档存在的理由：引擎的组合现在归本仓（`engine/profile/`），我们**删掉了遥测**、
> 也决定了哪些 provider 面可用——那就得说清楚"我们到底往外发什么"。一份含糊的隐私说明
> 比没有更糟，所以下面每条都注明**判据**，并单列一节写明**没审计到的部分**。

**方法**：读代码与配置（`apps/macos/Sources/`、`frontend/src/`、`engine/profile/` 与
bundle 内各插件的 README/实现），**没有做网络抓包**。所以这是"按实现推断的外发面"，
不是实测流量。凡标注"未审计"的，就是我没查到/没查完的。

## 1. 运行时 — 引擎（Node 子进程）

| 面 | 触发 | 去向 | 带什么数据 |
|---|---|---|---|
| 模型调用 | 每次发消息与每一步工具 | 配置的 provider 端点（默认 `deepseek-official`） | 会话上下文：你的消息、工作区**被读取文件的内容**、工具结果、附件 |
| 联网工具 `web_search` | 模型自行决定调用 | DeepSeek 的搜索面 | 查询词 |
| 联网工具 `web_fetch` | 模型自行决定调用 | **模型给出的任意 URL** | 该 URL 的请求（工作区外） |
| `llm/discoverModels` | 设置里拉取/测试模型列表 | 对应 provider 的 `/models` | API Key（只发不存） |
| 附件上传 | 你附图片/文件 | 本机（经桥）；随后随模型调用一起发出 | 附件字节 |
| MCP server | 你在设置里配了之后 | 你填的 command（stdio）或 URL | 取决于该 server |
| IM Bot Channel | 你启用了某渠道 | 该平台服务器（微信/飞书/钉钉/企微/QQ/Slack/Telegram/Discord/WhatsApp/iMessage/AI Office） | 该渠道的消息与会话内容 |
| 遥测 | **已移除** | — | 组合里不再有 `session-telemetry-otel`（`engine/profile/cordis.patch.yml` 的移除清单） |

## 2. 运行时 — 壳（Swift）

| 面 | 触发 | 去向 | 带什么数据 |
|---|---|---|---|
| 与引擎通信 | 全程 | **本机 `127.0.0.1`**（BridgeServer / EngineAuth 的 URLSession 都指向它） | 会话数据不出机 |
| 语音听写 | 你按听写键 | **Apple 的语音识别服务**（见下） | 麦克风音频 |
| 打开链接 / 文件 / 在访达中显示 | 你点击 | 默认浏览器或对应 App | 该 URL/路径 |
| 移动端远程访问 | 你显式开启 | 局域网**入向**监听 | — |

**听写这条要留意**：识别语言现在显式解析（`DictationController.resolveLocale`——默认构造
`SFSpeechRecognizer()` 取 `Locale.current`，而本 app 未声明本地化，那会恒落回英文，
是 2026-09-21 用户实测报的"一直是英文"的根因）。但**没有设 `requiresOnDeviceRecognition`**
——macOS 的 Speech 框架在未强制本地识别时**可以走 Apple 的服务器**。锁成本地识别是一行的
事，但会让不支持本地识别的语言直接不可用，所以是产品决定，没擅自改。每次开始听写会落一行
日志记下选中的语言（`[dictation] locale …`），排查"识别成英文"时那是第一现场。

## 3. 运行时 — SPA（WKWebView）

| 面 | 触发 | 去向 | 说明 |
|---|---|---|---|
| 引擎 RPC 与流 | 全程 | 经桥到本机引擎 | — |
| 正文里的远程图片 | 模型输出的 markdown 带 `http(s)` 图片 | 该图片主机 | `Markdown.tsx` 只把**单斜杠**路径改写到本机 `/api/file`；`http(s)` 原样交给 WebKit 加载，会暴露你的 IP 与 UA |
| `widget` 围栏 | 模型输出 widget 代码块 | 那段 HTML 自己发起的任何请求 | 沙箱是 `allow-scripts` 无 `allow-same-origin`（不透明源）：读不到我们的数据，**但可以发网络请求** |
| mermaid / pdf.js / 字体 | — | **本机**（随包资产，不走 CDN） | `frontend/scripts/copy-pdfjs-assets.mjs` 与 mermaid 独立分块 |

## 4. 构建期（只发生在构建机，与终端用户无关）

- `prepare-node-runtime.sh` → nodejs.org 取钉死版本的 node。
- `prepare-dsh-runtime.sh` / `prepare-chat-import.sh` / `prepare-dsh-im.sh` → npm registry 取闭包。
- `embed-engine.sh` → raw.githubusercontent.com 取 Node 的 LICENSE（取不到只告警）。

## 5. 留在这台机器上的

- `~/Library/Application Support/DeepDive/harness/` — 会话日志（V3 事件流）、引擎设置、
  技能、`storages/`。
- `harness/.credentials.yaml` — 模型 API Key（0600）。
- `<support>/mcp-servers.json` — MCP 密钥（0600；壳 spawn 引擎时展平成环境变量注入，
  patch 文件里只留变量名）。
- `<support>/engine-patch.yml` — 每次启动重写的 overlay（应用自有装配层）。
- `harness/AGENTS.md` — 部署提示词托管块（`DeploymentPrompt`）。
- `<support>/engine.log` — 引擎日志。

## 6. 未审计（别把上面读成"全部"）

- **闭包里其余 provider 适配器**：我只逐条查了上表用到的面；裁剪后闭包里仍有约 40 个
  provider（openai / anthropic / google / bedrock / xai / groq…），都是 `lazyApi` 按需加载，
  即"不配就不发"，但我没有逐个读它们的实现。
- **`@xmanrui/dsh-im`（IM 渠道，社区包）**：只看出来"启用某渠道会连该平台"，内部行为没读。
- **`dsh-chat-import` 的 `sync` 面**：是否只读本地来源库，未逐行核实。
- **`@everos-ai/dsh-plugin` / `browser-jev`**：本机 harness home 里挂着这两个**用户自加**的
  本地插件（`profiles/web/package.json` 里是 `link:` 绝对路径），它们的实现不在本仓、我未读。
- **macOS 系统层**：Speech、通知、TCC 授权框、`NSWorkspace.open` 交出去之后的事。
- **没有抓包验证**：上表是读代码得出的，不是观测到的流量。要坐实得在真实使用中抓一遍。

## 维护

改动下列任何一处都要同步本文：`engine/profile/cordis.patch.yml`（面的增删）、
`apps/macos/Sources/` 里新增的外发调用、`frontend/src/components/Markdown.tsx` 的图片策略、
`frontend/src/rich/` 的围栏执行策略、以及 `scripts/prepare-*.sh` / `embed-engine.sh` 的取件清单。
