# DeepDive 路线待办

> 产品路线的唯一事实源：一项一节，只写「要做什么 + 已查明的路径」；完成即删节（沿革归 git）。2026-09-11 重排：0.1.5-rc.1 对齐批（产物三动作/预览 Dock+分栏全屏/上传流式+进度取消/子代理交互/命令原生化/插件市场 v1/统计两摘要/persona 入口）已全部落地并删除；剩余项均带明确前置（§1 热加载实测、§2 鉴权设计稿、§3 公证凭据+依赖批准、§4 用户澄清范围）。

## 1. 自定义指令（Persona）—— 已按用户要求移除（2026-09-12）

设置「自定义指令」节 + 壳侧桥（`persona-get/set`）+ engine-patch 的 `id: system-prompt`
配置注入已整体删除（用户："暂时用不上，做的也不好"）。要用时按 git 历史重做入口：
persona 文本读写 `DSH_HOME/persona.json`，壳启动时经 engine-patch 覆盖 `{personaPrefix,
personaSuffix}`（值 JSON 序列化防 YAML 注入，`--dump-config` 可验挂载链路）。
用户现存 `persona.json` 未删（不再注入，随时可复用）。

## 2. 手机远程

iOS/Android 远程连接引擎：发起任务、查看进度、收通知。设计稿先行，代码后置。

**鉴权面设计草案（v1，倾向配对码 + 回环反代隧道）**：

- **形态**：手机不直连引擎端口。Mac 侧壳内置一个**回环反代隧道**（仅监听 127.0.0.1），由壳负责把已鉴权的手机连接转发到引擎桥；引擎桥的回环 + Origin 全等校验（PITFALLS §4.5）原样保留——引擎永远只信任本机。
- **对外暴露**：经隧道客户端建反连（手机 → Mac 的 relay，如 Tailscale/自建 WSS），Mac 侧不对 LAN 开任何监听端口；或后期提供「允许局域网」显式开关（默认关）。
- **配对码**：首次连接时 Mac 弹窗展示 6 位一次性配对码（60s 有效），手机输入后换取长效设备 token（壳签发、存手机钥匙串）；Mac 侧保存设备指纹清单，可在设置里吊销。配对码防「路过的人顺手连上」，token 防「每次都要掏出 Mac」。
- **会话安全**：所有手机流量走 TLS（隧道终止或壳自签）；token 走 `Authorization` 头，桥校验后才转发；读接口（转录/进度）与写接口（发起/审批）同权，不做分级。
- **收通知**：复用现有 NativeAlerts 语义，推送通道后期再议（通知即「Mac 在线时镜像」，不做离线推送）。
- **非目标**：多人共用一个引擎；手机离线消息队列。

前置：鉴权实现前先按本草案出 wire 增量（隧道握手 + token 校验在桥的落点），再动代码。

## 3. 自动更新

Sparkle：appcast + EdDSA 签名 + 增量更新。**前置：公证凭据**（`DSHMINI_NOTARY_PROFILE`）就绪后接入；发布仍本地打包（CI 无签名凭据）。**前置二：新增 Sparkle 依赖需用户批准**（铁律 7）。

## 4. 自动化页面（已实现）

`docs/SPEC-AUTOMATION.md`（已实现态）＝ 定时任务管理页：到点新开会话发指令，任务存在本机、由客户端调度（引擎无定时任务 RPC）。**开放项**：一次性计划 / 批量队列（形态见 SPEC §2，未做）；「应用关闭也照跑」需常驻代理，另立项。

## 5. 自进化（经验沉淀与校验闭环）

**已实现**：会话内采集 + 后台复盘（摩擦信号挑靶 + 日节流）→ 设置→自进化分区的待审队列 → 采纳交办落库 → 到期校验（回执块写回结论）→ 无效退役 / 手动撤销（git 回滚）+ 运行历史。政策文件 `docs/EVOLUTION-POLICY.md` + `AGENTS.md` 铁律 11 + 技能 `deepdive-evolution`。**开放项**：校验的粗判（复现次数/步数）目前靠 agent 挖日志，量大后可考虑本地索引。设计稿 `docs/SPEC-SELF-EVOLUTION.md`：会话内顺手记 + 后台隔离复盘（每累计 3 次回复一批），提案进设置里**独立的「自进化」分区**待审（Dashboard 显示累计/待审/已采纳/已退役 + 运行历史），采纳后**由 agent 在会话里写**进允许清单内的知识家（AGENTS.md / skills / PITFALLS / SPEC / 提议策略），写前留备份、提交带提案 id；到期用会话日志校验（重复事故率目标 0、流程步数目标 −30%），无效退役并把教训回流改提议策略。默认 `Propose`，其余设计逐条标了参考出处（SPEC §2/§3/§5/§11）。


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
