# DeepDive 路线待办

> 产品路线的唯一事实源：一项一节，只写「要做什么 + 已查明的路径」；完成即删节（沿革归 git）。2026-09-11 重排：0.1.5-rc.1 对齐批（产物三动作/预览 Dock+分栏全屏/上传流式+进度取消/子代理交互/命令原生化/插件市场 v1/统计两摘要/persona 入口）已全部落地并删除；剩余项均带明确前置（§1 热加载实测、§2 鉴权设计稿、§3 公证凭据+依赖批准、§4 用户澄清范围）。

## 1. 自定义指令（Persona）设置入口 —— 实现待收口

设置「自定义指令」节已落（前缀/后缀双文本域，读写 `DSH_HOME/persona.json`，壳启动经 engine-patch 的 `id: system-prompt` 配置覆盖挂载 `{personaPrefix, personaSuffix}`，值 JSON 序列化防 YAML 注入）。**剩余收口**：引擎热加载验证（0.1.5 动态改系统提示词不破 KV Cache，需模型声明支持——对 DeepSeek-V4 系实测生效情况）；如热加载不通则明确「重启生效」文案（前端已带提示）。

## 2. 手机远程

iOS/Android 远程连接引擎：发起任务、查看进度、收通知。前置：鉴权面设计（配对码或隧道二选一，倾向配对码 + 回环反代隧道），落实后再放开桥的非回环监听；LAN 无鉴权是被 dsh-desktop 明文警告的反面教材（PITFALLS §4.5）。设计稿先行，代码后置。

## 3. 自动更新

Sparkle：appcast + EdDSA 签名 + 增量更新。**前置：公证凭据**（`DSHMINI_NOTARY_PROFILE`）就绪后接入；发布仍本地打包（CI 无签名凭据）。**前置二：新增 Sparkle 依赖需用户批准**（铁律 7）。插件市场的版本锁定/插件更新机制并入本节一起设计。

## 4. 自动化页面（SPEC 草稿待澄清）

SPEC 草稿已落 `docs/SPEC-AUTOMATION.md`（能力底座 dsh-schedule 已挂载、提议范围三档、非目标、验收口径雏形）。**前置：用户对草稿末尾问题清单勾选范围**（只要定时任务管理页，还是含一次性计划/批量队列）；澄清后按 SPEC 动工。

## 期间不做

- **Agent Teams**（上游 experimental：单会话内 Lead + 命名队友 + 持久消息 + 共享任务板，四包 `experimental/agent-team*`）：用户拍板暂不用。接的话 = 挂 experimental profile + 花名册/任务板面板；地基已备——队友即 continuable 子会话，子代理续聊已落地。
- Codex/Claude Code 内置运行时（引入外部 CLI，与自包含分发冲突）。
- Skill 选择器（不渲染是显式设计）。
