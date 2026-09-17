# DeepDive 路线待办

> 产品路线的唯一事实源：一项一节，只写「要做什么 + 已查明的路径」；完成即删节（沿革归 git）。2026-09-11 重排：0.1.5-rc.1 对齐批（产物三动作/预览 Dock+分栏全屏/上传流式+进度取消/子代理交互/命令原生化/插件市场 v1/统计两摘要/persona 入口）已全部落地并删除；剩余项均带明确前置（§1 热加载实测、§2 鉴权设计稿、§3 公证凭据+依赖批准、§4 用户澄清范围）。2026-09-16 与 MiMoCode 对照后补 §7-§12：三块客户端面缺口（MCP / 记忆 / 富输出）＋ 四组「引擎有包未接」＋ 三项待补 ＋ 五项待拍板。2026-09-16 富输出第一批（富输出围栏 mermaid/svg/widget，§9）落地并删除；跨会话协作、worktree 隔离、技能·插件管理三项经用户拍板转入施工（口径见 `docs/ARCHITECTURE.md` 与各 SPEC）。**技能与插件管理面、会话协作、工作树管理面已落地并删节**（跨会话协作走客户端投递路线：`session/prompt` 按 id 寻址，实测给假 id 回 `session/not-found`；外部 agent 由壳一次性跑本机 CLI；外部会话历史复用「导入」分区）**；技能与插件管理面**（设置→技能与插件：技能清单/删除走壳读盘，插件两层只读清单——实测后确认不做开关，理由见 `PITFALLS §7.6`）。

## 1. 自定义指令（Persona）—— 已按用户要求移除（2026-09-12）

设置「自定义指令」节 + 壳侧桥（`persona-get/set`）+ engine-patch 的 `id: system-prompt`
配置注入已整体删除（用户："暂时用不上，做的也不好"）。要用时按 git 历史重做入口：
persona 文本读写 `DSH_HOME/persona.json`，壳启动时经 engine-patch 覆盖 `{personaPrefix,
personaSuffix}`（值 JSON 序列化防 YAML 注入，`--dump-config` 可验挂载链路）。
用户现存 `persona.json` 未删（不再注入，随时可复用）。

## 2. 手机远程（第一、二阶段已落地）

设置 →「移动端远程控制」分两栏：**手机扫码连接**（局域网监听 + 一次性配对令牌 + 设备台账 + CoreImage 二维码）与 **Bot Channel**（IM 机器人：微信/飞书/钉钉/Telegram，含机器人管理弹窗与扫码新建）。语义、安全边界与 wire 契约见 `docs/SPEC-MOBILE-REMOTE.md`（唯一事实源）。

**剩余**：

- **机器人细项还剩两项**：别名/工作区/模型/Agent 预设/**访问策略**都已可改（`SPEC-MOBILE-REMOTE §5.4`）；**上下文增强**（`bot.context-enhancement.set`，载荷是 `{config}`，结构另议）与**投递设置**（另一渠道面 `dsh-im-delivery` 的 `target.*`）未接。
- **手机端触屏版式**：窄屏已做侧栏浮层 + 遮罩、触屏目标 44px、hover 隐藏的功能控件在触屏常显、长按代右键；还没有为触屏做完整的版式重排（如会话列表做成全屏抽屉导航）。
- 更多渠道（QQ/Slack/Discord/WhatsApp/iMessage/AI Office 等）：插件支持，`bots/im.ts` 的 `IM_CHANNELS` 加一行即可。

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

## 7. MCP 接入（引擎侧已就绪，缺挂载与设置面）

`@deepseek-ai/dsh-mcp-client` 随包分发（应用闭包 `Contents/Resources/Runtime/dsh/node_modules/@deepseek-ai/dsh-mcp-client`），但 harness home 的 web profile 既没把它列进 `dsh.profile.bundles`、也没有任何 MCP 行 → 这条能力用户拿不到。挂载形状见 `deepseek-harness/packages/mcp/mcp-client/README.md`：一个 server 一行（`name: '@deepseek-ai/dsh-mcp-client'` + `config: {serverName, transport: stdio|http, command/args/env 或 url/headers}`），工具以 `mcp__<server>__<tool>` 进工具表；默认不启任何 server，且每个 server 的工具定义都会给**每次**请求加 token（启停状态要可见）。

- **已实现（2026-09-17）**：① server 行由壳生成到 home 级 patch 层的托管块里（`McpServerAdmin`，`- insert:` 一行一 server）——**不是** `engine-patch.yml`（那是每次启动重写的 app overlay，存不了用户配置），走 `patchReload: live` 监视的 home 层，所以增删改与启停都热生效（实测 `include:mcp-probe` → `enabled` 翻转 → `fiberPhase: active`，见 `PITFALLS §7.6`）；② 设置 → 插件 → 「MCP」tab：列表 / 启停 / 增删改 / 每行的挂载状态（取该行插件的 `fiberPhase`）。
- **密钥面（2026-09-17）**：README 的挂载形状是 `env: {TOKEN: !!js process.env.X}`，值只能来自**引擎进程的环境变量** —— 所以配置源放在 app 侧（`<support>/mcp-servers.json`，要与密钥同文件、0600；也因为要生成 `!!js` 这种 YAML 原生语法，直接读写 patch 文件表示不了它），壳在 spawn 引擎时把密钥展平成 `MCP_<SERVER>_<KEY>` 注入环境，**patch 文件里只留变量名这个引用**（单测断言 patch 里不出现密钥值）。前端只回"哪些 key 已配置"、不回值（与模型 Key 同一条惯例）。
- **未做**：工具计数（引擎没有工具表 RPC，MCP client 也不暴露状态——只有日志；每行的**挂载状态**已由该行插件的 `fiberPhase` 给出）；工具行 `mcp__*` 的图标族（`frontend/src/session/toolKind.ts`）。
- 更正同段开头：`transport` 的取值是 **`streamable-http`**，不是 `http`（按 README 的字段表）。

## 8. 记忆面补齐（引擎三层已有，客户端只有审计）

引擎侧记忆齐备：会话笔记（壳桥 `memory-list`/`memory-delete`/`memory-clear`）+ 自进化 lesson + EverOS Recall 插件。客户端只有查看与删除（`frontend/src/memory/MemorySection.tsx`、`apps/macos/Sources/DSHminiApp/AppDelegate.swift` 的 `memory-*` 路由）。

- 要做什么：① 「记忆」分区补项目 / 全局两层记忆文件（跨会话）的编辑；② 检索入口（复用引擎/插件已有的检索面）；③ 会话内「记住这条」的快捷写入。
- 前置：先查清引擎与插件侧已有的可写记忆面与检索接口，客户端不自造第二份平行存储。

## 10. 引擎有包未接：持久终端 / LSP / hooks 桥 / ACP·SDK

四组能力在引擎闭包里齐备，web profile 未挂载、客户端也没有渲染位：持久终端 `deepseek-harness/packages/terminal*`（现役 shell 是逐调用新 shell）、LSP `packages/lsp*`、hooks 桥 `packages/hooks/hooks-claude-code|hooks-codex`（可零改写复用外部 `hooks.json`）、ACP 与 SDK `packages/acp`、`packages/sdk`（引擎可被外部程序驱动）。

- 要做什么：逐组「挂载 + 工具行/面板渲染位 + 设置开关」，并给每组定默认开关。
- 前置：逐组可行性摸底与工作量估；先接哪组由用户拍板。

## 11. 待补三件（对照后确认的缺口）

- 任务台账产品化：Goal 已有 active/paused/blocked/complete（`frontend/src/components/GoalBar.tsx`）、`todo_write` 进 Todos 胶囊、workflow 成员有 outcome（`frontend/src/session/ToolRow.tsx`）；缺「子任务 + 阻塞原因 + 进度日志」的独立面板。前置：先定载体（引擎 todo 投影扩展 vs 客户端自持台账），别与 Goals 语义打架。
- 权限：三档档位当前只是**新建会话的初始预设**（`frontend/src/settings/permissionPreset.ts`），会话内只能敲 `/permission`，审批卡只有允许一次 / 拒绝（`frontend/src/session/Cards.tsx`）→ 补「会话内档位显示与就地切换」+ 审批粒度。前置：确认引擎 RPC 是否支持会话内改档与更细的审批。
- 定时：自动化页六种周期（`frontend/src/automation/model.ts`：时 / 日 / 工作日 / 周 / 月 / 每 N 天）已有，缺一次性计划与任意间隔循环。前置：「关应用也跑」需要常驻代理，另立项。

## 12. 待用户拍板（2026-09-16 与 MiMoCode 对照后提出）

- worktree 并行隔离：同一工作区里多个会话各跑一个工作树（会话 cwd 不可变、沙箱根 = 引擎进程 cwd，见 `PITFALLS` 与 `ARCHITECTURE`）。**管理面已落地**（设置→工作树：建/列/删 + 注册为工作区），差的只是引擎侧把沙箱根改成 per-session 可解析的 workspace 根——那步之前，每个工作树只能作为独立工作区用。
- ACP / SDK 对外开放：是否让外部程序（编辑器、其它客户端）驱动本引擎。
- 成本口径：使用统计已有 token / 时长 / 连续天数，无成本；引擎不提供价格数据，需自带价目表。

## 期间不做

- **Agent Teams**（上游 experimental：单会话内 Lead + 命名队友 + 持久消息 + 共享任务板，四包 `experimental/agent-team*`）：用户拍板暂不用。接的话 = 挂 experimental profile + 花名册/任务板面板；地基已备——队友即 continuable 子会话，子代理续聊已落地。
- Codex/Claude Code 内置运行时（引入外部 CLI，与自包含分发冲突）。
- Skill 选择器（不渲染是显式设计）。
