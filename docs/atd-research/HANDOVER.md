# Atd 对照调研 · 交接文档

> 本文是单线程调研的交接:对象是 **JUNERDD/Atd**(https://github.com/JUNERDD/Atd,官网 https://atd.best),目的有三——摸清这个同类竞品、解剖它的发布包与我们 DeepDive 对比、从它的设计规范里提炼可借鉴项。
> 项目全局面(架构/铁律/规范/踩坑)的家在本仓 `AGENTS.md` 与 `docs/`(`ARCHITECTURE` / `UI-SPEC` / `SPEC-SEMANTICS` / `PITFALLS` / `WORKING-AGREEMENTS`),本文不重复;本文只拥有「Atd 调研」这一件事,别处不另立——单块的深挖在本目录另立专文,并在本文登记。
> 调研时点:**Atd v0.7.12**(release 2026-10-10,仓库最近推送 2026-10-12)。素材全部固化在本目录 `assets/`(原始文件在 /tmp 会随重启消失,不要再回去找)。
> 「个人小应用」一块的时点更新到 **上游 main @ `45d4714`**(2026-10-13,release **v0.8.1**;本机安装副本 0.8.0),素材在同目录 `assets/atd-apps/`;§1-§4 的界面与设计规范素材仍是 v0.7.12 那批导出图,两者不混用。

---

## 1. 对象档案(全部实证,可直接引用)

| 事实 | 值 |
|---|---|
| 仓库 | GitHub `JUNERDD/Atd`,TypeScript 主体 + Swift 壳 + Rust(crate `file-index`/`file-index-node`),MIT,非 fork,⭐23,PR 已到 #53 |
| 版本 | v0.7.12(2026-10-10),资产:`Atd-0.7.12-arm64.dmg` 131.2 MB + `appcast.xml`(Sparkle 通道) |
| 签名 | 自签无 TeamId(`TeamIdentifier=not set`,10-10 签发),**未公证**,首启需「系统设置→隐私与安全性→仍要打开」 |
| 系统要求 | LSMinimumSystemVersion = **26.0**,Apple silicon 独占 |
| 壳 | `Contents/MacOS/Atd` 仅 9.6 MB,**LSUIElement**(无 Dock 图标);Frameworks 只有 Sparkle.framework——**不是 Electron**(Electron 必有百 MB 级 Framework);渲染层是 WKWebView + 自定义 scheme `ai-app://renderer`(见其 AGENTS.md「Native Shell And Design Boundaries」) |
| 布局 | 安装后 573 MB:`agent-service/` 399 MB(Node 服务端)+ `node/` v24.21.0 116 MB + `renderer/` 23 MB(React SPA)+ PlugIns `AtdWidgets.appex`(桌面 widget)+ Sparkle |
| 监督文档 | 它的 `AGENTS.md` 66 KB、`docs/design-source.md` 339 KB(1245 行)、README 11 KB——**三件全文已存 `assets/`**,接手人优先读前两件 |
| 协作形态 | 明显的 AI 维护仓(`.agents/`、`.claude/`、skills-lock、gitleaks、ghooks),协作纪律与我们同族 |

## 2. 血统结论(本调研最大发现)

它 `agent-service` 的依赖表直接写着 **`@earendil-works/pi-coding-agent 1.0.0` + `pi-mcp 1.0.0` + `pi-ai 1.0.0` + `pi-subagents 0.74.0` + `pi-web-access 0.35.0`**,即 **pi-mono 上游直装**;我们的引擎是 **dsh——pi-mono 的 DeepSeek 分支**——再 fork(dsh fork 见 `engine/README.md`)。两家是同血统两级派生,这解释了界面上 agent loop / 工具活动 / 轮折叠 / 审批语义的高度同构。

其余同构点(与 `docs/ARCHITECTURE.md` 三层逐项):Swift 壳 + 本地常驻 Node 服务 + React SPA;同源托管反代(它是 `ai-app://` 自定义 scheme + relay `/v1` 允许单与 `Authorization` 注入,我们是无端口话 BridgeServer 反代);凭据进 OS 钥匙串(它 `@napi-rs/keyring`,我们引擎 `credentials.*`);差异在:**它**调度用 croner 做**服务端**、带 Sparkle 自动更、带 widget、带 Memory 一级分区、带选区工具条与截图标注、个人小应用(Mini apps,深挖见 `APPS.md`);**我们**调度在客户端(SPEC-AUTOMATION)、无自动更新(TODO 已记)、路线含浏览器壳与 IM 渠道等它没有的块。

** sheds 的体积点**:它闭包不裁剪——node_modules 里 `fastify/test` 2.2 MB、`fastify/docs` 728 KB、`pi-web-access` 演示 mp4 4.9 MB、banner 1.2 MB 全在;我们 `prune-dsh-runtime.sh` 的裁剪门比它干净(此结论自带我们视角,别当成它的问题上纲)。

## 3. 界面对照速记

依据是官网 8 张 **1440×900 设计导出图**(README 声明:导出自设计稿,非运行截图,源图 `apps/website/public/cases/ui/`),本目录存了最关键的 5 张(`assets/atd-ui-*.png`)。实机 = `/Applications/Atd.app` v0.7.12,与 DMG 内拷贝 cdhash 一致(同构建,无隔离属性,已在运行);2026-10-12 用实机截图逐面对照过,未截到的面在行内如实标注。

| 面 | 观察要点 | 与我们对照 |
|---|---|---|
| 主面板 | 右侧圆角深色面板;"What can I help with?";底部输入条(+/占位/发送);左下权限胶囊 `Ask first`(常驻,不只藏会话设置);右下模型胶囊;默认 500×680、标题栏 48px(design-source.md 记档) | 语义一比一(输入/权限档/模型菜单),形态是"单任务无边侧栏" |
| 会话流 | 每轮一行 `✓ Worked for 18s · GPT-6 Astra · 62.4 tok/s ⓘ`(耗时+模型+速度+ⓘ详情);过程折叠 `Thought once · Ran 2 tools >` | 我们有轮折叠与「已工作 X」披露,没晒速度/模型/ⓘ——数据类提案,不合反拷贝红线,可议 |
| 选区工具条 | 选中浮出胶囊 `Ask Atd · Translate · Summarize · Explain`,要无障碍权限 | 我们没做 |
| Mini Panel | 屏幕边缘常驻小药丸 → 保存命令菜单(Translate/Summarize/Polish writing/…) + 竖排场景图标条 | 我们的悬浮球竞形态 |
| 设置 | 独立窗;左栏 搜索+General/Models/Permissions/Commands/**Automations**/**Memory**/Apps/Extensions;右栏 provider 卡三态(账号登录/API key 已存未验证/本地 LM Studio)+ 行内模型胶囊 `GPT-5.4 400k Medium` | 我们是 WebView 内浮层(v3 定稿);它多 Memory、Apps 两分区 |

### 实机对照(2026-10-12,截图由用户提供;没截到的面不下结论)

- **主面板**:与导出图同构(greeting/底部输入条 ± 发送/左下权限胶囊/右下模型胶囊)。差异三处:①实机头部是原生三灯+「新建任务」标题,右上只有历史与设置两钮、无 ×(导出图仍画 ×,即设计稿晚于/早于「面板改用 macOS 原生窗口控件」那轮的状态,不深究);②实机新建任务页多出命令快捷行(Ask about screenshot / Explain / Extract action items,`>_` 图标+英文命令名+英文描述)与「全部命令/创建应用/我的应用」三胶囊,导出图无;③权限胶囊实机显示「自动批准」(用户权限档,与导出图 `Ask first` 同位不同值)。命令名与描述在中文界面下仍是英文——它的 i18n 未覆盖命令目录。
- **会话流**:过程折叠行「思考 N 次 · 运行了 N 个工具」与导出图「Thought once · Ran 2 tools」同构;「✓ Worked for Xs · 模型 · tok/s ⓘ」行在导出图有、实机截图时该轮仍在跑(spinner 可见)未到轮尾——实机既未证实也未证伪。
- **设置**:左栏 8 分区、搜索、头部语言选择器与导出图一致;三灯在左栏卡片内。实机现象:全局「显示或隐藏面板 ⌘⇧Space」注册失败,红色报错「无法注册此快捷键,它可能已被 macOS 或其他应用占用」——热键冲突时它显式报错而非静默。provider 三态卡未截到,不下结论。
- **Mini Panel**:右缘竖排胶囊(logo/新建/就所选文字询问/截图/⌘)与导出图一致,悬停标签「就所选文字询问 Atd」实机复现;命令卡未截到。
- **选区工具条**:实机未截到,不下结论(仅导出图)。用户另提供一张**其他工具**的划词菜单截图(浅色,Translation/Speak/Dictionary/Sentence Analysis/Improve Writing 钉选动作+Add custom AI action,疑似 Bob 一类)——作为我们 P2 划词功能的 UX 参照,不是 Atd 的实机证据。

## 4. 设计规范对照与借鉴提案(本调研核心产出)

依据:它的 `AGENTS.md` 设计章(Native Shell And Design Boundaries / shadcn Preset Fidelity / Figma Ownership / Visual Acceptance)+ `assets/design-source.md`(逐次视觉修正记档)。对照基准:本仓 `docs/UI-SPEC.md` 全文。

### 提案(全部是"提案"态:未采纳,采纳=null 需用户拍板后走 worktree 流程动 `docs/UI-SPEC.md`)

| # | 提案(精炼) | 依据(Atd) | 我们的落点 | 价值评估 |
|---|---|---|---|---|
| 1 | 设计规范机械卡点:裸 hex 色值、`style=` 内联样式进前端 CSS/JSX 即红 | 它用 `@shadcn/lint` 把 raw-color / arbitrary-value / inline-style / static-class 设为**错误**级 | 扩展 `frontend/scripts/check-architecture.mjs`,自写检查,不引新依赖 | 高——"手写数值即违规"从人盯变机器拦 |
| 2 | 玻璃所有权五条不变式(最值得):①窗口外观(NSGlassEffectView 裁角/描边/阴影/桌面混合)归原生一格所有,渲染层永不重复绘制;②一层 fill 只有一个 owner,禁止窗口/webview/root/伪元素叠 tint;③**玻璃元素任何状态不带 outset 投影/描边圈/outline,焦点环画在边框盒内**(原话:WebKit 会按 outset 效果扩大整个合成层,玻璃糊面跟着变大,"a glass element never carries outset effects in any state: states and focus rings draw inside its border box, and glass never stacks on glass");④失活窗态、降透明度态由壳经桥推送成根属性 `data-reduced-transparency`,样式认属性不认 media query(WebKit 无 prefers-reduced-transparency);⑤`drawsBackground` 私有键值依赖单点收口 | 它 AGENTS.md「Native Shell And Design Boundaries」逐字 | ①②已落地(2026-10-12,UI-SPEC §1.5,主仓 43bff886);③**实证未复现,不采纳,只记现象**——WKWebView 实测(macOS 26/27 真引擎,活体捕获):条纹底上 `blur12+--shadow-pop` 同盒与 `outline 4px` 变体,逐距离量条纹对比度,糊面严格限于 border-box(含圆角),outset 阴影只暗化不扩散,outline 环带外照常锐利;机制语境是它家用 `-apple-system-glass-material` 系统玻璃(系统画整层),我们用标准 backdrop-filter,不同机制。④记 TODO;⑤未核 | 高——③经实证未命中我们引擎,防复发价值下降 |
| 3 | 行结构守恒三条:同一动作跨行同变体同位置(Run/Switch/More 语义固定);高亮边界覆盖整行含动作钮,不许只包标题;「创建成功」做瞬态反馈,不让新行伪装选中态 | 它 AGENTS.md「List And Row Consistency」 | §3.2 / §2.1 各加一行 | 中,成本低 |
| 4 | 图标动作 tooltip 全局动词表(短动词+固定词表:More/Run/Edit/Remove/Delete/Copy/Back/Insert/Configure/Move up/Move down 及中文对应;不重复对象名;截断值 tooltip 放全文属另一类;不可用态只说明状态) | 它 AGENTS.md「操作提示文案」(见 assets/design-source.md 同名节) | §1.9 加一条:tooltip 是受词表约束的文案面,新词先登记 | 中,与我们「同一概念同一个词」高度兼容 |
| 5 | 代表宽度验收集:settings 320/480/760/1000/1280、面板 320/420/640 + 短高窗口,每个结构断点两侧都要看;**禁止把固定画布截图当响应式证明** | 它 AGENTS.md「Responsive Layouts」 | §4 验收清单加一条;手机远程面(≤760)正好适用 | 中 |
| 6 | 视觉改动双端同轮同步义务:视觉/交互改动同轮同步"文档与代码"两侧;哪边改不了,如实报未同步范围,不许宣称两边都完成 | 它 AGENTS.md「Native Shell…」倒数第二条(对 Figma↔代码) | 我们等价物 = UI-SPEC ↔ theme.css:动了值同轮回写取值记录(现存的「已复制 1.2s/1.0s」分叉就是这种欠账) | 中,把已有自觉升成义务 |
| 7 | 组件专属尺寸归属主代码,「不许每修一处就添一条全局规则」;文档表是反结算快照、随属主更新 | 它 AGENTS.md「List And Row…」末条 | §5 加一句 | 低,零成本 |
| 8 | 滚动条向面板内侧让 4px 不压边框;工具步骤行任何状态不自带底色,展开态由旋转箭头独自表达 | design-source.md「视觉约束与最新修正」 | 记为参考——它是对 Radix ScrollArea 的修法,我们禁网页滚动条;工具行 hover 填充是我们的定稿 | 记录即可 |

### 明确不借(与我们既有定稿直接冲突,接手人别再提议)

- **350 行文件上限**(它 oxfmt+SwiftLint+脚本三层强制)——我们定稿「按职责拆、不再设行数上限」(`AGENTS.md` 代码约定);不翻案
- **shadcn/Rhea 预设组件库**——我们「组件=类名配方」定稿,换库推翻 UI-SPEC §2 全部
- **provider 品牌彩色 logo**——与我们 §2.4「单色反白」定稿相反
- **Figma 图纸源工作流**(design:link/heavy Figma MCP/原型双轨)——我们有 Figma 时才是资产
- 工具行 hover 已由我们门控细化(§1.10),它的「hover 只留光标」与我们的 hover 填充语言冲突,各留各的

## 5. 素材索引(本目录 assets/,共 5.2 MB)

| 文件 | 是什么 |
|---|---|
| `AGENTS.md` (66 KB) | 它的全仿交接文档,设计章最有价值(§Native Shell / shadcn / Figma / Visual Acceptance) |
| `design-source.md` (339 KB) | 它的设计源记录:1245 行 Figma 节点↔代码映射 + 逐次视觉修正记档 |
| `README.md` (11 KB) | 它的产品面声明(功能清单/数据与权限/签名警告) |
| `atd-ui-{main-panel,chat,selection-toolbar,mini-panel,settings}.png` | 5 张 1440×900 设计导出图 |
| `atd_repo.json` / `atd_rel.json` / `atd_tree.json` / `atd_{apps,packages,crates}.json` | 仓库/最新 release/根目录/子目录 GitHub API 快照 |
| DMG | 原件在 `~/Downloads/Atd-0.7.12-arm64.dmg`;已安装为 `/Applications/Atd.app`(与 DMG 同构建,cdhash `abf8968e…`,无隔离属性,持续在运行)。包已解剖(只挂过只读盘,已卸载)。**注**:该 DMG 已不在 `~/Downloads`,本机 `/Applications/Atd.app` 现为 0.8.0 |
| `APPS.md` + `assets/atd-apps/` | 「个人小应用(My apps)」专文与素材:create-app 技能全文与三份 references、它自己的两份立项计划(create-app、能力层)、三份契约(manifest/identity/widgets)、出处 `SOURCE.md` |
| 源码克隆 | `/Users/hanbyking/Documents/Atd-src`(本地 HEAD = v0.7.12 `b6f8bfc`,origin/main 已 fetch 至 v0.8.1+2 `1cc03af`)——`SELECTION-CAPTURE.md` 的施工底稿,后续复测先在此 `git fetch` |
| `SELECTION-CAPTURE.md` | 「截图(采集+标注)与选区工具条(划词)」专文:逐文件解剖、桥契约、权限模型、移植盘与七条提案(2026-10-13;上游 MIT,用户已获作者许可直接移植) |

复测命令(将来它出新版本时):

```sh
curl -s https://api.github.com/repos/JUNERDD/Atd/releases/latest
# 换新 DMG 后:
diskutil image attach --readOnly --mountOptions nobrowse ~/Downloads/Atd-<ver>-arm64.dmg
codesign -dv "/Volumes/Atd <ver>/Atd.app"
# 注意:hdiutil attach 变体在本机报「资源暂时不可用」,用 diskutil image attach(实测可行)
```

## 6. 接手清单(按优先级)

1. ~~实机验证~~ **已完成(2026-10-12,见 §3 实机对照)**:装包、逐面对照、差异与未实测面已记档。剩余可补测:provider 三态卡、Mini Panel 命令卡、选区工具条、Automations「无人值守拒绝审批」语义、Memory 分区
2. **提案拍板**——已定夺(2026-10-12 用户放行 8 条;#1 内联规则走 B 案=只拦全字面量静态块)。已落地:#1(架构门 bare-hex-color + inline-static-style,主仓 ddc626e0)、#2①②(UI-SPEC §1.5,主仓 43bff886);#2③ 实证未复现、只记现象(见 §4 表);#3-#7 采纳**待落地**(落点见 §4 表);#8 记为参考不进规范
3. **引擎侧 Automations 对照**——它 croner 服务端调度 vs 我们客户端调度(SPEC-AUTOMATION 已记取舍),是否立项评估,用户定
4. (可选)分包深潜:它的 `agent-service/dist/atd-agents/`(自研 agents 面)、`file-index` Rust 索引、`pi-subagents` 组合方式——未开工,起点是 DMG 里的包体与 `assets/`
5. 素材保鲜:上游仍高频发版(0.7.11→0.7.12 只隔数小时),重要复测前先拉最新 release 对照 §1 版本号
6. **个人小应用(My apps)对照已产出**(2026-10-13):见 `APPS.md` + `assets/atd-apps/`。其中 §8 的 7 条借鉴提案**仍未采纳**,待逐条裁决;它公开的最大缺口(沙箱碰不到本机)与那份未实现的能力层计划记在 `APPS.md` §10
7. **「截图与划词」已产出并落地**(2026-10-13):见 `SELECTION-CAPTURE.md`(源码级)。其 §6 提案①②(截图整块 + 划词核心)已拍板、移植落地(分支 `feat/atd-capture-selection-port`,主仓合并);提案③(Atd 命令 Island 族:进度岛/选项级联/写回链)**未搬、仍待拍板**——理由与两处接缝降级写在专文状态头;§5 风险 1(adhoc 签名每次重建掉屏幕录制与辅助功能两项授权)用户已接受,PITFALLS §11.2 记了处置

## 7. 本文维护规矩

现状态写作(不写 previously/now、不带调研叙事)、一事一家(本文就是 Atd 调研线的线级索引与总纲,2026-10-12 自 `handover-atd/` 移入;单块深挖由本目录专文拥有——`APPS.md` 拥有「个人小应用」——本文只链接不重复)、提案与结论分层(提案永远是提案,采纳与否沿线更新 §4 表与各专文自己的提案表)。调研线完结(全部提案拍板并在 docs/ 落地)后归档。**实机补测不再进行(用户 2026-10-12 定)**:对照以官方素材(导出图/README/AGENTS.md/design-source.md)与其仓内代码为准,不再向用户要截图;§3 未实测面维持如实标注。
