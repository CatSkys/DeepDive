# DeepDive 路线待办

> 产品路线的唯一事实源：一项一节，只写「要做什么 + 已查明的路径」；完成即删节（沿革归 git）。2026-09-10 引擎 0.1.5-rc.1 全量对齐完成后重排：§1 Sidebar 增强、§2 上传大文件、§3 persona（待产品拍板）；§4-§6 分发与生态（部分被外部前置挡住）。

## 1. Sidebar 增强：分栏与全屏

预览 Dock v1 已落（多标签 + md/代码/HTML/PDF/图片 + 打开/定位）。剩余对齐上游 `ui-dockkit`：分栏（同屏双预览）、全屏模式、侧栏宽度拖拽。

## 2. 文件上传大文件（>32MB）

上传已走 XHR 进度/取消（`/api/session/uploadFileBinary`）。剩余：壳桥 body 上限 32MB（`MiniHTTPServer.maxBodyBytes`）之上的大文件需分块或桥侧流式管道直通；选择器阈值（壳 `maxPickFileBytes` 8MB）同步放宽。

## 3. 动态系统提示词入口（可选，产品决策）

0.1.5 引擎支持动态修改系统提示词且不破坏 KV Cache（模型需显式声明支持）。persona 有两层：部署级（system-prompt 插件配置 `{personaPrefix, personaSuffix}`，宿主配置文件）与按 agent（dsh-persona preset `{prefix, suffix, complete}`）。SPA 无入口——均需产品拍板形态（全局 persona？会话级？）+ 引擎侧挂载方案（无 settings namespace，需自定义通道）。

## 4. 自动更新

Sparkle：appcast + EdDSA 签名 + 增量更新。公证链路就绪后接入（公证见 `scripts/package-macos.sh` 的 `DSHMINI_NOTARY_PROFILE`）；发布仍本地打包（CI 无签名凭据）。插件市场的版本锁定/插件更新机制并入本节一起设计。

## 5. 手机远程

iOS/Android 远程连接引擎：发起任务、查看进度、收通知。前提：引擎桥目前仅回环 + Origin scheme/host/port 全等校验（PITFALLS §4.5），开放非回环访问前先设计鉴权面（配对码或隧道），LAN 模式无鉴权是被 dsh-desktop 明文警告的反面教材。

## 6. 自动化页面

用户提出的方向，具体范围待澄清；启动前先补一页 SPEC（对齐 `docs/` 现状态写作约定）再动工。

## 期间不做

- **Agent Teams**（上游 experimental：单会话内 Lead + 命名队友 + 持久消息 + 共享任务板，四包 `experimental/agent-team*`）：用户拍板暂不用。接的话 = 挂 experimental profile + 花名册/任务板面板；地基已备——队友即 continuable 子会话，子代理续聊已落地。
- Codex/Claude Code 内置运行时（引入外部 CLI，与自包含分发冲突）。
- Skill 选择器（不渲染是显式设计）。
