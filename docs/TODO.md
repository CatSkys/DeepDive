# DeepDive 路线待办

> 产品路线的唯一事实源：一项一节，只写「要做什么 + 已查明的路径」；完成即删节（沿革归 git）。2026-09-11 重排：0.1.5-rc.1 对齐批（产物三动作/预览 Dock+分栏全屏/上传流式+进度取消/子代理交互/命令原生化/插件市场 v1/统计两摘要/persona 入口）已全部落地并删除；剩余项均带明确前置（§1 热加载实测、§2 鉴权设计稿、§3 公证凭据+依赖批准、§4 用户澄清范围）。

## 1. 自定义指令（Persona）—— 已按用户要求移除（2026-09-12）

设置「自定义指令」节 + 壳侧桥（`persona-get/set`）+ engine-patch 的 `id: system-prompt`
配置注入已整体删除（用户："暂时用不上，做的也不好"）。要用时按 git 历史重做入口：
persona 文本读写 `DSH_HOME/persona.json`，壳启动时经 engine-patch 覆盖 `{personaPrefix,
personaSuffix}`（值 JSON 序列化防 YAML 注入，`--dump-config` 可验挂载链路）。
用户现存 `persona.json` 未删（不再注入，随时可复用）。

## 2. 手机远程（第一、二阶段已落地）

设置 →「移动端远程控制」分两栏：**手机扫码连接**（局域网监听 + 一次性配对令牌 + 设备台账 + CoreImage 二维码）与 **Bot Channel**（IM 机器人：微信/飞书/钉钉/Telegram，含机器人管理弹窗与扫码新建）。语义、安全边界与 wire 契约见 `docs/SPEC-MOBILE-REMOTE.md`（唯一事实源）。

**剩余**：

- **机器人细项编辑**：模型 / Agent 预设 / 回复颗粒度 / 工作区访问范围。插件的端点都在（`bot.model.set`、`bot.agent-preset.set`、`bot.context-enhancement.set`、`bot.access-policy.set`），前端还没接——目前新建后可看状态但不能改这些。
- **手机端触屏版式**：窄屏已做侧栏浮层 + 遮罩，但没有完整的触屏排版（顶部按钮 34×34，低于 44 建议值）。
- 更多渠道（企业微信/QQ/Slack/Discord/WhatsApp/iMessage）：插件支持，`bots/im.ts` 的 `IM_CHANNELS` 加一行即可。

**非目标**：公网访问（隧道 / 内网穿透）、多人共用一个引擎、手机离线消息队列。

## 3. 自动更新

Sparkle：appcast + EdDSA 签名 + 增量更新。**前置：公证凭据**（`DSHMINI_NOTARY_PROFILE`）就绪后接入；发布仍本地打包（CI 无签名凭据）。**前置二：新增 Sparkle 依赖需用户批准**（铁律 7）。

## 4. 自动化页面（已实现）

`docs/SPEC-AUTOMATION.md`（已实现态）＝ 定时任务管理页：到点新开会话发指令，任务存在本机、由客户端调度（引擎无定时任务 RPC）。**开放项**：一次性计划 / 批量队列（形态见 SPEC §2，未做）；「应用关闭也照跑」需常驻代理，另立项。

## 5. 自进化（零人审 v3，已全量落地）

七段闭环全自动：采集（会话内 lesson + 复盘 24h/7d 兜底）→ 机械门（证据逐字+锚点，壳直跑）→ 自动落地（3 条/天，沙箱作用域会话）→ 落地确认（git--grep+允许清单+文件回读）→ 到期校验（lesson-verify 宿主直跑，appliedAt 锚定）→ 无效自动撤销 → 整理环（7 天，MiMo Dream）。允许清单七家（含 global= $DSH_HOME/AGENTS.md、plugin=引擎插件热装）。会话记忆插件（Session 层）+ EverOS Recall 层（钉 1.3.1，DeepSeek 端点，api_key 待用户填 ~/.everos/everos.toml）已挂载。设计/出处/适配清单见 `docs/SPEC-SELF-EVOLUTION.md` v3 与 `docs/EVOLUTION-POLICY.md` §0。**开放项**：细粒度摩擦信号（同命令重试/重复读文件/审批被拒）待采纳率数据积累后评估；EverOS defer_extraction 上 tag 后升级引脚。

## 6. Windows 客户端

壳换平台，SPA 与引擎不动：新增 C#/.NET + WPF + WebView2 原生壳，桥在 Windows 侧重写一份。
**方案与施工图见 `docs/PLAN-WINDOWS.md`（唯一事实源，含壳能力对照、引擎监督三差异、分期）。**
**暂缓：先把 macOS 端做完善，之后再推动；期间不进施工队列。**
前置：**壳技术栈需用户批准**（铁律 7）+ 方案 §11 的视觉决策与第一期范围。
已查明的关键路径：引擎 win32-x64 由上游 CI 与专用实现背书（`deepseek-harness/.github/workflows/ci.yml`、
`packages/sandbox/sandbox-windows-acl`、`session-persistence-jsonl/src/win32.ts`）；
运行时闭包必须在 Windows 构建机准备（macOS 上的 `npm install` 只取 darwin 预编译产物）。

## 期间不做

- **Agent Teams**（上游 experimental：单会话内 Lead + 命名队友 + 持久消息 + 共享任务板，四包 `experimental/agent-team*`）：用户拍板暂不用。接的话 = 挂 experimental profile + 花名册/任务板面板；地基已备——队友即 continuable 子会话，子代理续聊已落地。
- Codex/Claude Code 内置运行时（引入外部 CLI，与自包含分发冲突）。
- Skill 选择器（不渲染是显式设计）。
