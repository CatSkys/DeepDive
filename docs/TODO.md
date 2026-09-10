# DeepDive 路线待办

> 产品路线的唯一事实源：一项一节，只写「要做什么 + 已查明的路径」；完成即删节（沿革归 git）。2026-09-10 对照上游 0.1.5-alpha.2 摸清差距后定序：§1-§5（一档：引擎已支持、纯客户端缺口）先行，§6 打磨批随后，§7 抬引脚等 beta/rc；分发与生态仍是评分短板（2026-09-05 review），排在其后。

## 1. 产物文件卡可点 + 产物白名单修正

ToolRow 的产物 chip 是死按钮（`session/ToolRow.tsx:261`，无 onClick）：补三个动作——预览（Lightbox 同族浮层）、默认应用打开、Finder 定位；壳已有 `reveal-path` 桥（`AppDelegate.swift:259`），另补 `open-path`（`NSWorkspace.open`）。同步把产物推导白名单改为 mutation-only：`renderModel.ts:105` 把只读 `read`/`file_read` 的成功结果也算产物，与上游 `ui-deliverables/src/client/turn-deliverables.ts` 的白名单不一致。官方交互锚点：引脚内 `ui-deliverables/src/client/ProducedFiles.tsx`（openFile/showInFolder）。

## 2. read_image 工具卡直出图片

`renderModel.ts:171-175` 的 output 归并只收 `o.text`，image 块被丢成 JSON dump：walk 补 image 块分支，工具卡复用 `AttachmentImage` 同族渲染（字节缓存上限沿用其 24 张约定）。引擎侧 `read_image` 返回 `{type:'image',attachment}`（引脚 tool-fs `read-image.ts`），PTC 嵌套调用同面。

## 3. 会话内本地图片（绝对路径）直显

`Markdown.tsx:128` 把模型回复里的 POSIX 绝对路径原样塞进 `<img src>`，WebView 以 http 为原点必 404，且无 onError 兜底：壳桥加受控读图（转 data URL，工作区外截图同样可读），加载失败显示原路径。与 §2 同属「图片进会话流」，宜同批实现与验收。

## 4. 子代理对话（接 subagents/prompt）

子会话只能只读查看 + 单条中断（`SessionView.tsx:478` 只读 Notice；`StatusCapsule.tsx:232` 中断；`api.ts:233-237` 仅 list/interruptByParent）：接引脚 runtime 已有的 `subagents/prompt` 路由，补齐发消息、排队、编辑、删除、单条/全部 Steer、停止，子会话视图升级为可续聊——补上产品语义「随时纠正」的缺口。上游锚点 `packages/client/ui-subagent`。Agent Team 的 `send_message` 组合面不接（上游 experimental）。

## 5. 自定义提供方 Base URL 校验 + maxTokens 回填

`settings/ModelDialog.tsx:302` 是全前端唯一 baseURL 触点、无任何校验：`new URL` 校验、尾斜杠规范化、无效地址即时提示（引擎兜底在 `llm-pi-ai/src/discovery.ts:87`）。顺带补 `discoverModels` 回填被丢掉的 `maxTokens`（`ModelDialog.tsx:131` 映射只取 id/name/contextWindow）。

## 6. Phase 3 二档打磨批（一档清完再排）

- 会话级统计两摘要：`sessionStats` 投影引脚已有（`DSH-WIRE.md:123`），SPA 未接；呈现挂现有 `UsageMeter`/`MessageRow` 遥测点。
- 文件预览轻量浮层：点击文件 → QuickLook 式预览（`Lightbox` 同族）。完整右侧 Sidebar/dockkit（上游 0.1.5 新增 `ui-sidebar-right`/`ui-dockkit`/`ui-sidebar-documentpreview`/`ui-sidebar-files`/`ui-open-in-app` 五包）是独立大件，单屏极简 vs 多标签分栏待产品拍板。
- 排队「发送中」态与 steering 呈现：`SessionView.tsx:166` 只渲染 `placement === "queued"`，steering 消息被隐藏；`QueueDock.tsx:18` 操作无发送前锁定。繁忙时发送钮与 placeholder 随 busyEnter 设置（`Composer.tsx:220,262`）。
- blocked 目标恢复入口（`GoalBar.tsx:105` 只有 active↔paused）。
- 内建斜杠命令说明中文化：`useComposerMenu.ts:62` 直出引擎英文 description。
- 设置入口无障碍名称：`Sidebar.tsx:347` 仅 tooltip。
- 遥测口径修正（待拍板二选一）：引擎 base 默认 `FEEDBACK_ONLY`（`bundle/base/cordis.patch.yml:193`），壳未设 `DSH_TELEMETRY_MODE`，与 `SPEC-SEMANTICS.md:201`「默认 DISABLED、客户端保持关闭」冲突——改文档口径，或壳显式注入 `DISABLED`。

## 7. 抬引擎引脚 → 0.1.5（等 beta/rc）

0.1.3→0.1.5 两个月内会话格式连跳两代（v2→V3）且不可降级，分发版升级是单行道：等格式稳定再抬，代价仅是晚拿 pi-ai 0.85.1 新模型。抬前备好两件事：

- **版本-DSH_HOME 绑定策略**：壳 `resolveEntry()` 会回落 `DSHMINI_DSH_ENTRY`/Homebrew/系统 dsh（`EngineSupervisor.swift:90-110`）；新引擎把会话迁到 V3 后，回落链上的旧 dsh 拒读（`session-persistence/src/coordinator.ts:94`），等于打不开会话。需要入口版本校验或 per-version home，并给拒读一个可读文案。
- **安装链校验扩容**：`prepare-dsh-runtime.sh:67` 只验 dsh-subagent/session/web-app 三个嵌套包；0.1.5 引入的原生依赖（node-addon-system/koffi/undici）需纳入校验 + require 冒烟（PITFALLS §5.5/§5.8 同步），并把 pi-ai 钉进校验（现可在 `^0.84.2` 内漂移）。

期间不做：Agent Teams（上游 experimental）、Codex/Claude Code 内置运行时（引入外部 CLI，与自包含分发冲突）、Skill 选择器（不渲染是显式设计）。

## 8. 插件市场

引擎侧插件装进 profile 即生效（壳已有 `--patch` overlay 与成熟的引擎重启流）。市场按「发现在前端、安装在壳侧」分工自建：SPA 市场页实时抓 GitHub topic `dsh-plugin` 做搜索与排序；安装走壳侧 暂存 → 校验 → 原子写 profile 依赖 → 提示重启引擎。参考 [ouyangyipeng/dsh-marketplace](https://github.com/ouyangyipeng/dsh-marketplace)（市场即插件，DS-Harness Desktop v0.2.0 起内置其固定版）。发现面可走引擎清单（`pluginInventory/list` 已可达）。

约束（评估时已核实）：安装必须走壳侧（wire 面无插件安装/卸载 RPC，`pluginInventory/list` 只读）；SPA 不挂官方 slots，官方插件 UI 半侧在 DeepDive 无处落地，只接引擎侧插件。红线：安装不执行脚本（`--ignore-scripts` 等价语义）、不自动更新、安装前展示源码仓库与权限面——引擎沙箱不是安全边界，进程内插件视同 bash 权限。

## 9. 自动更新

Sparkle：appcast + EdDSA 签名 + 增量更新。公证链路就绪后接入（公证见 `scripts/package-macos.sh` 的 `DSHMINI_NOTARY_PROFILE`）；发布仍本地打包（CI 无签名凭据）。

## 10. 手机远程

iOS/Android 远程连接引擎：发起任务、查看进度、收通知。前提：引擎桥目前仅回环 + Origin scheme/host/port 全等校验（PITFALLS §4.5），开放非回环访问前先设计鉴权面（配对码或隧道），LAN 模式无鉴权是被 dsh-desktop 明文警告的反面教材。

## 11. 自动化页面

用户提出的方向，具体范围待澄清；启动前先补一页 SPEC（对齐 `docs/` 现状态写作约定）再动工。
