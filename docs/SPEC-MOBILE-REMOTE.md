# SPEC：移动端远程控制

> 状态：**第一阶段已实现**（2026-09-13，手机扫码连接）。拥有「远程访问」的产品语义与安全边界；壳桥消息清单归 `frontend/src/host.ts` 头部，HTTP/配对实现归 `apps/macos/Sources/DSHminiApp/RemoteAccess.swift`。Bot Channel（IM 机器人）见 §5「尚未做」。

## 0. 一句话

手机与这台 Mac 处在同一局域网时，**扫一次码**就用自己的浏览器打开同一个 DeepDive，接管当前工作区（看会话、发指令、批审批）。

## 1. 形态

- **入口**：设置页左侧导航的**移动端远程控制**分区。分区里是「手机扫码连接」卡片：未开启时只有一颗开启按钮 + 两行说明；开启后是状态行（等待手机连接 / 已连接 N 台设备 + 设备徽标）、二维码、「刷新二维码」「复制链接」、以及已配对设备台账（逐台解绑）。
- **关闭即断**：停止后局域网端口立刻释放，二维码与链接同时作废（令牌一并轮换）。
- **轮询**：分区开着时每 4s 拉一次壳侧快照（页面不可见时不拉），所以手机那边一连上，按钮旁边的文案自己就从「等待手机连接」变成「已连接 N 台设备」。

## 2. 安全边界（这一节是本文的重点）

手机连上等于**拿到一个能在这台 Mac 上执行命令的 agent**。三道闸：

1. **默认关闭**，只有用户在设置里显式开启才起局域网监听；关闭是默认态，重启应用恢复上次的选择。
2. **一次性配对令牌**：二维码里的 `?pair=<32 字节 hex>` 落地成功即轮换（`RemoteAccess.admit`），截屏/拍屏拿到的旧二维码立刻作废。令牌只在内存里，不落盘。
3. **设备台账**：cookie 只在台账里认。未知/伪造 cookie 一律 401；解绑立刻生效（下一条请求就进不来）。

其余纪律：

- **判定顺序是「先 cookie 后令牌」**：已配对的手机刷新页面时会重放带 `?pair=` 的旧 URL，若令牌优先，那次刷新会因为令牌已轮换而被拒。
- 设备 cookie 带 `HttpOnly`（脚本读不到）与 `SameSite=Lax`（跨站页面带不上）——WebSocket 握手不受 CORS 约束，`SameSite` 是远程面 WS 的唯一准入依据，不能省。
- 远程面还要求 **Origin 与 Host 同源**（`BridgeServer.originMatchesHost`）：挡的是「拿着 A 站 cookie 的跨站页面」，真正的准入仍是台账。
- 只有局域网，**没有公网隧道**：不做内网穿透、不做端口转发指引。要跨网用，用户自己接 Tailscale 这类组网。
- 远程面与回环桥**分监听**：回环端口是桌面 WebView 的 origin（PITFALLS §4.17），不能跟着远程开关变动；远程面另起一个 `0.0.0.0` 监听、自己的固定端口（首次开启记下，后面沿用，二维码链接才活过重启）。

## 3. 数据与状态

- 令牌：内存（进程级），开启/刷新/停止时轮换。
- 设备台账：`UserDefaults` 的 `deepdive.remote.devices`（id / kind / pairedAt / lastSeen）。`kind` 由 UA 归类成 `iphone`/`ipad`/`android`/`mac`/`web`，**展示文案归前端 i18n**，壳不产 UI 字符串。
- `lastSeen` 写盘按 60s 节流——静态资源请求很密，不能每个都落一次盘。
- 二维码：壳侧用系统 CoreImage 生成 PNG data URL（`QRCode.swift`）。**不引第三方 QR 库，也不把配对链接交给任何在线生成服务。**

## 4. 降级

- 引擎没起：二维码照出，但配对落地后前端会看到引擎不可用的既有降级（远程面与回环面共用同一套 `/api` 转发，行为一致）。
- 取不到局域网地址（Wi-Fi 关着）：不显示二维码，改显示「这台 Mac 现在没有局域网地址」，链接与复制按钮禁用。
- 纯浏览器（无壳桥）：`host.ts` 的远程通道按 `REMOTE_OFF` 空快照降级，分区显示未开启态。

## 5. Bot Channel（IM 机器人）

手机的浏览器只是「能打开工作区」；**Bot Channel 解决的是人离开这台 Mac 之后**——把工作区接到微信/飞书这类聊天工具上，从聊天窗口继续用。

### 5.1 形态与来源

渠道能力不自己造，走社区插件 `@xmanrui/dsh-im`（MIT，版本引脚 `scripts/dsh-im-version.txt`）：

- **随包分发**：`scripts/prepare-dsh-im.sh` 装出**整棵依赖闭包**（插件 + qrcode/undici/dingtalk-stream 等运行时依赖，装机时缺一个即报错），`embed-engine.sh` 拷进 `Resources/Runtime/dsh-im/`；`BotChannelPlugin.swift` 在引擎启动前铺进 `profiles/web`（与 `ChatImportPlugin` 同一套幂等纪律），并把它加进 profile 的 `dsh.profile.bundles`。
- **为什么是整棵闭包**：它的 host 面是自包含 bundle，但各渠道运行时动态 `import` 那几个 SDK——只拷插件目录会让对应渠道起不来。
- **只自建设置面**：插件给官方 web UI 配了客户端插件（`dsh.client`），我们不复刻它——它注册的**渠道面**是 HTTP 路由，我们的 SPA 直接调，省掉一整套前端移植。

### 5.2 wire 契约（实测，非 typert 网关路由）

每个渠道一个路由，**方法名不在 URL 里**：

```
POST /api/dsh-im/<渠道>            # 渠道 = weixin | feishu | dingtalk | telegram | …
Content-Type: application/json
{ type: "client-request", rpcId, method: "dsh-im/<渠道>",
  payload: { method: "<端点>", payload: { …参数 } } }
→ { type: "server-response", rpcId, result: { ok: true, value } | { ok: false, error } }
```

渠道名由插件注册时拼成 `dsh-im` + `/渠道`（其 host bundle 的 `path:\`/api/dsh-im${channel}\``）。**路由是插件按渠道注册的，插件没铺盘/该渠道没起时整条 404**——前端据此整体降级。

用到的端点（参数名取自插件客户端源码，勿猜）：

| 端点 | 参数 | 回 |
|---|---|---|
| `connection.status` | `{}` | 快照：`{state, bots[], totals{configured,connected}}` |
| `provision.begin` | `{locale}` | `{attemptId, status, verificationUrl, expiresAt, pollIntervalMs}` |
| `provision.poll` | `{attemptId}` | 同上（`status` 推进到 `connected`/`expired`/`failed`） |
| `provision.cancel` | `{attemptId}` | — |
| `bot.delete` | `{botId, confirm: true}` | 新快照 |
| `bot.workspace.set` | `{botId, workspace}` | 新快照 |

`verificationUrl` 就是二维码内容（微信给的是 `https://liteapp.weixin.qq.com/q/…`），前端把它交给**壳里那一份** CoreImage 生成器（桥指令 `qr-encode`）画码——前端不塞第二套 QR 实现。

### 5.3 前端

设置 → 移动端远程控制 的**下半栏**（用户定稿：上下排，不左右分栏）：12 个渠道各一行（微信 / 飞书 / 钉钉 / 企业微信 / 企业微信应用 / QQ / Slack / Telegram / Discord / WhatsApp / iMessage / AI Office，全部经 `/api/dsh-im/<渠道>` 实测有路由），行首是**各自的品牌标记**（路径取自随包插件的 `channel-logos.js`，MIT；单色 `currentColor` 渲染，与全站黑白体系和模型提供方图标同一套做法——不是所有渠道共用一个通用图标。数据在 `bots/channelLogos.ts`，有测试钉住"每个渠道都能解析到标记"）。行上显示真实状态（`还没有机器人` / `n 个机器人 · m 已连接` / `这个渠道现在不可用`）。

点开某行是该渠道的**机器人管理**弹窗：

- **这个渠道还没有机器人时，打开直接出二维码**（用户反馈：点开这个渠道本来就是想加机器人，不该再让点一次「新建机器人」）。用户显式取消后不再自动重开。
- 有机器人时是台账（名称 / 健康摘要 / 工作区）+ 新建 + 移除（确认式删除）。
- 配对是一条有状态流程：`begin` 拿 `verificationUrl` → 按插件给的间隔轮询 `poll` → `connected` / `expired` / `failed`；关窗即 `cancel`，不留后台尝试。

数据与动作全在 `api.im`（`api.ts` 内的 IM 渠道面）；UI 不复刻插件的状态机。

### 5.4 尚未做

- 机器人的**模型 / Agent 预设 / 回复颗粒度 / 工作区访问范围**编辑：插件有对应端点（`bot.model.set`、`bot.agent-preset.set`、`bot.context-enhancement.set`、`bot.access-policy.set`），前端还没接（当前只能在新建后看状态，改不了这些）。
- 参考图里的「飞书 中国 / Lark 全球」两行：插件里是同一个 `feishu` 渠道（Lark 是国际域名品牌），我们只列一行，不造两行驱动同一个机器人。

## 6. 尚未做（其余）

- **手机端**：窄屏已做「侧栏浮层 + 遮罩」（点遮罩收起，主列不再被挤成一条缝）与**触屏目标尺寸**（顶部按钮/会话行/设置导航/菜单项 ≤760px 时提到 44px，发送键 38px；Apple HIG 的最小触摸目标是 44），但还没有为触屏做完整的版式重排（如把会话列表做成全屏抽屉式导航）。
- 公网访问（隧道）、多用户共用一个引擎、手机离线消息队列：非目标。

