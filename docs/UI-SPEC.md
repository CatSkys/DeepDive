# DSHmini UI 规范（v0.3 · 黑白 · 少字）

> 上游：语义层 `SPEC-SEMANTICS.md`（对象与交互）→ **本文档**（视觉与呈现）→ 实现（React 组件 + 原生外壳）。
> **状态（2026-09-03）**：自建前端已全量落地（套壳时代结束），本文档是**现行视觉规范**；原「P1=套壳、组件库 P2 再做」的范围界碑已失效。后续新增界面以本文档为准。
> 设计参照（一手资料）：Raycast 官方[设计原则](https://www.raycast.com/blog/a-fresh-look-and-feel)、[Raycast 2.0](https://www.raycast.com/blog/the-new-raycast)、[技术深潜](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast)（原生惯例）；**视觉基调（用户指定）：近单色玻璃、大圆角、极简、主题纯黑白、无强调色、少字**。
>
> **单一事实源规则**：所有颜色、间距、圆角等只存在于 `frontend/packages/design/tokens.json`，
> 由代码生成 ① CSS Variables（Web） ② Swift 常量（原生）。**任何一端手写数值即违规。**
> 实现侧补充（现行）：图标经 `Icons.tsx`（官方 ic_ds_* 移植）+ `lucide-react` + `ProviderIcon`（Simple Icons 品牌原色，白色圆角底座）混用，色板语义变量（--ink/--line/--fill 等）承担亮/暗双主题。

---

## 0. 设计原则

1. **快（Fast）**——主流程 ≤2 次按键；快捷键永远可见（操作栏右侧键帽）；面板即焦点即输入。
2. **简单（Simple）**——一屏一个重点（输入框 / 会话流）；无装饰性内容；状态一眼可读。
3. **愉悦（Delightful）**——动效只出现在"发生"的地方。
4. **原生感 = 行为为先**：无 `cursor:pointer`、无 hover 高亮；设置独立窗口；弹层原生可越界；面板 vibrancy 透出材质；无白帧。
5. **一致（Consistency）**——一套 token、一套组件；组件均为 `@dshmini/design` 统一库导出。
6. **黑白（Monochrome）**——主题色只有黑与白（表面对应灰阶、亮度差）；**无强调色**。状态表达靠**符号 + 亮度**，不靠颜色：
   - 等待你 → 白点 ⚠ + 行整行亮度选中 + 呼吸；失败 → ✕ + 行高亮；完成 → ✓（灰）。
   - 彩色仅允许一处：**diff 增删**的绿红（内容层语义色，非主题色；如评审不同意可去除，改为 +/− 符号）。
7. **少字（Anti-Copy）**——文案规则见 §1.9：一切解释性小字、副标题、状态说明＝冗余。一行话能表达的，绝不用两句；一个词能表达的，绝不用一句。

---

## 1. 基础设计 Token（初值，评审后可调）

### 1.1 颜色（明/暗两套；主题 = 黑白灰阶）

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `text.primary` | `#1A1A1A` | `#F2F2F3` | 主文本 |
| `text.secondary` | `#626262` | `#9E9EA3` | 次级（分组标签、占位） |
| `text.tertiary` | `#98989D` | `#6E6E73` | 极低频（时间戳、禁用前哨） |
| `text.disabled` | `#C4C4C8` | `#454548` | 禁用 |
| `surface.panel` | `rgba(255,255,255,.72)` | `rgba(14,14,16,.62)` | 面板/侧栏/窗口（近黑玻璃） |
| `surface.raised` | `rgba(255,255,255,.88)` | `rgba(34,34,38,.70)` | 卡片、浮层、输入底、**选中** |
| `surface.input` | `rgba(0,0,0,.05)` | `rgba(255,255,255,.045)` | 输入框底色 |
| `surface.selected` | `rgba(0,0,0,.10)` | `rgba(255,255,255,.14)` | 列表选中（亮度差） |
| `surface.inverted` | `#FFFFFF` | `#2A2A2E` | 反色强调（标题底下衬、激活项） |
| `border.default` | `rgba(0,0,0,.11)` | `rgba(255,255,255,.09)` | 分隔线、通用描边 |
| `border.strong` | `rgba(0,0,0,.22)` | `rgba(255,255,255,.18)` | 输入框/浮层描边 |
| `border.gloss` | `rgba(255,255,255,.55)` | `rgba(255,255,255,.16)` | 玻璃顶部 1px 高光 |
| `focus` | `#000000` | `#FFFFFF` | 键盘焦点环（黑白主题） |
| `status.running` | `#8A8A8E` | `#D8D8DC` | 运行中（白点呼吸） |
| `status.waiting` | `#1A1A1A` | `#F2F2F3` | 等待你 ⚠（白点 + 加粗 + 整行高亮） |
| `status.failed` | `#3A3A3E` | `#E4E4E8` | 失败 ✕（配合符号） |
| `status.done` | `#6E6E73` | `#9E9EA3` | 完成 ✓ |
| `danger` | `#1A1A1A` | `#F2F2F3` | 危险操作 = 黑白（取消键在下），配 × 图标 |
| `diff.add` | `#0F7A3D` | `#3FCC7A` | diff 新增（**内容层唯一彩色**） |
| `diff.del` | `#C22F2F` | `#E5534B` | diff 删除（**内容层唯一彩色**） |
| `terminal.bg` | `#F2F2F4` | `#1A1A1D` | 代码块/终端输出底色 |
| `overlay.scrim` | `rgba(0,0,0,.35)` | `rgba(0,0,0,.55)` | 模态遮罩 |

- 对比度验收：正文 ≥ 4.5:1，次级 ≥ 3:1。
- 色彩纪律：**产品内只允许黑白灰阶 + diff 绿红**。任何其他颜色（含青/蓝/紫）＝评审拒绝；状态一律符号+亮度，不引入彩色。

### 1.2 字体

| Token | 值 | 用途 |
|---|---|---|
| `font.ui` | `-apple-system, "PingFang SC", "SF Pro Text", sans-serif` | 全系统一 |
| `font.mono` | `"SF Mono", ui-monospace, Menlo, monospace` | 代码、diff、上下文卡小标题、计数 |
| `font.size.caption` | 11px / 14 / 500 | 键帽、徽标 |
| `font.size.small` | 12px / 16 / 500 | **分组标签**（Pinned / Recent / Last Week）、浮层小标题（AI Agents） |
| `font.size.body` | 13px / 18 | 正文默认 |
| `font.size.title` | 15px / 20 / 600 | 会话标题 |
| `font.size.hero` | 20px / 24 / 600 | **面板唯一主标题** |
| `font.size.input` | 16px / 22 | 输入框 |
| `font.weight` | 400 · 500 · 600 仅三档 | |
| `num.style` | `tabular-nums` | 计数、耗时 |

- 跟随系统字号缩放（P2）；中文不斜体。

### 1.3 间距与尺寸（4pt 网格）

| Token | 值 | 用途 |
|---|---|---|
| `space.1..6` | 4 / 8 / 12 / 16 / 20 / 24 | 全局唯一间距阶梯 |
| `row.height.compact` | 28px | 菜单、命令面板行 |
| `row.height.standard` | 36px | 会话列表行、设置行 |
| `sidebar.width` | 240px（可拖 200–320） | 主窗口侧栏 |
| `input.minHeight` | 56px；最大 160px | 面板大输入框（居中） |
| `content.maxWidth` | 720px 居中 | 会话流 |

### 1.4 圆角 / 边框 / 高光 / 阴影

| Token | 值 | 用途 |
|---|---|---|
| `radius.control` | 10px | 按钮、chips |
| `radius.input` | 14px | 输入框 |
| `radius.card` | 14px | 工具卡、diff 卡 |
| `radius.floating` | 20px | 浮层：Agent 选择器、Memory 卡、命令面板 |
| `radius.panel` | 16px | 面板窗口 |
| `radius.keycap` | 6px | 键帽 |
| `border.width` | 1px `border.default` | 通用描边 |
| `border.gloss` | 顶部 1px `gloss` | 玻璃边缘光（浮层/面板） |
| `shadow.floating` | `0 16px 48px rgba(0,0,0,.35)`（dark .5） | 浮层 |
| 窗口阴影 | 系统提供 | 原生窗口/面板 |

### 1.5 材质与 Vibrancy（近黑玻璃）

- 面板窗口：`NSVisualEffectView`（material `.sidebar`/`.hudWindow`，Blending `.behindWindow`）＋ 透明 `WKWebView`。
- Web 侧表面色用 1.1 半透明值透出材质；不得写不透明色板。
- 玻璃细节：`surface.raised` ≥62% + `border.gloss` 顶部高光 + `shadow.floating`。
- macOS Tahoe：跟随系统 Liquid Glass；只组合系统属性。

### 1.6 图标（组件库已锁定：Lucide）

- **唯一图标源：Lucide**（MIT，`lucide-react`；参考图同款纤细线性风格）。
- **全局样式固定**：`strokeWidth = 1.5`（纤细）、`strokeLinecap/Linejoin = round`（柔和圆角）、`fill = none`、**单色 `currentColor`**。
- **尺寸阶梯**（唯一允许）：14（行内）· 16（列表 leading）· 20（卡片头部/工具卡）· 32（空态）；渲染用 SVG，`width/height` 由 token 控件。
- **颜色规则**：`text.secondary` 默认；激活/选中 `text.primary`；`waiting/failed` 状态图标 `text.primary`（黑白+符号语义，无彩色图标）。
- **封装**：所有图标经 `UiIcon`（`@dshmini/design`）使用——统一 stroke/size/color/命名；**禁止**直接 import 其它图标库、emoji 冒充图标、混合来源。
- **原生侧同源**：Swift 外壳用 SVG→`NSImage`（template）渲染同一 Lucide 资源（打包 SVG 资产）；不使用 `NSImage(systemSymbolName:)` 或其它图标集（系统控件自身的关闭/缩放红绿灯除外）。
- **SF Symbols 例外**：仅限系统自带控件行为（窗口控件、NSMenu 系统项），不用于业务图标。

**§1.6.1 语义图标映射表**（工具/状态 → 固定 glyph；新增工具必须先查表，缺则按语义就近指定并回填本表）：

| 语义 | Lucide glyph | 语义 | Lucide glyph |
|---|---|---|---|
| Pinned / 置顶 | `pin` | 打包/归档 | `archive` |
| 代码 / Coding | `code` | 编辑文件 | `square-pen` |
| 秒表 / 计时 | `timer` | 代码执行 | `braces` |
| 最近 / Recent | `layers` | 终端 / bash | `square-terminal` |
| 搜索 | `search` | 文件读取 | `file-text` |
| 发送 | `arrow-up` | diff | `diff` |
| 重置 | `rotate-ccw` | 重新生成 | `refresh-cw` |
| 删除 | `trash-2` | 网络搜索 | `globe` |
| 附件 | `paperclip` | 图片 | `image` |
| Agent / 助手 | `sparkles` | 子代理 | `network` |
| 深度研究 | `gem` | 目标 Goal | `target` |
| 命令 / 提示词 | `clipboard-text` | 计划 Plan | `route` |
| 配置 / 设置 | `sliders-horizontal` | 任务 Job | `list-checks` |
| 上下文 | `brain` | 压缩 | `shrink` |
| 审批 | `shield-check` | 提问 | `message-circle-question` |
| 异常 / 失败 | `circle-x` | 警告 / 等待你 | `triangle-alert` |
| 完成 | `circle-check` | 模型/提供方 | `cpu` |
| 工作区 | `folder` | 引擎 / 状态 | `activity` |

### 1.7 动效

| 场景 | 时长/曲线 |
|---|---|
| 控件态 | 120ms `cubic-bezier(.2,0,0,1)` |
| 面板显隐 | 200ms：alpha ＋ scale .98→1 ＋ translateY 8→0；隐 120ms 逆序 |
| 浮层 | 160ms：scale .96→1 ＋ alpha；遮罩 160ms |
| 流式文本 | 无逐字动画；上插淡入 ≤120ms |
| 状态点 running/waiting | 呼吸 1.2s；`prefers-reduced-motion` 全静止 |

### 1.8 键帽（KeyboardHint）

字体 11/500；圆角 6；底 `surface.input`；描边 `border.default`；内边距 3×5；顺序 `⌥ ⌃ ⇧ ⌘`（`⌥Space`）；英文键大写。**仅显示于操作栏与需要学习的动作旁，不解释。**

### 1.9 文案规则（Anti-Copy，评审 gate）

1. **没有解释性文字**：每个文案只有一个职责（标题/动作/占位/分组标签），无副标题、无说明句、无"以下""你可以"。
2. **动作动宾开头**：`+ 新建任务` `重新生成` `导出`——不加感叹号、不加"体验/敬请/让…更"。
3. **占位符即语法提示**：一条放完 ─ `输入任务，@ 引用 · / 命令`；不追加第二行说明。
4. **小字密码**：12px 及以下只作分组标签（Pinned / Recent / Last Week）、键帽、浮层小标题（AI Agents）；**禁止** 副标签/状态说明/时间戳弱化注脚出现在行内（时间仅主窗头部一处，见 §3.2）。
5. **分组标签词首大写**（Pinned · Recent · Last Week · AI Agents，与参考图一致）；中文场景用两字词（置顶 · 最近）。**标题一律单行截断**（…），完整标题在 P2 由原生 tooltip 展示。
6. 空态只一句：`还没有任务`；错误只一句：`引擎启动失败`（详情进日志，不在 UI 解释）。

---

## 2. 组件规范（`@dshmini/design` 统一库）

> 纯展示 + 最小回调；无 hover 态；键盘焦点可见（**黑/白 2px 环**）。P1 每组件有 dev 预览页。

### 2.1 基础组件

| 组件 | 变体 | 规格要点 |
|---|---|---|
| **Button** | `primary / secondary / plain / danger` | 高 28/32；圆角 10；primary=白底黑字；danger=黑白配 × 图标；无 hover |
| **Composer** | 单行/多行 | 高 56、圆角 14、`surface.input`+`border.strong`；焦点黑白环；附件 chips 行；⌘V/拖入；左 ⟳ 右 ➤ |
| **ListRow** | 标准/紧凑 | 高 32/36；leading 图标 16 + 标题 13；**无 meta 行**；选中=亮度差；↑↓ |
| **SearchField** | — | 高 32、圆角 10、放大镜 14/secondary；占位 `搜索` |
| **KeyboardHint** | — | 见 1.8 |
| **Chip** | `file/image/tag` | 高 22 圆角 10；× 按下态；黑白 |
| **StatusDot** | 五档 | queued 灰 · running 白(呼吸) · waiting ⚠白(呼吸,行高亮) · done 灰✓ · failed ✕白；12px |
| **SectionLabel** | — | 12/500/`text.tertiary`；高 24；仅分组名 |
| **Segmented** | 2–3 段 | 高 24；选中段 `surface.raised`+阴影；无彩色 |
| **Tooltip** | — | P1 Web 内 120ms；**P2 原生** |
| **ToastBar** | 信息/错误 | 面板底部：左一句 右动作+键帽；3s |
| **ProgressLine** | 1px | 黑白进度；不转圈 |
| **MarkdownContainer** | — | 正文 13/18；代码块 `terminal.bg` 圆角 10+复制；引用 2px 左条 |
| **EmptyState** | — | 32px 图标 + **一句** |
| **FloatingCard** | — | 圆角 20 + `surface.raised` + `border.gloss` + `shadow.floating` + scrim（浮层唯一样式） |

### 2.2 消息规范（两类，严格独立——用户定稿，2026-09）

> 用户消息与 Agent 消息是**两个完全独立的组件与规则**：不同的组件（`UserBubble` / `AgentMessage`）、不同的 class、不同的视觉规范。**禁止**用共用容器 + 子类差异实现；任何"消息系统"级别的一刀切调整都是违反规范。

| | 用户消息 `user-bubble` | Agent 回复 `agent-message` |
|---|---|---|
| 形态 | **降量显示**的气泡（克制、弱层）：小字号 13、半透 α .07、弱边框/弱内高光、圆角 14、61% 最大宽、右对齐 | **无气泡、无任何元素背景**：纯文字（14/21 白 93%）+ Markdown 层级 |
| 定位 | 弱于正文（不抢戏） | 主视觉通道 |
| 背景 | 半透明单层（无模糊） | `background: transparent`（元素与全部伪元素强制透明） |

> 此前的错误：两者共用 `.msg` 体系、气泡参数与 emoji/信息混调——已按"独立两套"重构并清空 `.msg` 残留。

### 2.2bis 悬浮层统一规范（FloatingPanel）

所有浮动层（ActionMenu、ModelMenu、未来的任何浮层）**统一**：
- 圆角 22 · 背景 `rgba(22,23,26,.55)`（真半透）· `blur(40px) saturate(160%)`（**必须同时带 `-webkit-` 前缀**，WebKit 需要）
- 折射渐变边（165°，亮上左→暗下右，mask-composite 切出）· 顶部 1px 内高光 · 大柔阴影（0 30px 70px）
- 行高 38-40 / 圆角 10-11 / 激活行 `rgba(255,255,255,.10)`；底部"搜索…"输入行 + 分隔线
- 任何浮层若与此不一致 = 设计违规。

### 2.2 复合组件

| 组件 | 内容 | 要点 |
|---|---|---|
| **TaskRow**（侧栏） | StatusDot + 标题（一行） | **无 meta 小字**；waiting：标题加粗 + 整行亮度选中 + 白点呼吸（黑白高亮法） |
| **ToolCard** | 折叠：图标+名称+结果态；展开：输出/diff | **折叠+异常高亮（D3）**：失败=高亮行+✕（黑白）；耗时等细节在展开区；>50KB 折叠 |
| **DiffView** | 文件头 + +/− 行 + 上下文 3 行 | 文件级切换；绿红仅限这里 |
| **ApprovalDialog**（原生） | 标题「DSH 请求授权」+ 详情（命令/文件/sandbox）+ 策略选择 + [拒绝][批准] | **P1 即原生**（D5）；Esc=拒绝；主在右 |
| **QuestionCard** | 问题 + 选项（ListRow）/自由输入 | 等待回答：⚡白点 + 「等待你」 |
| **PlanReviewCard** | 计划 markdown + [拒绝][接受计划] | 对齐 plan/mode |
| **MemoryCard** | **参考图式**：① 标题行（pin 图标 + `Memory` + 右侧操作钮：`🔄 重新生成`（图标+文字按钮）、删除）② 小节 `Work context`：persona 文本段落 ③ 底部 `Personal context`：技能/上下文构成（小字列表） | 上下文信息卡；只展示数据，无说明句；入口=会话头 `brain` 图标；重生成 P2 |
| **AgentPicker** | 小标题 `AI Agents` + 选项（图标+名称，选中=亮度差）+ **底部搜索框（占位 `搜索角色…`，P1 即过滤 preset）** | FloatingCard 居中；选项包括用户自建 preset |
| **MenuBarPopover**（原生） | 引擎状态 + 最近会话 5 + [设置][退出] | 宽 280 |
| **OnboardingCard** | 三步：连接模型 → 选工作区 → 示例任务 | 每步**一个动词短语 + 一个按钮** |

### 2.3 键盘映射

`⌥Space` 唤起/隐藏面板 · `⌘,` 设置 · `Esc` 收起菜单/取消 · `Enter` 发送 · `@` 引用 · `/` 命令 · `Tab` 补全；@ 菜单内 `↑↓`/`Enter`/`Tab` 选择。

---

## 3. 布局规范（v0.3：参考图式 · 少字）

### 3.1 Launcher 面板
```
┌ 750×430 → 900×580 ────────────────────────────┐
│            （留白，内容垂直居中）                │
│               做点什么？           ← hero 唯一   │
│                                                │
│   ⟳  [ 输入任务，@ 引用 · / 命令      ]  ➤      │
│        （Composer：640×56、圆角 14、居中）       │
│  ───────────────────────────────────────────── │
│  ⟳ 最近任务（一行标题 + 状态点）      [设置 ⚙] ◄ │
│  （左下=引擎状态点 · 右下=圆形设置钮 ⌘,· 参照图角落圆钮）│
│  ToastBar：左一句 / 右动作+键帽                 │
└────────────────────────────────────────────────┘
```
- **无副标题、无解释行**；输入即任务，回车即开始。
- **角落圆钮**（参考图左右下角圆形图标）：左下=引擎状态点（白点+呼吸）；右下=设置入口（`sliders-horizontal`，⌘,）——面板上仅此两个常驻控件。

### 3.2 主窗口
```
┌ 1100×720 ──────────────────────────────────────┐
│ ┌ 侧栏 240 ────────────┐ ┌ 会话视图 ───────────┐ │
│ │ [工作区 ▾]    [+ 新建]│ │ [侧栏开关]        [✎ 重命名] [🧠]│← 顶栏：左=侧栏开关，右=重命名+Memory
│ │ 🔍 搜索              │ │ 标题 · 状态点 · 角色 · 模型 │← 右上对齐（New Chat / Claude…式）
│ │ 置顶                  │ │ (agent 状态一行：编辑中)│
│ │ 🔒 修登录 bug         │ │ 对话流（max 720）     │
│ │ 最近                  │ │ 工具卡（折叠+异常高亮）│
│ │ ● 新任务    (选中=亮) │ │ [Composer ⌘V 附件]   │
│ │ 上周                  │ └──────────────────────┘
│ │ 邮件分拣              │                        │
│ └───────────────────────┘                        │
└──────────────────────────────────────────────────┘
```
- 分组：置顶 / **最近（首行常设「新任务」入口，New Chat 式）** / 时间分组（上周 / 4 月）；任务行 = 状态点 + **单行截断标题**，无 meta；完整标题 P2 由原生 tooltip 展示。
- **内容区顶栏**（参考图右上图标区）：左=侧栏开关；右=重命名（`square-pen`）+ Memory 入口（`brain`）；标题/状态点/角色/模型名**右上对齐**（New Chat / Personal Assistant / Claude Sonnet 4.6 式）。

### 3.3 浮层 & 设置
- FloatingCard 体系（Agent 选择器/Memory/命令面板）：居中、宽 560、圆角 20、scrim。
- 设置（v3 变更，用户拍板）：**内置于主窗口**——左导航 + 主区内容（与主界面同一 .sidebar/.main 底板与语义变量）；分区=通用/模型/Agent 预设/插件/快捷键/已归档的聊天/数据；黑白。（原"480×600 独立原生窗口"方案废弃。）

## 4. 平台惯例验收清单（每条 = 发布 gate）

1. 无 `cursor:pointer`、无 hover 高亮（仅 focus/selected）。
2. 设置页内置主窗口（v3 变更，原"独立窗口"gate 废弃）；弹层 P2 原生可越界。
3. 面板显隐无闪烁/白帧。
4. 右键菜单原生；拖入=附件；⌘C/⌘V 按 macOS 惯例。
5. 对比度达标；VoiceOver 有 label；`prefers-reduced-motion` 全静态。
6. 两端同一 token 源。
7. **黑白检查**：截图仅黑白灰阶（diff 区除外）；**文案检查**：无解释性小字/副标题/注脚。

## 5. 实现衔接

- `frontend/packages/design/tokens.json`（唯一事实源）→ `gen-tokens.mjs` → `tokens.css` + `Tokens.swift`。
- 组件库按 §2；每组件 dev 预览页（P1）；P2 视觉回归快照。
- 前缀 `UiXxx`；包 `@dshmini/design`；无裸 class 手写。
- 原生侧仅系统控件 + Tokens.swift + NSVisualEffectView。

## 6. 拒绝清单

- ❌ 主题/皮肤系统（明/暗+跟随；暗色默认）；❌ 强调色/品牌色/彩色状态；❌ **Lucide 以外的任何图标库**、emoji 冒充图标、混合图标来源；❌ 渐变、彩色高亮、拟物；❌ hover 动效；❌ 自定义字体下载；❌ 网页式滚动条；❌ **解释性文案、副标题、行内 meta 小字、状态说明注脚**。
