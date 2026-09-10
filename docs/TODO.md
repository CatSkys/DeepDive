# DeepDive 路线待办

> 产品路线的唯一事实源：一项一节，只写「要做什么 + 已查明的路径」；完成即删节（沿革归 git）。2026-09-10 引擎已抬至 **0.1.5-rc.1**（V3 格式、assistant-stream 直播帧、文件上传全链/子代理交互/图片直出当日全量落地）后重排：§1-§3 是对齐上游的主缺口，§4 上传体验，§5 打磨批，§6 可选产品面，§7-§10 分发与生态。Agent Teams 经评估暂不接（见文末「期间不做」）。

## 1. 产物文件卡可点 + 产物白名单修正

ToolRow 的产物 chip 是死按钮（`session/ToolRow.tsx` ProducedFiles 无 onClick）：补三个动作——预览（Lightbox 同族浮层）、默认应用打开、Finder 定位；壳已有 `reveal-path` 桥（`AppDelegate.swift`），另补 `open-path`（`NSWorkspace.open`）。同步把产物推导白名单改为 mutation-only：`renderModel.ts` 现在把只读 `read`/`file_read` 的成功结果也算产物，与上游 `ui-deliverables/src/client/turn-deliverables.ts` 的白名单不一致。官方交互锚点：引脚内 `ui-deliverables/src/client/ProducedFiles.tsx`（openFile/showInFolder）。

## 2. 自定义提供方 Base URL 校验 + maxTokens 回填

`settings/ModelDialog.tsx` 是全前端唯一 baseURL 触点、无任何校验：`new URL` 校验、尾斜杠规范化、无效地址即时提示（0.1.5 引擎侧已有兜底校验与报错，SPA 补内联反馈）。顺带补 `discoverModels` 回填被丢掉的 `maxTokens`（映射只取 id/name/contextWindow）。

## 3. 右侧 Sidebar 文件预览族（大件，单独立项评估）

上游 0.1.5 主打：多标签/分栏/全屏侧栏 + Markdown/代码高亮/HTML/PDF/图片五类预览；模型显式交付的文件可预览、默认应用打开、文件管理器定位；子代理与未激活会话的文件同样可开。锚点包：`ui-sidebar-right`/`ui-dockkit`/`ui-sidebar-documentpreview`/`ui-sidebar-files`/`ui-open-in-app`。我们已有地基：产物 chip（§1 做完后可点）、`/api/file` 受控读图面、attachment 字节缓存。开建前先拍板形态：单屏极简浮层（QuickLook 式，§5 的轻量浮层可作前奏）vs 多标签分栏全量。

## 4. 文件上传进度与取消

现有 `fileUploads/upload` 走 base64 RPC（无进度、不可取消）。引擎另有流式面 `POST /api/session/uploadFileBinary?sessionId&name`（octet-stream，逐块落盘不聚合）+ 官方 Web Worker XHR 路由（`file-upload/src/client/runtime.ts`：`upload.onprogress` + AbortSignal 取消）。SPA 换路由后文件 chip 可显示真实百分比与取消钮；>8MB 的选择器上限也靠此路由解锁。

## 5. 打磨批

- 会话级统计两摘要：`sessionStats` 投影引擎已有，SPA 未接；呈现挂现有 `UsageMeter`/`MessageRow` 遥测点（轮数/速度一摘要、精确 token/缓存命中一摘要）。
- 排队「发送中」态与 steering 呈现：`SessionView.tsx` 只渲染 `placement === "queued"`，steering 消息被隐藏；`QueueDock.tsx` 操作无发送前锁定。繁忙时发送钮与 placeholder 随 busyEnter 设置。
- blocked 目标恢复入口：`GoalBar.tsx` 只有 active↔paused；0.1.5 语义「暂停即终止当前轮、模型不可自行恢复用户暂停的目标」已随引脚生效，恢复入口要对齐。
- 内建斜杠命令说明中文化：引擎 RPC 返回英文原文（0.1.5 的中文化在官方 UI 层），SPA 建 name→中文描述映射随界面语言切换（`useComposerMenu.ts` 直出 description 处）。
- 设置入口无障碍名称：`Sidebar.tsx` 仅 tooltip。
- 遥测口径修正（待拍板二选一）：引擎 base 默认 `FEEDBACK_ONLY`（`bundle/base/cordis.patch.yml`），壳未设 `DSH_TELEMETRY_MODE`，与 `SPEC-SEMANTICS.md`「默认 DISABLED、客户端保持关闭」冲突——改文档口径，或壳显式注入 `DISABLED`。

## 6. 动态系统提示词入口（可选，产品决策）

0.1.5 引擎支持动态修改系统提示词且不破坏 KV Cache（模型需显式声明支持）。我们没有 persona/系统提示词入口——有引擎无产品；做不做、什么形态（全局 persona？会话级？）待拍板后再排。

## 7. 插件市场

引擎侧插件装进 profile 即生效（壳已有 `--patch` overlay 与成熟的引擎重启流）。市场按「发现在前端、安装在壳侧」分工自建：SPA 市场页实时抓 GitHub topic `dsh-plugin` 做搜索与排序；安装走壳侧 暂存 → 校验 → 原子写 profile 依赖 → 提示重启引擎。参考 [ouyangyipeng/dsh-marketplace](https://github.com/ouyangyipeng/dsh-marketplace)（市场即插件，DS-Harness Desktop v0.2.0 起内置其固定版）。发现面可走引擎清单（`pluginInventory/list` 已可达）。

约束（评估时已核实）：安装必须走壳侧（wire 面无插件安装/卸载 RPC，`pluginInventory/list` 只读）；SPA 不挂官方 slots，官方插件 UI 半侧在 DeepDive 无处落地，只接引擎侧插件。红线：安装不执行脚本（`--ignore-scripts` 等价语义）、不自动更新、安装前展示源码仓库与权限面——引擎沙箱不是安全边界，进程内插件视同 bash 权限。

## 8. 自动更新

Sparkle：appcast + EdDSA 签名 + 增量更新。公证链路就绪后接入（公证见 `scripts/package-macos.sh` 的 `DSHMINI_NOTARY_PROFILE`）；发布仍本地打包（CI 无签名凭据）。

## 9. 手机远程

iOS/Android 远程连接引擎：发起任务、查看进度、收通知。前提：引擎桥目前仅回环 + Origin scheme/host/port 全等校验（PITFALLS §4.5），开放非回环访问前先设计鉴权面（配对码或隧道），LAN 模式无鉴权是被 dsh-desktop 明文警告的反面教材。

## 10. 自动化页面

用户提出的方向，具体范围待澄清；启动前先补一页 SPEC（对齐 `docs/` 现状态写作约定）再动工。

## 期间不做

- **Agent Teams**（上游 experimental：单会话内 Lead + 命名队友 + 持久消息 + 共享任务板，四包 `experimental/agent-team*`）：用户拍板暂不用。接的话 = 挂 experimental profile + 花名册/任务板面板；地基已备——队友即 continuable 子会话，子代理续聊已落地。
- Codex/Claude Code 内置运行时（引入外部 CLI，与自包含分发冲突）。
- Skill 选择器（不渲染是显式设计）。
