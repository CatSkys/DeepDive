# DeepDive 路线待办

> 产品路线的唯一事实源：一项一节，只写「要做什么 + 已查明的路径」；完成即删节（沿革归 git）。2026-09-11 重排：0.1.5-rc.1 对齐批（产物三动作/预览 Dock+分栏全屏/上传流式+进度取消/子代理交互/命令原生化/插件市场 v1/统计两摘要/persona 入口）已全部落地并删除；剩余项均带明确前置（§1 热加载实测、§2 鉴权设计稿、§3 公证凭据+依赖批准、§4 用户澄清范围）。2026-09-16 与 MiMoCode 对照后补 §7-§12：三块客户端面缺口（MCP / 记忆 / 富输出）＋ 四组「引擎有包未接」＋ 三项待补 ＋ 五项待拍板。2026-09-16 富输出第一批（富输出围栏 mermaid/svg/widget，§9）落地并删除；跨会话协作、worktree 隔离、技能·插件管理三项经用户拍板转入施工（口径见 `docs/ARCHITECTURE.md` 与各 SPEC）。**技能与插件管理面、工作树管理面已落地并删节**；**会话协作分区已按用户口径移除**（2026-09-19：协作改走 @ 引用会话 + 会话互发，见 §13）；**「记忆」与「自进化」两个分区已按用户口径移除**（2026-09-24：当期不好用，整条能力连壳侧脚本/技能/插件一并撤掉，原 §5/§8 两节随之删除）**；技能与插件管理面**（设置→技能与插件：技能清单/删除走壳读盘，插件两层只读清单——实测后确认不做开关，理由见 `PITFALLS §7.6`）。

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

## 10. 引擎有包未接：持久终端 / LSP / hooks 桥 / ACP·SDK

四组能力在引擎闭包里齐备，web profile 未挂载、客户端也没有渲染位：持久终端 `deepseek-harness/packages/terminal*`（现役 shell 是逐调用新 shell）、LSP `packages/lsp*`、hooks 桥 `packages/hooks/hooks-claude-code|hooks-codex`（可零改写复用外部 `hooks.json`）、ACP 与 SDK `packages/acp`、`packages/sdk`（引擎可被外部程序驱动）。

- 要做什么：逐组「挂载 + 工具行/面板渲染位 + 设置开关」，并给每组定默认开关。
- 前置：逐组可行性摸底与工作量估；先接哪组由用户拍板。

## 11. 待补三件（对照后确认的缺口）

- 任务台账产品化：Goal 已有 active/paused/blocked/complete（面板目标区 `frontend/src/components/CapsuleGoalSection.tsx`，原 GoalBar 条已并入面板）、`todo_write` 进 Todos 胶囊、workflow 成员有 outcome（`frontend/src/session/ToolRow.tsx`）；缺「子任务 + 阻塞原因 + 进度日志」的独立面板。前置：先定载体（引擎 todo 投影扩展 vs 客户端自持台账），别与 Goals 语义打架。
- 权限：三档档位当前只是**新建会话的初始预设**（`frontend/src/settings/permissionPreset.ts`），会话内只能敲 `/permission`，审批卡只有允许一次 / 拒绝（`frontend/src/session/Cards.tsx`）→ 补「会话内档位显示与就地切换」+ 审批粒度。前置：确认引擎 RPC 是否支持会话内改档与更细的审批。
- 定时：自动化页六种周期（`frontend/src/automation/model.ts`：时 / 日 / 工作日 / 周 / 月 / 每 N 天）已有，缺一次性计划与任意间隔循环。前置：「关应用也跑」需要常驻代理，另立项。

## 12. 待用户拍板（2026-09-16 与 MiMoCode 对照后提出）

- worktree 并行隔离：同一工作区里多个会话各跑一个工作树。**管理面已落地**（设置→工作树：建/列/删 + 注册为工作区），沙箱根也已经是 per-session 的（`session.header.cwd`，见 `ARCHITECTURE`）——卡住的是**会话 cwd 创建即定死**（wire 面无 cwd 变更方法），所以每个工作树只能作为独立工作区用。
- ACP / SDK 对外开放：是否让外部程序（编辑器、其它客户端）驱动本引擎。
- 成本口径：使用统计已有 token / 时长 / 连续天数，无成本；引擎不提供价格数据，需自带价目表。

## 13. 会话协作重建：@ 引用会话 + 会话互发（2026-09-19 用户拍板）

原「设置→会话协作」分区已移除：外部 agent 联系人暂不做，外部会话历史归「导入」分区。

**2026-09-19 用户拍板：协作＝接力**——新会话 @ 引用老会话接着干，原会话照常留着不动、不写交接文，接棒方自己去读原会话历史（同 Codex `codex resume` 读 rollout 的形态）。这套**引擎已落地**：`@ 引用会话`（`frontend/src/session/sessionMention.ts`，mention = `dsh-session:` URI）经宿主 agent/pre-step 注入被引用会话的**只读快照**（每消息最多 3 条 = 引擎 MAX_REFERENCES），rc.2 web profile 已装配——能力已具备，无施工项。

- 可选打磨（未拍板）：会话行菜单加「在新会话中接力」——新会话预填该会话的 @ mention，省一次 @ 搜索；属一键便捷入口，不做也不影响能力。

## 14. 2026-09-20 复盘后仍未做的项（其余已随本轮修掉）

- **附件上限只对齐到桥**：前端与壳都按桥的单请求上限（32 MB）先拦，引擎自己的
  `imageLimits` 投影（每图 20 MB / 每条 200 MB / 每消息 20 张 / 64 MP）没有读——
  超引擎限额的图片仍会在准入处被拒，只是现在会明确告诉你原因。要做得更前，得读
  会话投影或按引擎默认值内置一份。
- **搜索没有翻页**：`session/search` 的 `hasMore` 现在会提示"只显示前 20 条"，
  但没有游标翻页。
- **机器会话的待审批仍会通知**：后台会话（自动化运行）的"完成"已静默，
  但待审批/提问照旧弹——无人值守的会话挂在审批上时，通知是唯一线索。要不要给这类
  会话配"自动允许"策略是产品决定。
- **壳被 SIGKILL 时工具孙进程收不到信号**：壳侧的引擎收尾已改成 SIGTERM→等待→
  SIGKILL，且启动时按 pid+可执行路径收残留引擎；但引擎自己的子进程（bash 等）不在
  进程组里，收尾依赖引擎自己。要彻底解决得给引擎起独立进程组。

## 15. 样式类名静默失效 —— 已机械化（2026-09-21）

CSS Module 对**不存在的键返回 `undefined`**：`className={css.xxx}` 写错名字不会报错、
不会类型报错、也不会让测试变红，只是那块样式凭空消失——轻则少一层间距，重则整块
UI 不可见（2026-09-20「新建项目」弹窗就是这么"点了没反应"的：遮罩写成了本模块里
没有的 `css.modalOverlay`，那个类定义在设置页那份 `SettingsRows.module.css`）。
写样式前先在模块里确认类名存在；**引用全局 `theme.css` 的类要用字面量 className**，
经 module 引用只会拿到 undefined。

**现在有机械门了**：`frontend/scripts/check-architecture.mjs`（`make test` 会跑）对
**每个** `*.module.css` 导入绑定做同一条判定——`X.<名字>` 必须是那份 CSS 里出现过的
`.名字`。所以这条不再依赖谁记得。

**那份"待清理清单"已作废：六处全是误报**，逐条复核结果——`.on` / `.off` / `.recording` /
`.active` / `.closed` / `.tabActive` 等都以**复合选择器**形式声明在各自的 CSS 里
（如 `.toggle.on { … }`），先前那次扫描用 `^\.名字` 匹配行首，才把复合选择器漏成"缺失"。
检查器扫过全部 41 个导入文件，零真违规。（`McpTab.tsx` 的 `rs.json` / `rs.length` 同样
是误报：`rs` 确实是 CSS module 绑定，但那两个访问在文件里并不存在。）

维护方式：新增违规必须修掉；存量按指纹进 `frontend/scripts/architecture-baseline.json`，
`node frontend/scripts/check-architecture.mjs --baseline:update` 刷新（棘轮，不是垃圾桶）。
同一脚本还带一条**新文件行数上限**（300 行，与 `AGENTS.md` 一致；存量 29 个超限文件在基线里）。

## 16. 高速输出时随机出现紫色条带（2026-09-20 用户报，未修，待取证）

**现象**（用户原话）：AI 高速输出、推理的时候，时不时随机出现紫色的彩条；**很随机、
没法复现**。没改任何代码，只把查到的东西记在这里。

**已排除的（判据：内容层的紫色都是确定性的，同一段内容重渲必然同位置再出现）**——
全仓色相扫描（H 250°–330°）只有三处偏紫，都不符合"随机不可复现"：

- `theme.css:3601` 代码高亮的 `.hljs-keyword / -selector-tag / -literal / -doctag` = `#C792EA`
  → 紫色**文字**；只要输出里有代码块就出现，且每次都在同一处（另外它还是硬编码色值，
  与"手写数值即违规"冲突，属 AUD-091 同族，可并入 §15 一起清）。
- `session/ToolIcon.tsx:47` 文件类型徽标 `.css` = `#663399` → 工具行上的紫色**小方块**。
- `onboarding/Confetti.tsx`、`plugins/PluginsTab.tsx` 的紫 → 引导礼花与插件图标配色，
  不在会话输出的渲染路径上。
- mermaid 图表：`rich/mermaidRender.ts` 的 `themeVariables` 只接管了 primary/secondary/
  tertiary/line/text/node/cluster 几族，**pie / xychart / gantt / timeline / quadrant /
  gitGraph 这些图种用的是 mermaid 自己的默认色**（薰衣草/淡紫系）——若模型输出这类图会
  出现紫，但同样是确定性的（图种固定则颜色固定），与"随机"不符；顺带记下，值得实测。

**主嫌（随机、无法复现 ⇒ 指向渲染/合成层，不是我们的配色）**：会话流那条**六层渐进
backdrop-filter 渐隐带**——`theme.css:1535-1575`（`--session-fade-blur: 16px` 逐层减半，
`--session-fade-ramp` 由 SessionView 写在元素上、随滚动 0→1 连续变化）。高速输出时
转录在吸底滚动 + 高频重排，同时六个 blur 面板各自重算背景模糊，是 GPU 合成的重活；
模糊层 + 高频重绘在 WKWebView 上出彩色条带是同类事故的常见形态（本仓对这套组合已有
前科：PITFALLS 的模糊面板条目、`theme.css` 里 52 处 `backdrop-filter`）。

**下次抓到现行就按这个顺序钉死**（能省一轮瞎猜）：

1. 截图/录屏抓现行——先看紫是**文字**还是**矩形带**（文字 ⇒ 走上面那三处内容色；带/块 ⇒ 合成层）。
2. 同一段内容重渲一次：同样位置再现 = 内容色；再也复现不出 = 合成层。
3. 把 `--session-fade-blur` 置 0（或临时移除那条渐隐带）再跑同样的高速输出：消失即坐实。
4. 对照非 WKWebView：`DSHMINI_WEB_ROOT` 指向同一份 SPA、在 Safari/Chrome 里连同一桥，看是否只在这里出现。
5. 亮色主题下是否同样出现（排除主题变量参与）。
6. 记录当时的状态：输出速率、是否在自动吸底滚动、是否刚切过会话/改过窗口大小。

**处置候选**（都没做，等取证结果再定）：渐隐带降到单层固定半径；`--session-fade-ramp`
改为静止后算一次而不是连续写；减少同时可见的 blur 层数；或给模糊层加 `contain`/隔离
合成层。**别在没取证前先动**——改了也没法验证，等于把随机现象埋掉。

## 期间不做

- **Agent Teams**（上游 experimental：单会话内 Lead + 命名队友 + 持久消息 + 共享任务板，四包 `experimental/agent-team*`）：用户拍板暂不用。接的话 = 挂 experimental profile + 花名册/任务板面板；地基已备——队友即 continuable 子会话，子代理续聊已落地。
- Codex/Claude Code 内置运行时（引入外部 CLI，与自包含分发冲突）。
- Skill 选择器（不渲染是显式设计）。
