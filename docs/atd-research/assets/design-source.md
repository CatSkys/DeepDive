# 设计来源与实现记录

Figma 引用使用文件别名和原节点编号，真实地址保存在 Git 忽略的本地配置中。例如 `pnpm design:link project/69:80` 可解析组件页地址；配置方式见 [SECURITY.md](../SECURITY.md#local-project-context)。

更新日期：2026-09-19。当前入口为 01 · Product design · Flows & settings (Figma `project/1:251`)。用户已授权界面、真实 Agent 与持久化一并实现，并授权使用独立数据目录验证 Electron。

Agent 流程与 Providers / Shortcuts 设置已合并到同一设计页：统一导览 (Figma `project/577:11193`)串联 A–E 任务、命令和记忆，F1–F9 提供商，以及 G 快捷键；Q1/Q2 保留视觉验收和渲染参考，Z 保留原型内部状态。原画板节点、组件引用和原型路径继续保留。本次页面合并未修改应用代码。

## 设计与组件映射

通过云端 Figma MCP 读取画面、主组件、变量、样式与截图。项目画面与适配组件保留在 Atd 项目文件 (Figma `project`)；共享 Radix / Rhea 控件与 Lucide 实例保留 shadcn UI kit (Figma `uiKit`) 连接。本次没有修改共享库。

以下代码路径相对于 `apps/desktop/src/`。

| 设计源                                                                                                                                                                                                          | 代码拥有者                                                                                           | 实现内容                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Panel header (Figma `project/71:112`)、Composer (Figma `project/72:150`)                                                                                                                                        | `App.tsx`、`components/composer.tsx`、`features/agent/use-task-panel.ts`                             | 新建、历史、设置、草稿、发送、停止与后续消息设置                                                                                                                                                                           |
| App / History view menu · Rhea (Figma `project/1856:99653`)、A4 · 任务列表排序与分组 (Figma `project/1856:99661`)                                                                                               | `features/agent/history-view-menu.tsx`、`history-view.ts`、`use-history-view.ts`、`task-history.tsx` | 任务历史的排序与分组：分组（日期、状态、模型、不分组）、排序（最近更新、创建时间、标题），所选视图记在 localStorage（`history.view`）；搜索框右侧的触发器复用 App / Icon button（icon-sm）与 `Lucide / sliders-horizontal` |
| 任务执行 (Figma `project/622:3727`)、会话轮次 (Figma `project/693:4071`)                                                                                                                                        | `features/agent/conversation.tsx`、`tool-activity.tsx`、`task-request.tsx`                           | Pi 消息、真实工具步骤、输入/权限确认、队列、停止与中断恢复                                                                                                                                                                 |
| Command management (Figma `project/373:1416`)                                                                                                                                                                   | `features/commands/command-settings.tsx`、`command-editor.tsx`                                       | 同构示例与自定义命令、Run / Switch / More、版本冲突、复制、删除                                                                                                                                                            |
| 指令编辑器 (Figma `project/417:1716`)、变量选择器 (Figma `project/439:2067`)                                                                                                                                    | `features/commands/instruction-editor.tsx`、`instruction-extensions.ts`、`variable-picker.tsx`       | 高亮、光标处插入、变量说明、未启用来源的配置入口                                                                                                                                                                           |
| 参数字段 (Figma `project/410:1982`)、参数定义 (Figma `project/414:1817`)                                                                                                                                        | `features/commands/parameter-editor.tsx`、`parameter-field.tsx`、`features/agent/command-input.tsx`  | 文本、数字、选项、布尔字段；共用校验、默认值与运行预览                                                                                                                                                                     |
| 文件结果 (Figma `project/433:2044`)                                                                                                                                                                             | `features/agent/task-files.tsx`                                                                      | 文件信息、路径、打开、显示位置、复制、继续使用、重新关联                                                                                                                                                                   |
| Memory card (Figma `project/2126:127588`)、Memory list content (Figma `project/2007:116669`)、Memory page (Figma `project/2010:118214`)                                                                         | `features/memory/memory-overview.tsx`、`memory-card.tsx`、`memory-page.tsx`                          | skill 形状的记忆：设置 › 记忆概览与 Personal 的记忆标签都以卡片网格列出（搜索与添加、单条启用开关与 More）；学习建议为行，可展开查看拟写内容；自动学习与保存前询问；记忆页编辑字段，打开期间被改动或删除时提示             |
| Plugin card · Rhea (Figma `project/1610:75888`)、Plugin kind tabs · Rhea (Figma `project/1614:74934`)、Plugin item row · Rhea (Figma `project/1590:66093`)、Plugin sub-page · Rhea (Figma `project/1593:66734`) | `features/service/*`（插件卡片列表、插件详情 Tabs、安装页）                                          | 以插件为条目的扩展设置：来源徽标、启用开关、内容摘要、安装预览、只读条目与复制到个人                                                                                                                                       |

上述项目主组件的 usage description 已同步代码映射。Figma 原型继续使用固定样例表达有限状态，应用中的数据与执行状态来自运行时。

## 视觉约束与最新修正

- 采用仓库的 `b27GcrRo`：Radix / Rhea、Inter、Neutral、Lucide；控件复用 `packages/ui`，按钮、输入框、选择器与菜单保持各自变体的几何与状态。
- 面板默认 500 × 680（2026-10-07），标题栏 48px 加 1px 分隔线。macOS 的外部圆角、材质、边缘与阴影由原生 HUD 窗口拥有；渲染层保持单一共享表面填充，不叠加 CSS 窗口描边或阴影。`PanelGeometry.defaultSize` 与 Figma 的空白／输入示例 (Figma `project/98:222`)、会话示例 (Figma `project/237:1988`)及官网主面板／会话场景已同步；既有用户保存的尺寸继续保留。官网与根 README 共用重新导出的 `apps/website/public/cases/ui/main-panel.png`、`chat.png`，桌面画布仍为 1440 × 900。已读回 7 个设计示例的尺寸、检查导出图片并通过 8 项窗口定位测试；本次未接管正在运行的开发实例，原生实机外观未复测。
- 按用户反馈移除会话 `margin-top: auto`。短对话首条消息从标题栏下方 20px 开始，Composer 固定在底部；长对话滚动至最新内容由滚动逻辑负责。
- 共享会话说明 (Figma `project/694:17333`) 与 短回复示例 (Figma `project/796:15567`) 已同步顶部排列。长内容原型中展示“滚动至最新”的有限状态不代表运行时垂直布局规则。
- 已检查实际 Electron 内容截图及白色 / 蓝色背景上的 OS 合成窗口，覆盖四角、边缘、阴影和原生材质。证据在 `apps/desktop/.artifacts/agent-result-top-aligned.png`、`agent-native-contrasting.png`。
- 工具步骤行不绘制任何自身背景：折叠、hover 与展开（`aria-expanded`）都保持透明，hover 只保留指针光标，展开状态由旋转的箭头承担（`features/agent/agent.css` 的 `.tool-heading`）。Tool activity (Figma `project/774:4064`) 的 Toggle activity 同样没有行填充，两侧一致。
- 滚动条不再压在窗口边框上（2026-09-19）：面板内容滚动区（自身带 `.panel-content` 的 ScrollArea 与 `.conversation`）的纵向滚动条改为向面板内侧让出 4px（`apps/desktop/src/styles.css` 对 `[data-slot='scroll-area-scrollbar'][data-orientation='vertical']` 设置 `margin-right`；Radix 用内联样式固定滚动条位置，`right` 不可覆盖）。历史列表保留自己已有的 4px 内缩（`-mr-3` 加 `gutter`），命令列表因 `Command` 自身内边距落在 8px，消息卡片与代码块内的滚动条保持卡片边缘；消息列 16px 内边距与列宽不变。Figma 的会话画板（`693:4071` 等）只使用 `overflowScroll`、未绘制滚动条，因此本次只改代码与文档。

### 设置二级页标题统一

用户确认以 New command 的「左箭头 + 标题同一行」为准。提供商接入、连接详情、命令与参数编辑、上下文来源、记忆编辑及独立删除确认页共 58 个画板，统一复用 App / Settings subpage header · Rhea (Figma `project/1045:32910`)。一级设置页保留各自总览标题。

返回控件复用 `App / Icon button` 的 Ghost / icon-sm：28 × 28px，连接共享 `Lucide / arrow-left` 的 16px 图标；与 Inter Semi Bold 24px / 32px 标题相距 8px，垂直居中。可选说明使用 Inter Regular 14px / 20px，与标题行相距 8px。组合 Fill 宽度、Hug 高度，长标题自然换行；Desktop 保留设置内容 40px 内边距，窄屏遵循响应式模式。代码对应 `features/commands/commands.css` 的 `.editor-heading` 与 `components/icon-button.tsx`。

组件暴露标题、说明、说明显隐及嵌套返回按钮。原型导航由返回控件的容器承担，避免按钮状态切换覆盖返回目标；tooltip 统一为 `Back`，可访问名称说明返回的上级页面。保留既有导航，并补齐记忆编辑、独立确认页及 Anthropic 连接详情遗漏的返回入口。此次仅修改 Figma 与文档，提供商功能的后续实现沿用 [提供商计划](plans/2026-09-12-provider-defaults-design.md#二级页面标题)。

### 操作提示文案

图标操作的 tooltip 使用简短动作，不重复行内容、对象名称或页面上下文：省略号统一为 `More`，其他操作使用 `Run`、`Edit`、`Remove`、`Delete`、`Copy`、`Back`、`Insert`、`Configure`、`Move up` / `Move down`。`IconButton.label` 提供可见提示，`aria-label` 按需保留命令、参数、记忆内容或返回目标，方便屏幕阅读器区分按钮。文件操作保留 `Copy path`、`Show in folder`、`Attach latest version` 等必要区别。用于查看被截断的文件名、模型名和说明的完整值提示继续保留；不可用提示简明说明状态。

### 表单分组与间距

2026-09-12 按用户截图修正 25 个命令、参数和上下文编辑画板，并同步命令运行输入页与字段宽度评审。普通命令字段／分组之间使用 16px，标签到控件、说明和变量快捷入口之间使用各自分组内的 8px。保留 Rhea 标签 14px / 14px、32px 控件和输入／快捷键共享组合；提供商的 24px 大分区、选项编辑的 12px 组内行距继续按各自组合使用。

15 个命令画面复用 App / Command run settings · Rhea (Figma `project/1062:33204`) 的展开／收起变体。展开入口到内容为 16px；Model／Memory 在宽度充足时并排，Allowed tools 单独组成标签与开关组。复用既有 `Spacing / 16`（Standard）与 `gap/layout`，保留按钮、Select、Switch 的连接及原型目标。编辑页标题、滚动内容和页脚之间为 16px；Desktop 的内容 inset 为上／右／下／左 40／40／32／40px，窄屏值由响应式模式拥有。

输入选项 (Figma `project/440:6995`) 的新增参数入口与列表标题共用一行，参数列表 Hug 高度，行距 8px；第五项不再被固定高度隐藏。滚动由表单区域承担，页脚位置固定。指令编辑器 (Figma `project/417:1716`) 保留 96px 最小高度并随内容增长，防止长指令溢出到说明文字。已检查展开／收起、长内容、字段错误、变量弹层、五项参数和窄字段截图，并读回布局与原型引用。

此次按用户约定只修改 Figma 与 plan。后续实现需同步 `run-settings.tsx` 的展开间距和组合、`input-options.tsx` 的列表标题操作，以及指令编辑器的内容高度；现有代码的 `pt-3` 和运行设置排列尚未按本次设计调整。详见 [计划中的表单间距修正](plans/2026-09-10-general-agent-requirements.md#2026-09-12--表单间距修正仅-figma)。

### 设置页组件归属统一

2026-09-12 按用户要求统一优化 Figma，并同步 plan。此前 sidebar 虽然全部是实例，8 个主变体仍保留旧文案，55 个 Providers 页面另有文字覆盖；连接了图标或按钮也不能代替其外围布局的复用。

- Settings sidebar (Figma `project/256:1024`) 的四项固定文案改由 `App · Controls / Content/Settings navigation/*` 字符串变量拥有。清理 55 处旧文案覆盖后，当前 93 个设置／菜单画面统一显示 Providers、Commands、Memory、Shortcuts。24 个变体覆盖四个 Tab、两种 Hover 和 Sidebar／Top／Drawer 布局；全部移除 logo、头像和姓名，保留原生窗口控件。页面只配置导航状态、布局和目标。
- Settings editor layout (Figma `project/1093:34262`) 与 Settings editor footer (Figma `project/1093:34242`) 替代 25 组复制的编辑页与页脚。主组件统一拥有响应式 inset（Desktop 为 40／40／32／40px）、16px 分区间距、共享二级标题、有界垂直滚动 SLOT，以及滚动区外的页脚。各页保留自己的表单、反馈、操作文案、禁用状态和原型目标。
- Command identity (Figma `project/1093:34209`) 替代 15 组独立的名称／描述列。当前响应式版本使用随标签一起换行的字段列：每列最小 220px，列／行间距 16px、标签到控件 8px，可用宽度小于 456px 时堆叠。固定标签绑定文案变量并在最小列宽内保持单行，值和状态通过暴露的 Command field 实例编辑；更长的本地化标签需堆叠或使用共享标签／控件轨道，不能单独偏移输入框。
- 131 个独立共享库按钮迁入既有 Settings action · Rhea (Figma `project/907:17188`)，统一 Label、前置图标、Primary／Outline／Ghost 与 Default／Hover／Focus／Disabled。保留连接的共享库外观层和 Lucide 图标；项目组件直接拥有标签属性，因为共享按钮源未提供文本属性。状态切换由项目组件负责，避免内层跳回共享库外观；禁用透明度只在整个按钮应用一次。
- 39 个独立输入框迁入既有 Command field · Rhea (Figma `project/410:1982`)。Text 增加 Value／Placeholder 内容变体并覆盖五种交互／校验状态，复用共享 Input 的 Value 属性；独立搜索或外部标签组合关闭 `Show label`。32px 高度、18px 圆角与 token 由源组件拥有。

页面导航放在按钮外的透明 Auto Layout 动作容器，按钮实例只继承组件状态反应，避免 hover 切换覆盖点击目标。产品页的 178 个按钮导航保留原目的地；组件定义与组件页 QA 只提供外观参考。

保留当前批准的 hover：Ghost 白色 10%、Outline 白色 4.5%、Primary 为 `primary/80`；焦点使用 ring 边框与 3px、30% 的焦点环。未修改共享 shadcn 文件。组件页新增 09 · Shared settings layouts (Figma `project/1093:34208`)，记录使用方式及宽窄窗口、换行和状态样例。

已复核标准编辑页、Memory、五项参数、长指令、校验错误、按钮及输入框状态；早期控件迁移的标准命令页与 Memory 截图一致。后续响应式修正允许窄字段堆叠，760 × 560px 窗口通过有界正文滚动保留页脚。产品页保留 26 个分区和 25 个原型起点。本条修正仅涉及 Figma 与文档，应用共用编辑布局的后续同步见 [组件统一计划](plans/2026-09-10-general-agent-requirements.md#2026-09-12--设置页组件统一仅-figma)。

### 命令菜单内边距归属（仅 Figma）

2026-09-12 复核 命令操作弹层 (Figma `project/380:3063`)：实际内容已有 4px 内边距，与 `packages/ui/src/components/dropdown-menu.tsx` 的 `DropdownMenuContent p-1` 一致，并非零内边距。问题是这 4px 位于材质 SLOT 内的独立 Frame；外壳和菜单项虽然连接了组件，完整动作布局仍可能由各实例独立保留。

Command actions menu · Rhea (Figma `project/487:11060`) 的 Enabled／Disabled 主组件现在直接拥有绑定既有间距变量的 4px Auto Layout padding 和五个连接菜单项。`App / Popover surface · Rhea` 继续连接共享库，仅作为铺满组件的材质层，其内容 SLOT 留空。两个产品实例的旧内容 Frame 已清理，九个点击目标、禁用 Run 的 50% 透明度及无动作状态保留。菜单行仍为 32px 高、左右 8px／上下 6px 内边距和 14px 圆角；没有套用通用 `PopoverContent p-4` 的 16px 规格。

实测临时调整源组件 padding 后，两处产品实例同步重排，随后恢复正式 4px；Enabled／Disabled 在 192、224、288px 菜单宽度下的六项原生布局检查通过。默认 224×168px，首行距顶部和左侧均为 4px，末行距底部为 4px；材质始终铺满。启用态整个画板的前后 PNG 完全一致，禁用态另已视觉复核。这次修正的是布局归属，不宣称先前已有数值漂移。当时只确认其余 16 个相关产品弹层拥有连接的内容组件，没有证明它们的累计内边距正确；后续发现与修正见下文深度排查。旧版菜单仅在已弃用源与 QA 中保留。使用说明、[项目 plan](plans/2026-09-10-general-agent-requirements.md#2026-09-12--全界面响应式布局仅-figma) 和 AGENTS.md 已同步。

### 弹层内边距深度排查（仅 Figma）

2026-09-12 根据 变量补全实例 (Figma `project/1123:43441`) 再次核对主组件、实际材质、SLOT、内容、分组和高亮边界。这次问题写在主组件内部：外层四边 4px，Suggestion group 又额外添加左右 4px，实际高亮边距成为上 4px、左右 8px。组件连接正常会把错误一起传给消费者；此前仅检查连接和单层 padding 的验收不充分。

| 发现                     | 源组件修正与当前结果                                                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 补全高亮左右多出 4px     | Variable menu content (Figma `project/507:4022`) 的 Suggestions 只保留根组件四边 4px，选项组不再叠加水平 inset。首行高亮到材质上／左／右均为 4px，选项与底部提示文字的左边线均为 12px。                                                                                  |
| 补全短高时整体裁切       | Command variable suggestions (Figma `project/484:2844`) 的材质、SLOT、内容共同 Fill 受限高度；仅选项组滚动，底部提示 Hug 并保持可见。由 18px 圆角材质裁切内容，取消产品实例外层方形滚动裁切。320px 长内容 QA 保留 226px 高度，清除内部固定高度覆盖，使其缩高时也能重排。 |
| 模型搜索框与选项错开 4px | Model picker content (Figma `project/954:19478`) 的 Default、No results、Catalog warning 均增加原生 CommandInput inset 容器，保持连接的 32px 输入框；搜索表面与选项高亮左右均为 8px、宽度相等。Composer 中的现有实例继承更新。                                           |
| 刷新失败提示右侧越界 4px | Codex catalog warning (Figma `project/964:19967`) 的 Refresh notice 从固定 320px 改为 Fill。在 320px 菜单内占 312px，左右外边距均为 4px，提示文字左右均为 12px；原失败画面已继承。                                                                                       |

完整可搜索变量选择器继续使用 Rhea Command 的 8px 搜索／选项高亮横向边距；行文字 16px 与底部提示文字 12px 来自不同用途的明确组合，不统一改成相同数值。DropdownMenu／Select 的 4px 边界、Tooltip 的上下 6px／左右 12px 也保留各自规格。

独立复核覆盖 25 个源／评审弹层和 18 个产品弹层，共 160 个菜单行外观层，未发现剩余行外观尺寸错配或横向区域越界；产品动作目标均可解析。另核对 36 个 Tooltip 实例，文字四边符合其规格。补全菜单验证 192／288／460px 宽度和 96／120px 短高，另在实际产品视口及 320px 长内容 QA 上验证高度传递并恢复评审尺寸；模型三个状态和刷新提示均验证 288px 窄宽。已检查实际画面、细节和短高截图，临时实例均已清理。

本轮按既定范围只修改 Figma 与文档。`instruction-theme.ts` 仍保留补全列表 `padding: '4px 8px'`，应用尚未同步本次 4px 补全边界及滚动／页脚调整；不把 Figma 修正当作运行时完成。后续同步要求见 [项目 plan](plans/2026-09-10-general-agent-requirements.md#2026-09-12--弹层内边距深度排查仅-figma)。

### 全界面响应式布局（仅 Figma）

2026-09-12 按用户要求覆盖各个尺寸，并将小屏抽屉及无 logo／账户信息的导航规则写入 [AGENTS.md](../AGENTS.md#responsive-layouts)。响应式组件与评审区 (Figma `project/1117:35919`) 集中展示导航、编辑器、各设置模块、变量弹层和任务浮窗。

| 可用窗口宽度 | 导航布局         | 内容处理                                                       |
| ------------ | ---------------- | -------------------------------------------------------------- |
| ≥760px       | 208px 侧栏       | Desktop inset：上／左右／下 40／40／32px，内容宽度最多 1000px  |
| 480–759px    | 可换行顶部导航   | Compact inset：16／16／16px，字段与操作区按可用空间换行        |
| <480px       | 菜单按钮打开抽屉 | 同 Compact inset；抽屉提供选中项、关闭按钮、遮罩和 Escape 关闭 |

Settings window layout · Responsive (Figma `project/1119:36110`) 统一拥有窗口布局、导航和两个原生 SLOT：正文与视口内弹层。91 个原设置窗口与两处旧命令菜单载体均已迁入，共 93 个画面。两处菜单入口改为完整窗口状态导航，保留原画板 ID、菜单操作和返回目标。普通侧栏仍透明，所有布局均无 logo、头像或姓名。

抽屉在真实蓝色壁纸上复核半透明、背景模糊与共享选中色。窗口独占 Glass 80% 底色；抽屉独立表面复用 `surface/settings-content` 10% 局部材质并施加 40px 背景模糊，导航本身透明，选中态沿用 Glass 白色 12%。有效 30% 的遮罩只覆盖抽屉外区域，避免窗口、遮罩与抽屉三层底色叠加成近乎不透明。表面作为导航的同级节点保留变体间相同的导航层级，避免切换时丢失选中 Tab。真实壁纸评审 (Figma `project/1187:38838`) 展示关闭与打开两种状态。

`App · Responsive` 使用 Desktop／Compact 模式。内容的三个间距变量别名到已有 token，另一个布尔变量控制窄屏下不再适用的模型列表列标题；BOOLEAN 使用 API 支持的默认 scope。原生窗口控件另有横向／纵向 inset：Desktop 为 0／0px，Compact 为 12／4px，只作用于侧栏控件行，使抽屉打开／关闭时的三灯位置一致，保留桌面位置及导航行的内边距。名称／描述、Input／Shortcut、运行设置、目录筛选、连接校验和页脚使用原生换行；长表单／列表放在有界滚动正文，页脚及任务 Composer 保持可达。保留 Rhea 控件尺寸、字体、圆角与分组间距。

提供商行和命令行由各自主组件拥有响应式布局，继续连接共享 Item 外观层、品牌／Lucide 图标及项目控件。保留模型值、Default 标签、命令标题与说明、快捷键显隐及操作目标；比对后清理旧插槽副本。18 个设置弹层均受窗口范围和滚动容器约束；49 个任务浮窗及 8 个边界状态卡片使用伸缩、换行或有界滚动。

变量选择器 (Figma `project/439:2067`) 的三个 Scope 统一使用固定头尾与中间选项滚动区。弹层表面、内容 SLOT 和实例一起 Fill 可用高度；视口裁切沿用表面的 18px 项目适配圆角，避免旧的高菜单被方形滚动外框截断。四处产品弹层与小屏 QA 已同步，16 个尺寸检查通过，标题、搜索、Done 和底部提示保持可见。

Settings overview header · Rhea (Figma `project/1181:38808`) 拥有共同的标题／说明与管理工具栏，Toolbar 原生 SLOT 保留各页的搜索状态与按钮，消费者在其下方以 16px 间距衔接正文。标题到说明为 8px，标题区到工具栏为 16px；工具栏列距 12px、换行间距 8px，搜索最小 180px，主操作 Hug 并在窄屏换到搜索下方。Memory 搜索位于 Learn automatically 之前。Top／Drawer 导航下内边距为 8px，Compact 正文上 inset 为 16px，避免两个容器叠加过大的留白。

字段的内部文字区使用 Fill 与单行末尾截断，保留完整文本值和 Input 的左右 10px 内边距；Select 保留自身变体的内边距。提供商行与命令行的共享 Item 外观层从行的原点覆盖完整宽高，布局由内容拥有；不以旧外观层的固定高度裁切或偏移行内容。总览已同步 32 个产品消费者、4 个提供商源状态和 3 个总览 QA。553 个输入视口与 313 个 Input 几何检查通过，93 个产品列表行与外观层边界完全一致；旧源 QA 有一处 0.25px 原生取整差异，未发生可见裁切。补充截图标注项已完成，详见 [项目 plan](plans/2026-09-10-general-agent-requirements.md#2026-09-12--全界面响应式布局仅-figma)。

总览重排后的 12 处静态菜单已按真实触发器重新定位，使用现有 DropdownMenu／Popover 的 4px 间隔与尾端对齐；空间不足时上翻并限制在视口内。760、1000、1280px 与 320px 有界呈现共完成 48 项显式重排检查。**这些静态菜单不能跨 SLOT 自动跟随正文高度变化**：例如说明在 760px 换为两行时，锚点比 1000px 下移 20px；改变尺寸或文案后须重新计算。MAX／STRETCH 约束只处理自身分支，不能将其作为自动锚定的证明。Figma 原型另支持相对触发节点的 [`OVERLAY` 定位](https://developers.figma.com/docs/plugins/api/Action/)，但本次保留既有完整窗口评审帧及目标，不声称已迁成该机制。应用同步须使用已有菜单／弹层库的动态定位与碰撞处理。

基础迁移阶段的结构检查覆盖 93 个设置画面的 320×400、480×560、760×560、1000×720、1280×900，49 个浮窗的 320×400、420×580、640×800。修复发现的空状态、目录操作和校验行溢出；另检查 479／480、759／760 两侧、抽屉开关和状态往返，正文及选中 Tab 保持一致。最终引用复核包含隐藏与远程嵌套实例：28,508 个实例、371 个主组件引用（83 个远程）和 112 个 NAVIGATE 目标均可解析；93 个产品设置窗口仍共用响应式窗口主组件。产品页保留 26 个分区和 25 个原型起点。代表性渲染覆盖窄屏编辑器、各设置模块、菜单、抽屉及任务浮窗。

Figma **不会随宽度自动切换变体**：评审时按上述断点显式选择 Layout，变体内部由原生 Auto Layout 重排。固定样例原型不等于应用响应式实现；本次未修改应用代码、启动运行时或增加测试。后续应用同步与焦点管理要求见 [响应式计划](plans/2026-09-10-general-agent-requirements.md#2026-09-12--全界面响应式布局仅-figma)。

### Hover 与交互状态复核

用户确认保留半透明效果，统一同类控件规则，并要求 hover 再淡一些。常规 Ghost hover 从白色 15% 降至 10%，由 `--ata-surface-ghost-hover` 对应 Figma `surface/ghost-hover` 独立控制；标题栏、快捷命令、命令导航及同类操作共用这一值。原生背景材质仍会影响最终像素明暗，输入底色和展开、按下态继续使用原有 `input`。

| 控件与状态                   | 代码与 Figma 约定                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Ghost hover、命令导航活动项  | `surface/ghost-hover`，白色 10%；cmdk 的活动项表示当前指针或键盘目标，不是持久选择。                                  |
| Ghost 展开、任务页按钮按下态 | `input`，白色 15%；任务按钮保持 Ghost，展开或按下时移入指针不削弱该状态。键盘焦点继续使用原有 ring。                  |
| 描边按钮与变量快捷按钮       | 默认透明，hover 为 `input/30`，白色 4.5%；变量按钮采用 Outline / sm、28px、14/20 Regular，移除覆盖 hover 的局部背景。 |
| 命令管理行、参数行           | 整行 `muted/50`，嵌套动作继续使用 Ghost；Run、Switch、More 与参数动作的位置不随 hover 改变。                          |
| 下拉菜单、Select 与变量选项  | 保留 Rhea 的 `muted/accent` 活动色和 14px 行圆角；Figma 的变量 Hover / Focus / Selected 对齐实际活动选项语义。        |
| 菜单与变量补全浮层           | `popover`（#0c0c0c 80%）与 20px 模糊；移除菜单局部 `bg-card`，补全不再使用 One Dark 配色。                            |
| 输入选项                     | 通过 Button ghost/xs 组合原生 details/summary，具备 hover、展开色、键盘焦点环，保留来源配置后的展开与聚焦。           |
| 主按钮                       | hover 使用 `primary/80`；修正 Figma 主图标按钮的 100% 填充，发送、停止、继续实例继承更新。                            |

变量文字共用 `--ata-syntax-variable`，对应 Figma `syntax/variable`。补全的标题与说明共用 `command-variables.ts`，状态和插入继续由已安装的 CodeMirror 负责，通过其 [theme API](https://codemirror.net/examples/styling/) 适配菜单样式。没有新增依赖或替代补全引擎。对照了 [Rhea Button registry](https://ui.shadcn.com/r/styles/radix-rhea/button.json)；Ghost 采用用户确认的半透明项目适配，并按最新反馈将 hover 调淡，不用最新 registry 重置项目样式。

窄窗口验收另发现变量弹层在 760 × 620 下超出窗口底部 35px。弹层现在使用 Radix 提供的实际可用高度与 8px 碰撞内边距，保留标题、搜索和底部提示，仅收缩并滚动选项列表；不压缩选项本身。该约定同步至 Figma 变量选择器的 usage description。

云端复核了组件页全部 25 个普通 Hover 变体、禁用 Hover、侧栏状态及另两个资源页；实际实例读回确认共享库连接保留，相关原型实例继承更新。隔离 Electron 检查覆盖首页、命令浏览器、管理列表、变量按钮/选择器/补全、Select 与记忆确认框，另验证键盘插入、来源配置聚焦、长名称/空快捷键、禁用动作。状态记录和截图位于 `apps/desktop/.artifacts/hover/`；`final-native.png` 是白色 / 蓝色背景上的 OS 合成窗口。

本轮调淡已在更新后的隔离目录包中复核 35 个状态，记录为 `subtle.json` 与 `subtle-*.png`。确认同类 hover 为白色 10%，按下和展开保留 15%，键盘焦点环可见；同时修正原生 summary 展开后被 hover 覆盖的样式优先级。

## 运行时与数据归属

`apps/desktop/electron/agent/` 实现窄类型 IPC、单写入者元数据、不可变运行快照、执行队列与资源授权。Pi 0.85.1 运行在 Electron utilityProcess，拥有会话 JSONL；凭据只由主进程提供。模型通过现有 Providers 设置连接，不再将“保存任务”呈现为 AI 执行成功。

Hermes 0.9.8 拥有 SQLite 与 Markdown 记忆。`patches/pi-hermes-memory@0.9.8.patch` 补充桌面宿主接口、GUI 修改同步、无项目上下文、学习来源/提交策略和包内运行边界，保留上游工具、复盘、纠正与压缩前学习实现。桌面运行不调用用户 PATH 中的 `pi -p`，也不扫描全局 Pi 扩展、技能或项目记忆。

复用 Mustache 负责一次性纯文本变量解析，TypeBox 负责 IPC 与持久化边界校验，CodeMirror 负责编辑和补全，react-markdown / remark-gfm 负责结果渲染，selection-hook 负责原生选区读取。快捷键继续复用已有 react-hotkeys-hook 录制逻辑。版本与研究依据见 [实施计划](plans/2026-09-10-general-agent-requirements.md#技术方案与复用决策)。

附件支持明确列出的 UTF-8 文本类型，单文件上限 1 MB；输入、展开指令、参数及附件合计上限 120,000 字符。任务保存只读副本与内容指纹；打开、附加或重新关联产物时检查真实文件。删除任务清理该任务拥有的数据，外部原件与长期记忆独立保留。

## 验证与使用边界

- `pnpm lint`、`pnpm typecheck`、13 个现有单元测试、1 个现有 Electron smoke 检查通过；生产构建及 macOS arm64 目录包构建通过。
- 使用隔离目录和本地 OpenAI-compatible 响应夹具，验证真实 Pi 流式调用、输入确认、原生文件/终端工具、队列取消、停止、幂等提交、历史版本复跑、四类参数、记忆管理与重启持久化。同一流程已在目录包中运行。夹具只替代模型网络响应，不替代 Pi、工具执行或存储。
- 包内 Hermes 默认 10 轮自动复盘已通过：后台请求使用同一连接，命令首轮与模板不进入复盘输入，学习结果自动刷新设置页，暂停再恢复会丢弃暂停前尚未提交的写入。
- 远端模型需要在 Settings → Providers 配置。未使用用户远端模型凭据发送验证请求。selection-hook 原生模块加载和系统辅助功能权限状态检查通过；尚未验证跨应用选区快捷键的完整路径，原位替换不在本版范围。
- 本地目录包位于 `apps/desktop/release/mac-arm64/AI.app`，未签名或公证，未发布。构建仍提示 renderer 分块体积偏大与默认应用图标。

## 验证隔离修正

首次目录包验证发现已有启动逻辑只在开发构建处理 `AI_TEST_USER_DATA`，导致该次检查误用默认应用目录。已修正启动条件，现有 smoke 和本次验证脚本都先断言 `app.getPath('userData')` 等于指定目录，再操作应用。修正后的目录包与自动学习流程已重新在独立目录核验。

默认目录中的 Agent v1 数据目录创建于该次检查，全部 17 条任务属于验证夹具，已移到 `.artifacts/default-profile-verification-recovery/`；测试 Provider 已清除，快捷键、置顶和旧版浏览器存储保留。没有验证前的 Provider 快照；若此前配置过连接，需要重新填写。恢复备份包含运行数据，保持本地忽略，不进入提交。

## 历史资产

`design-assets.json` 保留 2026-09-09 初始面板的节点和五个资源名称，`third-party/Hugeicons-LICENSE` 保留许可记录。早期 SVG 已不在仓库中，临时 MCP 下载地址已移除；当前产品使用 Lucide。后续仍需使用的设计导出资源应保存为仓库内文件，不依赖临时下载地址。Inter 由 `@fontsource-variable/inter` 本地提供。

## 2026-09-12 应用同步：多连接、响应式设置与指令生成

代码按最新[提供商修订计划](plans/2026-09-12-provider-defaults-design.md#应用实现记录--2026-09-12)及产品页 `1:251` / 组件页 `69:80` 实现。Figma 保持原画板、共享库实例、变量和原型；本轮更新相关组件 usage description 的实现状态，纠正旧单连接说明与已被新计划取代的 Compact 24px 顶部 inset。

| Figma owner                                                 | 应用 owner                                                                                                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings window layout · Responsive `1119:36110`            | `settings-window.tsx` / `settings.css` / `electron/settings-window.ts`                                                                                                  |
| Settings overview header · Rhea `1181:38808`                | `settings-heading.tsx`，Providers / Commands / Memory 共用                                                                                                              |
| Settings editor layout / footer `1093:34262` / `1093:34242` | 共享滚动正文与页脚样式、命令/参数/记忆/连接表单                                                                                                                         |
| Command identity `1093:34209` / Run settings `1062:33204`   | `command-editor.tsx` / `run-settings.tsx` / `commands.css`，220px 字段与16/8px间距                                                                                      |
| Provider connections `913:17261` / Model picker `954:19478` | `provider-settings.tsx` / `model-picker.tsx` / `providers.css`，连接内4px与跨连接8px边界                                                                                |
| Command instruction generator `1231:39739`                  | 已由 Agent 会话的 `command` 工具与编辑器移交入口取代（见 2026-09-17 命令 AI 编辑）；原 `instruction-generator.tsx` / `instruction-generation.ts` 已删除，Figma 侧待同步 |

代码仍复用项目 Rhea primitives、Radix/cmdk/CodeMirror 和仓库中原始品牌 SVG。该阶段先完成静态检查；其后的完整 UI 走查见下节。真实账户 OAuth 与计费模型调用不在本次视觉验收范围。

## 2026-09-12 完整 UI 走查与透明弹层修复

用户补充的共同验收条件是：可滚动内容统一使用 ScrollArea；项目项、卡片、页面和普通对话框的标题、描述优先单行省略，保留完整值的 title 或详情入口。输入正文、会话内容、校验错误与确认操作所需的正文保持可读。

- 命令 More 菜单统一为 224px、三项次要动作、16px Lucide 图标与 9px 分隔区域，避免 Edit / Delete 文案挤成两行。Run、Switch、More 保留固定顺序；窄列表将身份和动作分为两轨，空快捷键或长名称不改变动作列。对应 Figma 主组件 `487:11060` 和实际 Enabled / Disabled 菜单均保留原型连接。
- 所有可见滚动区域复用已安装 Radix 的 [Rhea ScrollArea](https://ui.shadcn.com/r/styles/radix-rhea/scroll-area.json)，包括设置、表单、抽屉、菜单、Select、变量补全、对话框、会话、代码/表格、工具详情、附件与长输入。默认纵向 viewport 使用可收缩的 flex 布局，避免仅有 max-height 时内容被裁掉却不能滚动；横向区域保留独立测量。滚动条不占内容布局宽度。
- CodeMirror 继续拥有匹配、选择、键盘与插入。通过其公开 completion state 和 tooltip API 将可见列表呈现为 ScrollArea；默认 tooltip 仅保留不可见的库内分页度量，避免 PageUp / PageDown 失效。没有自写匹配器或劫持原生列表 DOM。补全已关闭自动补括号，避免插入后多出 `}}`。
- Select 复用 Radix popper 定位、8px 视口避让和 ScrollArea viewport，修复短窗口中的选项越界。设置抽屉修复 Tailwind 独立 translate 残留，打开时聚焦当前目的地，Escape 或导航后关闭并恢复触发器焦点；Tooltip 保留键盘与悬停触发，避免鼠标关闭后自动弹出。确认框保留 16px 视口边距，标题避开关闭按钮，长正文滚动而底部动作保持可达。
- 提供商品牌图标使用正确引用的仓库 SVG；修复长连接名、长认证选项、目录失败提示被隐藏和表单内边距覆盖。面板修复长命令、工具详情、附件、Composer 与输入错误挤占底部操作的问题。

Figma 继续复用项目组件与远端共享库连接。Provider row `910:17467` 增加 Inline / Stacked 共 18 个状态，按内容宽度 475px 切换，有效内边距包含代码 1px Item border。命令行 `373:1416` 保持同一 Run / Switch / More 结构；参数行 `414:1817` 统一四项图标操作；项目按钮 `907:17188` 的 24 个变体将图标与标签绑定为同一语义色。命令运行页共用 footer `1287:45290`。Panel dialog `1289:45187` 与权限 overlay `1292:46322` 表达正文滚动和固定操作，普通对话框描述保持单行省略；预览使用 Content / Bounded 高度变体，短内容自然收缩。权限入口分别映射新任务、命令定义或历史快照的初始值，产品页原型指向同页连接实例。Figma 需要显式选择结构性变体；源组件 usage 记录断点和代码映射，实际消费者保留文案、状态与原型目标。

透明材质仍采用原来的窗口/菜单 80% tint、设置内容/抽屉 10% tint、菜单 20px 与抽屉 40px 模糊。实测 Electron 44 的透明 backing surface 会把 CSS backdrop blur 再叠到清晰原像素上；调整窗口透明开关、普通 filter/isolation 或动画没有解决。实现复用原生 [SVG feGaussianBlur](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feGaussianBlur) 与 [feComposite](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feComposite)，仅在上层浮层覆盖的区域替换下层 portal 的像素，保留 alpha；原生窗口继续拥有桌面毛玻璃、外轮廓与阴影。全窗表面保留 alpha 下限，防止 SVG 模糊在窗口边缘产生亮晕；局部弹层保留透明圆角，并扩展滤镜范围以容纳模糊与外阴影，避免多层覆盖时变成方角。读取 alpha 兼容 CSSOM 的 rgba 与 oklab 等现代颜色表达。该适配限于 macOS Electron，Radix / CodeMirror 仍负责定位、焦点、关闭和滚动；关闭浮层后清除临时滤镜。

本次使用独立 Electron 数据目录分批检查：设置 320 / 480 / 760 / 1000 / 1280px 及 479 / 759px 断点边界和短高，共 36 个页面与尺寸组合，没有水平越界或页面异常；面板覆盖 320 / 420 / 640px，含 320px 短高与长文本。变量补全的键盘翻页、选择、插入，长认证选项、错误反馈、抽屉焦点和关闭均实测。原生合成截图核对明暗背景中的四角、边缘、阴影及材质。

检查记录与截图位于 `apps/desktop/.artifacts/ui-audit/`、`ui-audit-command/` 及各批次目录；生产设置矩阵为 `final-settings-matrix.json`，原生明暗证据为 `os-composite-*-final.png`。`pnpm check` 的格式、Oxlint、TypeScript、13 个现有单元测试、生产构建均通过，`pnpm test:electron` 的现有冒烟检查通过。真实账户认证与远端模型请求没有执行。

### 首页长标题溢出反馈

后续截图显示首页长命令名越过右侧边界。代码补齐 `CommandLauncher` 的行与文字容器约束：行允许收缩，文字容器裁剪自身内容，标题和描述由同一处 CSS 明确设为块级、单行省略，快捷键组不参与收缩。保留完整字符串的 `title`。Figma `App / Command item`（`337:1155`）原本已有 Fill + clipsContent + ENDING/maxLines1，本次补充 usage 映射并读回实际实例，未改变既有几何或原型。

截图中的原状态未在新开的窗口复现，未将缓存或热更新判定为根因。修改后使用独立 Electron 数据目录检查开发版和生产版，覆盖 320 / 420 / 640px 宽、580 / 320px 高的 12 组首页布局，以及 2 组命令目录；包含长英文、无空格标题、中文长描述、有/无快捷键和悬停/键盘焦点。文字与快捷键均在行内，标题和描述各占一行，页面错误为零。截图和尺寸读数位于 `apps/desktop/.artifacts/title-overflow/`。本次 `pnpm check` 的格式、lint、类型、13 个既有单元测试与构建通过。

### 首页文字列与抽屉动效反馈

用户继续用红框指出：无快捷键的第二条命令文字伸入第一条的快捷键列。此前只验证文字在窗口内且单行省略，没有满足同行内容边界一致的要求。现在 `CommandLauncher` 的快捷命令组通过 CSS Grid / subgrid 统一图标、文字和快捷键三列；快捷键列由整组实际内容的最大宽度决定，空快捷键行保留这一列，整组没有快捷键时才使用两列。标题和描述继续单行省略，并通过 `title` 提供完整值；没有添加占位按钮或不可见快捷键。

设置抽屉改用共享 [Rhea Sheet](https://ui.shadcn.com/r/styles/radix-rhea/sheet.json)，复用已安装的 Radix Dialog 焦点与关闭行为。设置组合指定从左侧完整滑入／滑出，时长 200ms，缓动 `cubic-bezier(0.4,0,0.2,1)`，保持内容 opacity 为 1，不使用居中缩放；减少动态效果时取消动画。局部关闭通用 CSS transition，避免原生模糊适配切换 `backdrop-filter` 时产生额外过渡。现有透明适配增加 Sheet 表面选择器，抽屉继续使用 10% 表面与 40px 模糊，原生窗口控件和桌面材质归属不变。

Figma 在既有 App / Command item (Figma `project/337:1155`) 增加 `Presentation=Quick`，保留 Catalog 及其消费者。首页两处实际实例与组件页两处实例统一迁入 Quick，并复用远程 Kbd 及既有 Rhea 适配。父级 `App · Home command grid` 模式统一控制快捷键列宽与可见性：Three keys／No shortcuts／Five keys 分别为实测的 69／0／118px。Figma 无法自动实现 CSS subgrid 的跨行测量，因此这些是明确的内容模式；换快捷键组合时须按实际最大宽度调整模式，不能把某个宽度当作通用常量。已验证 320／420px 长文字混排、640px 五键与 320px 全无快捷键，随后恢复原始文案、尺寸和原型。

Settings window layout · Responsive (Figma `project/1119:36110`) 的开闭变体使用同名抽屉层，在 -264px 与 0 之间 Smart Animate，窗口栏和正文保持不动。17 个实际消费者的层名、两处导航 Tab 与继承点击已同步；每个实例往返切换后均保留正文、SLOT、选中章节和原型目标，并恢复原来的 15 个关闭态、2 个打开态。菜单、关闭、遮罩和 Escape 均读回同一 200ms 自定义贝塞尔，按钮 hover 不变。Figma 验收记录分别为 `ui-audit-command/home-copy-boundary.md` 与 `ui-audit/settings/drawer-figma-audit.json`。

隔离 Electron 验证覆盖开发／生产两种加载方式：18 组首页布局包含 320／420／640px、不同长度快捷键与全无快捷键，另检查 320px 短高时 ScrollArea 内入口可达。8 组抽屉检查覆盖 320×400、420×685、479×320、导航后关闭、480／760px 断点切换、关闭按钮／Escape／遮罩、焦点限制与归还、减少动态效果及关闭后滤镜清理。逐帧记录确认只发生横向平移；原生录像及明暗背景截图核对侧滑、透明材质和窗口边缘，页面错误为零。

本轮证据位于 `apps/desktop/.artifacts/drawer-motion/`，其中 `home-shared-columns-production-420.png` 替代此前被用户指出问题的首页截图，`drawer-slide.mp4` 为真实窗口开闭录像。最终 `pnpm check`（格式、Oxlint、TypeScript、13 个现有单元测试、生产构建）与现有 Electron 冒烟测试通过；临时运行时与隔离数据目录已清理。

## 2026-09-13 菜单式弹层自适应宽度

用户要求所有 dropdown 形态的弹层随内容调整宽度，并保留最小宽度。代码使用原生 [`max-content`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/max-content) 计算内容宽度；Radix 弹层沿用[可用空间约束](https://www.radix-ui.com/primitives/docs/components/dropdown-menu#constrain-the-contentsub-content-size)与碰撞处理。最小宽度受可用窗口宽度约束，不能在窄窗口中撑出页面。

| 弹层                   | 最小宽度               | 宽度上限与代码归属                                                                 |
| ---------------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| 操作菜单、子菜单       | 128px                  | Radix 可用宽度；共享 `dropdown-menu.tsx`                                           |
| Select 选项            | max(144px, 触发器宽度) | 窗口宽度减 16px 上限；共享 `select.tsx`，popper 下跟随触发器，内容更长时按内容扩展 |
| 通用 Popover           | 288px                  | Radix 可用宽度；共享 `popover.tsx`，业务组合可定义自己的最小值                     |
| 连接内及跨连接模型菜单 | 256px                  | Radix 可用宽度；`providers.css` 的 `model-picker`                                  |
| 变量选择器             | 320px                  | 460px 与 Radix 可用宽度的较小值；`commands.css` 的 `variable-picker`               |
| 指令变量补全           | 320px                  | 原有 460px／窗口减 32px 上限；`instruction-theme.ts` 已采用内容宽度，继续沿用      |

移除命令菜单的 224px 和连接菜单的 240px 固定宽度；图标、快捷键及禁用原因参与内容宽度计算。继续复用现有 ScrollArea、键盘操作、模型菜单 18px／14px 圆角与单层 4px 边界。

本轮定向格式、Oxlint、TypeScript 与独立输出目录中的 renderer 构建通过；构建保留分块体积提示。未启动或连接应用运行时，因此尚未验证实际窗口中的内容宽度、窄屏碰撞和滚动效果。

Figma 对应组件已记录新宽度规则，但自适应结构尚未同步。临时连接实例试验显示：仅设 Hug 会保留旧宽度，逐层解除 Fill 后会使选项高亮失去整行宽度；恢复高亮 Fill 又使外层收缩到最小值。嵌套实例的 max-size 覆盖被 API 拒绝，原生 Grid 试验也未同时满足两者。试验节点均已移除，保留原组件、共享库引用与画板几何；不把现有固定评审宽度当作自适应布局的验收证据。

## 2026-09-17 Select 弹层内边距同步

用户截图指出 `features/commands/parameter-field.tsx` 的语言选项弹层没有内边距。根因在共享组件而非该字段：4px 边界原先只挂在 `SelectGroup` 上，而应用内 8 个文件的 10 处 `SelectContent` 都直接渲染 `SelectItem`、从未使用分组，弹层因此实际为零内边距。此前「应用 Select 已按各自 primitive 布局」的判断只核对了连接与宽度，没有测量累计内边距。

现在由 `packages/ui/src/components/select.tsx` 的 `SelectContent` 拥有单层 4px inset，与 `DropdownMenuContent`、`Command`、`model-picker` 的单层 4px 口径一致；`SelectGroup` 不再叠加，分组用法仍保持单层。行文字与勾选指示距材质边 12px，选中／悬停高亮距材质边 4px，`parameter-field.tsx` 及各消费者无需改动。

同轮用户要求下拉列表与触发器等宽。`SelectContent` 的最小宽度改为 `min(max(144px, var(--radix-select-trigger-width, 0px)), 100vw - 16px)`：popper 定位取触发器宽度与 144px 中的较大值，长选项仍按内容扩展，窄窗口继续受视口上限约束。这取代 [菜单式弹层自适应宽度](#2026-09-13-菜单式弹层自适应宽度) 中「取消与触发器宽度绑定」的单一 144px 下限，`SelectGroup` 与所有消费者自动继承。

触发器宽度让原先照菜单尺寸调好的开合动画变得明显：`zoom-in-95`／`zoom-out-95` 以 `50% 0` 为原点缩放，长宽弹层在 100ms 内左右各移动约 20px，看起来像被横向拉伸。按用户决定，Select 弹层不再有动画：官方 [base select](https://ui.shadcn.com/docs/components/base/select) 的默认 `alignItemWithTrigger` 会命中 `data-[align-trigger=true]:animate-none`，文档页看到的弹层是直接出现；应用把定位改成 popper 后动画才生效。因此从 `SelectContent` 移除 `animate-in`／`animate-out`、`duration-100`、按方向的 `slide-in-from-*` 与 `data-[align-trigger=true]:animate-none`，触发器自身的焦点色／阴影过渡保留。DropdownMenu、Popover、Tooltip 的动画不变，它们宽度仍由内容决定。

定向 Oxlint、oxfmt、`@ai/ui` 类型检查与 `@ai/desktop` 的 renderer 生产构建通过，构建产物已生成对应的 `min-width` 规则；未启动应用运行时，本环境也没有 Figma 工具，因此未复核实际窗口与画板几何。设计记录中 [弹层内边距深度排查](#弹层内边距深度排查仅-figma) 的 4px 口径已由代码兑现。

## 2026-09-17 命令输入页进入即报错修复与辅助功能权限申请

用户截图显示从首页点击 `Translate selection` 进入命令输入页后立即出现 "No selected text was captured."，且没有捕获内容却显示 "Captured 10:16:11"；随后确认正确行为：需要走系统的权限申请。应用从未在打开命令时提交任务：首页快捷命令、命令目录和设置列表的入口都只调用 `prepare` 并停在输入页，真正运行仍需要用户按 Run。

根因在 `CommandService.prepare` 与 `emptyInput()`：准备流程对命令声明的选区／剪贴板来源总是尝试捕获，任何失败都写入 `notice`，输入页进入时把 `notice` 弹成错误；空输入又用当前时间填充 `capturedAt`。现在只有全局快捷键触发把捕获失败作为 `notice`（`register` 传入 `expectCapture`，与 C3「快捷键在浮窗获取焦点前捕获、读取失败明确展示」一致）；`emptyInput().capturedAt` 改为空字符串，只有真实捕获才显示 "Captured" 时间。

按用户确认的正确行为，读取选中文字前走系统权限申请：`selection-hook` 的 `docs/GUIDE.md` 在 Node 场景使用其 `macRequestProcessTrust()`，在 Electron 场景推荐 `systemPreferences.isTrustedAccessibilityClient()`，因此由主进程的 `CommandService.requestAccessibility()` 在 macOS 未授权时调用 `isTrustedAccessibilityClient(true)` 触发系统授权对话框，每次启动最多一次，避免重复打扰。触发点是打开声明了选区来源的命令（`prepare`）与 `captureSelection()`（命令快捷键、浮窗唤起）；权限检查、申请与提示都与捕获同属主进程服务，`selection-hook` 继续只负责捕获。

用户随后用箭头指出提示只显示前半句：`lib/errors.ts` 的 `toastTextOf` 只保留首个句号前的句子并限制在 80 字符内，原消息的第二句（系统设置路径）被截掉。两条捕获失败消息因此改为单句且不超过该上限：「Enable Accessibility: System Settings → Privacy & Security → Accessibility.」（未授权）与「No selected text — select text in another app, then use the command shortcut.」（已授权但没有选区）；不再使用原先「Accessibility permission may be required」的模糊说法，后续修改提示文案时需保持单句可完整显示。

打开缺少选区／剪贴板的草稿仍保持静默：字段留空等待手动输入或显式点击捕获按钮，不会因为进入页面就报错。定向 oxfmt、Oxlint、`pnpm typecheck` 与 13 个现有单元测试通过；未启动应用运行时，无法在真实 macOS 授权对话框下复核申请时机与授权后的捕获，本环境也没有 Figma 工具，Figma 侧的权限引导样例待有工具时复核。

## 2026-09-17 界面语言选择器与 i18n 基础

用户要求在设置窗口右上角（截图红框）添加语言选择器，并把 i18n 作为后续由 agent 增量翻译的基础设施写入 [AGENTS.md](../AGENTS.md#internationalization)。渲染层复用社区方案 i18next 26.4.2 + react-i18next 17.0.14（模块级同步初始化、无需 Provider、键类型直接来自英文 JSON），没有自建翻译层；当前语言集为 `en`（源语言）与 `zh-CN`。

| 归属                                                                                       | 实现                                                                                                                            |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/i18n/`                                                                   | 初始化、`settings` 命名空间资源、`useAppLanguage`、语言自称（endonym）与首次启动的初始语言解析                                  |
| `electron/settings-contract.ts`                                                            | `LANGUAGE_CODES` / `AppLanguage` / `isAppLanguage` / `resolveLanguage`；`SettingsSnapshot.language` 与 `setLanguage` 契约       |
| `electron/settings-store.ts` / `settings-service.ts` / `preload.ts`                        | `language` 持久化；`settings:save-language` IPC 仅接受设置窗口，主进程校验、写盘并广播                                          |
| `features/settings/settings-window.tsx` / `settings.css` / `language-selector.tsx`         | 内容表面顶部 40px 头部行内的右对齐 Select（Rhea 默认触发器 32px、`Languages` 图标、语言自称）；切换后两个窗口即时生效，无需重载 |
| `features/settings/provider-settings.tsx` 与设置外壳（导航、抽屉、移动栏、加载、预览提示） | 本轮迁移的文案，en 与 zh-CN 键集合一致                                                                                          |

选择器位置按 Figma 读回的口径实现：`App / Settings window layout · Responsive`（1119:36110）内容表面 inset 12px、padding 40/40/32、概览标题自表面顶部 40px 开始，右上角是未被占用的表面内边距；代码新增的 40px 头部行替代原 `padding-top`，桌面标题仍从 40px 开始，32px 控件位于表面 y 4–36，右端对齐内容 inset 40px（窗口右缘内 52px）。紧凑布局（≤759px）标题偏移由 16px 变为 40px，因为 32px 控件无法放进 16px 的旧边距。

Figma 侧未同步：本环境只有只读的本地 Figma MCP（`figma-desktop_*` 工具集没有写入能力），无法新增选择器实例或变体。待有写权限时应在 `App / Settings overview header · Rhea`（1181:38808）或窗口组件层补齐，并复核 Desktop／Compact／Drawer 与二级页头部（`1045:32910`、`1093:34262`）；当前不把代码侧实现当作 Figma 已同步。

本轮是增量迁移的第一步：快捷键、命令、记忆、提供商子页与任务面板仍保留英文文案，后续按 AGENTS.md 的增量约定在改动时迁移；主进程原生菜单、对话框与窗口标题仍为英文。验证为定向 oxfmt／Oxlint、`pnpm --filter @ai/desktop typecheck` 与 13 个既有单元测试通过（英文值保持不变），未启动应用运行时，因此选择器的实际窗口位置、跨窗口切换与原生合成外观尚未复核。

## 2026-09-17 全界面 i18n 补齐

用户截图指出上一轮只迁移设置外壳与 Providers 总览后仍有多处英文（提供商行操作菜单、任务面板标题栏、任务权限弹窗）。本轮按功能域拆分为 `providers`／`commands`／`memory`／`panel`／`tasks` 五个命名空间，外加 `common` 承载共享词条，把渲染层其余用户可见文案全部迁入 i18n。各命名空间 en 与 zh-CN 键集合一致，共 536 条：common 10、settings 70、providers 95、commands 159、memory 36、panel 74、tasks 92。

| 归属                                                         | 迁移内容                                                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `features/providers/**`                                      | 连接行状态与操作菜单（当前默认／管理连接／刷新模型／断开连接）、目录、表单、登录、模型选择器、自定义模型 |
| `features/commands/**`                                       | 命令管理、编辑器、参数与变量、运行设置、指令生成、预览、快捷键输入                                       |
| `features/memory/**` 与设置剩余                              | 记忆列表／编辑／暂停／确认；快捷键设置、二级页返回、设置加载错误                                         |
| `panel`（`App.tsx`、`components/**`、`features/agent` 外壳） | 面板标题栏、欢迎区、Composer、语音输入、命令启动器与命令输入页                                           |
| `tasks`（会话、历史、文件、请求、权限）                      | 会话操作与复制反馈、任务历史、文件操作、输入请求、任务权限弹窗                                           |

共享工具词条（Read files／Create files／Edit files／Terminal）不再使用主进程 `TOOL_DESCRIPTIONS` 的英文标签，改由 `common.tools.*` 提供，任务权限弹窗与命令运行设置共用；权限弹窗的“新增能力”现在显示本地化标签而不是 `read, write` 原始 id，复核弹窗中的运行状态也改用 `tasks.status.*` 标签。`common` 同时承载全局 toast 的关闭控件。

独立复核后按中文质量清单统一了术语：对话（不再混用“会话”）、每次询问、设置分类、命令（不再把 Commands 写成指令）、创建副本，并修正若干措辞。英文值保持原样，13 个既有单元测试继续通过。

保留的英文边界：主进程原生菜单／对话框／窗口标题、提供商目录元数据（认证方式与云字段标签）、主进程校验消息（[command-validation.ts](../apps/desktop/electron/agent/command-validation.ts)）、[errors.ts](../apps/desktop/src/lib/errors.ts) 的回退文案，以及 Agent 运行数据（消息、工具输出、任务标题、模型 id）。处理它们需要主进程侧的语言方案；本轮未修改 `electron/**`（另有任务在改）。

验证：oxfmt／Oxlint、`pnpm --filter @ai/desktop typecheck`、13 个既有单元测试与 renderer 构建通过；行为完整性与中文质量两项独立复核通过，复核发现的 P2 项已修复。未启动应用运行时，未做实际窗口、跨窗口切换与原生合成检查。

## 2026-09-17 命令 AI 编辑移交 Agent 会话

用户决定：命令的 AI 生成不再在编辑器内弹出建议对话框，而是由主面板的 Agent harness 直接创建和修改命令；编辑器里的 AI 入口改为打开一个新会话去改。原来的「只能写指令」与随后的「整份命令建议」两条路径因此都被取代，避免同一能力有两个所有者。

运行时流程：

- 主面板普通任务的默认工具集加入 `command`（[run-service.ts](../apps/desktop/electron/agent/run-service.ts)），Agent 可以列出、读取、创建和更新命令。读取不需要确认；写入沿用现有权限弹窗逐次确认，确认卡列出创建的全部字段，更新只列出变化的字段，被拒绝时不落库。
- 写入与设置编辑器共用同一套校验（`validateCommand` + `CommandSchema`）与 `CommandService.save`：只有 name、description、instructions、input、parameters、tools、memory 七个字段可由 Agent 写入，id、revision、enabled、shortcut、templateId 与 model 仍归用户；更新必须带上读取到的 revision，过期会要求重新读取后再改。
- 命令保存或删除成功后由 `CommandService` 广播一次快照，面板与设置窗口的命令列表随之刷新（此前由两个 IPC 处理器各自广播）。
- 编辑器页脚左侧的 AI 按钮调用 `settings:start-command-session`：主进程校验来源、解析 id 并取名字，先向面板发送 `agent:command-session` 再显示面板；面板据此开启新会话，把「更新命令 “X”（id：…）：」或「创建命令：」作为种子文本放进输入框，由用户补充意图后发送。该按钮此前短暂放在二级页标题行的 actions 槽，按用户反馈移回页脚左侧；`SettingsHeading` 的 `actions` 因此在失去唯一消费者后被移除，共享头部组件恢复原形。
- 运行设置按用户反馈从页脚弹层改为编辑器正文里的正式表单项（`run-settings.tsx`，位于参数之后）：模型策略（含固定模型选择器）、记忆、允许的工具。原 `.run-settings-popover` 与 `run.modelPolicy`／`run.memoryPolicy` 随之删除，Select 改用可见标签关联（`htmlFor`／`id`）而不是 `aria-label`。工具列表按预设列表形态重排为 `ItemGroup` + `Item variant="outline" size="sm"`（`ItemContent` 标题／描述 + `ItemActions` 开关，描述改用预设的 14px muted）。整块布局由 grid 承担：`.run-settings` 提供 16px 分区行距，工具网格 `.run-settings-tools` 采用与 `.field-columns` 相同的 220px 最小列宽与 16px 间距，但上限为三列（`repeat(auto-fit, minmax(max(220px, (100% - 32px) / 3), 1fr))`）：宽窗口始终三列，456–691px 两列，更窄与并排字段同步收成一列，每张卡片内部再由 `.run-settings-tool[data-slot='item']` 的 `minmax(0, 1fr) auto` 把开关固定到独立轨道；并排的模型／记忆继续使用既有的 grid + subgrid 轨道（`.field-columns.aligned-fields`）。Figma `1062:33204` 仍保留展开／收起变体，需要设计侧改为常驻分区。

实现归属：

- `electron/agent/command-schema.ts`：`command` 工具 id、`CommandFieldsSchema`、`CommandToolSchema` 与工具回复 schema；`TOOL_DESCRIPTIONS` 增加条目，显示文案由 `common.tools.command.*` 提供。
- `electron/agent/command-tool.ts`（新增）：list／get／save，revision 守卫、字段合并与确认卡文本。
- `electron/agent/native-schema.ts`、`native-tools.ts`、`task-runtime.ts`、`service.ts`：`commandList`／`commandGet`／`commandSave` 三个 native action，按运行快照的工具集授权，工具实例在 `AgentService` 中构造一次。
- `electron/agent/worker-session.ts`：注册 `command` 工具，允许列表沿用运行快照的工具集。
- `electron/main.ts`、`settings-contract.ts`、两个 preload：设置窗口到面板的移交通道与本机来源校验。
- `features/commands/command-editor.tsx`、`features/agent/use-task-panel.ts`：编辑器移交按钮与新会话种子。

同时移除（同一决定的一部分）：编辑器内建议对话框 `command-generator.tsx`、`generation-review.tsx`、`command-changes.ts`，以及主进程的 `command-generation.ts`、`command-generation-prompt.ts`、`generation-contract.ts`、`settings.generation` 桥和配套 i18n／CSS。手动编辑、保存、运行设置、参数编辑与命令运行入口保持不变。

验证：oxfmt／Oxlint、`pnpm typecheck` 与既有 20 个单元测试通过（`--force` 强制不使用缓存）；独立复核确认按工具集授权、确认先于写入、失败与拒绝不广播、可写字段范围与校验和编辑器一致、删除后无残留引用。未启动应用运行时，因此 Agent 实际调用工具、确认卡渲染、移交后的窗口聚焦与原生合成外观尚未复核。

未同步范围：Figma 仍保留「生成指令」旧对话框（`1231:39739`）、运行设置的展开／收起变体（`1062:33204`），也还没有页脚左侧的 AI 入口；本地 Figma MCP 只提供只读工具（`get_design_context`、`get_variable_defs`、`get_screenshot`、`get_motion_context`、`get_metadata`、`get_figjam`），没有写入能力，云端 Figma 工具在本会话不可用，因此本次没有修改设计文件。

## 2026-09-17 面板改用 macOS 原生窗口控件

用户要求移除主面板 header 右侧的关闭按钮，改用 macOS 原生窗口管理按钮。实现归属：

| 归属                                          | 实现                                                                                                                                                                                                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron/main.ts`                            | 面板在 darwin 使用 `titleBarStyle: 'hidden'` 与 `trafficLightPosition: { x: 16, y: 18 }`（与设置窗口同一口径），其他平台保持 `frame: false`；darwin 的原生关闭按钮经 `close` 事件调用 `hidePanel()`，窗口只隐藏不销毁，全局快捷键与应用菜单仍能显示同一窗口，退出流程继续由 `quitting` 标记让行 |
| `App.tsx`、`features/agent/use-task-panel.ts` | header 关闭按钮只在非 darwin 渲染，`useTaskPanel` 暴露已有的 `platform` 解析；web 预览与 Windows/Linux 的隐藏入口及 `setHidden` 行为不变                                                                                                                                                        |
| `src/styles.css`                              | `html[data-platform='darwin'] .panel-header` 预留与设置窗口相同的 88px 原生控件区，logo 与标题不再与三灯重叠                                                                                                                                                                                    |

原生关闭按钮复用原 X 的「隐藏而非退出」语义；绿灯按用户要求保持可用（`maximizable: true`），与设置窗口同为 macOS zoom：缩放到工作区而不进入原生全屏（`fullscreenable: false`），因为面板是快捷键唤起的浮窗，全屏 Space 与「召回即重新停靠」的显隐模型冲突。`pnpm test:electron` 的既有冒烟检查改为直接关闭面板窗口，断言窗口隐藏但仍存在，再经 `activate` 恢复显示。

验证：定向 oxfmt／Oxlint、`pnpm typecheck`、`pnpm --filter @ai/desktop test`（20 个既有单元测试）通过。未启动应用运行时，因此三灯位置、header 内边距、原生关闭→隐藏的实际窗口表现与原生合成外观尚未复核；Windows/Linux 与 web 预览未做运行时验证。已知残留：退出流程执行 `runtime.close()` 期间若用户点击红灯，面板会销毁并触发 `window-all-closed`，应用可能不等清理完成即退出。

Figma 侧未同步：本会话没有可用的 Figma 工具（云端与本地均未连接），无法从 Panel header（`71:112`）移除关闭控件实例或为三灯预留左侧空间；待有写权限时同步该主组件、`App / Icon button` 消费者与响应式评审帧，当前不把代码侧实现当作 Figma 已同步。

## 2026-09-17 提供商表单默认模型改用共享 Select

用户截图指出连接详情表单的「默认模型」（`provider-form.tsx`）应接命令编辑器中「输入来源」同款的现有全宽 Select，而不是连接内模型搜索弹层 `ModelPicker`。该字段现在由共享 `Select` 渲染：触发器宽度与值截断继续由 `providers.css` 的 `.provider-form [data-slot='select-trigger']`／`[data-slot='select-value']` 拥有（与同表单的「认证」同一口径），选项为 `sortModels(available)`（已保存目录 + 自定义模型，按 id 排序）；未选择时用 `models.choose` 占位；当前值不在目录中时保留为 `models.unavailable` 选项，避免下拉框吞掉已保存的值。可访问名称沿用 `form.defaultModelLabel`（含连接名称），可见标签经 `htmlFor`／`id` 与触发器关联。随之删除只为该控件构造的 `preview` Connection。

保留范围：连接行（`provider-connections.tsx`）与 Composer／固定命令的 `ModelPicker` 连接内搜索菜单及跨连接选择不变，其菜单几何与最小宽度规则继续有效；表单字段本身不再提供模型搜索。

验证：定向 oxfmt／Oxlint、`pnpm lint`、`pnpm typecheck`、`pnpm --filter @ai/desktop test`（20 个既有单元测试）通过。未启动应用运行时，因此下拉位置与等宽表现、长目录滚动、禁用与窄窗口布局尚未复核。

Figma 侧未同步：本会话没有可用的 Figma 工具，无法读取或更新提供商详情表单中该字段的组件引用；待有写权限时把该字段同步为 Rhea Select，并把 `App / Provider selection menu` 留给连接行消费者。

## 2026-09-17 面板 header 图标尺寸统一

用户截图指出主面板 header 的 logo 按钮（`Astroid`，原先 20px）比右侧历史／设置按钮（16px）大，要求统一按钮图标尺寸。

实现归属：`App.tsx` 的 `<Astroid />` 去掉 `size-5`，改由共享 `Button` 的 `[&_svg:not([class*='size-'])]:size-4` 决定 16px，与同 header 内 `IconButton`（`icon-sm`，28px）的其他共享 Lucide 图标一致；`.panel-logo-button` 的 `margin-inline: -4px` 与标题位置保持不变，只更新了已过时的「20px logo」注释。AGENTS.md「shadcn Preset Fidelity」例外清单仍列有 logo sizing，本次未改动该文件。

验证：定向 oxfmt／Oxlint、`pnpm --filter @ai/desktop typecheck`、`pnpm --filter @ai/desktop test`（20 个既有单元测试）通过。未启动应用运行时，因此实际渲染尺寸、与标题的视觉间距及原生合成外观尚未复核。

Figma 侧未同步：本会话没有可用的 Figma 工具（云端与本地均未连接），无法把 Panel header (Figma `project/71:112`)（`71:112`）主组件内的 logo 实例从 20px 改为与共享 Lucide 图标一致的 16px；待有写权限时同步该主组件、`App / Icon button` 消费者与响应式评审帧。

## 2026-09-18 连续工具调用收进一个活动根节点

用户以 Full conversation column (Figma `project/237:1370`)（`237:1370`）为参照，要求连续的工具调用由一个根节点收集后展示。设计来源是该帧内的实例 `237:1418`，其主组件为 App / Agent activity (Figma `project/204:1096`)（`204:1096`，含 `201:425` Expanded 与 `204:1083` Collapsed 两个变体）。组件说明要求：只有真实工具调用进入 rail，助手正文留在 rail 之外；32px 行高、28px 层级缩进、1px 不透明连接线与 8px 弯折；隐藏末条分支时由 Tail=End 收尾。

实现归属：新增 `activity-groups.ts` 承担纯逻辑（`messageBlocks` 按相邻关系把同一轮助手消息切成文本块 / 工具块，文本永远切断根节点；`activityState` 聚合根状态，失败优先于运行中，运行中优先于中断；`isMemoryActivity` 识别全记忆调用）；新增 `activity.tsx` 渲染根节点（Collapsible + 根行 + 步骤列表）；新增 `activity-row.tsx` 作为根行与步骤行共用的行内容（20px 图标槽含 16px 图标、标题、右侧元数据、chevron，运行中用共享 `Shimmer`）；`tool-activity.tsx` 改为嵌套步骤行，保留自己的输入／输出折叠；`conversation.tsx` 改用 `messageBlocks` 渲染块；`agent.css` 拥有 stem、rail、lead-in 与末条步骤的 8px 弯折，`.tool-details` 的 rail 与根 rail 同色；`packages/ui/src/styles.css` 新增 `--activity-connector`（对应 Figma 变量 `activity/connector`），作为 rail 的唯一所有者；i18n 新增 `activity.ranTool` / `activity.ranTools`。

根节点的展开策略：运行或等待中保持展开，全部步骤进入终态后自动折叠一次；用户手动切换后以其选择为准。

标题与元数据的映射：运行时数据（`task-schema.ts` 的 `MessagePart`）只有 name／input／output／status，没有回合摘要，也没有逐步骤计时，因此根标题由调用数量生成（en `Ran 1 tool` / `Ran {{count}} tools`，zh `运行了 N 个工具`，全记忆调用沿用 `Memory`），右侧元数据是状态文案（Completed／Running…／Waiting…／Failed／Interrupted）。Figma 中的 `Done · 42s` 需要逐步骤耗时，本次未改动运行时契约与持久化数据。

验证：定向 `oxfmt`／`oxlint`、`pnpm typecheck`、`pnpm test`（20 个既有单元测试）通过；另用脚本核对分组与状态聚合（相邻工具合并为一个根、文本切分、单条与空消息、失败／运行／等待／中断的优先顺序、记忆判定）全部通过。未启动应用运行时，因此实际的 rail 连续性、折叠动画、窄面板下的换行与原生合成外观尚未复核。

对齐修正（用户反馈「线没对齐」）：在用户截图上按像素测量显示，共享 `Button` 的 `border border-transparent` 使 `.tool-heading` 的 padding box 相对边框盒偏移 1px，且每行实际高 34px。绝对定位的 heading stem 以 padding box 为包含块，于是根行 stem 落在根图标轴（相对 x8.5～9.5），而步骤 rail 落在 x7.5～8.5，两者错开 1px，且 stem 与 lead-in 之间还留下 1px 断口。现在 `.tool-heading` 设 `border-width: 0`（行高回到设计要求的 32px，图标回到轨道起点），`.tool-details` 的 rail 由 8px 改为 7.5px，接上步骤 heading 自身绘制的 stem。修正后用生产构建的 CSS（`pnpm --filter @ai/desktop build`）在无头浏览器渲染同构 DOM 并逐像素测量：四行行高均为 32px；根图标轴与 rail 同在相对 x8（同一列，无断口）；步骤内容起点 x28；步骤 heading 的 stem 与详情 rail 同在步骤图标轴；末条步骤的 8px 弯折收在相对 x16；弯折之后不再有 rail。该测量在无头 Chromium + 生产 CSS 上完成，Electron 窗口内的合成结果仍待用户在运行时确认。

Figma 侧未同步：本会话云端 Figma 工具不可用，本地 Figma MCP 只读，无法写入设计文件。本次设计侧不需要新组件（`App / Agent activity` 及两个 Disclosure 变体已存在），但两处实现差异未在设计文件中表达：根行右侧显示状态而非「状态 · 耗时」，以及上述默认折叠策略。另记一处待定项：新帧 `237:1370` 内各部分的间距是 8px，而代码沿用 `app.css`／`.assistant-message` 的 12px（与 App / Conversation turn (Figma `project/693:4071`)（`693:4071`）一致），本次未改动，待确认后再统一。

### 按设计稿重排：工具调用标签与结果卡片

用户反馈上一轮实现「没有按照设计稿来」。重新核对设计文件后确认：面向本应用的真实设计实例是 Memory activity · Saved (Figma `project/772:4031`)（`772:4031`，位于应用自己的会话轮次 `693:4071` 内），它给出了设计对真实数据的映射规则，而不是 237-1370 中标注为示意内容的文案：

- 根行 = 种类标签（`Memory`）+ 状态（`Completed`），32px 行、左 7.5px stem、4px lead-in、28px 缩进、末条 8px 弯折。
- 步骤行 = 动作标签（`Saved memory`）+ 目标（`User`，即 memory 写入工具的 `target` 参数），图标 68% 不透明度。
- 步骤内容 = 结果卡片 `Tool output`：`surface/raised` #262626、1px `border/subtle`、8px 圆角、16px 内边距、12px 间距；标题行 16px 图标 + 14/20 主色文本；正文 14/22 次级色；`Show full output` 展开原始输入与输出。

实现按同一规则映射到运行时数据：根标题在整段调用同属一种时用种类标签（复用 `common.tools.<id>.label`，memory 用 `activity.memory`，输入用 `activity.yourInput`），混合时用调用数量（`Ran N tools`），右侧固定显示状态；混合运行按种类聚合为 cluster（对应 237-1370 的同种类分组），meta 为「N 次」，单条调用直接作为 step；步骤标题用按工具的过去式动作标签（`activity.step.*`，含 memory 的四个动作），未知工具回退到原始工具名并保留 hover title；步骤右侧优先显示可由参数推导的目标（memory `target` → `activity.target.*`（User／Project／Memory／Failure）；文件工具 → 文件名；终端 → 命令首行；命令工具 → 命令名），推导不到时回退到状态文案；步骤内容改为结果卡片，标题行取输出的首个非空行（无输出时用状态），正文为后续预览，`显示完整输出` 展开原始输入／输出滚动区。图标按种类分配（read→FileText、write→FilePlus、edit→FilePen、bash→Terminal、command→SquareTerminal、memory→Brain、input→MessageCircleQuestionMark、未知→Wrench），运行中与失败仍分别用 spinner 与警示图标覆盖。新增 `--ata-surface-raised`、`--ata-radius-control` 两个 token（对应 Figma 的 `surface/raised` 与 `radius/control`），与既有 `--ata-border-subtle` 一起作为卡片的唯一所有者。

验证：`oxfmt`／`oxlint`／`pnpm typecheck`／`pnpm test`（20 个既有测试）通过；用生产构建的 CSS 在无头浏览器渲染同构 DOM，并按计算值与像素核对：六行行高均 32px；根图标轴与 rail 同在相对 x8；cluster 内容起点 x28、cluster 内步骤 x56；卡片计算样式为 rgb(38,38,38) / 8px / 16px / 1px / 12px 间距，与设计一致；步骤内容起点相对 x56。

仍未落地：设计稿中示意内容使用的散文式根标题（`Explored component patterns`）与分组的结果计数需要运行时并不存在的摘要与统计，本次分别以种类标签／调用数量与状态文案替代；逐步骤耗时仍未实现（transcript 不含计时数据），因此 `Done · 42s`、`2s` 一类时长未落地。Figma 侧仍只读，设计文件未改动。

## 2026-09-27 上下文窗口档位与自动压缩

计划：[`docs/plans/2026-09-27-context-window-and-compaction.md`](plans/2026-09-27-context-window-and-compaction.md)。代码与项目 Figma 文件已双侧同步，节点如下（链接格式 `project/<id>`，`:` 换成 `-`）：

| Figma 节点                                                                                                                                                                                             | 代码                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| App / Model config content `1544:58725`：新增 `View=Root context tiers` `1557:58946`、`View=Context` `1557:58964`；App / Model config popover · Rhea `1544:58943`：同名变体 `1557:59043`、`1557:59133` | `model-config-popover.tsx`、`model-config-subviews.tsx`、`providers.css` |
| App / Model config option · Rhea `1557:58872`（Default / Hover / Focus；32px、6/8 内边距、14 圆角、16px 勾选槽）                                                                                       | `model-config-subviews.tsx` 的档位选项                                   |
| 15 · Context window & compaction `1557:59218`：App / Compaction activity `1557:59298`（Running / Completed / Completed expanded / Failed）                                                             | `transcript/compaction-block.tsx`、`agent.css`                           |
| App / Context usage ring `1557:59243`（Normal / Warning / Error × Default / Focus）                                                                                                                    | `compaction/context-usage-ring.tsx`、`composer.css`                      |
| App / Context usage popover `1651:78274`（Loaded × Expanded、Loading、Error）；示例帧 `1651:78275`；变量 `status/progress` `1650:65606`、`context/skills` `1650:65607`、`chart-2` `1650:65608`         | `compaction/context-usage-{detail,ring}.tsx`、`context-usage.css`        |
| App / New task hint `1558:58935`                                                                                                                                                                       | `compaction/new-task-hint.tsx`                                           |
| App / Progress pill segment `1523:57936` 新增 `Kind=Compacting` `1558:59086`；App / Progress pill `1499:53918` 新增 `Compacting` 轴 `1558:59091`                                                       | `progress/progress-pill.tsx`                                             |
| App / Composer `72:150` 新增 `Show context usage` 属性；App / Composer quick panel `1447:51964` 新增 `View=Context drill` `1558:60190`、`View=Compact query` `1558:60271`                              | `composer.tsx`、`quick-commands.ts`、`slash-drills.tsx`                  |
| 变量 `status/warning` `VariableID:1557:58847`（#f59e0b）                                                                                                                                               | `packages/ui/src/styles.css` 的 `--ata-status-warning`                   |
| 评审帧 `1558:60437`（420 与 320 宽）                                                                                                                                                                   | —                                                                        |

未同步或有差异：会话菜单项“整理上下文”（Figma 中没有会话菜单可扩展）；zh-CN 文案变体；运行中微光、旋转与圆环动画只写在组件说明里；14px 库图标的描边约 1.17px，代码为 1.75（约 1.02px）；摘要以 13/20 文本近似 Markdown；评审帧中的 Composer 仍使用待迁移的旧 `App / Composer selector`（见 `96:215`）。

## 2026-09-27 macOS 菜单栏状态项与程序坞显示

决策记录：`tmp/grill-me/outcome-claude-ce5ffe71-mac-menubar-20260927-221259.md`（本机，未提交）。仅 macOS；Windows 与 Linux 行为不变。代码与项目 Figma 已双侧同步：

| Figma 节点                                                                                                                                                                        | 代码                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 16 · Menu bar status item `1562:59907`：App / Menu bar status item `1562:59933`（State=Idle / Running / Attention / Unavailable，18 × 18 模板图，连接共享库 `Lucide / sparkles`） | `electron/menu-bar.ts`、`menu-bar-status.ts`；导出图在 `apps/desktop/resources/menu-bar/` |
| 预览帧 Preview / Menu bar appearance `1562:59934`（浅色与深色菜单栏）                                                                                                             | —                                                                                         |
| Settings / Shortcuts · Desktop preview `257:1454`：页脚 Window preferences `1561:48667` 新增 Show in Dock（默认关闭）                                                             | `shortcut-settings.tsx`、`use-shortcut-settings.ts`、`settings.css`                       |

- 入口：状态项是任务面板的第二入口。左键与全局快捷键共用切换逻辑：面板聚焦时隐藏，否则停靠到默认的右下角并显示、聚焦（按用户修正，不再锚定到图标下方）。失焦不自动收起。右键或 Control/Option 点击打开日常菜单项：显示/隐藏面板、设置、在浏览器中打开、退出；一次性的“迁移到 Agent Service”只保留在应用菜单中。
- 状态：服务断开或重连中（与面板横幅一致；启动时的连接中不算）> 等待输入或确认 > 排队、运行或停止中 > 空闲，只显示优先级最高的一种。tooltip 汇总数量，不显示数字标题；完成与失败不提示。主进程文案与应用菜单一样只有英文。
- 程序坞：`showInDock` 是本机偏好，默认关闭，不同步到服务，网页端不显示。打包版通过 `LSUIElement` 以代理应用启动，启动时不会闪现程序坞图标；开启后在运行时显示。开发版启动时会先出现图标，读取偏好后再隐藏。状态项始终显示，不能关闭。
- 恢复路径：图标被刘海或菜单栏管理工具遮住、全局快捷键又被占用时，从 Spotlight、Finder 或启动台再次打开 AI 会触发 `activate` 并显示面板。

验证：`pnpm test:electron` 覆盖默认隐藏程序坞、开关切换和四个模板图的 1x/2x 加载；打包版在隔离配置中确认默认启动期间程序坞始终不可见、保存为开启后重启会显示。打包版原生操作确认：点击状态项切换面板、右键菜单与“设置…”、深色菜单栏中的模板图着色、服务停止后的 Unavailable 图标与 tooltip、隐藏程序坞后设置窗口保持焦点、隐藏程序坞时输入框的 Cmd+Z / Shift+Cmd+Z / Cmd+A、重新打开应用恢复面板。未验证：Running 与 Attention 的真实任务状态（隔离配置没有模型提供商），以及 Cmd+C / Cmd+V（避免覆盖剪贴板）。

## 2026-09-28 登录时打开

设置「快捷键」页页脚的窗口偏好新增“登录时打开”（Open at login），默认关闭，顺序为：登录时打开、在程序坞中显示、始终置顶。代码与项目 Figma 已双侧同步：

| Figma 节点                                                                                                                                                                                                                                                                                      | 代码                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Settings / Shortcuts · Desktop preview `257:1454` 的页脚 Shortcut actions `1123:37578`：Window preferences `1561:48668`（上节记为 `1561:48667`，实际节点为 `1561:48668`）新增 Window preference / Open at login `1564:60015`，开关复用 App / Settings switch · Rhea `State=Unchecked` `284:983` | `shortcut-settings.tsx`、`use-shortcut-settings.ts`                                                 |
| Window preferences 改为 Fill、最小宽度 139（最宽一项的 Hug 宽度）、行距 12；Shortcut actions 改为左对齐、间距 16，偏好组占满剩余宽度，窄宽度下开关组内换行、恢复默认按钮随后换行                                                                                                                | `settings.css` 的 `.settings-window-preferences`（`gap: 12px 16px`）与 `.settings-shortcuts-footer` |

- 状态来源：系统登录项本身，不写入设置文件。主进程 `electron/login-item.ts` 读取 `app.getLoginItemSettings()`、写入 `app.setLoginItemSettings({ openAtLogin })`；设置窗口重新获得焦点时再读一次，在“系统设置”里做的更改会随之反映。
- 可用范围：仅打包版的 macOS 与 Windows。开发版（会注册裸 Electron 程序）、Linux 和网页端的快照值为 `null`，开关不显示。
- 三个开关只由左侧可见标签命名，不再显示重复标签的 tooltip（按用户修正；此前“始终置顶”的 tooltip 一并移除）。Figma 中这些行本就没有 tooltip，App / Settings switch · Rhea `284:988` 的用法说明已改为覆盖三个窗口偏好并注明不加 tooltip。
- macOS 13+ 若返回 `requires-approval`，开关保持关闭并打开“系统设置 › 登录项”，提示 `shortcuts.status.openAtLoginApproval`；批准后回到设置窗口即显示为开启。其他未生效的开启会报错。

验证：打包版（隔离配置、CDP）读取到 `openAtLogin: false`，全程未切换登录项；按视口宽 1280、1000、760、759、480、479、320 与 760 × 420 核对页脚，英文与 zh-CN 均无溢出和横向滚动，换行位置与 Figma 各布局变体一致；悬停三个开关均无 tooltip。未验证：真实开启、`requires-approval` 流程与 Windows（避免给本机注册登录项）。

差异：Figma 中恢复默认按钮单独换行时位于行首，代码用 `ml-auto` 保持在行尾；最小宽度按英文文案取值，zh-CN 文案未在 Figma 中单独验证。

## 2026-09-28 插件化扩展设置

扩展设置改为以插件为顶层条目，详见 [计划](plans/2026-09-28-plugin-grouped-extensions-settings.md)。Figma 组件页新增 19 · Plugin-grouped extensions (Figma `project/1589:65641`)，产品页新增 S5 (Figma `project/1595:67144`)，包含 320–1280px 列表、插件详情与安装页，以及菜单、抽屉和短高状态。

- 同日后续修订（用户确认）：列表改为 Plugin card · Rhea (Figma `project/1610:75888`) 卡片网格，对应 `plugin-card.tsx` 与 shadcn `Card` size sm：16px 内边距与区块间距、24px 圆角、36px 图标环、标题 14px Medium；已安装插件在名称下显示「来源 · 版本」，描述两行截断，底部为内容摘要与状态徽标。网格列最小 240px、间距 12px。深色填充对应代码 `bg-input/40`，Figma 用新增变量 `card/surface`（6% 白）与 `card/ring`（10% 白）表达，因为绑定变量的颜色透明度取自变量本身。
- 卡片上的 More 只在有更新、配置或卸载操作时出现（Show More 属性），隐藏时保留 28px 列宽，使开关位置一致；Core、个人和共享技能不显示 More。旧 Plugin row (Figma `project/1589:66279`) 保留但列表页已不再使用。
- 分组只有「内置」与「个人与共享」，已安装插件归入后者；原「已安装」分组及其空状态已移除，安装入口在 Add 菜单 (Figma `project/1591:66028`)，其「创建」分组末项新增「记忆」。
- 记忆不再是单独插件，而是「个人」的一部分，且仅在有记忆条目时出现；插件详情按分类使用 Plugin kind tabs · Rhea (Figma `project/1614:74934`)（每个 Tab 带数量，记忆除外，Tab 内分组不再显示标题）。Plugin sub-page (Figma `project/1593:66734`) 新增 Personal · Memory tab 与 Personal · Empty 状态。
- 已知差异：Figma 换行网格无法保留空列，少于列数的卡片会被拉宽；320px 下放不下的 Tabs 在 Figma 中被裁切，代码为横向滚动；插件详情页头部的徽标位置沿用旧头部组件；搜索结果只在组件说明中描述，未单独绘制。
- 设置导航 Settings sidebar (Figma `project/256:1024`) 已包含 Extensions 与 Permissions，两项文案现在同样由 `Content/Settings navigation/*` 字符串变量拥有。上文 2026-09-12 记录的四项导航是当时状态。
- 已知差异：共享 Badge 使用 Geist SemiBold 12/16，代码 Badge 为 Inter 12 Medium（与现有技能行相同）；诊断块使用项目自有的 Rhea Alert 版本，因为共享库只有 Nova Alert。

## 2026-10-01 个人 › 记忆标签显示真实列表

用户要求插件详情的记忆标签显示真实记忆，而不是一个入口行；随后确认学习开关只由「记忆」分区拥有（标签里不再重复），标签里也不再保留跳转到「记忆」分区的入口。上文「记忆除外」与 Memory 分组的开关、计数描述已被取代。

- 代码：`features/service/plugin-memory-group.tsx` 复用 `features/memory/memory-list.tsx` 的行与 `memory-delete-dialog.tsx`，与「记忆」分区共用 `use-memory-snapshot.ts`；行点击经 `useOpenSettingsMemory` 打开「记忆」分区的编辑页，More 可在原地删除；每行在 More 前有与命令行相同的启用开关，关闭的条目移出 agent 的记忆（不参与检索、学习和 `@` 引用），仍可编辑和删除。标签内只有记忆列表，没有学习开关或入口按钮。记忆 Tab 与其他 Tab 一样显示条目数（含已关闭条目）。
- Figma：Personal · Memory tab (Figma `project/1614:75986`) 移除学习行，只保留记忆列表；Plugin kind tabs (Figma `project/1614:74934`) 的 Memory 带数量；Plugin item row (Figma `project/1590:66093`) 新增记忆行类型（`Trailing=More`）并删除旧 Memory 变体；该类型显示 Switch 列与 More，开关复用命令行的 `App / Settings switch · Rhea`，画面中「Corrections and learnings」一行示意关闭状态。S5 消费者已继承。
- 记忆来源追溯经评估暂不实现：写入路径已限于任务内的记忆工具调用与根运行学习器，Hermes 补丁冻结且条目以内容哈希为 id、学习器只报告「已变化」，旁路账本只能靠差异推断，会与单一权威（D7）产生漂移。
- 已知差异：「记忆」分区画面（C · 04.01–04.05）仍用较旧的 App / Memory item (Figma `project/339:1153`)（无类型图标、编辑按钮而非 More），与代码列表不一致，尚未迁移；该组件已在编辑按钮前加入同一启用开关，04.01、04.03、04.05 与 320px QA 各有一行示意关闭状态，保存中的半透明状态未绘制。

## 2026-10-04 skill 形状的记忆（替换 pi-hermes-memory）

计划见 `docs/plans/2026-10-04-skill-shaped-memory.md`：服务改为自建记忆引擎，每条记忆是带名称、描述、类型、加载方式和正文的单元；单条开关、学习建议与「保存前询问」进入设置界面。上面 2026-10-01 一节的行结构与 Hermes 相关说明由本节取代。

- 行（2026-10-05 起退役，由下文的记忆卡片取代）：App / Memory item (Figma `project/2005:115750`)（339:1153 原地改为变体集，`Media=Icon|Ring` × `State`）= Rhea Item sm outline：类型图标；标题为描述；第二行「名称 · 类型 ·（纠正类）分类」加来源徽标（Learned / Agent / App）与 New 徽标（secondary）；随后是启用开关与 More（编辑 / 删除）。设置 › 记忆用 Icon，Personal › 记忆标签用 36px 圆环（Ring），Plugin item row (Figma `project/1590:66093`) 的 `Trailing=More` 嵌套此行。类型名为用户档案 / 偏好与事实 / 纠正与经验（User profile / Preferences and facts / Corrections and learnings）。
- 列表页 App / Memory list content · Rhea (Figma `project/2007:116669`)：搜索 + Add（默认按钮，菜单 (Figma `project/2007:116069`)：New memory（bookmark-plus）/ Create with AI）；有建议时 Suggestions 组位于列表上方，建议行 (Figma `project/2007:116036`) 的种类图标为 book-open / bookmark-plus / pencil-line / bookmark-minus / pin，标题为描述，第二行「种类 · 名称 · 类型」，下方为原因，操作为 Dismiss（ghost）与 Accept（outline），记忆已改动的过时建议只保留 Dismiss 并显示提示，操作位于右上角，320 宽窗口时换到正文下方右对齐；读不了的记忆文件在列表顶部提示；页脚两枚玻璃开关 (Figma `project/2006:115912`)：Learn automatically、Ask before saving（暂停学习时禁用）。Settings switch 新增 `Size=Small`。
- 记忆页 App / Memory page · Rhea (Figma `project/2010:118214`)：标题为记忆名称（关闭时带 Disabled 徽标）；信息块为来源、学习自任务、创建、更新；字段依次为名称 | 类型、描述（整行）、加载方式（所选项的提示显示在下方）| 分类（仅纠正类）、正文（下方附说明）；页脚 Delete memory / Cancel / Save changes，新建时为 Create memory。编辑页页脚新增 `Show leading action`。删除确认的标题点名记忆。
- 接受「新 skill」建议时由服务写入 Personal skill 并打开该 skill 的扩展页；`@` 面板只列出启用的记忆；上下文用量新增 `memory` 类别：代码 `--context-memory`，Figma 变量 `context/memory`（指向 `tw-raw/pink/400`），Context usage popover (Figma `project/1651:78274`) 在 Skills 之后增加 Memory 段与行。
- 画面：C · 04.01–04.06 与 C5 (Figma `project/2029:100393`)（04.07–04.16，含无法读取的文件与过时建议、已关闭的记忆、打开期间被改动或删除的记忆页；1280–320 宽度、短高度），QA 320 已迁移。
- 已知差异：Badge 字体沿用 Geist（代码为 Inter）；第二行长文本需在实例中改为 Fill 才会在徽标前截断；页脚未叠放在列表上；Add 菜单固定 224px；More 菜单复用 Command actions menu；zh-CN 画面、`@` 面板、保存中状态、409 提示与删除 toast 未绘制。

同日评审修正（代码与 Figma 已同步）：

- 建议行 App / Memory suggestion row · Rhea (Figma `project/2007:116036`) 新增 `Text=None|Collapsed|Expanded` 与文本属性 `Proposed text`：新建、更新与 skill 建议（正文非空）在种类行下方显示链接样式的切换「Show text / Hide text」（App / Settings action · Rhea `Size=Extra small, Variant=Link`，左右内边距 0，即代码 `Button variant="link" size="xs"` 加 `px-0`），展开后在其下方显示完整拟写正文（App / Detail / Meta 12/16、muted、保留换行，最高 160px 并自带纵向滚动，即代码 `ScrollArea` 的 `max-h-40`）；删除与常驻建议为 `Text=None`。Dismiss / Accept 贴行顶部（代码 `ItemActions` 加 `self-start`），展开正文不会移动按钮，所有建议行的操作位置一致。示例：04.07 有一条展开（Update memory）与两条收起，删除建议没有切换；04.01、04.13、宽度扫描与 QA 320 显示收起的切换。
- 记忆页新增 `Page=Edit · Changed elsewhere`：打开期间别处保存了新版本且有未保存修改时，正文顶部提示 “This memory changed after you opened it.” 与 Reload。新增 `Page=Edit · Deleted elsewhere`：别处删除且有未保存修改时页面保持打开，提示 “This memory was deleted elsewhere. Save keeps your edits as a new memory.”，主按钮改为 Create memory，不再显示 Delete memory，标题与信息块保留最后读到的内容。两种提示是新组件 App / Memory page alert · Rhea (Figma `project/2094:126164`)（`Kind=Changed elsewhere|Deleted elsewhere`，Rhea Alert 几何、无图标，Reload 按代码 `AlertAction` 绝对定位在右上）。画面 04.15 (Figma `project/2096:127227`)、04.16 (Figma `project/2096:127833`)。
- 加载方式 Always 的说明改为 “Every run includes its text, or only its description when the text is over 600 characters. Always-on memories share 3,000 characters; any that don't fit are listed in the memory index instead.”。此前没有画面选中 Always，因此新增 `Page=Edit · Always`，04.11 (Figma `project/2030:102273`) 改用该变体；说明在 1280–320 宽度的字段内换行（3–5 行），不截断。Figma 没有中文画面，zh-CN 文案只在代码中。
- 已知差异：展开正文的滚动渐隐（`scrollShadow`）未绘制；Alert 为操作预留 72px（`pr-18`），Reload 加右侧 12px 需要 82px，满行文字可能伸到按钮下方（代码相同）。

2026-10-05 记忆列表改为卡片（代码与 Figma 已同步，review-fixes v1.2）：

- 新组件 App / Memory card · Rhea (Figma `project/2126:127588`)（`Enabled=On|Off` × `State=Default|Hover`）即代码 `memory-card.tsx`（基于共享 `ListCard`），与 Plugin card、App list card 结构和取值相同：36px 圆环内的类型图标；标题为记忆的描述（单行截断），下一行为名称；正文为记忆内容，两行截断并固定占两行高度；底部为「类型 · 分类（仅纠正类）· 加载方式」，在徽标前截断，徽标依次为来源（outline：Learned / Agent / App，自己写的没有）、New（secondary）、Disabled（secondary，关闭时）；右上角为启用开关与 More，与图标居中对齐；整张卡片打开记忆页，Hover 为整卡底色。文本、图标、来源与 New 都是组件属性，来源徽标的文字通过公开的嵌套实例修改。
- 设置 › 记忆概览（List content (Figma `project/2007:116669`) 五个有记忆的状态）与 Personal 的记忆标签（Plugin sub-page (Figma `project/1614:75986`) `Page=Plugin details · Personal · Memory tab`）都以卡片网格列出同样的 6 条记忆：每列至少 240px、间距 12，1280 宽三列、1000 宽两列，760 及以下一列；建议仍是行，位于卡片上方，组间距按代码 `.memory-list` 改为 8。04.09 改为卡片的 More 菜单（卡片 Hover、More 为 Selected，菜单右对齐在其下方 4px）；Personal 记忆标签画面原先分叉的行内容已恢复为主组件内容（计数 6）。
- 建议行移除 `Layout=Narrow`，改为原生自动布局换行（v1.4，对应代码 `ItemContent` 的 `min-w-40` 与 `ItemActions` 的 `ms-auto self-start`）：每个变体横向换行、行列间距 14，正文最小宽度 160；行宽放不下正文与按钮时（两个按钮 389px 及以下、只有 Dismiss 309px 及以下，即 320 宽窗口）Dismiss / Accept 换到正文下方单独一行、右对齐、与正文相距 14，正文占满整行；480 宽及以上保持右上角。宽度扫描 320 栏与 QA 320 已自动换行，展开正文的建议行在 320 宽同样如此。
- App / Memory item (Figma `project/2005:115750`) 与 Plugin item row 的 `Trailing=More` 已没有实例，说明中标为退役，未删除（两者需一并删除）。
- 代码已让设置 › 记忆的卡片也画出 36px 圆环（`settings.css` 的 `.memory-settings .list-card [data-slot='item-media']`），与 Personal 记忆标签一致。
- 已知差异：Figma 换行布局会拉伸末行的单张卡片（代码保持列宽），示例用 6 张卡片避开。

## 2026-10-01 命令输入来源新增截图

代码已支持把截图作为命令输入来源，本次只同步 Figma，没有修改应用代码。

- 代码：`features/commands/input-options.tsx` 的 Input source 选项依次为 Manual input、Selected text、Clipboard、Screenshot、No text input；选 Screenshot 时 Input options 里的 Allow attached files 开启并禁用。输入页 `features/agent/command-input.tsx` 在 Screenshot 来源下渲染 `screenshot-field.tsx`：标签行右侧是 outline `sm` 按钮（Lucide `camera`，Take / Retake screenshot），下方是截图预览（`resource-image.tsx`：最高 192px、宽度不超过内容宽、`rounded-xl`、描边、`object-contain`）；没有任何图片时显示 “Take a screenshot to run this command.” 且 Run 禁用。附加的其他图片在 Files 列表里用 16px 缩略图代替文件图标。
- 组件（02 · App components）：新增 App / Command screenshot field · Rhea (Figma `project/1686:79500`)（State=Missing / Preview，按钮为连接的 App / Settings action · Rhea Small Outline 加共享 `Lucide / camera`）、App / Command attachment row · Rhea (Figma `project/1687:79488`)（Kind=Image / File，移除按钮为 App / Icon button Ghost icon-xs）和 App / Command input source menu · Rhea (Figma `project/1687:79572`)（与 Command actions menu 同构：Popover surface 材质层加连接的 Dropdown Menu Item，按 SelectItem 调整为 6/8px 内边距、14px 圆角、尾部 16px 勾选列）。App / Settings switch · Rhea (Figma `project/284:988`) 增加 Checked disabled / Unchecked disabled（50% 不透明度）。`shadcn · Project` 新增 `radius/image-preview`（别名 `radius/tooltip`，14px）与 `radius/thumbnail`（6px，`rounded-sm`）。
- 审阅画面：新区块 C2 · 截图输入 (Figma `project/1688:79581`) 包含 05.07 输入来源菜单展开、08.09 Screenshot 来源下 Allow files 锁定开启，以及输入页 02.07 已拍摄预览、02.08 未拍摄（提示加 Run 禁用）、02.09 附加图片代替截图（缩略图行）、02.10 面板 320 宽预览。输入页文件没有现成的宽度变体，因此以 420 为主，另加一帧 320 用于窄宽检查。截图样例图取自 08.01 画面导出。
- 已知差异：Figma 输入页沿用旧的 Command run footer（Review / Ask first / Change input / Run），代码页脚为 Command settings 加带 ⌘↵ 的 Run；编辑器里 Input options 仍是二级页（08.xx）而不是代码的 Popover，字段标签仍为 “Input” / “Main text source”，代码是 “Input source”。拍摄中状态（按钮禁用、Spinner 代替相机）只写在组件说明里，没有单独绘制。

## 2026-10-01 原生截图浮层与标注工具栏

代码已实现原生截图浮层（`apps/macos/Sources/AIShell/Capture/`），本次只同步 Figma，没有修改应用代码。浮层与工具栏都是 AppKit 原生界面，不是网页；Figma 只是预览。

- 组件（02 · App components 新区块 21 · Screenshot capture overlay (Figma `project/1694:87769`)）：App / Capture annotation toolbar (Figma `project/1695:88345`)（`AnnotationToolbar.swift`：Tools 10 段、Colours 6 段、Stroke widths 3 段、Undo/Redo、Cancel/Done；内边距 6/8、间距 4，组间 12；变体 Tool=None 与各工具 × History=None / Undo / Undo and redo）由 App / Capture tool segment、colour swatch、stroke segment、toolbar button 组成，图标连接共享库 `Lucide / *`（D9 的 14 个名称）。浮层部件：App / Capture selection (Figma `project/1694:87797`)（State=Highlight / Selected / Locked：1.5pt 强调色外描边、8pt 白色手柄、尺寸标签）、App / Capture size label（`1694:87770`）、App / Capture loupe (Figma `project/1694:87798`)（15 × 15 像素、8 倍、读数为 Quartz 坐标与 hex）、App / Capture hint pill（`1694:87776`，Kind=Idle / Accessibility）。
- 令牌：`ATA · Panel semantics` 新增 `capture/*`（强调色即系统 controlAccentColor、40% 遮罩、72% 标签底、六种标注色等）；效果样式 `ATA/Capture toolbar glass` 仅用于预览工具栏胶囊。代码中的材质是 `NSGlassEffectView`（Liquid Glass，圆角 = 高度 / 2），由系统绘制，Figma 用 material/glass 填充、popover/ring 内描边和该效果近似。
- 审阅画面：产品页新区块 C3 · 截图捕获浮层 (Figma `project/1696:74490`)：C3.01 空闲（元素高亮、放大镜、两条提示）、C3.02 已选区与下方工具栏、C3.03 标注中（矩形、箭头、文字、马赛克、序号 1–3，Arrow 选中、可撤销）、C3.04 靠近底边时工具栏翻到上方、C3.05 zh-Hans 提示。冻结屏幕为示例桌面组件（仅原型内容）。
- 已知差异：分段控件与工具栏按钮的高度、选中填充和禁用透明度是对系统控件的近似，只绘制深色外观；尺寸标签字体用 SF Pro，未开启等宽数字特性。
- 同日修正（代码与 Figma 已同步）：工具栏翻到上方时让出尺寸标签（`AnnotationToolbarLayout.sizeLabelReach = 30`，y = 选区顶 − 30 − 8 − 工具栏高），C3.04 已更新；所有色板都有 1pt `labelColor` 40% 描边（`capture/swatch-edge`，深色外观为白色 40%），黑色色板在玻璃上可见。
- 同日按用户修正重做工具栏（取代上文分段控件的结构与近似说明）：所有控件都是 28 × 28 圆形按钮 App / Capture toolbar button (Figma `project/1701:88788`)（Kind=Glyph / Accent glyph / Swatch / Stroke × State=Rest / Hover 9% / Pressed 16% / Selected / Disabled），内边距四边 6、按钮间距 2、组间 16pt 分隔线两侧各 6，胶囊 740 × 40、圆角 20 = 14 + 6 同心；工具与线宽选中为强调色圆加白色图形，颜色选中为内缩 2pt 的 2pt 强调色环；旧的 tool segment / colour swatch / stroke segment 组件已删除，色板与线宽图形改为 App / Capture swatch dot、stroke dot，C3.02–C3.04 实例已继承并按 740 宽右对齐。
- 标注可在绘制后改样式：颜色与线宽按钮显示并修改选中标注（或正在编辑的文字）的样式，未选中时作用于下一个标注；线宽同时决定文字大小、序号尺寸与马赛克粗细。App / Capture toolbar button 新增 Kind=Swatch, State=Disabled（`1703:88838`），工具栏新增 Colours 变体属性与 Tool=Mosaic, Colours=Disabled（`1703:88841`，选中马赛克或马赛克工具且无选中时六个颜色均禁用）；新画的标注保持选中，C3.03 中最后画的箭头两端显示抓手。
- 样式控件按用户要求移出主工具栏（取代上两条中颜色禁用的做法）：工具栏只剩 10 个工具 | 撤销、重做 | 取消、完成（450 × 40，Colours 属性与禁用色板状态已删除）；新增 App / Capture style bar (Figma `project/1704:88999`)（Kind=Default 290 × 40：6 色板 | 3 线宽；Kind=Mosaic 100 × 40：只有线宽），仅在有可设置样式的对象时显示，与工具栏叠成一组、间距 6、左缘对齐（下方时样式栏在工具栏下，上方时样式栏在最外侧）。C3.02 无样式栏，C3.03 显示选中箭头的样式，C3.04 改为 Rectangle 工具并在上方叠放，新增 C3.06 马赛克工具帧（`1704:89064`）。
- 同步 v4/v5：选区全程可调、标注时也显示手柄（删除 State=Locked）；工具栏 11 个工具（Mosaic 后新增 Spotlight `focus`，S），480 × 40，新增 Tool=Spotlight 变体；样式栏新增 Kind=Text（330 × 40，第三组为 `square-text` 文字背景开关，开启为强调色填充），Spotlight 无样式不显示样式栏；尺寸标签在导出像素不同时追加「 · W × H px」；提示新增 Kind=Selected（`capture.hint.selected`），底部会碰到选区带时移到顶部；新增 C3.07（`1706:75264`）展示聚光灯 50% 压暗、带黄色底板的文字（选中虚线框）与元素框悬停预览。调整选区时的放大镜只写在组件说明中，未单独绘制。
- 同步 v6：面板端新增 App / Composer attach menu · Rhea (Figma `project/1709:88967`)（`composer-attach-menu.tsx`：截图 / 上传文件 / 提及…，向上展开、左对齐）、App / Vision notice（`1709:89025`）、App / Composer attachment chip（`1709:89042`，图片带编辑铅笔）、App / Composer `State=Ready attachments`（`1710:89043`）、截图字段 Preview 增加「Edit screenshot」、App / Message image thumbnail（64px，`1710:89210`）与 App / User message `Content=Images`（`1710:89211`），审阅区块 C4 (Figma `project/1712:75731`)；原生端提示新增 Kind=Recall / Windows only，新增 C3.08（`1711:89126`）、C3.09（`1711:89269`），C3.03 的序号 2 带尾巴指向柱形。
- 2026-10-02 工具栏可拖动（代码与 Figma 已同步）：工具栏最左侧新增 App / Capture toolbar grip (Figma `project/1774:95884`)（16 × 28，`Lucide / grip-vertical`，muted-foreground），工具栏变为 498 × 40；拖动抓手或任一栏的非按钮区域，两栏作为一组移动，本次截图内停在放下处（距显示器边 8），样式栏有空间时在下方、否则在上方；双击恢复到选区旁。C3.02–C3.07 的工具栏与样式栏左移 18，保持与选区右对齐。
- 2026-10-02 马赛克稳定化与模糊形态（代码与 Figma 已同步）：`CIPixellate` 实测为每块点采样且网格锚在区域左上角，区域移动 1px 即整体跳变；改为网格锚定冻结屏幕左上角、每块取块内像素精确平均，块边长按线宽固定 8 / 12 / 18 pt（不再随区域大小变化）。新增模糊形态：整屏高斯模糊（半径 6 / 10 / 16 pt），区域只取窗口。App / Capture style bar Kind=Mosaic 前置「马赛克（grid-3x3）/ 模糊（droplet）」二选一组，记忆为 `capture.annotation.style.redaction`；C3.06 实例已继承。
- 同日补充遮盖与随机扰动（代码与 Figma 已同步）：马赛克形态新增「遮盖」（`solid`，不透明黑框，不保留任何原像素，选中时隐藏线宽），图标为新组件 App / Capture cover glyph (Figma `project/1776:95940`)，样式栏 Kind=Mosaic 变为三选一，新增 Kind=Cover 变体；马赛克块在精确平均后加按块位置与大小确定的 ±12 级扰动（参照 CleanShot X 的随机化，对抗 Depix 一类的块平均匹配），同一块始终相同，移动仍稳定。随后按用户反馈（深色界面上呈棋盘噪点，“太花”）参照 PixPin（文档：块内平均值替换整块，无扰动）撤除扰动；需要确保不可还原时用「遮盖」。
- 同日按用户要求改为 PixPin 式强度滑块（代码与 Figma 已同步）：马赛克不再用三档线宽，样式新增连续强度 `strength`（0–1，默认 0.3，记忆为 `capture.annotation.style.strength`），马赛克块 4–32 pt、模糊半径 2–28 pt；样式栏为 AppKit `NSSlider`（small，112 pt），拖动时只预览、不进撤销栈，松手提交一步，`[` / `]` 按 0.1 步进，选「遮盖」时隐藏。新组件 App / Capture strength slider (Figma `project/1778:95951`) 为系统滑块的深色近似，Kind=Mosaic 变为 224 × 40，C3.06 实例已继承。
- 同日按用户要求把所有三档大小改为同一个滑块，并参照 PixPin 加滚轮（代码与 Figma 已同步）：`AnnotationStroke` 由 thin/medium/thick 改为 0–1 连续值，默认 0.3 正好等于原中档；各工具尺寸线性映射并取整到 ¼ pt（线宽 1–11、荧光笔 8–48、文字 13–43、序号 19–49、马赛克块 3–33、模糊 1–31 pt），马赛克单独的强度并入其中。滚轮在浮层任意位置调整样式栏当前目标的大小（向上变大，每格 1/20），`-` `=`（及 `[` `]`、Shift 下 `_` `+`）为键盘等效，与 PixPin 的滚轮和 -/= 快捷键一致；一次拖动或一串滚轮（间隔不超过 0.5 秒或同一触控板手势）为一步撤销。PixPin 的 Ctrl + 滚轮调透明度未采用（没有透明度样式）。组件改名 App / Capture size slider (Figma `project/1778:95951`)，样式栏 Kind=Default 314、Kind=Text 354 宽；记忆键仍为 `capture.annotation.style.stroke`（改存数字，旧的档位名回落为默认值）。
- 同日新增「复制」（代码与 Figma 已同步）：工具栏完成组变为 取消 | 复制（Lucide `copy`，⌘C）| 完成，宽 528 × 40；复制导出与完成相同的带标注图像，以 PNG 与 TIFF 按完整像素写入剪贴板（尺寸按点计，粘贴为屏幕大小）后结束截图，不附加到输入框，页面调用按 `cancelled` 收到；选区同样记为 `R` 的上次区域；打开文字编辑时 ⌘C 仍复制所选文字。C3.02–C3.07 工具栏左移 30，保持与选区右对齐。

## 2026-10-02 依赖升级带来的界面变化

依赖升级（pi 1.0 codemode、streamdown 2.7、MCP 新字段）改动了代码中的界面，本次同步 Figma，并以代码为准。链接节点均在 ai (Figma `project`) 文件中。

- 代码块：App / Markdown code block (Figma `project/229:907`) 改为 `@pierre/diffs` 版式（1px 描边、14px 圆角、行号、13/20 等宽），删除旧的语言标签头部与 `Language` 属性，新增 `Hover=Off/On`：完成态悬停显示 Download（`download-button.tsx`，Lucide `download`）与 Copy，流式态（`streaming-code-block.tsx`）悬停只显示 Copy。新增令牌 `code/*`（ATA · Panel semantics）、`radius/code-block`、`sidebar`（shadcn · Project）。
- 图表与脚本（新区块 22 · Transcript diagrams & scripts (Figma `project/1722:89369`)）：App / Mermaid diagram (Figma `project/1722:89500`)（Streamdown 全屏胶囊旁为 Copy 与下载菜单触发器）、App / Diagram download menu · Rhea (Figma `project/1722:89509`)（SVG / PNG / Mermaid 源码）、App / Tool body · Codemode (Figma `project/1723:89570`)（脚本代码块最高 320，随后为活动轨道上的嵌套步骤；变体为等待审批与已拒绝步骤）。
- MCP 设置：App / Extension sub-page · Rhea (Figma `project/1584:63172`) 的添加、详情、需审批、已审批页增加 Connection、OAuth client（客户端 ID、名称、回调端口、元数据 URL、客户端密钥）与 Agent access（工具加载方式、允许读取资源）分区；新增 MCP details · Plugin（只读事实与「复制到个人」提示）、MCP add · Remote（认证为 None 时的登录提示）与 MCP add · OAuth · Invalid（行内错误）；新增组件 App / Settings switch row · Rhea (Figma `project/1723:89709`) 与 App / MCP client secret input · Rhea (Figma `project/1723:89787`)（Saved / Replacing / None）。App / Extension detail row · Rhea (Figma `project/1576:62091`) 去掉固定 20px 高度，换行内容不再溢出。
- 审阅画面：S7（`1727:92460`，六个 MCP 页面 1000 宽全长，以及 480 卡片与 320 抽屉宽度下双列堆叠，另有英文行 `1731:80242`），T2（`1731:94988`，420 与 320 面板宽度下的代码块、展开菜单的图表与两种脚本状态）。选区工具栏改为 Radix Toolbar 只影响键盘焦点，外观不变，未改 Figma。
- 已知差异：工具加载下拉的展开态、另两个选项的说明、保存成功与导出失败提示、插件命令（stdio）事实只写在说明中，未单独绘制；语法色与行号宽度为近似，Geist Mono 代替 SF Mono，`=>` 因连字显示为 ⇒；`App / Activity step` 在窄行中长目标会挤压标题（代码中目标截断），320 示例改用短目标；S4/S7 1000 宽窗口实例的面包屑仍为旧的「Models」。

## 2026-10-02 输入框 @ 面板提及命令与记忆

用户要求 Composer 的 `@` 面板也能提及已保存命令和记忆（此前引用类条目常常只剩 MCP），并确认两者都作为引用芯片：命令把定义（名称、说明、指令模板、参数）作为上下文交给本次运行而不执行它，记忆只引用单条条目的内容。`/` 仍不列已保存命令（Q2 不变）。

- 代码：`features/quick-panel/use-saved-groups.tsx` 提供 Commands（已启用命令）与 Memory 分组，`use-mention-view.tsx` 把它们排在子代理之后；芯片新增 `command` / `memory` 两种（`composer-editor/draft.ts`、`chip-content.tsx`），契约 `RunReference` / `InputChip` 同步新增；服务端在 `references/saved.ts` 解析，记忆按内容哈希 id 定位，条目改过或本条消息关闭记忆时列为不可用。命令指令编辑器不提供这两类（指令令牌不含它们）。
- Figma：App / Composer quick panel (Figma `project/1447:51964`) 的 `View=Mention root` 在 Subagents 后新增 Group / Commands 与 Group / Memory（Lucide / command、Lucide / brain，记忆类型作为尾部状态）；App / Composer chip (Figma `project/1451:53451`) 新增 `Kind=Command` / `Kind=Memory`（Default、Selected）；两处组件说明已更新。
- 已知差异：Mention root 的 Options 区域固定高度并裁剪，新分组位于滚动区下方，整体预览中不可见；`View=Mention query` 未绘制命中命令或记忆的示例。

## 2026-10-02 Atd 名称与品牌标识

项目对外名称统一为 `Atd`，Figma 文件标题也已更名。应用显示名、菜单、窗口标题、应用包及安装包名称已同步；工作区包名和导入路径统一为 `@atd/*`。Bundle ID、数据目录、钥匙串和通信协议标识保留，以保持现有数据与连接兼容。

- 标识（2026-10-09 起由水滴标识取代，见下节）：使用完整的抽象折带轮廓与圆形端部，不含产品名字母。原始透明 PNG 保留在 `packages/ui/src/assets/brands/atd/symbol.png`；Figma 原始标识组件 (Figma `project/1741:95290`) 与 前景色组件 (Figma `project/1741:95292`) 共用该图像，没有重绘轮廓。
- 面板：Panel header (Figma `project/71:112`) 的新建任务入口替换为新标识。26px 图像占位保留原始透明留白，实际标识约 16px 宽，按钮保持 28px；返回箭头的覆盖实例继续使用 16px。代码通过 `currentColor` alpha mask 着色，按比例完整显示。设置导航继续不显示 Logo。
- 菜单栏：四种状态 (Figma `project/1562:59933`) 共用新标识，保留运行圆点、待处理标记和不可用时的 40% 不透明度，导出 18px／36px 透明模板图片。状态栏专用实例放大到约 17.1px 的可见宽度，图框外只保留原图的透明留白，完整轮廓留在 18px 图框内。
- 应用图标：1024px 母版 (Figma `project/1741:95296`) 使用 864px 浅色底板，四周留 80px 透明边距。正式 PNG 通过 Figma `exportAsync` 导出，未包含画布底色；macOS AppIcon 的 10 个尺寸从该母版等比导出。图片资源与生成提示词见 `packages/ui/src/assets/brands/atd/README.md`。
- 开发环境：开发版应用图标 (Figma `project/1757:95728`) 在完整图形旁加入琥珀色 `DEV` 标签。标签右下圆角为 134px，与外框 190px 圆角同心，右侧和底部等距内缩 56px。Debug 构建使用 `AppIconDev`，Release 使用 `AppIcon`；面板按 `import.meta.env.DEV` 显示 54 × 26 的标识，按钮为 68 × 28，水平内边距 6px，与标题相距 8px；开发版菜单栏使用 44 × 18 的模板图片和自适应宽度，完整显示图形、状态标记与 `DEV`。

## 2026-10-09 Atd 标识改为水滴

标识重画为扁平抽象的“水滴”：两颗水滴在对角线上尖对尖相接，纯色实心，不含字母和外框。经过实心几何、单色徽章两轮方案后定稿。

- 母版：矢量 `packages/ui/src/assets/brands/atd/symbol.svg`。全部 PNG（符号、应用图标及开发版、两套 AppIcon、菜单栏 8 张模板图、官网图标）由 `node scripts/export-brand.mjs` 从母版导出，不再从 Figma 导出或手工修改。
- Figma：`App / Atd symbol` (Figma `project/1741:95290`) 改为矢量，水滴占 26px 图框的 58%，与导出的 `symbol.png` 留白一致；引用它的前景色组件、应用图标、面板标题和菜单栏状态随之更新。
- 尺寸：面板 26px 占位中可见约 15px；应用图标保持 864px 浅色底板与 80px 边距，标识 400px 居中，开发版 `DEV` 标签位置不变，距标识 16px；菜单栏标识可见 15pt。
- 菜单栏：运行圆点与待处理标记移到标识空出的右上象限 (Figma `project/1562:59933`)，中心 (13.5, 4.5)，四周挖出间隙；不可用状态仍为 40% 不透明度。

## 2026-10-02 选择文字工具栏与文件夹只读授权

依据 grill 决定（访达「添加到 Atd」服务、文件夹只读授权、默认开启的选择文字工具栏）同步代码与 Figma。新区块 24 · Selection toolbar & folder access (Figma `project/1797:97346`)。

- 原生工具栏：App / Selection toolbar (Figma `project/1798:97382`)（`AIShell/Selection/SelectionToolbarPanel.swift`、`SelectionToolbarController.swift`，几何与显示规则在 `AICore/Selection/SelectionToolbarGeometry.swift`、`SelectionToolbarRules.swift`；NSGlassEffectView 胶囊，高 36、圆角 18、内边距 4、间距 2、最宽 420），变体 Content=Default / Overflow / Long name。按钮 App / Selection toolbar button (Figma `project/1797:97365`)（代码为 `AnnotationToolbarButton` 的带文字胶囊变体；Kind=Ask 带 14pt `Lucide / sparkles`、间距 6，Kind=Command 命令名 160pt 尾部截断；高 28、圆角 14、水平内边距 10、13pt Medium；State=Rest / Hover 9% / Pressed 16%），「更多」复用 App / Capture toolbar button 加 `Lucide / ellipsis`。三个内置选区命令在 420 内放不下时，末项进入更多菜单 App / Selection toolbar more menu (Figma `project/1798:97383`)（代码为系统 NSMenu，Figma 为近似）。审阅帧：更多菜单展开 (Figma `project/1798:97415`)、选区上方 8pt 居中且悬停命令 (Figma `project/1798:97448`)。
- 文件夹：App / Composer chip (Figma `project/1451:53451`) 新增 `Kind=Folder`（Default、Selected，`Lucide / folder`，工具提示为完整路径；`composer-editor/draft-attachments.ts`、`chip-content.tsx`）；App / Composer attach menu · Rhea (Figma `project/1709:88967`) 在「上传文件」后新增「添加文件夹…」（`Lucide / folder-plus`，`composer-attach-menu.tsx` → `files.pickFolder`），C4.01 中的实例上移 32 保持与触发按钮相距 4。
- 设置 › 通用：App / Selection toolbar settings · Rhea (Figma `project/1800:97639`)（`features/settings/selection-toolbar-settings.tsx`；开关、辅助功能权限状态与「打开系统设置」、排除的 App 列表 App / Excluded app row · Rhea (Figma `project/1799:97438`)），变体 Access=Not granted / Granted × Apps=List / Empty；审阅帧 (Figma `project/1800:97673`) 含 700 与 320 宽度。
- 会话菜单：Figma 之前没有此菜单，以现有菜单实例新建 App / Session menu · Rhea (Figma `project/1800:98144`)（`features/agent/session-menu.tsx`；Folders=Some 时显示分隔线、「Readable folders」分组与 App / Readable folder row · Rhea (Figma `project/1800:97941`)）。代码中点击该项即撤销授权（工具提示「Revoke access to <path>」），Figma 行内为单独的撤销按钮，两者交互不同，待统一。
- 已知差异：工具栏与菜单只绘制深色外观，未绘制 zh-Hans 文案；页 01 的旧版通用设置预览（257:1454）未更新；设置分组只核对了 700 与 320 宽度；原生工具栏的实际合成外观尚未在运行中的应用里核对。
- 同日补充：选区工具栏新增与截图工具栏一致的拖动手柄（`App / Capture toolbar grip`，16 × 28，置于「问 Atd」之前、间距 2）；拖动手柄或胶囊表面可移动，松手后停在原处（距显示器可用区域 8pt），直到隐藏，双击复位到选区旁；悬停手柄显示张开手掌光标，悬停按钮显示手形光标（Atd 不激活，悬停与光标由 `SelectionToolbarHover.swift` 逐帧读取指针驱动）。手柄与间距共 18pt 计入 420 上限：App / Selection toolbar (Figma `project/1798:97382`) Default 357、Long name 404，Overflow 变为「问 Atd + Translate selection + 更多」共 286，Extract action items 随 Polish writing、Summarize 进入更多菜单 (Figma `project/1798:97383`)。
- 入场动画（写入组件描述，`SelectionToolbarEntrance.swift`）：自选区「长出」，以朝向选区的一边为锚点缩放 0.9→1、起点向选区偏移 4pt，弹簧感知时长 0.32s、bounce 0.15，透明度 0→1 用 0.16s ease-out（窗口在胶囊四周留 24pt 透明边距，阴影与动画不被窗口边缘裁切，边距处点击穿透到下方 App）；减弱动态效果时仅淡入 0.2s；无退出动画。AppKit 的 `NSGlassEffectView` 没有 materialize 过渡，以缩放加快速不透明近似。
- 同日补充：两个原生玻璃工具栏的图标统一使用选区工具栏按钮文字的颜色（代码 `labelColor`，Figma `foreground`），拖动手柄也由次级色改为该色；自带着色的按钮（如强调色的确认 ✓）、选中工具的白色图标与色板保持原样。模板图标由 `AnnotationToolbarButton` 自行着色绘制，不再交给 AppKit：AppKit 会在窗口非 key 时调暗模板图标，而选区工具栏所在的 Atd 始终不激活。
- 同日补充：两个工具栏中禁用的图标与文字（如没有可撤销操作时的撤销/重做）改用系统的禁用标签色 `labelColor.withSystemEffect(.disabled)`（深色约 42%、浅色约 30%），与 AppKit 在 key 窗口中禁用按钮的观感一致；此前误用 `tertiaryLabelColor`（约 25%）过淡。

## 2026-10-04 创建应用（Create app）设计

依据 [创建应用计划](plans/2026-10-03-create-app.md) 的「渲染器」「桌面小组件（Q4）」「壳：应用窗口宿主」三节，以及同日用户追加的要求：设置「应用」是独立分区，侧栏导航新增「Apps / 应用」入口，应用详情是该分区的二级页。本次只改 Figma 与本文档，未改代码。组件页新增 26 · Create app (Figma `project/1863:99351`)，产品页新增 AP · 创建应用 (Figma `project/1864:102764`)。共享库未改动；Lucide 图标均为共享库 `Lucide / *` 实例，没有重绘或分离。

| Figma 组件（节点）                                                                                             | 代码对应                                                                                                                                                      | 要点                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App / App icon (Figma `project/1863:99362`)（`1863:99362`）                                                    | `ItemMedia variant="image"`（32px，`rounded-xl`）内的 `<img>`，源为 `GET /v1/apps/:appId/icon`                                                                | `card/surface` 底 + `card/ring` 内描边；Figma 的 Glyph 只是示意，产品不画 Lucide；`Source=Missing` 用 `image-off`                                                                                                                                                                                                         |
| App / App card (Figma `project/1863:99626`)（`1863:99626`）                                                    | `transcript/tool-body.tsx` 的 `DetailsBody` 新增 `AppCard`：`ToolCard.Root/Body/Footer` + `Badge outline/secondary` + `Button size="sm" variant="outline"` ×2 | 状态 Ready / Typecheck warnings（footer `warning`）/ Building（footer muted、无操作）/ Failed（footer `destructive`）；`Show widgets` 控制小组件徽标；打开调用 `userApp.open`                                                                                                                                             |
| App / Tool card footer (Figma `project/1791:96154`) 新增 `Tone=Warning`（`1863:99422`）                        | `ToolCard.Footer tone="warning"`（`--ata-status-warning`）                                                                                                    | 三个变体改为 Hug 高度，单行仍为 26px，长注释换行                                                                                                                                                                                                                                                                          |
| App / App row · Rhea (Figma `project/1863:99997`)（`1863:99997`）                                              | `Item size="sm"` + `ItemMedia image` + `ItemContent` + `ItemActions`                                                                                          | `Trailing=Panel actions`：Open / Continue editing / More 三个 `IconButton` ghost icon-sm，列位置固定；`Trailing=Settings link`：Open + chevron，整行进入详情；Hover 为整行 `bg-muted`                                                                                                                                     |
| App / App actions menu · Rhea (Figma `project/1863:100011`)（`1863:100011`）                                   | `DropdownMenuContent align="end"`                                                                                                                             | Rename（pencil）、Versions（history）、分隔、Delete（trash-2，destructive）；复用 Plugin actions menu 的材质与菜单项                                                                                                                                                                                                      |
| App / App capability consent · Rhea (Figma `project/1863:100218`)（`1863:100218`）                             | Composer 弹层 HITL 中的新请求类型，与 `approval-controls.tsx` 同位                                                                                            | Capability = AI（sparkles）/ Agent（bot）/ Memory（brain）/ MCP（plug）/ Web（globe）；用途块沿用 ToolCard 表面；Allow（Return）/ Deny（Esc）均为 `App / Decision action · Rhea` Outline；结论写入 `PATCH /v1/apps/:id/grants`                                                                                            |
| App / Settings sidebar (Figma `project/256:1024`) 新增 Apps 项与 `Tab=Apps` 变体                               | 设置分区 id `apps`；侧栏卡片、顶部卡片、抽屉三种布局                                                                                                          | 全部 42 个变体都有 `Tab / Apps`（Lucide app-window），文字绑定新变量 `Content/Settings navigation/Apps`；现有设置画面自动显示该入口                                                                                                                                                                                       |
| App / Settings action · Rhea (Figma `project/907:17188`) 新增 `Variant=Destructive`（Default、Small × 4 状态） | `Button variant="destructive"`                                                                                                                                | 用于删除应用与其确认框；共享 Button - Nova Destructive 皮肤加 Rhea 18px 圆角                                                                                                                                                                                                                                              |
| App / Apps list content · Rhea (Figma `project/1864:102035`)（`1864:102035`）                                  | 设置「应用」分区页                                                                                                                                            | 与插件列表同一骨架与响应式内边距；工具栏为搜索 + 「Create app」；`State=Empty` 用 `App / Empty`                                                                                                                                                                                                                           |
| App / App detail page · Rhea (Figma `project/1864:102036`)（`1864:102036`）                                    | 「应用 › {名称}」二级页，`App / Settings editor layout · Rhea`                                                                                                | 分组：Versions（版本行 (Figma `project/1864:101331`)，Revert = `Button sm outline`）、Permissions（能力授权行 (Figma `project/1864:101368`)，`Switch`）、Data（数据操作行 (Figma `project/1864:101425`)：Clear data outline、Delete app destructive + `App / Alert dialog · Rhea`）；页脚 Continue editing（glass）/ Open |
| Widget / Atd app (Figma `project/1869:107044`)（`1869:107044`）                                                | `AtdWidgets.appex` 的 SwiftUI `WidgetTreeView`（`AIWidgetRender`）                                                                                            | 原生参考，使用 SF Pro、SF Symbols 与 Apple 语义色，不用 Atd/shadcn token；Family = Small / Medium / Large，State = Gallery preview / Content / Unconfigured / Unavailable                                                                                                                                                 |

产品页画面：AP1 任务面板 (Figma `project/1866:88784`)（新建视图的 Create app / My apps 入口、预填 `create-app` 技能、我的应用列表与 More 菜单、空状态、转录卡片、能力同意；320 / 420 / 640）；AP2 设置 › 应用 (Figma `project/1864:102765`)（列表与详情各 1280 / 1000 / 760 / 480 / 320，空状态、删除确认、抽屉打开、短高、完整滚动正文、zh-CN 文案）；AP3 应用窗口 (Figma `project/1870:90314`)（原生有标题栏、不透明窗口，无玻璃外壳）；AP4 小组件 (Figma `project/1870:90353`)（小组件库示例、桌面内容、未配置与不可用，含 zh-Hans）。

同日第二轮（按 root 决定）：

- 能力同意保留在 Composer 的 HITL 弹层；同意请求到达时面板自动打开，不用原生确认框。
- 「我的应用」有两个入口：新建视图的按钮，以及 App / Panel header (Figma `project/71:112`) 新增的常驻切换（Ghost icon-sm，Lucide app-window，位于 Tasks 之前）。代码统一用 `AppWindow` 表示「我的应用」：标题栏切换、新建视图按钮与设置侧栏共用这一个图标。开发版标题栏 `1760:95766` 同步加入。显示「我的应用」时它为 `State=Selected`，与历史视图中 Tasks 的处理相同。
- 历史行的应用标识：新增 App / Task history row (Figma `project/1873:107460`)（`1873:107460`，Origin=User / App）。由应用发起的任务在标题后显示 `Badge variant="secondary"`（应用名），标题先截断。现有代码 `task-history.tsx` 把 `AppOriginBadge` 放在 meta 行开头，需要移到标题行。画面见 AP1.08（420，`1873:107566`）与 AP1.18（320，`1873:107693`）。原有历史画面仍使用 `App / Configuration option`，本次没有迁移。
- 设置应用详情新增 Widgets 分组（位于 Versions 与 Permissions 之间）：App / App widget row · Rhea (Figma `project/1874:107617`)（`1874:107617`，Preview=Snapshot / Pending；`ItemMedia image` 56px 放壳用 `ImageRenderer` 从快照渲染的 PNG，标题与「尺寸 · 刷新间隔」）。另有 App / App widgets unavailable notice · Rhea (Figma `project/1874:107618`)（`1874:107618`，Rhea Alert 几何，`triangle-alert` 用 `status/warning`，文案「Move Atd to the Applications folder to use its widgets.」），只在壳报告小组件因安装位置不可用时插入分组第二位。插槽内容不能绑定组件属性，所以提示不在默认组合中；示例见 1000（`1874:108556`）与 320（`1874:108905`）评审画面。
- 应用详情页脚的「Continue editing」改用 `App / Settings action · Rhea` 的 `Variant=Glass`（代码 `Button variant="glass"`），与其他浮动 `overlay-footer` 的次要操作相同；Open 仍是实心主操作。`App / App card` 的 Building 与 Failed 状态在 v1 不会出现：应用只在首次构建成功后才存在，构建中由活动步骤行表示，失败由工具错误表示。两个状态保留在组件中，供以后使用。
- `Content/Settings navigation/Apps` 所在集合 App · Controls 只有一个 Default 模式，其他导航标签同样只有英文值，没有用模式做本地化，因此没有加 zh-CN 值；中文「应用」由渲染器 i18n 提供。

已知差异与待定：

- 设置侧栏的 Top 布局有 7 项时，Apps 单独占第三行。Figma 换行会把它拉满整行，代码按网格列宽显示。
- Figma 中长标题与应用徽标同行时，靠主组件里标题的固定最大宽度（180px）近似代码的收缩截断；实例不能覆盖最大宽度，徽标本身在 Figma 中不截断。
- 小组件尺寸按常见 Mac 显示参数绘制（170、364×170、364×382），实际尺寸随显示器而变；中文在 Figma 中由字体回退显示，原生为 PingFang SC。

## 2026-10-04 应用详情页重设计与「应用小组件」同步

本节把同日代码中的两处改动同步到 Figma，代码为准：设置 › 应用 › 应用详情页按 apple-design 重做（实现见 `apps/desktop/src/features/apps/`）；桌面小组件改名为「App Widget / 应用小组件」，添加时立即选择应用小组件，小组件库预览显示真实渲染，内容使用应用的识别色（`apps/macos/Widgets/Extension/`、`Sources/AIWidgetModel/`、`Sources/AIWidgetRender/`）。本次只改 Figma 与本文档。共享库未改动；新用到的 Lucide 图标（square-arrow-out-up-right、square-pen、ellipsis、loader-circle、shield-check、list-checks）均为共享库实例。

前一轮同步中断前已完成的五项，本轮回读后保留：App / App icon (Figma `project/1863:99362`) 新增 `Size=Large`（64px）；App / Settings action · Rhea (Figma `project/907:17188`) 新增 `Size=Extra small, Variant=Link` 四个状态；App / Icon button (Figma `project/70:129`) 新增 `Appearance=Outline, Size=icon`；App / App actions menu · Rhea (Figma `project/1863:100011`) 新增布尔 `Show versions`；App / App version row · Rhea (Figma `project/1864:101331`) 重建为 Item sm 卡片行。回读发现并修复了两处：

- 版本行的 meta 文字虽绑定 `muted-foreground`，存储的颜色仍是白色，渲染成前景色；已重新绑定。变更说明加了两行截断，Revert 暴露为嵌套实例，供忙碌状态改写。
- App actions menu 的三个菜单项由同一个源菜单项复制而来，在实例里共用一个覆盖键：关闭 `Show versions` 后 Delete 不回流、溢出菜单，改写一项的文字会串到另一项。已用 `App / Command actions menu · Rhea` 中键值各不相同的三个菜单项重建，Delete 改为 `Type=Destructive` 并绑定 `destructive`。任务面板中的现有实例显示不变。

| Figma 组件（节点）                                                                        | 代码对应                                                                                                             | 要点                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App / App detail hero · Rhea (Figma `project/1903:109317`)（`1903:109317`，新增）         | `app-detail-hero.tsx`，`apps.css` 的 `.app-detail-hero*`                                                             | 身份卡片：`Card size="sm"`（圆角 24、内边距 16、`card/surface` + `card/ring`、`Rhea / Shadow sm`）。`Layout=Wide`（页宽 ≥ 480）为图标旁一列，`Compact` 为名称居中于图标旁、正文与操作占满宽度；`Description=Fits / Clamped / Expanded`（三行截断 + Show more / Show less）；名称两行截断。布尔 `Accent halo` 为图标周围的径向光晕（24% 到 32px、12% 到 48px、160px 处透明），按应用改写椭圆渐变颜色；`Show source task`、`Show description`。暴露 App icon、Open（实心主操作）、Continue editing（outline）、More（Outline icon）、Show more |
| App / App detail section · Rhea (Figma `project/1901:109024`)（`1901:109024`，新增）      | `app-detail-group.tsx` 的 `AppDetailSection`                                                                         | 标题行（最小高 24，可选 Link xs「Show all {n}」）、可选的 小组件不可用提示 (Figma `project/1874:107618`)、`Rows` 插槽即分组卡片（与通用设置的卡片相同，行间分隔线是每行自己的 `Divider`）、卡片下方的脚注（12/16 muted，最大约 528px）；间距均为 8                                                                                                                                                                                                                                                                                           |
| App / App detail status row · Rhea (Figma `project/1897:108730`)（`1897:108730`，新增）   | `AppDetailStatusRow`                                                                                                 | `State=Loading`（「Loading…」muted）/ `Error`（circle-alert 16 + 13/20 destructive，尾部 outline sm「Try again」）                                                                                                                                                                                                                                                                                                                                                                                                                           |
| App / App widget row · Rhea (Figma `project/1874:107617`)（`1874:107617`）                | `app-widgets.tsx` 的 `AppWidgetRow`                                                                                  | 改为 Item sm 卡片行；新增 `Description text`（两行截断）与 `Divider`，`Families` 改名 `Meta`；新增变体轴 `Description=Shown / None`：有描述时 56px 预览置顶下移 2px，无描述时居中                                                                                                                                                                                                                                                                                                                                                            |
| App / App capability grant row · Rhea (Figma `project/1864:101368`)（`1864:101368`）      | `app-grants.tsx` 的 `AppGrantRow`                                                                                    | 改为 Item sm 卡片行，描述为「{状态} · {能力说明}」；已回答时尾部先显示 Ghost icon-sm「Ask again」（rotate-ccw）再显示开关；新增 `Grant=Waiting` 与 `Grant=None`（shield-check + 不使用任何能力的说明）                                                                                                                                                                                                                                                                                                                                       |
| App / App data action row · Rhea (Figma `project/1864:101425`)（`1864:101425`）           | `app-data.tsx` 的 `AppDataRow`                                                                                       | 改为 Item sm 卡片行（标题与描述换行），按钮暴露；忙碌时前置 loader-circle 并显示「Clearing…」/「Deleting…」                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| App / App detail page · Rhea (Figma `project/1864:102036`)（`1864:102036`）               | `app-detail-page.tsx`                                                                                                | 去掉 `App / Settings editor layout · Rhea` 与浮动页脚，整页一个滚动区：身份卡片，其下 Versions、Widgets、Permissions、Data，间距 24；内边距沿用 `settings/content-*`。页面画框按滚动视口裁切                                                                                                                                                                                                                                                                                                                                                 |
| Widget / App Widget (Figma `project/1869:107044`)（`1869:107044`，原名 Widget / Atd app） | `AtdWidgetBundle.swift`、`AppWidgetView.swift`、`GallerySamples.swift`、`WidgetGallery.swift`、`WidgetAccent*.swift` | `State=Content`（应用自己的渲染，`accent` 取应用识别色，Daily notes 为 #F5A524，相关图层名含「accent」）、`Gallery stand-in`（新增：app.fill 28/34pt 识别色、应用名 headline、小组件标题 footnote）、`Gallery example`（原 Gallery preview，按 `GallerySample.example` 重画：Notes · 3 today，中、大尺寸加分隔线与三行列表）、`Unconfigured` 与 `Unavailable` 改为代码的左上对齐消息布局（title2 符号、底部 headline 与 footnote）；Unavailable 为 questionmark.app 与「已不可用」文案                                                       |
| Widget / App Widget configuration (Figma `project/1926:111919`)（`1926:111919`，新增）    | `AppWidgetConfiguration.swift`（`.promptsForUserConfiguration()`）                                                   | 添加小组件时系统弹出的配置（系统界面的近似）：小组件名、意图说明、参数「App Widget」，弹出列表为全部应用小组件，最新应用在前，行为应用名 + 小组件标题，默认选中最新的一个（勾号），右下「Done」                                                                                                                                                                                                                                                                                                                                              |

画面：AP2 设置 › 应用 (Figma `project/1864:102765`) 中所有详情画面都换成新页面：宽度一行 (Figma `project/1864:104963`) 为 1280（识别色光晕）、1000（无识别色）、760（页宽 445，紧凑卡片）、480（长名称两行、描述三行截断、Show all 8，紫色识别色）、320（zh-CN 长名称，抽屉布局）；删除确认 (Figma `project/1865:87503`) 改为代码文案；760 × 480 短高 (Figma `project/1865:88384`) 整页滚动、底部不再固定任何内容；1000 完整正文 (Figma `project/1865:105655`)、1000 小组件不可用提示 (Figma `project/1874:108556`) 与 320 完整正文（提示换行） (Figma `project/1874:108905`) 按新页面高度加高。新增两行：状态 A (Figma `project/1914:92661`) 为 800（页宽 485，宽布局一侧的边界）、加载中、加载失败（zh-CN）、回退中；状态 B (Figma `project/1914:92662`) 为 More 菜单展开（zh-CN）、重命名对话框（zh-CN，`App / Settings form dialog · Rhea` + `App / Command field · Rhea`）、320 抽屉打开（zh-CN）、1000 完整正文（zh-CN）。AP3 随之下移。AP4 小组件 (Figma `project/1870:90353`) 改为：小组件库 en（小、中为最新真实渲染，大为品牌化替身）与 zh-Hans（尚无应用声明小组件时的示例），名称与说明为「App Widget / Shows a widget from an app you made with Atd.」「应用小组件 / 显示你用 Atd 创建的应用中的小组件。」；新增 添加时选择 en (Figma `project/1928:95254`) 与 zh-Hans (Figma `project/1928:95292`)；桌面画面加入以紫色识别色绘制的 Habits 小组件；可读状态加入无应用小组件、等待 Atd、内容无法读取（en / zh-Hans）。

与先前设计的差异：浮动页脚取消，Open 移到身份卡片作为唯一实心操作，Continue editing 改为 outline，新增 More（Rename、Delete）；页脚的「来源任务 · 创建日期」移入卡片的 meta；各组由「标题 + 说明 + 无边框 Item xs 行」改为「标题 → 分组卡片（分隔线）→ 脚注」；版本行显示变更说明与类型检查结果，默认 5 条；小组件行加描述，脚注改为 D4 v2 文案；权限状态分隔符改为「 · 」，无能力时为卡片内一行；加载、错误与忙碌状态放在各自分组和控件里。小组件不再出现「Atd App」字样，Unconfigured 因添加时即提示而很少出现；保留它，是因为在尚无应用声明小组件时添加的实例，之后有了应用小组件时会显示「Choose an App」。

已知差异与待定：

- 抽屉布局（320）的页面插槽从 44 开始，52px 的内容头部与它重叠 8px，卡片紧贴头部；代码约留 8px。这是共享窗口布局的现有几何，应用列表的 320 画面相同，本次未改。
- 通用设置的分组卡片在 Figma 中没有 `shadow-sm`，新的详情卡片按代码加了 `Rhea / Shadow sm`。共享库 Badge 的文字仍是 Geist SemiBold，代码为 Inter。zh 画面的侧栏导航仍是英文（导航文案变量只有 Default 模式）。
- 小组件行的预览是缩小的小组件组件实例，不是壳渲染的 PNG；zh 画面中的预览仍是英文的 Daily notes 内容。识别色光晕在 Figma 中按 sRGB 插值，代码用 oklab 的 `color-mix`。
- More 菜单宽度按代码的 `w-max`（最小 128px）近似为 128；重命名对话框用现有表单对话框组合，输入框显示焦点态，代码中会选中整段名称。Open 与 Continue editing 的忙碌态只写在组件说明里，画面只画了「Reverting…」。
- 示例中的 note.text 用 SF Symbols 的 note 字形（U+1007FB）绘制，本机的 SF Pro 中没有找到 note.text 的私用区码位；unsupported size（rectangle.dashed）状态未绘制。accented / vibrant 渲染模式（系统强调色）只写在组件说明中。添加时的配置面板是系统界面的近似。
- 顺带发现：`App / Plugin actions menu · Rhea` 与 `App / Plugin item actions menu · Rhea` 的菜单项同样共用覆盖键，实例中逐项覆盖会出错；本次未改。

### 同日补充：「我的应用」启动器小组件

用户追加第二个小组件「My Apps / 我的应用」（决定 D6，代码为准）：固定的 `AtdLauncherWidget`，`StaticConfiguration`，无需配置，小、中、大三种尺寸；说明「Open the apps you made with Atd.」/「打开你用 Atd 创建的应用。」。实现见 `apps/macos/Widgets/Extension/LauncherWidget.swift`、`LauncherContent.swift`，`apps/macos/Sources/AIWidgetRender/WidgetLauncherView.swift`、`WidgetMessageView.swift`，网格度量在 `Sources/AIWidgetModel/WidgetLauncher.swift`。Figma 新增三个原生参考组件，放在 Widget / App Widget (Figma `project/1869:107044`) 旁边，仍用 SF Pro、SF Symbols 与 Apple 语义色。

| Figma 组件（节点）                                                   | 代码对应                                                     | 要点                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Widget / My Apps (Figma `project/1934:112380`)（`1934:112380`）      | `LauncherWidget.swift`、`WidgetLauncherView`                 | `Family=Small`（2 × 2，56pt 图标，无名称）/ `Medium`（4 × 2，42pt 图标 + 名称）/ `Large`（4 × 4，54pt 图标 + 名称）；`State=Content`（全部应用，最近更新的在前，空格子保留网格位置，没有「更多」格）、`Gallery samples`（没有应用时小组件库显示的 16 个示例应用，en；zh-Hans 名称在 AP4 中覆盖）、`Empty`（共用的消息布局：square.grid.2x2、「No apps yet」/「还没有应用」、「Create one in Atd.」/「在 Atd 中创建一个应用。」）。背景为系统 `.fill.tertiary`（与 App Widget 相同的 #1E1E1F），无玻璃，默认 16pt 边距。布尔 `Accented / vibrant (simulated)` 用饱和度混合层把图标去色，近似代码的 `.desaturated` |
| Widget / My Apps tile (Figma `project/1933:112047`)（`1933:112047`） | `WidgetLauncherTileView`、`WidgetLauncherIconView`           | 一个格子即一个点击区域（`Link` 到 `atd://apps/<appId>`，不带路由）；图标裁成应用图标形状（连续圆角，边长的 22.37%，Figma 用 60% 的 corner smoothing）；名称为 `.subheadline`（11pt）单行截断，左右各留 3pt。`Size=Small` 69 × 69、`Medium` 83 × 69、`Large` 83 × 87.5                                                                                                                                                                                                                                                                                                                                            |
| Widget / My Apps icon (Figma `project/1932:112060`)（`1932:112060`） | 扩展用 AppKit 栅格化的 `icon.svg`；`LauncherContent.samples` | 图标画面：W5 渲染用过的 SVG 夹具（`tmp/w5-launcher/icons`）以矢量导入，代表各应用自己的图标；`Fallback · app.fill`：图标缺失或画不出时，在应用识别色（没有时为 systemGray）上画 app.fill，浅色识别色上用黑色符号；`Sample · symbol`：示例应用的 SF Symbol 与底色                                                                                                                                                                                                                                                                                                                                                 |

画面：AP4 (Figma `project/1870:90353`) 改名为「Atd widgets」，标题与第 1、3 步说明同时提到两个小组件。新增 My Apps 小组件库 en (Figma `project/1935:95344`)（用户自己的应用：真实图标、灰色与识别色兜底格、长英文与长中文名称截断）、zh-Hans (Figma `project/1935:95819`)（还没有应用时的本地化示例）、桌面 (Figma `project/1936:96032`)（每种尺寸的启动器放在同尺寸的 App Widget 旁边，另有一个模拟 accented / vibrant 的中尺寸，以及只有三个应用、其余格子留空的大尺寸）、没有应用 (Figma `project/1936:96549`)（en 三种尺寸与 zh-Hans）。

已知差异：

- accented / vibrant 只模拟了应用自己的部分（图标去色）：系统着色没有画，符号格在 Figma 里变成灰色，代码中是半透明的 primary 底加 primary 符号。浅色外观没有画。
- 示例中没有在本机 SF Pro 找到码位的符号用同族字形代替：note.text → note、dice.fill → die.face.6.fill、chart.pie.fill → chart.pie、fork.knife → fork.knife.circle、pencil.line → pencil。
- 图标是测试夹具的矢量，不是扩展栅格化后的位图。W5 的离屏渲染中深色容器约为 #2C2C2C，Figma 沿用 App Widget 的 #1E1E1F，两者都代表 `.fill.tertiary`。
- 开发构建同版本重装时，新的小组件种类要等 chronod 重读描述符（换版本或在 LaunchServices 中重新注册）后才会出现在小组件库中，Figma 不表现这一点。

## 2026-10-04 命令「显示位置」与对话中的命令菜单同步

依据同日代码（代码为准）把命令的显示位置（`CommandPlacement`、`readsSelection`、`offeredAt`，见 `packages/agent-contracts/src/commands.ts`）与重做的原生「更多」菜单同步到 Figma。代码由同日同一任务实现，本节记录 Figma 侧的同步；同步后代码只补了「显示位置」分区的 `data-figma-node`（`1969:113490`）。新组件放在新区块 27 · Command placement · Show in & command menus (Figma `project/1968:113341`)；共享库未改动，用到的 Lucide 图标（languages、list-todo、terminal、ellipsis）均为共享库实例，没有分离或重绘。

- 命令编辑器「显示位置」：App / Command placement settings · Rhea (Figma `project/1969:113490`)（`1969:113490`，`features/commands/placement-settings.tsx`），变体 `State=Available`（第一行开启，其余关闭）/ `Unavailable`（三个开关关闭并禁用，卡片下 8px 显示说明，ATA/Body 14/20、`text/secondary` 即 `--ata-text-secondary`）/ `Read-only`（插件命令：开关保留存储的值但禁用）。区块纵向间距 8、宽度随表单；标题 Inter Semi Bold 14/20；卡片圆角 24、`card/surface` 填充、1px `card/ring` 外描边、`Rhea / Shadow sm`、裁切内容。`Title`、`Note` 为文本属性，三行是暴露的实例，可逐行改写 zh-CN 文案。
- 卡片行新建为 App / Settings card switch row · Rhea (Figma `project/1968:113364`)（`1968:113364`，对应放在 `.settings-card` 中的 `SettingsSwitchRow`）：Item sm，上下内边距 12、左右 14、间距 14，标题 `Rhea / Item title`，描述 ATA/Body muted-foreground，均可换行；尾部为暴露的 `App / Settings switch · Rhea`（四种状态）；布尔 `Divider` 为第二行起的 `--border` 顶部细线；`State=Hover` 为整行 `surface/ghost-hover`，只在开关可用时出现。
- 审阅帧 States, widths & zh-CN (Figma `project/1970:113439`)：表单宽 685 的三种状态（第二行悬停）、445（760 窗口）与 264（320 窗口）的不可用状态，以及 zh-CN 的 685 可用、264 不可用状态。
- 编辑画面：37 个命令编辑画面（B1 05.02–05.06、B3 09.01–09.11、B4 06.02 / 06.03、B7 13.01–13.08、C2 05.07，以及 Q3 中 320 × 640 至 1280 × 720 与 420 高的 12 个响应式画面）都在「Input and shortcut」（即代码的输入选项）之后插入该组件实例，宽度随表单（264、423 / 424、445、685、703、965）。输入来源为 Selected text 的 05.05、09.02 用 Available（第一行开启）；09.08（手动输入但开启了选中文本变量）用 Available 且三行关闭；其余为 Unavailable。表单在有界滚动区内，新区块在多数画面中位于首屏下方，与代码滚动到顶部时一致。
- 对话中的选择文字工具栏：App / Selection toolbar (Figma `project/1660:78179`) 新增布尔 `More`（默认关闭，现有实例不变），即 Quote / Copy / Read aloud / Remember 之后的 More 按钮（同一 App / Message action，`Lucide / ellipsis`，工具提示「More actions」/「更多操作」，无分隔线）。它打开 App / Selection toolbar command menu · Rhea (Figma `project/1974:115146`)（`1974:115146`，标准页内玻璃，位于工具栏同侧、按用户修正与 More 起始端（左边缘）对齐，和每轮操作的「更多」菜单（`align="start"`）及原生工具栏的「更多」一致；sideOffset 从 More 按钮量起，而胶囊有 4 的内边距，按用户反馈由 4 改为 8，菜单与胶囊之间留出 4px，不再贴在一起，与原生工具栏「更多」菜单离胶囊 4pt 一致）。菜单行为 App / Command menu items · Rhea (Figma `project/1974:115054`)（`1974:115054`，`transcript/command-menu-items.tsx`）：默认 `DropdownMenuItem`，16px 命令图标（translate / extract / polish / summarize 模板为 languages / list-todo / pencil / file-text，其余为 terminal）加命令名，256px 处尾部截断。审阅帧为产品页区块 T 第二行的 T12 (Figma `project/1979:115653`)（复制 T6，More 展开，含长命令名）。
- 每轮对话的更多菜单：App / Turn actions menu · Rhea (Figma `project/1978:115179`) 改为变体集（`1978:115179`）：`Commands=None` 即原组件（`1636:75463`，Turn action bar 的 Menu open 变体与 T2 仍引用它，显示不变）；`Commands=Some`（`1978:115108`）在内置项后加分隔线与命令行，宽 308。没有内置项时只列命令行、不显示分隔线（写在组件说明中）。审阅帧为 T13 (Figma `project/1979:115881`)（复制 T2）。
- 原生「更多」菜单：App / Selection toolbar more menu (Figma `project/1798:97383`) 在原节点上重建（`AIShell/Selection/SelectionToolbarMenu.swift`、`AICore/Selection/SelectionToolbarMenuGeometry.swift`）：与胶囊相同的玻璃（`material/glass` 80%、不参与布局的 1px `popover/ring` 内描边、`Atd/Capture toolbar glass`），连续圆角 18、四边内边距 4；`Rows` 插槽内为拉伸到菜单宽度的 App / Selection toolbar button Kind=Command，行高 28、行距 2、文字最宽 160（行最宽 180），Rest / Hover 9% / Pressed 16%；宽 = 最长行 + 8（≤ 188），高 = n × 28 + (n − 1) × 2 + 8（三行 96）。审阅帧 更多菜单展开 (Figma `project/1798:97415`) 改为悬停第二行并加入一条长命令名（四行，188 × 126），其下的「选区上方」审阅帧随之下移 40；新增 胶囊上方展开 (Figma `project/1981:115552`)（下方没有空间时在胶囊上方 4pt）。App / Selection toolbar (Figma `project/1798:97382`) 与按钮组件的说明已同步：命令按钮取 `offeredAt(command, 'selectionToolbar')`，More 打开玻璃菜单。2026-10-02「选择文字工具栏与文件夹只读授权」一节中“代码为系统 NSMenu，Figma 为近似”的说法作废，以本节为准。

验证范围：上述组件、审阅帧与 T12、T13 均用 get_screenshot 按常规尺寸检查，原生菜单另做了细节截图（外圆角 18 与行圆角 14 同心、内缩 4、悬停底色、160 截断）；回读了 37 个编辑画面中实例的主组件、变体、开关状态、宽度与插入顺序，以及卡片行的内边距、间距和开关位置；确认 Turn action bar 与 T2 仍为 `Commands=None`，页内工具栏现有实例的 More 为关闭。只检查了深色外观，原生菜单没有在运行中的应用里核对。

已知差异：

- Figma 的命令编辑表单没有参数列表，运行设置仍是展开 / 收起变体、Allowed tools 仍是行内开关（代码为常驻分区与 SettingsSwitchRow 卡片），所以「显示位置」在 Figma 中直接位于运行设置之前，代码中两者之间还有参数列表。05.04「Run settings expanded」的首屏已看不到运行设置。
- Figma 中没有插件命令的编辑画面，插件只读状态只出现在组件 `State=Read-only` 与审阅帧中。
- 代码中 Item 有 1px 透明边框，卡片行内容实际内缩 13 / 15、三行卡片约 208 高；Figma 沿用现有设置卡片的画法（内边距 12 / 14，卡片 204）。通用设置与选择文字工具栏设置的卡片行仍是复制的 frame，未迁移到新的行组件。
- 菜单项沿用库组件 Dropdown Menu Item - Nova 的左侧装饰（16px 图标外加 2px 内缩），文字比代码右移 4px，含 256px 命令名的菜单在 Figma 中为 308、代码约 304；行沿用其他 Rhea 菜单的实例覆盖（上下内边距 6、Inter Regular）。
- 实例内的嵌套实例不能改尺寸：T13 隐藏了操作栏内嵌的菜单，另放一个 `Commands=Some` 实例；Turn action bar 组件本身没有带命令的变体。
- 页内工具栏仍用 App / Message action（Ghost）表示代码的 `IconButton variant="glass-ghost"`，与现有映射一致。
- 原生菜单行宽取自 Figma 中 SF Pro Medium 13 的测量，可能与 AppKit 的 `ceil` 结果相差约 1pt；列表高于可用空间时的滚动状态只写在组件说明中，没有画。

## 2026-10-04 应用列表改为卡片，与插件卡片统一

用户先要求应用列表用卡片展示，而不是列表；看到结果后又要求「扩展」与「应用」两个界面的卡片统一。现在任务面板「我的应用」、设置 › 应用与设置 › 扩展用同一个卡片组合，代码与 Figma 在同一任务内同步，代码为准。共享库未改动；用到的 Lucide 图标与 Badge 均为共享库实例，没有分离或重绘。

代码：新增共享组合 `apps/desktop/src/components/list-card.tsx`（`ListCard`、`ListCardGrid`）与 `list-card.css`，原 `settings.css` 中的 `.plugin-card*` 规则移入其中，使面板窗口也能加载。`PluginCard`（`features/service/plugin-card.tsx`）与新的 `AppListCard`（`features/apps/app-list-card.tsx`，取代已删除的 `app-row.tsx`）都由它组成，`ExtensionGroup` 与两个应用列表用 `ListCardGrid`。`app-icon.tsx` 新增 `size="md"`（36px，与插件图标同尺寸）。

| Figma 组件（节点）                                                                             | 代码对应                   | 要点                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App / App list card · Rhea (Figma `project/2047:123329`)（`2047:123329`，新增）                | `AppListCard` → `ListCard` | 与 Plugin card · Rhea (Figma `project/1610:75888`) 同一构成与数值：`Card size="sm"`，内边距 16、区块间距 16、圆角 24、`card/surface` 填充、1px `card/ring` 外描边、`Rhea / Shadow sm`。CardHeader（间距 6、居中）：Identity（间距 12）= 36px 应用图标（暴露实例）+ 名称（ATA/Label，单行截断）；CardAction 为 App / Icon button Ghost icon-sm，间距 4，暴露。`Surface=Panel` 为打开、继续编辑、更多；`Surface=Settings` 只有打开。描述 ATA/Body muted，两行截断、最小高 40，没有描述时显示「No description.」（与插件卡片同一文案）。CardFooter（间距 8）：Meta Rhea / Tooltip 12/16 muted，填满并截断；`Show status` 在其后显示共享 Badge Secondary「Waiting for permission」，与插件卡片的状态徽标位置相同。`Surface=Settings, State=Hover` 在卡片填充上叠 `surface/ghost-hover`；面板卡片不是点击目标，没有悬停态。属性：Name、Description、Meta、Show status |
| App / App icon (Figma `project/1863:99362`) 新增 `Size=Medium`（`2047:123117`、`2047:123120`） | `AppIcon size="md"`        | 36px、圆角 14 的图块；Missing 的 image-off 为 18px；Medium 的 Glyph 连回 `Glyph` 替换属性                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| App / Apps list content · Rhea (Figma `project/1864:102035`) `State=List`                      | `AppSettingsList`          | 行改为卡片网格 `ScrollArea / App card grid`：水平换行 Auto Layout，间距 12 / 12，卡片 Fill、最小宽 240，与插件卡片网格相同。第一张为 Hover，「Quarterly expense report reviewer…」显示等待授权徽标，「Meeting planner」为图标缺失                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| App / App row · Rhea (Figma `project/1863:99997`)                                              | （`app-row.tsx` 已删除）   | 已被卡片取代，文件中不再有实例；组件保留作参考，说明已标注                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

网格：`ListCardGrid` 为 `grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--list-card-min, 240px)), 1fr))`，间距 12，同一行卡片等高、Meta 贴底。设置（扩展与应用）用 240：1280 三列，1000 两列，760 及以下一列。面板卡片右上有三个操作，列宽从 288 起（`.apps-view-grid`），名称在图标与操作之间仍有约 110px：620px 以下的面板一列，640 两列（各 298）。面板的滚动区向左、上、下伸出 4px，向右伸出 12px（滚动条所在），内容再补回同样的内边距：卡片边缘与面板内容对齐，外描边和阴影不被视口裁切，滚动条仍在框内 4px，与任务历史相同。

交互：设置卡片整张打开应用详情子页（`.settings-open-row` 的打开按钮在内容下方铺满卡片，悬停与焦点环由它绘制，与插件卡片相同），右上为「打开」，不再显示右箭头。面板卡片的操作不变：打开、继续编辑与「更多」（重命名、版本、删除）；卡片本身不响应点击，也没有悬停底色。原先元信息里的「· Waiting for permission」改为 Meta 后的徽标。描述是新增内容，取应用清单的 `description`。

画面：AP1 的 AP1.03 · 420 (Figma `project/1866:88787`)、AP1.04 · 更多菜单展开 (Figma `project/1866:89014`)（第一张卡片的「更多」为 `State=Selected`，菜单末端对齐、下移 4）、AP1.13 · 320 (Figma `project/1866:89298`)（长名称卡片移到第二位，使它在首屏可见，画框随之改名）与 AP1.23 · 640 (Figma `project/1866:89314`) 的应用列表改为 `App card grid`。面板 Meta 按代码 `rowDate` 书写，如「Updated 4:20 PM · v4」「Updated Friday · v7」「Updated Sep 26 · v1」。AP2 的列表画面（1280 / 1000 / 760 / 480 / 320、空状态、删除确认、抽屉、短高）随 `App / Apps list content · Rhea` 实例更新；zh-CN 审阅帧 (Figma `project/1865:105654`) 的卡片重新写入中文名称、描述、Meta 与「等待授权」。示例 Meta 改为代码的写法，不再出现「2 widgets」「No working version yet」这类代码中没有的元信息（应用只在首次构建成功后才存在）。

验证范围：代码在一次性预览页中核对（独立的 Vite 端口，渲染真实的 `AppsView`、`AppSettingsList` 与 `PluginCard`，apps 桥为桩；Chromium 而非 WKWebView）。插件卡片与应用卡片放在同一网格中逐项比对：卡片 337 × 156，头部与图标 36，描述 40，页脚位于 124；带徽标时两者都是 160。另核对了面板宽 320 / 420 / 560 / 640、设置页宽 264 / 313 / 445 / 685 / 965，en 与 zh-CN；悬停、键盘焦点、更多菜单展开、空状态、溢出滚动、等待授权徽标、无描述、长名称与图标缺失。面板 420 下卡片为 16–404，滚动条为 406–416（脚本读取）。桌面端 Vitest 全部通过（9 个文件、38 项）。Figma 的组件与 AP1 / AP2 画面用 get_screenshot 核对。用户正在运行的 Debug 应用没有被启动或附加，所以没有在原生窗口中核对；卡片属于页面内容，不涉及原生玻璃或窗口合成。

已知差异：

- Figma 的换行网格不能保留 auto-fill 的空列，最后一行卡片较少时会被拉宽（设置 1280 与面板 640 的最后一行），也不能让同一行卡片等高（带徽标的卡片高 4）。代码中列宽不变，同行等高。
- 与插件卡片网格相同，Figma 的列表会裁切两侧边缘卡片 1px 的外描边；代码的滚动区为此留出了 4px。
- Figma 面板画面仍有「Search apps…」搜索框和底部的「Open an app, or continue editing it in its task.」与「Create app」，代码的「我的应用」视图没有这两部分。这是先前就有的差异，本次未改。
- 「更多」菜单沿用 224 宽的 App actions menu 组件，代码为内容宽度（`w-max`，最小 128）。
- Plugin card 在 Figma 中的页脚最小高为 20，没有徽标的插件卡片画成 160；代码与 App list card 没有徽标时为 156。

## 2026-10-04 对话内命令改为侧边对话

依据同日代码（代码为准）同步。从对话内启动的命令（对话中的选择文字工具栏、每轮的「更多」菜单、子代理钻取视图的选区工具栏）不再离开当前对话页，而是打开侧边对话：命令照常作为自己的新任务运行（不带对话上下文，选中的文字或该轮回答作为选区），任务以 `sideChatOf` 指向所在对话（`packages/agent-contracts/src/task.ts`、`http.ts`；服务端在创建任务的同一次账本写入中保存，`apps/agent-service/src/runner-manager.ts`）。侧边对话以图层盖在对话上（`features/agent/side-chat/side-chat-layer.tsx`、`use-side-chat.ts`），像子代理钻取视图一样让对话保持挂载、隐藏且不可交互；显示任务时底部输入框服务侧边对话（追问、审批、停止），命令需要先填写时输入步骤也在图层内；返回后对话的滚动位置与展开状态不变。对话的侧边对话列在输入框上方的进度胶囊中（`progress/progress-pill.tsx`、`side-chat-panel.tsx`，与子代理列表共用 `status-row.tsx`、`status-glyphs.ts`），也是重新打开侧边对话的入口。侧边对话在历史中是普通任务；全局快捷键、设置窗口与原生工具栏启动的命令保持原行为。

- 图层：App / Side chat layer · Rhea (Figma `project/2055:124092`)（`2055:124092`，代码以 `data-figma-node` 关联），Phase = Input（`2050:123132`）/ Starting（`2053:123180`）/ Task running（`2053:123200`）/ Task settled（`2053:123291`）/ Drill-in（`2055:124016`），位于新区块 29 · Side chat · layer & HUD (Figma `project/2050:123131`)。
- 共用组件改名并扩展（节点 ID 与现有实例不变）：App / Subagent drill-in header → App / Layer header · Rhea (Figma `project/1525:58108`)（`LayerHeader`，新增默认关闭的 `Show details` 布尔，属性改为 `Parent title` / `Title`，高 47 与代码一致）；App / Subagent list row → App / Status list row · Rhea (Figma `project/1523:58148`)（`StatusRow`，六种状态新增 State=Current）；App / Subagent panel → App / Status list · Rhea (Figma `project/2043:123224`)（`StatusList`，List=Subagents `1524:57971` / Side chats `2043:123163`）。
- 进度胶囊：App / Progress pill segment (Figma `project/1523:57936`) 新增 Kind=Side chats（Default / Hover / Expanded / Focus）与窄宽变体（64px，图标加截断计数），HITL、Step、Subagents 补了 Focus；App / Progress pill (Figma `project/1499:53918`) 新增 `Side chats` 轴（现有变体为 None）；App / Composer popover (Figma `project/1533:58668`) 新增 View=Side chats（`2046:123083`）。胶囊各段的悬停与展开改用新变量 `glass/control-wash`（10%）与 `glass/control-wash-strong`（16%，原为 15%）。
- 命令输入页页脚：App / Command run footer · Rhea (Figma `project/1287:45290`) 改为代码的玻璃「Command settings」与主按钮「Run ⌘↩」（新变量 `kbd/on-primary`、`kbd/on-primary-text`），8 个输入画面随之更新，补上 2026-10-01 记录的页脚差异。
- 审阅帧：产品页新区块 SC · Side chat · layer & HUD (Figma `project/2058:105831`)：SC1–SC5 为五个阶段，SC6（320）、SC7（640）、SC8（420 × 420，正文滚动、页脚保留），SC9 胶囊「1 waiting」展开且列表打开（多种状态、长标题），SC10（320）在打开的侧边对话上打开列表并标出当前行。先前落在页面根部的 T12、T13 已移回区块 T。

文案：返回「Back to the conversation」/「返回对话」，启动中「Starting…」/「正在启动…」；胶囊依次显示「N waiting」「N running」「1 side chat」「N side chats」/「N 个等待中」「N 个运行中」「1 个侧边对话」「N 个侧边对话」，列表标题「Side chats」/「侧边对话」。

验证范围：代码只做了静态检查（类型检查、Oxlint、oxfmt、桌面端 38 项与服务端 247 项测试）和 jsdom 临时检查，未在真实 App 中验证图层的合成、聚焦顺序与审批流程。Figma 用截图与回读检查了全部组件集和十个审阅面板。

已知差异：

- 当前面包屑的 2/3 宽度上限在 Figma 中固定为 241px：320 宽时两段各约 119px（代码约 65 / 175），640 宽时标题仍止于 241（代码最多 388）。
- 侧边对话段的窄宽变体只画在段组件中，没有放进拥挤的完整面板；代码在 320 宽同时出现五段（审批、步骤、子代理、侧边对话、压缩）时，压缩段会被裁切约 17–23px。
- 既有钻取画面（`1526:48076`）仍显示输入框，代码在钻取时隐藏（先前的差异）；头部旧的任务 / 状态 / 错误部分仍留在组件中，默认隐藏。
- 旧输入画面的正文仍是旧的运行策略文案与预览框，只更新了页脚；侧边对话的输入步骤用的是代码文案。
- 640 宽的用户消息气泡沿用面板宽变体，比代码窄；流式文字未画；只画了深色，zh-CN 文案只写在组件说明中。

同日按用户反馈补充（代码与 Figma 已同步）：

- 子代理与侧边对话列表（`progress/status-row.tsx`、`status-glyphs.ts`、`progress.css`）重做为 xs `Item` 行：16px 状态图标与标题首行对齐，标题 14 Medium，下方一行 12px 次级文字「状态 · 上下文」（子代理为代理名，标题已是代理名时省略；侧边对话为它运行时的选中文字，没有时省略），右侧居中的 chevron；子代理的任务标题最多两行，相近的并行任务因此能区分。状态用新增的简短词 `tasks.json` `statusList.*`（Needs approval / Needs an answer / Running / Failed / Interrupted / Completed；待批准 / 待回答 / 运行中 / 失败 / 已中断 / 已完成），无障碍名称仍用完整状态。焦点环画在行内（`ring-inset`，不再被滚动区裁切），当前行悬停时保持较深的玻璃底色，不能打开的行改为满不透明度的普通列表项、不带 chevron。标题与图标对齐（表头内缩 11px，计入行的 1px 边框），行距 2px，行内上下内边距 4px（与队列行一致）。
- 列表的滚动区改为 `gutter="none"`：滚动条浮在行右侧内边距上，只在悬停或滚动时出现，与菜单、面板内容一致；行在两侧都保持 4px 内缩，列表开始滚动时也不变窄。此前 `gutter="stable"` 恒定保留 12px 滚动条通道，造成用户指出的右侧多余边距。待办列表的内边距本就按保留通道设计，保持不变。
- 侧边对话的标题是命令名：服务端先按渲染后的提示命名任务，客户端在提交后立即改名为命令名（`task-submit.ts`），所以列表行与图层头部都显示命令名。
- Figma：App / Status list row · Rhea (Figma `project/1523:58148`) 原地重构为 60 个变体（Status 6 × State Rest / Hover / Current / Focus / Static × Lines 1 / 2，属性 `Title`、`Context`、`Show context`），现有实例保持连接；App / Status list · Rhea (Figma `project/2043:123224`) 间距与代码一致，新增 List=Subagents · overflow（`2082:126214`，七行、352 高、滚动条浮在行内边距上、底部渐隐、无通道）；两个组件移到区块 29。Composer popover 的两个列表视图宽 320；审阅帧 `1525:58160`、`1525:58352`、SC9、SC10 已更新。
- 已知差异：`Lines=2` 用固定两行的标题框（Figma 不能同时自动高度与截断），能放进一行的任务应选 `Lines=1`；各变体的状态词为英文，zh-CN 需覆盖文字；Figma 中滚动条一直画出（代码只在悬停或滚动时出现），宽 8px（代码约 7px）；行的 1px 透明边框画成内边距（5 / 11）；运行中的图标不转动。

## 2026-10-04 输入框快捷面板分组导航

`@` / `/` 快捷面板加入分组导航：每个有标题的分组是一节，当前节的标题固定在列表顶部，下一个标题到达时把它推上去；两节及以上时固定行右端出现分组栏，点击跳到该节并高亮当前节，⌘↑ / ⌘↓ 移到上一节 / 下一节的第一项。代码由另一项任务实现，本节记录 Figma 同步。

- 代码：`features/quick-panel/quick-panel-sections.tsx`（固定行与分组栏：`role="toolbar"`，每节一个 ghost `IconButton`，名称与 tooltip 为节标题，高亮在按钮间滑动）、`use-section-pin.ts`（吸顶、推挤与跳转滚动）、`use-quick-panel.ts`（⌘↑ / ⌘↓）、`quick-panel-surface.tsx`（页脚「⌘ ↓ for next group」，`quickPanel.hints.nextGroup`，zh-CN「下一组」）、`quick-panel.css`（标题在分组栏前 8px 截断；列表滚动边缘蒙版：顶部先 20px 全透明再 8px 渐显，后面还有行时底部 8px 渐隐）；节图标为 `QuickGroup.icon`。
- Figma：App / Quick panel heading · Rhea (Figma `project/1442:51276`) 改为水平布局，新增默认关闭的 `Show sections` 与 `Sections` 插槽（`2118:127284`，`gap/compact` 2px，靠右），插槽内放 App / Icon button (Figma `project/70:129`)（Ghost、icon-sm；当前节 `State=Selected`，其余 Default 并把图标覆盖为 muted-foreground）；App / Quick panel footer · Rhea (Figma `project/1442:51320`) 新增默认关闭的 `Show next group`（`2119:127320`、`2119:127327`），388 宽时页脚换成两行；新组件 App / Provider brand tile (Figma `project/2121:127287`) 对应 `ProviderBrand` 的白色纸片（3px 内边距、6 圆角、10px 黑色单色标识），供模型连接按钮使用。App / Composer quick panel (Figma `project/1447:51964`) 的 `View=Mention root`、`View=Mention query`（高度由 333 改为上限 352）、`View=Slash root`、`View=Model drill` 在首个标题上打开分组栏并打开页脚提示，单节视图不变；与 Model drill 重叠的 `View=Context drill`、`View=Compact query` 移到空位；组件说明已补充上述行为。示例帧 Examples / Quick panel scroll state (Figma `project/2130:128629`) 展示 Mention root 滚到较长的 Memory 分组中段：固定行为 Memory 且其按钮选中，行经 alpha 蒙版在固定行下消失，没有填充或分隔线。QA 帧 `1449:51849` 与 A1 01.11–01.15 随组件更新；B1 05.06 指令提及面板隐藏了文件分组，在其 Conversations 标题上补了 5 个按钮。History 行（Slash root、Running）与 Recently used 按钮改用 `Lucide / history`：lucide-react 1.49 中 `History` 即 `rotate-ccw-clock`（别名 history，路径相同），而共享库的 `rotate-ccw-clock` 内层框架约束为 MIN，缩到 16px 会被裁切。
- 已知差异：只画了深色（浅色的选中填充为 muted）；高亮滑动、tooltip、推挤与跳转滚动只写在说明里；静态视图停在顶部，未画底部 8px 渐隐；Mention root 的 Memory 行仍是旧的单行样式，示例帧按代码画为描述、名称与类型；`App / Quick panel option · Rhea` 的 Mark=Brand 仍内联绘制纸片；B1 05.06 中面板底部（含页脚）被设置窗口裁切，为原有问题。

同日评审修正（已写入组件说明）：分组栏最宽为固定行的四分之三，超出时横向滚动且不显示滚动条，被裁切的一端以 16px 渐隐并保持当前分组的按钮可见（如连接很多的 `/model` 或窄面板），标题在分组栏的实际宽度前截断；列表滚动后固定行接管指针，其下渐隐的行不能悬停或点击，在固定行或分组栏上滚动滚轮仍会滚动列表；320 宽窗口（288 面板）中 7 个 @ 分组按钮（208px）在上限（210px）以内，分组栏只在超出上限时才横向滚动（如连接很多的 `/model`）。

同日按用户反馈修正：分组按钮保留 28×28 的点击区域，选中填充与悬停底色改为按钮内居中的 22px 圆（四边各内缩 3px），与第一行的高亮留出 3px 间隙；Figma 新增 App / Quick panel section button (Figma `project/2148:129079`)（组合 App / Icon button 并暴露其 Icon 实例替换属性，State=Default / Hover / Selected），各视图、示例帧与 B1 05.06 的分组栏均已换用。

## 2026-10-05 面板应用卡片整张可点击

用户要求任务面板「我的应用」的卡片本身可以点击打开，随后要求去掉面板卡片右上角的「打开」。本节取代上文 2026-10-04「应用列表改为卡片」中「面板卡片不是点击目标，没有悬停态」及面板卡片有「打开」的约定。

- 代码：`AppListCard` 在面板中也传入 `ListCard` 的 `open`：整张卡片打开应用，与右上「打开」相同，标签为 `apps:panel.openLabel`；应用正在写入时点击不生效。设置 › 应用仍然打开应用详情子页。整行打开的样式原在 `settings.css`（只有设置窗口加载），现移到共享的 `apps/desktop/src/components/open-row.css`，类名由 `.settings-open-row` 改为 `.open-row`，由 `ListCard` 与设置中的各类可打开行各自引入；MCP 行内登录框的规则仍留在 `settings.css`。
- 面板卡片右上只剩「继续编辑」与「更多」，「打开」由整张卡片承担。设置卡片保留「打开」，因为它整张打开的是详情页。面板网格的最小列宽 288 不变，名称旁的空间由约 110px 增至约 140px。
- Figma：App / App list card · Rhea (Figma `project/2047:123329`) 新增 `Surface=Panel, State=Hover`（`2178:131273`），与 `Surface=Settings, State=Hover` 相同，在卡片填充上叠 `surface/ghost-hover`；两个 `Surface=Panel` 变体删去 Open 实例；组件说明已改为两种 Surface 都可整张点击、只有 Settings 有 Open。AP1 画面（如 AP1.03、AP1.04）的卡片随主组件更新，已截图核对，「更多」菜单的末端对齐不变。
- 验证：`pnpm --filter @atd/desktop typecheck`、oxlint、oxfmt 与 `src/App.test.tsx` 通过；没有测试覆盖这些卡片。用户正在运行的 Debug 应用没有被启动、停止或附加，所以面板中的点击与悬停没有在原生窗口里核对。

## 2026-10-05 面板底色调浅

用户认为面板背景太黑，要求调浅一些。渲染器的内容底色只有一个来源，改它即可让任务面板、设置窗口、引导页与菜单浮层一起变化。

- 代码：`packages/ui/src/styles.css` 的 `--ata-surface-panel` 由 `rgb(12 12 12 / 80%)` 改为 `rgb(24 24 24 / 80%)`，减少透明度时的不透明值同步改为 `rgb(24 24 24)`，与已有的 `--ata-glass-fill-opaque` 同色；`--popover` 引用它，随之变化。设置抽屉的备用填充 `--ata-material-settings-content` 与面板同色，改为 `rgb(24 24 24 / 10%)`。原生窗口的 `NSGlassEffectView` 不变，透明度仍为 80%，桌面模糊照常透出。
- Figma：变量 `material/panel`（Glass、Inactive window 为 24 / 80%，Solid 为不透明 24）与 `material/settings-content`（24 / 10%，Solid 不透明）已改，说明同步；`surface/panel`、`material/glass` 与 `popover` 经别名随之变化，AP1.03 截图已核对。上文表格中「`popover`（#0c0c0c 80%）」为当时的值。
- 验证：只改了 CSS 变量，格式检查通过。用户正在运行的 Debug 应用没有被启动或附加，所以没有在原生窗口里对照浅色、深色与彩色桌面核对合成效果。

## 2026-10-05 子代理钻取头改为单行，详情由名称打开；移除内置系统子代理

依据同日两项代码改动同步 Figma（代码为准）。本节取代上文 2026-10-04「对话内命令改为侧边对话」中 Layer header 的 `Show details` / 2/3 宽度上限，以及计划 `docs/plans/2026-10-04-agent-defined-subagents.md` F1 记录的钻取头角色区。

- 代码（钻取头）：`LayerHeader`（`features/agent/transcript/layer-header.tsx`，`agent.css` `.child-header*`）在所有面板宽度下都是一行 47px：返回、面包屑「父任务 › 代理」、任务代理的「临时」标记与末端「更多」。分隔符两侧由 4px 增至 12px；当前项保持自身宽度，最多为整行 − 60px，父标题先截断。任务代理的描述、工具、推理强度与角色说明不再固定在头部下方，而由名称打开（macOS 文档标题的做法）：名称、临时标记与 chevron-down 组成 ghost / sm 按钮（−12px 外边距，名称与纯文本位置相同），打开 `PopoverContent`（side bottom、align start、偏移 4、`material="backdrop"`，宽 22rem 并限制在窗口 − 16 内，高最多 min(30rem, 标题下方可用高度)），标题为完整名称与标记，正文为一个可聚焦的滚动区（边缘渐隐、覆盖式滚动条）。`TaskAgentDetails`（`task-agents/task-agent-role.tsx`、`task-agents.css`）取代原角色区；`TaskAgentInstructions` 只留在定义卡片中，去掉了有界模式。钻取时输入框照常隐藏。
- 代码（系统子代理）：服务不再内置 `service.worker` / `service.reviewer` / `service.scout`；设置 › 扩展中 System 插件只提供技能，说明为「Skills that ship with the app.」/「随应用提供的技能。」，没有界面再列出这三个代理。
- Figma 头部：App / Layer header · Rhea (Figma `project/1525:58108`) 改为单行，属性为 `Kind = Plain / Task agent / Task agent · no definition` 与 `Title state = Rest / Hover / Open / Focus`（只用于 Task agent）；删去 `State` 轴与五个无实例的旧变体、`Show details` 及任务 / 状态 / 错误文本属性和角色区块，原 `State=Running` 的两个变体改名后沿用节点 ID，现有实例保持连接。面包屑间距为 0，Separator 框左右各 12（Task agent 只留左侧，触发按钮从分隔符框起）；标题触发按钮为拉伸到 28 高的共享库 Button（Ghost）皮肤，内边距 12 / 8，内容为可截断的名称 + 6 + App / Badge · Rhea (Figma `project/2157:129211`)「Temporary」+ 4 + Lucide / chevron-down 14px（muted-foreground）；Hover 为 `surface/ghost-hover`，Open 为 `input`，Focus 为 1px `ring` 边线加 3px `focus-ring`。
- Figma 变量：新集合 `App · Layer header`（模式 Panel 420 / Panel 320 / Panel 640），`layer-header/current-max`（302 / 202 / 522，绑定当前项 Current 框）、`layer-header/trigger-label-max`（250 / 150 / 470，绑定触发按钮内的名称与标记）、`layer-header/details-heading-max`（320 / 272 / 320，绑定弹层标题的名称）。Figma 实例不能覆盖最大宽度，也不能按百分比限制，所以面板帧按宽度设置模式；父标题放不下时在实例中设为 Fill（Task agent 类变体默认已是 Fill，Plain 默认 Hug）。
- Figma 新组件（区块 30）：App / Layer details popover · Rhea (Figma `project/2198:131384`)（`Overflow = Fits / Scrolls · top / Scrolls · middle`，属性 Title、Show mark、Body focus、Show scrollbar 与 Content 插槽）：材质为绝对定位铺满的 App / Popover surface · Rhea (Figma `project/476:2600`) 实例，圆角绑定 `radius/panel`（22）；内边距 16 / 4 / 12 / 4、间距 12（正文向两侧伸进内边距 12、向下 4，内容再补回）；正文圆角 14，40px alpha 蒙版渐隐，滚动条为 7px 拇指（`scroll/glass-thumb`），Body focus 为内侧 1px `ring` 加 3px 30% 内阴影。App / Task agent details · Rhea (Figma `project/2196:131217`) 为插槽默认内容：描述（ATA/Body）、暴露的 App / Task agent facts · Rhea (Figma `project/2158:129216`)、「Instructions / 角色说明」标签（12/18 Medium）与保留换行的角色说明。
- Figma 删除与说明：App / Task agent role · Rhea（`2159:129230`）迁移后无实例，已删除；App / Task agent instructions · Rhea (Figma `project/2158:129338`) 删去 Bounded=Yes 两个变体与 Bounded 轴，只剩 State=Collapsed / Expanded。Badge、facts、definition、instructions 与 App / Side chat layer · Rhea (Figma `project/2055:124092`) 的说明已同步；侧边对话五个阶段（含 Drill-in「Summarize › explorer」）随主组件更新，SC6 / SC10 设为 Panel 320、SC7 设为 Panel 640；H 页「Mappings · Harness progress & approvals」的两段说明已改。
- Figma 审阅帧：Panel widths · task agents (2026-10-05) (Figma `project/2168:111267`) 的钻取画面改为代码测量用的窗口尺寸，并按代码隐藏输入框：420×520 静止（`2200:113036`）、详情打开（`2200:131332`，弹层 352 × 422，x 60）、更多菜单打开（`2168:111268`，末端对齐、下移 4）；320×520 静止（原 role 帧 `2168:129885`，长名称截断，父标题约 20px）、详情打开（`2200:131499`，304 × 422，x 8，名称两行、标记另起一行）；320×360 短高（`2201:131331`，304 × 262）；640×700 静止（`2201:131594`）与详情打开（原 instructions 帧 `2168:130010`，352 × 480，x 194）。save as my subagent 四个对话框画面与 420 Plain 钻取画面的头部随组件变为一行。
- Figma 系统子代理：App / Plugin list content · Rhea (Figma `project/1592:66124`) 的 System 卡片说明改为「Skills that ship with the app.」，内容数由「6 skills · 4 subagents」改为「8 skills」（当前 8 个产品技能），S5 / S6 插件列表随之更新；App / Extensions settings content (Figma `project/1511:57026`) Tab=Subagents 的三行示例改为个人子代理 test-writer / code-reviewer / researcher，描述行不再有「· System」，App / Extension subagent row · Rhea (Figma `project/1568:60217`) 与 App / Settings form dialog · Rhea (Figma `project/1569:61796`) 的默认文案改为 code-reviewer，S3 的对话框标题与映射说明随之更新；App / Extension sub-page · Rhea (Figma `project/1584:63172`) 删除迁移后无实例的 `Page=Subagent details · System`，新增 `Page=Subagent details · Plugin`（`2204:131856`：已安装插件的代理只读，来源为插件名，页脚只有「复制到个人」），S4 的 1000 宽画面与说明改用它。输入框 @ 面板与子代理列表中没有系统子代理的画面。

验证范围：Figma 用 get_screenshot 与节点回读核对。头部所有变体与审阅实例高 47；420 下返回 x 10、父标题 x 42、触发按钮 x 173 宽 204、更多 x 382，与代码一致（面板帧有 1px 边，实例内偏移 1px）。弹层顶部 = 触发按钮底部 + 4，距窗口边 8，尺寸 352 × 422 / 304 × 422 / 304 × 262 / 352 × 480，与代码测量一致；Figma 面板标题栏为 50px（代码 52），所以头部与弹层整体高 2px。截图保存在 `apps/desktop/.artifacts/drill-in-header/figma/`（忽略提交）。代码一侧在 Chromium 预览中测量，没有在原生窗口里核对系统玻璃；本节只改文档，未运行应用检查。

已知差异：

- 系统玻璃在 Figma 中显示为回退材质（popover 填充、20px 模糊、阴影与外侧 1px 边线，沿用 App / Popover surface · Rhea）；系统玻璃路径的边线在内侧。
- Figma 没有「只在需要时收缩」：父标题按实例在 Hug / Fill 间切换；三个上限只为 320 / 420 / 640 准备了模式，其他宽度需要新增模式。
- 滚动条只在 Show scrollbar 打开时画出（代码在悬停或滚动时出现）；焦点移动、Esc 关闭与 100ms 淡入缩放未做原型。
- App / Task agent facts · Rhea 的换行布局中，Tools 设为 Fill 时 Effort 仍留在第一行（代码会换到下一行）；审阅帧用了较短的工具列表，facts 组件按要求原样复用，未改。
- S3 等扩展页画面仍是插件分组之前的标签页布局（先前的差异），本次只替换了系统子代理示例；S4 说明中提到被移除的三个名称，属于记录。
- 只画了深色。

## 2026-10-05 对话中的数学公式

用户指出会话中智能体用 `$…$` 写的公式（`\dfrac`、`\binom`、`\pmod` 等）在面板里显示为原始 TeX，要求按最佳实践补上公式渲染。原因是 Streamdown 2.7 没有接入数学插件；官方 `@streamdown/math` 默认也只读 `$$`，不读单个 `$`、`\(…\)` 与 `\[…\]`。

- 代码：`features/agent/transcript/math-plugin.ts` 按 Streamdown 的 `MathPlugin` 契约组合 `@ziloen/remark-math` 与 `rehype-katex`。前者读四种定界符；单个 `$` 两侧不能紧挨 ASCII 字母或数字，所以价格（`$5 and $10`）与 shell 变量保持文本，`函数$f(x)$的` 仍是公式；独占一行的 `$$…$$` 或 `\[…\]` 是展示公式，句中的保持行内。KaTeX 在 Streamdown 的 sanitize 与 harden 之后运行，`trust` 关闭，`strict: 'ignore'`（公式中的中文不再逐字警告），无法解析的公式以 `--muted-foreground` 显示源码。`math-lazy.ts` 只在文本含定界符时加载 KaTeX、样式与字体，不进 Markdown 渲染块；`use-markdown-plugins.ts` 统一按需加载 mermaid 与数学插件，加载过后新挂载的消息首帧即渲染公式。
- 样式：`agent.css` 的 `.markdown .katex-display` 去掉 KaTeX 的 1em 外边距，沿用 12px 块间距（思考区 8px）；上下各 4px 内边距，避免 `\underbrace` 下中文 `\text` 等超出 KaTeX 度量的笔画被横向滚动容器裁掉；过宽的公式在自身块内横向滚动。
- 选区：选区跨入公式时整体取下整个公式（`selection-toolbar/math-sources.ts`），复制、引用、记住与命令得到 `$…$` / `$$…$$`（`selection-markdown.ts` 经 `mdast-util-math` 序列化），朗读文本中每个公式只读一次 TeX；系统复制（⌘C）由 KaTeX 官方 `katex/contrib/copy-tex` 写入 TeX。
- 依赖：`@ziloen/remark-math` 0.1.2、`rehype-katex` 7.0.1、`katex` 0.16.47（与 mermaid 依赖的版本相同）、`mdast-util-math` 3.0.0，按 `catalogMode: prefer` 进入 workspace catalog。
- Figma：新组件 App / Markdown math (Figma `project/2210:131495`)（02 · Messages & notifications，与其他 Markdown 原件同列），`Kind = Inline / Display / Error`，宽 600。Inline 为一行正文（App / Markdown / Body，`text/primary`），公式框高等于基线以上部分，自动布局按基线对齐，下沉部分由行底内边距容纳，与浏览器行盒变高一致；Display 居中，上下内边距绑定 `gap/small`，裁剪表示横向滚动；Error 的源码段为 `muted-foreground`。组件说明写明代码位置与行为。

验证范围：`pnpm --filter @atd/desktop typecheck`、oxlint、oxfmt 与桌面端 Vitest（38 项）通过，渲染器构建确认 KaTeX 只在数学块中。另在隔离端口的 Chromium 预览中用真实组件核对：该会话答案 96 个公式全部渲染、无错误、无残留 `$`；价格、中文紧贴、`\(…\)`、`\[…\]`、独占一行的 `$$`、`math` 围栏、列表 / 表格 / 引用中的公式、长公式横向滚动、错误源码、深色与流式输出；从公式中间开始的选区复制为完整 TeX，系统复制事件同样得到 TeX。用户正在运行的 Debug 应用占用 bundle id，没有被启动、停止或附加，所以原生窗口中的 WebKit 渲染未核对。

已知差异：

- Figma 不能加载 KaTeX 的网络字体，公式图形取自 MathJax 3 的 SVG 轮廓（KaTeX 字体同出一源的 TeX 字体），按 KaTeX 的 1.21em（16.94px）缩放；只画了深色。
- 流式输出时，Streamdown 的 remend 1.4.0（当前最新）会给未闭合的 `[` 补占位链接，且不避开数学区：`$[0,1`、`\[` 展示块与 `$$` 块中的 `\left[` 在括号闭合前会短暂显示 `[blocked]` 或 `](streamdown:incomplete-link)`。这在接入公式前已经存在，闭合后恢复正常；普通链接流式输出时显示 `[blocked]` 也来自同一原因（项目的 harden 配置拦截了占位协议）。
- Chromium 预览中，行内公式后的中文标点在窄宽度下可能换到下一行行首（行内公式两侧可断行）；未在 WebKit 中核对。

## 2026-10-05 创建应用优化：面板固定到桌面、单次运行一个版本、应用窗口玻璃底

依据 root 决定 D1、D4、D5（v1 至 v1.4，用户已批准）同步 Figma，以代码为准。

- 共享库未改动。Lucide（pin、pin-off、settings、plus、info、triangle-alert、circle-alert、x）都用共享库实例；原生菜单与指针用 Apple「macOS 26」社区库实例。没有分离或重绘任何实例。
- 新增变量集合 `Widget · macOS appearance`，模式为 Dark（默认）和 Light，包含 10 个 `widget/*` 变量。
- `shadcn · Project` 新增 `card`（--card，#171717）。
- 新增效果样式 `Atd/Desktop pin window shadow`。

### 面板应用卡片固定按钮

代码见 `apps-view.tsx`、`use-app-pins.ts`、`use-pin-drag.ts`、`app-list-card.tsx`。

- 布局：面板卡片右上依次为固定开关、继续编辑、更多。名称在三个操作旁约有 110px。
- 固定开关：
  - Ghost icon-sm，未固定时为 Lucide pin，已固定时换成 pin-off，没有选中底色。
  - 提示（D5 v1.2）：未固定为 `pin.addHint`「Pin to Desktop (or drag the card there)」/「固定到桌面（也可拖动卡片）」，已固定为「Remove from Desktop」/「从桌面移除」。
  - aria-label 为 `pin.addLabel` / `pin.removeLabel`；请求进行中为 aria-disabled。
- 拖出：按下卡片移动超过 4px 即交给壳拖出，松手处的桌面就是固定位置。
- Toast：新组件 App / Toast · Rhea (Figma `project/2231:132329`)（`2231:132329`），对应 `components/toast.tsx`。
  - 外观：圆角 18、1px 边框、bg-card，内边距 6 / 8 / 6 / 12，间距 8，12/18 文字，阴影 0 4 12 黑 20%，高 42。
  - 位置：面板 ToastHost top 65，相邻间隔 8，最宽为窗口宽减 32，过长时文字换行。
  - 文案：每次固定后显示 `pin.added`，之后至多跟一条一次性提示。
    - 第一次用按钮固定后为 `pin.dragHint`「Next time, drag an app's card onto the desktop to pin it.」/「下次可以直接把应用卡片拖到桌面来固定。」。
    - 之后的固定，或第一次通过拖动固定时，若「登录时打开」未开启，则为 `pin.loginHint`。
    - 用按钮移除时显示 `pin.removed`。
- Figma：
  - App / App list card · Rhea (Figma `project/2047:123329`) 的两个 `Surface=Panel` 变体加入暴露的「Pin to Desktop」实例（`2225:131963`、`2225:131967`），并改了组件说明。
  - 同时修复了 `Surface=Panel, State=Hover`（`2178:131273`）的标题、描述、Meta 与状态徽标没有绑定属性的问题。
  - 评审帧 (Figma `project/2227:131700`)（`2227:131700`）含默认、悬停、键盘焦点、已固定、zh-CN 与长名称。
  - AP1 新增一行 固定到桌面 (Figma `project/2235:113353`)，AP2、AP3 因此下移 760：
    - AP1.30 拖出卡片 (Figma `project/2236:113986`)：桌面上的面板，拖动图是即将生成的固定组件，居中于指针。
    - AP1.31 首次按钮固定 (Figma `project/2235:113354`)
    - AP1.32 登录提示 (Figma `project/2235:132337`)
    - AP1.33 移除 (Figma `project/2235:132502`)
    - AP1.34 zh-CN (Figma `project/2235:132660`)

### 桌面固定组件

代码见 `apps/macos/Sources/AIShell/DesktopPins/`（窗口、视图、菜单、`DesktopPinCorner.swift`），卡片在 `AIWidgetRender/WidgetCardView.swift`，图块在 `AIWidgetRender/WidgetLauncherView.swift`，几何在 `AICore/Windows/DesktopPinGeometry.swift`。

- 卡片：
  - 按尺寸为 170 × 170、364 × 170、364 × 382；内边距 16，连续圆角 22。
  - 底色为 `.fill.tertiary` 叠在 windowBackgroundColor 上，即 `widget/card`。本机 macOS 26 实测：深色 #292929，浅色 #F3F3F3。
  - 阴影由窗口服务器画在卡片外。
- 图块（D5 v1.4）：
  - 宽度不足 320 时图标在上、名称在下（小）；更宽时图标在前，右侧是名称和能放下的描述（中），描述由小组件同步数据的 `description` 下发。没有描述时，名称垂直居中，卡片只能加宽到 364 × 170。
  - 菜单预设与四角调整同样适用于图块。
  - 小组件回退为图块时，取最接近原尺寸的图块尺寸。
- Figma：
  - 新组件 Widget / Desktop pin (Figma `project/2224:131436`)（`2224:131436`）：
    - Kind=Widget：小、中、大各有 Content、First render (stand-in)、Unreadable 三种状态，是去掉容器底色的 Widget / App Widget 实例。Unreadable 显示 exclamationmark.triangle 与 `pin.unreadable`。
    - Kind=App tile：Small 为 72pt 图标与 11pt 名称；Medium 为同一 72pt 图标在前、间距 14，名称 headline 13 粗体一行，描述 subheadline 11 次要色、能放下几行显示几行（364 × 170 时最多 8 行，实测），名称与描述间距 2，由属性 Show description 控制。两种尺寸都各有内容与回退图块两种状态。
  - 浅、深色通过 `Widget · macOS appearance` 的模式切换。为此 Widget / App Widget、My Apps 与 My Apps tile 的颜色改为绑定这些变量；默认 Dark 下现有画面不变。
  - 新组件 Widget / Desktop pin menu (Figma `project/2225:131960`)（`2225:131960`），按 D5 v1.3 排列：打开“名称” / 尺寸（单选，声明两种及以上时显示）/ 小组件 ▸ / 从桌面移除，组间用分隔线隔开，不再有尺寸子菜单。
  - App / App widget row · Rhea (Figma `project/1874:107617`) 的预览底色改为 `widget/card`。
- 调整尺寸（D5 v1.3、v1.5、v1.6，响应式、不缩放）：
  - 指针在任意一角 20pt 内（去掉圆角外的部分）时，显示从该角出发的调整尺寸指针：最小尺寸时只朝外，最大尺寸时只朝内，其余双向。
  - 拖动时对角固定，大小连续变化。范围是所声明尺寸的区间：小 170–320 × 170–270，中 320–480 × 170–270，大 320–480 × 270–440；图块（图标在上）170–320 × 170，图块（图标在前、有描述）320–420 × 170–240，无描述时 320–364 × 170（只能加宽）。落在区间外的大小取最近的可用大小；宽、高都在所声明尺寸（小 170 × 170、中 364 × 170、大 364 × 382）8pt 以内时吸附到该尺寸；保持在工作区内。松手后保存宽高与位置。
  - 显示区间包含当前大小的最大已声明尺寸的布局，在实际空间里排布、不缩放：列表只显示能放下的整行（系统小组件同样不出现半行），图表占满多出的高度（Daily notes 大号：364 × 382 时 136pt，480 × 420 时 174pt），字号、图标与内边距不变。跨入尚无快照的尺寸时先显示占位，新快照到来后替换。
  - 右键菜单中的小、中、大是预设：选中即设为该尺寸，只有大小正好相等时才打勾；切换小组件或应用图标时尽量保持当前大小。
  - Atd 不在前台时，指针由 `BackgroundCursor` 显示。
  - Figma 中的 AP4 第 6 步：深色 (Figma `project/2238:132930`)、浅色 (Figma `project/2238:133038`)、右键菜单 (Figma `project/2239:114299`)、自由调整 (Figma `project/2239:114532`)、中间尺寸 (Figma `project/2248:114780`)。
  - Widget / App Widget 的 Large 示例图表改为占满剩余高度（与 SwiftUI 实测一致）；新增示例组件 Example / Notes starter widget (Figma `project/2245:133276`)（`2245:133276`）与变量 `widget/starter-accent`。

### 转录应用卡片「已更新」

- 代码见 `app-card.tsx` 与 `AppBuildDetails.updated`（D1：每次运行只产生一个版本）。同一运行中之后的构建会原地更新版本 n，卡片徽标为 `card.versionUpdated`「Updated v{n}」/「已更新 v{n}」。
- Figma：App / App card (Figma `project/1863:99626`) 新增变体属性 `Version = New | Updated in place`。
  - Ready 与 Typecheck warnings 各有一个「Updated v1」变体（`2227:132037`、`2227:132084`）。
  - 组件集改为三列换行并右移，以免重叠。
  - 评审帧 (Figma `project/2227:132129`) 依次展示 v1、Updated v1 与 zh-CN「已更新 v1」。

### 应用窗口玻璃底

- 代码（D4）：新应用为 `window.surface: "glass"`。
  - 窗口沿用设置窗口的做法：玻璃背景、52pt 统一标题栏、透明网页视图，并开启系统玻璃。
  - `#root` 绘制 `--ata-surface-panel`，即 #181818 80%；开启「减少透明度」时不透明。
  - 页面第一行为 `.atd-titlebar`：高 52，左 88、右 12，间距 8。
  - 模板为 720 × 612，主色 #f59e0b，主色上的文字为 #171717。
- Figma：AP3 (Figma `project/1870:90314`) 重做。
  - 玻璃窗口（`2237:132814`）位于壁纸之上，使用 `surface/panel`、圆角 22 与 `Atd/Native window glass`，红绿灯在 (18, 16)。
  - 标题行为 Notes 加 Ghost icon-sm 设置按钮，其下是 Notes 模板内容；笔记行为新组件 Example / Notes starter item (Figma `project/2237:132807`)。
  - 旁边的说明列附面板底色在黑、灰、白桌面上的色块（#131313 / #2d2d2d / #464646）。
  - 另附较小的 `surface: "opaque"` 参考（`2238:114086`）：标准标题栏 32pt，页面自绘全部内容，没有标题行。

验证范围：

- Figma：用截图与节点回读核对了以下各项。
  - Dark 下原有小组件不变，浅、深两种模式都正确。
  - 菜单与子菜单对齐，各种 toast 与长名称截断正常。
  - 现有 AP1 画面（AP1.04、AP1.13）中「更多」菜单仍然对齐。
- 卡片颜色：用脚本经 ImageRenderer 实测（sRGB）。
- 原生，在隔离实例中核对：
  - 固定组件的窗口层级（桌面图标层加一）、尺寸、快照与图块图标，有用户截图。
  - 右键菜单、点击打开、拖出与 Esc 回弹，由用户确认。
- 原生尚未核对：
  - 应用窗口玻璃底的外观（用户选择跳过截图）。
  - v1.3 的顶层尺寸菜单、v1.5/v1.6 的四角自由调整与响应式布局，以及 v1.4 的中号图块。这些仅用 ImageRenderer 渲染与几何脚本核对过。

已知差异：

- 近似值：窗口阴影与玻璃窗口的 22 圆角。
- 颜色来源：只有 `widget/card` 是实测值。其余 Dark 值沿用 App Widget 原有的 iOS 色板（标签为 100% 白，实测为 84.7%），Light 值据此对应；WidgetKit 容器的浅色值 #FFFFFF 为近似。
- 指针：调整尺寸指针在 Figma 中为双向箭头；代码在最小、最大尺寸时只朝一个方向。
- 菜单与拖动图：菜单只画了浅色外观，因为系统套件没有深色版本；拖动图是否半透明未核对。
- Toast：过长的 toast 在 Figma 中用固定的 388 宽模拟换行，代码中则随文字收缩、最宽 388。
- 中号图块的描述只来自小组件同步数据，它最多列 16 个应用；超出时中号图块只显示名称。
- 先前已有的差异：原有 AP1 画面仍有搜索框和页脚，面板标题栏为 49px 并带 X 按钮。

## 2026-10-05 欢迎指南新增「应用」步骤

代码在「AI 提供商」与「准备就绪」之间加入第 6 步「应用」（`onboarding-types.ts` 的 `ONBOARDING_STEPS`：欢迎、快捷键、划词工具栏、截图、AI 提供商、应用、准备就绪）。这一步只做介绍，不在 `GOAL_STEPS` 中：主按钮为「继续」，有「返回」，没有「稍后」；它说明应用是什么、怎么用，不会创建应用，也不向模型发送任何内容，不消耗 token。Figma 仍是欢迎指南的第一版（720 × 540 窗口），本次只在这个结构内补上该步骤拥有的部分，并把画面编号与页码改为代码顺序。共享库未改动，图标都是共享库实例，没有分离或重绘。

| Figma 组件（节点）                                                                                          | 代码对应                                                                                             | 要点                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App / Onboarding hero · Step=Apps (Figma `project/2273:132989`)（`2273:132989`）                            | `apps/desktop/src/features/onboarding/art-apps.tsx`、`art-apps.css`；光效 `lights/apps.ts`           | 184 × 100u 的插图（u = 1.53px，即 281.5 × 153）居中于 480 × 153。应用窗口沿用截图插图的页面卡片（`card/surface`、`border`，圆角 9u）：16u 标题栏含三点与标题条，下方三行清单，前两行为 `syntax/variable` 圆底加共享库 Lucide check（`primary-foreground`），第三行为 28% 空心圆。小组件为键帽面的 `secondary` 底、`border`、内侧顶部白 8% 高光与黑 45% 阴影（0 / 4u / 12u），内有标签条与五列图表，末列为 `syntax/variable`。共享库 Lucide sparkles（改绑 `foreground`）的中心落在窗口右上角。Step 值排在 Provider 之后，组件说明记录了尺寸、动效与光效。 |
| App / Onboarding controls · Step=Apps (Figma `project/2261:133432`)（`2261:133432`）                        | `apps/desktop/src/features/onboarding/step-apps.tsx`；文案为 `locales/*/onboarding.json` 的 `apps.*` | 小节标题「使用方式」（Inter Semi Bold 14/20，同设置小节标题），卡片内五行 Item xs（内边距 8 / 10、间距 8、`border` 分隔线）：16px 共享库 Lucide（sparkles、app-window、pin、history、shield-check，改绑 `foreground`）加 Rhea / Item title；脚注为 ATA/Body、`text/secondary`、左对齐。Step 值顺序同代码：Welcome、Shortcut、Selection、Provider、Apps、Finish。                                                                                                                                                                                          |
| App / Onboarding page indicator (Figma `project/1812:98281`)（`1812:98281`）                                | `onboarding-progress.tsx`；步数来自 `onboarding-types.ts` 的 `ONBOARDING_STEPS`                      | 每个变体改为 7 个 App / Onboarding page dot（间距 2，宽 138），新增 Step=6、Step=7；当前之前为 Reachable，当前为 Current，之后为 Upcoming。组件集宽度改为 Hug（170），不再溢出。                                                                                                                                                                                                                                                                                                                                                                          |
| Onboarding · 6 Apps · 720×540 (Figma `project/2277:132992`)（`2277:132992`，O1 第二行）                     | `onboarding-steps.tsx` 的 `apps` 分支                                                                | App / Onboarding step 实例，外框同「5 AI provider」：返回、跳过、主按钮「继续」，无状态行；Hero 与 Controls 都为 Apps，标题「打造你自己的应用」，描述「描述你需要的工具，比如习惯打卡或记账表，Atd 就会把它做成一个独立的应用。」，页码 Step=6。                                                                                                                                                                                                                                                                                                          |
| Onboarding · 5 AI provider (Figma `project/1817:98827`)、Onboarding · 7 Finish (Figma `project/1817:98971`) | `onboarding-types.ts` 中 `ONBOARDING_STEPS` 的位置                                                   | 由 4、5 改为 5、7，页码 Step=5、Step=7；第 4 位是截图步骤，Figma 没有对应画面。1–3 号画面编号与页码不变，页码点随组件变为 7 个。                                                                                                                                                                                                                                                                                                                                                                                                                          |

验证范围：Figma 用 get_screenshot、插件截图与节点回读核对。新主视觉与代码预览（strip 尺寸）构图一致；新节点的实心填充与描边都绑定变量，只有小组件的两层阴影按键帽面与划词工具栏的先例写死颜色；Lucide 实例都连接共享库，没有分离。其他主视觉、控件与页码变体的位置、尺寸、子节点和实例数不变，O1 现有画面的属性、插槽与覆盖不变。代码侧：定向 oxfmt、Oxlint、`pnpm --filter @atd/desktop typecheck`、渲染器 lint 与 38 个现有 Vitest 测试通过；Chromium 预览页核对了侧栏与堆叠两种尺寸下的插图，以及中英文卡片。在用临时数据目录启动的 Debug 应用（WebKit）中，页面上报的事实确认了：第 6 步的中英文文案、7 个页码点与「第 6 步，共 7 步」、只有「返回」与可用的「继续」；1120 × 780 并排与 720 宽堆叠两种布局下，插图尺寸与居中正确，正文不溢出；7 个光效着色器都能在 WebKit 的 WebGL2 中编译并链接。本机会话没有屏幕录制权限，未截取原生窗口画面；原生玻璃合成与「减弱动态效果」未在原生应用中核对。

### 已知差异

- Figma 仍是欢迎指南第一版：720 × 540 固定窗口、单栏居中。代码中的全屏舞台与开场页、最大 1120 × 780 的卡片、带每步 GLSL 光效的插图面板、顶栏（进度、音乐、关闭）、760px 以下的堆叠布局、「稍后」与页脚说明，在 Figma 中都没有对应。
- 截图步骤没有控件变体，也没有画面（只有主视觉 Step=Screenshot）。
- 实测数值差异：标题 Figma 为 Inter Bold 24/32，代码为 600；Figma 标题与描述居中、间距 6，代码左对齐、间距 8；页脚的返回与主按钮 Figma 为 Large（36px），代码为默认尺寸（32px）；页码点 Figma 在页脚，槽宽 18、间距 2，当前 18 × 6，其余为 `foreground` 30% / 14%，代码在顶栏，每点在 24px 按钮中，当前 16 × 6（`foreground`），其余 6 × 6（`muted-foreground`，之后的步骤为禁用按钮而变暗）；窗口阴影 Figma（`Atd/Native window glass`）为黑 28%（0 / 14 / 40），代码卡片为 40%。
- 「6 Apps」的内容高 517（主视觉 153、文字 82、控件 242 与两段 20 的间距），窗口正文只有 404。正文居中并裁剪，上下各约 56px 看不到，与「7 Finish」（超出 35px）同属第一版的限制；代码中长步骤从顶部开始滚动。
- 主视觉：代码的 sparkle 为实心（`fill="currentColor"`），共享库 Lucide sparkles 是描边轮廓，实例不分离就无法填满内部，Figma 保留轮廓。check 的笔画用实例矢量上加 0.54px 居中描边补足，约等于代码的 stroke-width 3.5。GLSL 光效与两段 CSS 循环（最后一行反复写出、小组件浮动）只在代码中，组件说明有记录。
- 代码的 `History` 在 lucide-react 1.49 中是 `rotate-ccw-clock` 的别名，图形相同；Figma 用共享库 Lucide / history，与面板应用视图一致。
- 共享库 Lucide 默认绑定共享库的 `shadcn colors/general/foreground`，欢迎指南的组件没有为该集合设 shadcn-dark 模式，所以在深色底上显示为黑色。本次新增的图标都改绑项目 `foreground`；先前已有的 Selection 控件行 shield-ellipsis 与 Selection 主视觉工具栏的 languages、file-text 仍为黑色，不在本次范围，未改。
- 只画了 zh-CN 与深色。

## 2026-10-06 欢迎指南按实现重建：卡片、插图面板与两种布局

依据 `apps/desktop/src/features/onboarding/` 重建 Figma 的欢迎指南，处理上一节「已知差异」中的各项。代码中的引导已不是 720 × 540 的窗口：Swift 壳层（`OnboardingWindowController.swift`）是覆盖整个显示器的无边框舞台，页面画黑色遮罩、开场页与卡片，壳层在卡片下铺原生玻璃。组件在 25 · Welcome guide (onboarding) (Figma `project/1812:98206`)（`1812:98206`），画面在 O1 · 欢迎指南 (Figma `project/1817:98359`)（`1817:98359`）。共享库未改动，Lucide 图标都是共享库实例，没有分离或重绘；本次没有修改应用代码。

每步的 GLSL 光效（`lights/*.ts`）不在 Figma 中画。本次曾加入静态渐变占位，用户确认它与实际效果完全不同，已删除，插图面板只画黑底、插图与描边。欢迎与准备就绪主视觉中第一版留下的光晕也一并删除，代码中已经没有。

| Figma 组件（节点）                                                                                                                                                                     | 代码对应                                                                               | 要点                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App / Onboarding card (Figma `project/2298:135441`)（`2298:135441`）：`2298:135008` (Figma `project/2298:135008`) 并排、`2298:135320` (Figma `project/2298:135320`) 堆叠               | `onboarding-card.tsx`、`onboarding.css`；步骤列 `onboarding-step.tsx`、`steps.css`     | 卡片为 min(1120, 显示宽 − 64) × min(780, 显示高 − 112)，居中在舞台上；卡片宽小于 760 时堆叠（画成 720 × 780）。`radius/panel` 22，`surface/panel`，效果样式 Atd/Onboarding card（0 / 14 / 40，黑 40%；背景模糊预览壳层铺在卡片下的原生玻璃，玻璃画边缘，页面不加描边）。并排：左栏 minmax(340, 42%)，1120 宽时为 470.4；右侧插图格内边距 8。堆叠：插图格占 30%（234），内边距 8 / 8 / 0，正文与页脚左右内边距 20。主栏 = 顶栏 + Body + 页脚；Body 是有界滚动区，Steps 内边距 12 / 28 / 16，短步骤垂直居中，长步骤从顶部开始。步骤列间距 16：Header（间距 8；Title 为 Inter Semi Bold 24/32、左对齐；Description 为 14/22、`text/secondary`；描述里有按键时改用 Keys sentence：前文、每个键一个 Kbd、后文，行高 26）、Goal status、Controls 槽。属性：Title、Description、Show description、Keys lead、Keys tail、Show keys sentence、Show status、Scrolled（Body 底部 40px 渐隐遮罩，对应 ScrollArea 的 `scrollShadow`）与 Controls 槽；顶栏、页脚、插图面板与目标状态是暴露的嵌套实例。共享库 `shadcn colors` 显式设为 shadcn-dark。 |
| App / Onboarding art panel (Figma `project/2295:134983`)（`2295:134983`）                                                                                                              | `onboarding-card-art.tsx`、`onboarding-card-art.css`                                   | 黑底（代码为 `rgb(0 0 0)`，绑定共享库 `tw-raw/black`），圆角 14（卡片 22 减去 8 的内缩，同心）；Art 槽居中放插图；最上层是 1px `border/settings-sidebar` 描边，盖在插图上（代码 `::after`）。每步的光效不画。插图放 App / Onboarding hero 实例，按面板单位 u 缩放（缩放系数 u / 1.53）：并排 1.656（面板 633.6 × 764，u = 2.534），堆叠 1.108（704 × 226，u = 1.695）；欢迎与准备就绪的图标在代码中封顶 176，并排时用 176 / 107。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| App / Onboarding top bar (Figma `project/2296:134897`)（`2296:134897`）                                                                                                                | `onboarding-card.tsx` 顶栏、`onboarding-progress.tsx`、`onboarding-stage-controls.tsx` | Layout 为并排 / 堆叠：内边距 16 / 12 / 4 / 28（堆叠时左侧 20），间距 4（`gap/small`），高 48。Progress 为页码指示器，占满剩余宽度；Music 为 App / Icon button Ghost icon-sm 加共享库 Lucide volume-2（静音时 volume-x，音乐不能播放时隐藏：Show music）；Close 为同款按钮加 Lucide x。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| App / Onboarding footer (Figma `project/2297:135049`)（`2297:135049`）                                                                                                                 | `onboarding-footer.tsx`                                                                | Layout × State（Ready / Goal pending）。纵向间距 8，内边距 12 / 28 / 20（堆叠时左右 20）。返回、稍后与主按钮都是 App / Settings action · Rhea 的 Default（32px）：返回、稍后为 Ghost，主按钮为 Primary。Goal pending：按钮上方的说明（12/16，`text/secondary`，右对齐）、「稍后」，主按钮为 Disabled。Show Back 控制返回（第一步没有）；主按钮暴露，文字为「开始」「继续」或「开始使用 Atd」。高 64，待完成时 88。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| App / Onboarding goal status (Figma `project/2294:135320`)（`2294:135320`）                                                                                                            | `onboarding-step.tsx` 的 `GoalStatus`                                                  | Waiting / Met。Item muted sm：`radius/control`，内边距 13 / 15（含 1px 透明边框），间距 14；`muted` 50% 的底色是单独一层（Muted wash）。图标：等待为 Lucide circle-dashed（`foreground`），完成为 circle-check（`status/progress`）。属性：Status、Detail、Show detail（有第二行时图标顶对齐，下移 2）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| App / Onboarding goal row (Figma `project/2294:134301`)（`2294:134301`）                                                                                                               | `step-finish.tsx` 的 `GoalRow`                                                         | Done / Open。设置卡片里的 Item sm 行：circle-check（`status/progress`）或 circle（`foreground`）加步骤名称（Step 文字属性）；操作区始终保留小按钮的 28 高，Open 时显示 Small Outline「现在完成」。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| App / Onboarding selection practice (Figma `project/2300:136269`)（`2300:136269`）：`2298:134955` (Figma `project/2298:134955`) 并排、`2300:136260` (Figma `project/2300:136260`) 堆叠 | `art-selection.tsx`、`selection-illustration.css`                                      | 划词步骤的插图面板内容：练习文字页（宽 min(100%, 360)，内边距 16 / 18，圆角 14，`card/surface` 底与 `border`，示例文字 14/22），下面是说明（12/16，`muted-foreground`，居中），呼出键为 App / Onboarding keycap，大小 max(32px, 22u)（并排缩放 0.911），在面板底部 24 处居中，与说明至少相隔 12。面板不超过 280 高时（所有堆叠插图条）间距收紧、不显示呼出键，Layout=Stacked 画的就是这个状态。属性：Sample、Caption、Show keys。代码已不再画工具栏示意图，划词画面用它代替主视觉。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| App / Onboarding page dot (Figma `project/1812:98213`)（`1812:98213`）、page indicator (Figma `project/1812:98281`)（`1812:98281`）（更新）                                            | `onboarding-progress.tsx`                                                              | 每个点是 24 × 24 的 ghost icon-xs 按钮：当前步骤为 16 × 6 `foreground` 胶囊，其余为 6 × 6 `muted-foreground`；未到达的步骤是禁用按钮，整体 50%。指示器间距 0，宽 168，放在顶栏。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| App / Onboarding keycap (Figma `project/1815:98094`)（`1815:98094`）（更新）                                                                                                           | `keycaps.tsx`、`art-illustration.css`                                                  | 按 u = 1.53 改为代码的 40u：高 61.2（含 4px 底座），圆角 0.19 × 键高 = 11.6，键面最小宽 57.2，字 25.4；宽键字 17.7，左右 0.7em。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| App / Onboarding hero (Figma `project/1816:98233`)（`1816:98233`）（更新）                                                                                                             | `art-*.tsx`、`art-illustration.css`、`art-screenshot.css`                              | 删除 Welcome、Finish 中第一版留下的光晕（代码已没有）。Screenshot 的页面卡改为 170 × 100u（260 × 153），线条、选框与把手按代码比例排列。选框的 `syntax/variable` 16% 底色和 Apps 窗口标题栏的 `foreground` 4% 底色改为单独一层：绑定变量的填充另设不透明度时，实例会按变量自身的 alpha 渲染成 100%。Selection 变体（工具栏示意）保留，但画面不再使用；其中的 Lucide languages、file-text 改绑项目 `foreground`。组件说明已改写。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| App / Onboarding controls (Figma `project/1817:98358`)（`1817:98358`）（更新）与 Step=Screenshot `2294:133919` (Figma `project/2294:133919`)                                           | `step-*.tsx`；文案为 `locales/zh-CN/onboarding.json`                                   | Welcome：「接下来要设置」与四行卡片（Lucide keyboard、text-select、camera、plug），加「语言」行。Shortcut：行描述改为「想换个组合？点击按键即可录制新的快捷键。」，冲突提示左对齐。Selection：辅助功能权限行在前（描述「仅用于读取你选中的文字。」，shield-ellipsis `1817:98265` 改绑 `foreground`），然后是工具栏开关与呼出方式行（Small Select「按住按键」与 ⌥ 录制器）。Screenshot（新增）：屏幕录制权限行。Provider：按钮与脚注左对齐。Finish：目标卡片（四个 goal row）、「可以试试」与五行快捷键、「登录时打开 Atd」。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 效果样式 Atd/Onboarding card（`S:538168c740c16d28999433351ff0dbac9c13cf2d`）                                                                                                           | `onboarding.css` 的 `.onboarding-card-surface`                                         | 背景模糊 40（同 Atd/Native window glass）加卡片自己的阴影 0 / 14 / 40，黑 40%。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

画面在 O1 中每步一行。每张都是舞台画框：`tw-raw/black` 60% 的遮罩，卡片按代码的边距（左右 32、上下 56）居中，所以并排画框为 1184 × 892，堆叠画框为 784 × 892；桌面与原生玻璃不画。等待状态的步骤显示目标状态、「稍后」与禁用的主按钮。

| 步骤                     | 并排 1120 × 780                             | 堆叠 720 × 780                                                                      | 其他状态                                               |
| ------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1 欢迎                   | `2298:135451` (Figma `project/2298:135451`) | `2298:135600` (Figma `project/2298:135600`)                                         | —                                                      |
| 2 快捷键（等待按键）     | `2300:135559` (Figma `project/2300:135559`) | `2300:135780` (Figma `project/2300:135780`)                                         | 已成功 `2300:135983` (Figma `project/2300:135983`)     |
| 3 划词工具栏（等待权限） | `2301:117061` (Figma `project/2301:117061`) | `2301:117320` (Figma `project/2301:117320`)                                         | —                                                      |
| 4 截图（等待权限）       | `2301:117546` (Figma `project/2301:117546`) | `2301:117735` (Figma `project/2301:117735`)                                         | —                                                      |
| 5 AI 提供商（未连接）    | `2302:136362` (Figma `project/2302:136362`) | `2302:136624` (Figma `project/2302:136624`)                                         | —                                                      |
| 6 应用                   | `2302:136857` (Figma `project/2302:136857`) | `2302:137018` (Figma `project/2302:137018`)                                         | —                                                      |
| 7 准备就绪（全部完成）   | `2302:137179` (Figma `project/2302:137179`) | `2302:137361` (Figma `project/2302:137361`)（内容超出：Body 顶对齐并打开 Scrolled） | 未全部完成 `2302:137543` (Figma `project/2302:137543`) |

删除了第一版窗口组件 App / Onboarding step（`1814:98048`，720 × 540，代码中已没有这个窗口），以及使用它的 7 张画面（`1817:98360`、`1817:98484`、`1817:98591`、`1817:98698`、`1817:98827`、`1817:98971`、`2277:132992`），没有其他引用。上一节表格中指向这些节点的链接已失效，对应的新画面见上表。节 25、O1 与卡片组件把共享库 `shadcn colors` 设为 shadcn-dark（同节 26），共享库颜色在深色下解析。

验证范围：节点回读确认卡片 1120 × 780 / 720 × 780、圆角 22、阴影 0 / 14 / 40 黑 40%；标题 Inter Semi Bold 24/32、左对齐（距卡片 28 / 20）；页脚按钮高 32，待完成说明 12/16 右对齐；页码点为 24 × 24，当前 16 × 6，其余 6 × 6，未到达 50%；插图面板 633.6 × 764 / 704 × 226、圆角 14、1px `border/settings-sidebar` 描边，主视觉缩放 1.656 / 1.108。16 张画面都用 get_screenshot 与插件截图核对过。扫描节 25 的主组件，没有绑定颜色还依赖填充不透明度；嵌套实例都连接主组件，没有分离。注意：Figma 中绑定变量的填充若另设不透明度，主组件显示正常，实例会按变量自身的 alpha 渲染（变成 100%）。半透明底色要么用带 alpha 的变量（如 `card/surface`），要么放在单独一层，用图层不透明度。本次只改 Figma 与本文档，没有运行应用。

练习区呼出键压住说明文字，已修复（`selection-illustration.css`）：原先呼出键绝对定位在面板底部，不参与布局，只靠 220px 的容器查询在短面板中隐藏；堆叠插图条最高 226（卡片 780 × 30% − 8），720 × 780 堆叠时键帽盖住说明 12.3px（英文 29.3px），侧栏在很矮的显示器上也会重叠。现在练习区改为网格：练习页与说明在中间两行，上下两行平分剩余空间，呼出键在最后一行底部、与说明至少相隔 12，面板矮时把练习页往上推，放不下时才滚动；间距改用外边距，空的第一行不再额外占位。面板高度阈值改为 280（当前文案放下练习页、说明与呼出键约需 280），所有堆叠插图条与很矮的侧栏都收紧间距并隐藏呼出键，说明里已写出按键。验证：用临时页面载入真实的 `selection-illustration.css` 与 `art-illustration.css`、Inter 字体与中英文文案，在 Chromium 中测量 704 × 226 / 220 / 172 / 150、400 × 226 / 172 与 633.6 × 764 / 320 / 300 / 290 / 281 / 280 / 244、404 × 764 / 290 共 15 种尺寸、中英文各测一次：都不再重叠；高面板中练习页、说明与呼出键位置与修复前一致；只有高 150 的英文插图条需要滚动，修复前同样滚动 20px。没有在 WebKit 与原生应用中核对，也没有现有测试覆盖这段样式。Figma 的 Layout=Stacked 变体同步为收紧状态、去掉呼出键，O1 的堆叠划词画面随之更新。

### 已知差异

- 每步的光效、原生玻璃的折射与边缘、舞台下的桌面都不画；玻璃只以效果样式的背景模糊预览。开场页（地平线光、打字机文字、「开始设置」按钮）也没有画。
- 只画了 zh-CN 与深色；减弱透明度与减弱动态效果没有单独的画面。
- App / Onboarding controls 的 Step 下拉中 Screenshot 排在最后：插件 API 不能调整变体值顺序，需要在属性面板中拖动一次。
- Provider 主视觉按 u 缩放时，图标在并排画面中为 177.2（代码封顶 176）。练习区键帽的字号随键帽一起缩放：并排 23.1（代码 24.1）。
- 设置卡片行沿用本文件的画法：行内边距 12 / 14，加 1px 分隔线；代码每行有 1px 透明边框，上下相差 1px。选择器仍是共享库 Select & Combobox - Nova 的实例，同第一版。
- 节 25 在本次会话中被移到该页 (6164, 35933)，脚本没有设置过它的位置；组件已按新位置重新排布，与相邻的节不重叠。

## 2026-10-06 迷你面板：贴边快捷入口、灵动岛动效与拖入上下文

屏幕边缘的迷你面板（Mini Panel）：贴在显示器工作区左或右边缘的玻璃胶囊，点击（可在设置中改为悬停）展开为快捷入口（打开 Atd、新建任务、就所选文字询问、截图、命令），可拖动到任意位置后带速度吸附到最近的边缘；在任何应用里开始拖动文件、图片、文字或链接时，它变为拖放目标，放下的内容进入任务面板当前草稿（不自动发送），与 Finder 服务、截图快捷键、划词「问 Atd」一致。代码为原生实现（SwiftUI 内容，AppKit 窗口），设计与代码在同一任务中同步。

| 设计源                                                                                                                                                                                                                                                                  | 代码拥有者                                                                                                                                                                            | 内容                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 31 · Mini panel (Figma `project/2290:133108`)：App / Mini panel (Figma `project/2292:133325`)（State × Edge）、按钮 (Figma `project/2290:133198`)、命令行 (Figma `project/2290:133205`)、命令卡片 (Figma `project/2290:133206`)、悬停标签 (Figma `project/2307:136569`) | `apps/macos/Sources/AIShell/MiniPanel/`（窗口、控制器、视图、指针、拖放）、`apps/macos/Sources/AICore/MiniPanel/`（几何、吸附投影、磁吸滞回、编排时序、标签路径、拖放路由，均有单测） | 药丸 6 × 44（1x 显示器上 8 × 44，见下方动效修复）、胶囊宽 44（内边距 6、按钮 32、间距 4）、命令卡片圆角 18 与 28 行高、拖放卡片 184 × 112；所有状态同一种未着色玻璃，静止的小胶囊另在玻璃内加一层中性色调（见下方「小胶囊可见度」）                                                                      |
| MP · 迷你面板 (Figma `project/2294:133578`)（MP1–MP12、MP2a/2b、MP3b）、Motion · Island choreography (Figma `project/2313:118059`)、Motion · Hover label exit (Figma `project/2322:118059`)                                                                             | `MiniPanelChoreography`、`MiniPanelView`、`MiniPanelGlassPieces`、`MiniPanelGlassShape`、`MiniPanelMotion`、`MiniPanelController+*`                                                   | 灵动岛式动效：进入热区一帧内鼓起，60 ms 后展开；厚度与长度分轴弹簧，玻璃、裁剪与内容取同一个形状值，内容居中于形状、随之缩放、任何一帧都不超出玻璃，以透明度与模糊先于形状离场、晚于形状到场；按压收缩、拖动拉伸、甩动吸附；悬停标签从按钮中心长出，文字随标签长出、滑动并插值换字，收回并与胶囊玻璃融合 |
| Settings › Window「显示迷你面板」 (Figma `project/2300:135447`)                                                                                                                                                                                                         | `apps/desktop/src/features/settings/general-settings.tsx`、`use-shortcut-settings.ts`、`native-host/native-mini-panel.ts`                                                             | 开关跟随 `miniPanel.state`，写入 `miniPanel.setShown`；面板推送已启用命令 `miniPanel.setCommands`；`task.new` 新建任务                                                                                                                                                                                   |

- 桥接契约新增 `miniPanel.setShown`、`miniPanel.setCommands` 两个调用与 `task.new`、`miniPanel.state` 两个事件；显示状态、边缘、位置与显示器保存在壳的 UserDefaults（`miniPanel.*`），菜单栏与面板右键菜单都可显示或隐藏。
- 动效与性能按用户验收：隔离进程实测（60 Hz），各动画环节无超过 16.7 ms 的帧，主线程每帧耗时约为改前的一半，悬停展开从约 160 ms 降至约 16 ms 出现。
- 动效修复（motion-v3，同日，按用户反馈的四个问题）：
  - 按钮溢出容器：形体原先用 `frame` 宽高动画加两层 `offset` 摆放，SwiftUI 对玻璃、裁剪与内容的几何各自插值，展开中途按钮画到玻璃外，整列内容先偏下再滑回。现在形体与命令卡片、悬停标签一样画在固定泳道里（`MiniPanelLayout.bodyRegion`），玻璃与裁剪是同一个可动画形状（`MiniPanelGlassRect`），内容用同一组值的 `MiniPanelFollowEffect` 居中于形状、按 min(宽比, 高比) 缩放（至多 1.06）；分轴弹簧改由自定义动画 `MiniPanelAxisAnimation` 在这一个值上分别推进厚度与长度。命令卡片的行同样随卡片缩放。
  - 悬停标签文字：原先文字固定在静止位置、由长大的形状裁出，切换按钮时新文字先到终点、被标签边缘切开，旧文字当即消失。现在文字随标签形状居中缩放（`MiniPanelLabelFollowEffect`，与轮廓同一组值），换字用 `contentTransition(.interpolate)`。
  - 收起时变黑：实测（macOS 26，1x 显示器）Liquid Glass 以 4 × 4 设备像素块采样背景，一块也盖不满的玻璃画成近黑色（17, 17, 17），与 `glassEffectID`、玻璃容器无关。6 pt 小胶囊在 1x 上只有 6 px，收起末段厚度弹簧逼近 6 pt 时外缘和内缘都在亚像素位置，先后约 4 帧与 2 帧盖不满像素块。小胶囊因此至少 8 个设备像素宽（`MiniPanelMetrics.glassMinPixels`）：Retina 上仍为 6 pt，1x 上为 8 pt，鼓起保持 +4 pt；圆角改为按实际厚度取半。各玻璃也去掉了没有作用的 `glassEffectID`（它们从不插入或移除）。
  - 模糊：内容到场与离场恢复模糊（主体内容 6、命令行 4、标签文字 3 pt），只作用于内容层，与透明度同一曲线，静止时为 0；动画仍全部是渲染效果，帧间不重新布局、不求值视图。
  - 验证：用临时 SwiftPM 宿主驱动真实的 `MiniPanelController`（不移动指针、独立 UserDefaults），ScreenCaptureKit 只录宿主自己的窗口（60 Hz），左右边缘各录展开、标签出现 / 滑动 / 收回、收起，左边缘另录鼓起与回落、按压、命令卡片开合、邀请 / 拖放卡片 / 收起，并对小胶囊逐帧取色：修复前每次收起都有近黑帧，修复后 6 段录制中 0 帧。AICore 与全部 Swift 单测、SwiftLint、`swift format lint --strict`、Debug 构建通过。Figma 两张动效说明图（Island choreography、Hover label exit）的说明、图例、条形与 Reduce Motion 文案已同步；组件与 MP 画面未改。
  - 命令卡片滚动（同日追加，按用户反馈）：超过 8 条时不再显示系统滚动条（它压在行的右端，并顶进卡片的圆角），改为卡片右侧 6 pt 内边距里的 4 pt 滑块（`MiniPanelScrollThumb`，颜色同 `--ata-glass-scroll-thumb` / Figma `scroll/glass-thumb`），离行和卡片边缘各 1 pt，只在两个圆角之间显示（上下各让出 18 pt），长度为可见部分的比例（至少 18 pt）：左右内边距相同、不遮挡任何行，与共享 ScrollArea 的 `gutter="none"` 一致。滑块随行一起随卡片缩放、淡入淡出，卡片打开期间一直显示；与 ScrollArea 一样可拖动滑块，按在轨道上时滑块中心跳到按下处再随指针移动，指针命中宽度 10 pt（右侧内边距加行自身 8 pt 内边距中的 4 pt，碰不到命令名），悬停与拖动时滑块变亮（标签色 42 % / 56 %）。拖动沿用面板窗口接管按压的做法（新增按压目标 `scroller`，由 `MiniPanelController+Scroll` 换算为滚动位置，经 `ScrollPosition` 滚动列表）。同时修正内容随形状带来的回退：变换施加在 AppKit 滚动视图上会让它自行移动滚动位置（打开时停在 12–25 pt，首行被遮），现在只变换滚动视图里的行，滚动视图本身不变换。验证：宿主中 12 条命令的卡片打开、关闭再打开，滚动位置始终为 0；滚到顶部、中部、底部时滑块位置正确，与高亮行不重叠；经面板窗口的事件入口合成按压：按住滑块下拖 36 pt 列表滚动 60 pt（按比例应为 60.5），按在轨道上滑块跳到按下处，拖过末端停在末端，按在行上仍是点击该行。Figma `App / Mini panel commands flyout` 增加布尔属性 Scrolls（默认关，现有 7 个实例不变）与滑块层，并改写组件说明。
  - 命令标签与卡片（同日追加，按用户反馈）：悬停「命令」出现标签后点击，原先标签当即收回，正在长出的卡片与胶囊之间的缝隙里能看到它收回的残影；关闭时卡片直接缩回按钮中心，与标签互不相干。现在按住「命令」期间标签保持原样（`holdLabel`），不会留下等待中的空气泡；松开后点击打开，卡片在同一帧接替气泡的位置与形状（`takeLabelBubble`），下一帧从气泡长成卡片，标签文字在长出的卡片上 0.1 s 淡出（模糊 3），随后已在卡片之内的气泡与卡片玻璃融为一体后撤掉，缝隙里不再有收回的标签。没有标签时卡片仍从按钮中心长出；按下后开始拖动时标签立即离开，松开后没有打开卡片时 0.2 s 后照常离开。再点「命令」关闭时反向经过气泡：行先离场，40 ms 后卡片缩向标签气泡，关闭开始 150 ms 后（已接近气泡大小，`MiniPanelChoreography.flyoutCloseThroughLabel`）转向按钮中心，以标签收回的 Spring(0.28, 0) 并入胶囊玻璃。两段弹簧叠加、速度连续，不再像先前那样停在气泡处等第一段完全静止、再换成标签玻璃收回（约 250 ms 的停顿）。其他关闭方式（选中命令、收起、拖动、命令被移除）不变。同时修正：关闭后指针仍停在「命令」上时，标签会在 0.35 s 后重新弹出。原因是卡片打开期间胶囊按钮没有标签，计时器记不住刚被点过的按钮；现在受抑制的帧记下指针下的控件（`updateLabel`），离开该按钮再回来才重新出现。验证：经面板窗口的事件入口实测，松开到点击执行为 4–16 ms；宿主（右侧边缘，60 Hz）悬停 0.7 s 出现标签，按下、90 ms 后松开、10 ms 后执行点击打开，再同样点击关闭，另录按住 300 ms 与轻点 15 ms 的打开：按住期间标签始终带着文字，松开后文字在长出的卡片上淡出，没有空气泡，也没有残影；关闭从行开始离场到玻璃并入胶囊约 250 ms（先前约 520 ms），无停顿、无近黑帧，关闭后 0.9 s 内标签不再出现。Swift 单测 388 项、SwiftLint、`swift format lint --strict`、Debug 构建通过。Figma：Island choreography 的 C 道新增「卡片形状 · 点命令关闭（经标签气泡）」，并按代码把「卡片形状 · 关闭」改为 +40 ms 开始；H 道新增「点击命令 · 标签变成卡片」；原型映射、MP3 与 MP2a 交互说明（顺带把已过时的「不做模糊」改为 motion-v3 的模糊）、`App / Mini panel commands flyout` 与 `App / Mini panel hover label` 组件说明已同步，两份组件说明中多次读写叠加的 HTML 转义（如 `&amp;quot;`）一并清理。
  - 点击才展开（同日追加，按用户要求；随后按用户要求把默认改为点击时）：设置 › 通用 › 窗口在「显示迷你面板」下新增「展开迷你面板」，可选「点击时」（默认）或「悬停时」，说明随选项改写（`mini-panel-open-row.tsx`，与选择工具栏「触发方式」同为 Item + 小号 Select 的行；面板隐藏时仍可设置）；迷你面板右键菜单在「移到…边缘」之后新增可勾选的「点击时打开」。两处经 `miniPanel.setOpenOn` 与 `miniPanel.state`（新增 `openOn`）同步，设置保存在壳的 UserDefaults `miniPanel.openOn`，未设置时为点击时（`MiniPanelSettings`；AICore 的悬停规则本身仍以悬停为基准，由面板按设置覆盖）。点击时打开：指针进入热区只让小胶囊鼓起并停在鼓起，不再计时、不会展开；点击小胶囊或热区内任意处都会在松开时展开，包括指针停靠的屏幕最边缘（热区画了一块 1/255 透明度的命中区，窗口服务器才会把点击交给面板）；热区内光标为手指；展开后离开胶囊仍按 0.35 s 规则收起。小胶囊的点击由面板窗口直接交给控制器（`MiniPanelWindow.onClick`），不再经 SwiftUI 回放，悬停模式下点小胶囊也走这条路。
  - 按压收缩、拖动抬起、松手拉伸与投放挤压（同日修正，点击模式下按住小胶囊时暴露）：它们原本用视图缩放（`scaleEffect`）实现，但 GlassEffectContainer 里玻璃视图的缩放会被丢掉、只留下平移（macOS 26；独立实验中同一个缩放在容器外正常，在容器内不缩放、整体偏到一旁），所以按住小胶囊时它会向屏幕边缘和下方跳约 4 pt，按住胶囊、拖动抬起时整体同样偏移。现在这些系数直接画进形体几何（围绕中心，`MiniPanelBodyShape.drawn`），每次改变带各自的动画，不再做视图变换；内容在按压与抬起时随形体缩放，在拉伸与挤压时保持原尺寸。
  - 验证：宿主中把形体缩放设为 0.5，胶囊与图标围绕中心缩到一半（修改前不缩小、整体滑出画面）；按压 0.96、抬起 1.04、拉伸 0.96 × 1.08、投放挤压 1.06 × 0.92 各段录制中玻璃中心不动（±0.5 pt），尺寸按设计变化；点击模式下停在屏幕最边缘 0.8 s 只鼓起不展开，点击该处（小胶囊之外）后展开，离开后收起，右键菜单切回悬停后停留即展开；展开、标签、收起、命令卡片、邀请与放置卡片的既有录制无回退，最长帧 16.7 ms。设置行用一次性 jsdom 测试核对后删除：位于「显示迷你面板」之下，默认显示「悬停时」与对应说明，选「点击时」调用 `setMiniPanelOpenOn('click')`。前端类型检查、oxlint、桥 schema 与 Swift 类型生成检查、`App.test.tsx`、Swift 单测 388 项、SwiftLint、`swift format lint --strict`、Debug 构建通过。Figma：新增 App / Settings card select row · Rhea (Figma `project/2411:155333`)（与开关行同构，右侧为按 Rhea 调整的小号 Select，无整行悬停），MP12 (Figma `project/2300:135447`) 英中两版加入该行；`App / Mini panel context menu` 两个变体加入「Open on Click」并改用带勾选列的菜单项布局（MP11 中文副本译为「点击时打开」）；`App / Mini panel` 组件说明、MP1 / MP7 / MP12 交互说明与编排图 0 道「停留」已同步。默认改为点击时后，MP12 两版显示「On click / 点击时」与对应说明，右键菜单组件的「点击时打开」默认勾选，MP1 原型改为点击热区进入 MP2（原为 MOUSE_ENTER 延迟 0.06 s），相关说明与原型映射一并改写；宿主中全新设置启动即为点击时，停在热区 0.8 s 只鼓起。
  - 收起态拖动保持小胶囊（2026-10-08，按用户要求）：原先在小胶囊上按住移动超过 3 pt 会先展开成胶囊再拖动，松手后停在展开态。现在拖动保持按下时的形状：新增 `draggingPill` 状态，小胶囊抬起 1.04 倍、1:1 跟随指针，指针下的鼓起随即回落，不显示胶囊内容，悬停与点击都不会在途中展开；松手按原有速度投影吸附，停在收起态（不经过 MP6）。胶囊的拖动不变（`dragging`，松手停在展开态）。验证：用临时 SwiftPM 宿主驱动真实的 `MiniPanelController` 与窗口的拖动回调（独立 UserDefaults，不移动指针）：点击模式下从右边缘拖到左半屏、悬停模式下从左边缘拖回右半屏，全程为 `draggingPill`、形体为 pill、无内容，松手后吸附到新边缘并为 `tucked`；胶囊拖动全程为 `dragging`，松手后为 `expanded`。Swift 单测 396 项、SwiftLint、`swift format lint --strict`、Debug 构建通过。Figma：MP4 交互说明已同步。
  - 新建任务直接进入新任务界面（2026-10-08，按用户反馈）：主面板隐藏前停在其他页面（历史、应用、某个任务）时，迷你面板的「新建任务」原先先显示面板、再把 `task.new` 交给页面，第一帧露出上次的页面，下一帧才换成新任务。现在页面已就绪时，壳层只发 `task.new`、不显示面板；页面同步切到新任务（`flushSync`），等这一帧画出后（第二个 `requestAnimationFrame`）再经 `window.show` 显示面板。隐藏的面板保持 alpha 0、动画帧全速（临时 WKWebView 探针实测：alpha 0 时 `visibilityState` 为 visible、60 fps，改动约 29 ms 后画出），所以不会先露出旧页面；面板在其他桌面空间或最小化时文档为 hidden、不再出帧，此时立即显示。页面尚未就绪（首次加载、WebContent 重启）时面板照旧立即显示，请求在页面就绪后送达。`task.new` 与划词「问 Atd」共用 `nativeHeldRequest`，页面订阅前到达的请求留给第一个订阅者。无视觉变化，Figma 不需同步。
  - 展开与收起更具弹性（island-v1，2026-10-08，按用户要求「类似灵动岛」）：原先展开的过冲只有厚度约 2 %（0.8 pt）、长度约 4 %，收起几乎没有回弹。现在展开厚度 Spring(0.34, 0.36)、长度 Spring(0.42, 0.32)，先胀过静止尺寸（厚约 7 %、长约 5 %，8.5 pt）再落定；收起 +20 ms 长度 Spring(0.36, 0.26)、+50 ms 厚度 Spring(0.30, 0.24)，收进小胶囊时缩过头约 3 %（长 5 pt）再弹回。所有过冲都在 `overshootRoom` 12 pt 之内。内容时序、鼓起、邀请与放置卡片、命令卡片不变。
  - 无感性能（perf-v2，同日）：SwiftUI 对弹簧「已静止」的估计会让末尾不到 1 像素的摆动继续逐帧重绘玻璃数百毫秒。`MiniPanelAxisAnimation` 现在在剩余能量（距静止的距离与速度 / 频率的合成）所能造成的位移不超过 0.25 pt 时结束，最后一跳不到半个 Retina 像素。实测中发现：`glassEffect(in:)` 会把形状类型擦除为 `_AnyAnimatableData`，所以玻璃一直整体沿长度弹簧运动，只有裁剪与内容按两轴分开；该路径同样按变化量的模长套用静止规则。曾试过用可动画修饰器逐帧给玻璃新形状、让玻璃真正分轴，但主线程每帧多约 1 ms（玻璃形状经视图图更新，而不是由 SwiftUI 直接插值），未采用。实测（临时 SwiftPM 宿主驱动真实控制器，优化构建，旧版用 HEAD 的 worktree，各 15 轮取中位数）：展开结束 785 → 717 ms、主线程每帧 0.88 → 0.72 ms、每次动画主线程总量 68 → 56 ms；收起结束 601 → 573 ms、每帧 0.89 → 0.58 ms、总量 50 → 39 ms，弹性更强的同时总工作量下降约 17–21 %，无掉帧（p95 1.6 ms）。响应日志里的静止时间改用同一规则计算。Swift 单测 396 项、SwiftLint、`swift format lint --strict`、Debug 构建通过。Figma：编排图 A、B 道的弹簧条与标签（收起厚度条按代码改到 +50 ms）、内容随形状缩放条、MP1 / MP2 / MP7 / MP10 交互说明、原型映射，以及 21 个原型过渡（展开 223.80 / 20.35，收起 304.62 / 25.83）已同步。
  - 小胶囊可见度（pill-v2，2026-10-10，按用户反馈「能见度太低」）：6 × 44 的未着色玻璃在纯色窗口上几乎没有可折射的内容，白底上为 249（底 255）、深底上为 26（底 23），几乎看不见。现在静止的小胶囊与悬停鼓起在玻璃内加一层中性色调（标签色 20 %，增强对比度时 40 %；`MiniPanelChoreography.pillFillLevel`；先试的 40 % 用户反馈太重），由形体轮廓裁剪、逐帧随玻璃变形；它随展开以内容的离场时序（easeIn 0.08）退出，收起时 0.24 s 后才回来，胶囊、卡片、标签与拖放形体仍是纯玻璃。色调跟随玻璃背后的内容而非系统外观：宿主中系统深色与浅色两次运行结果相同，白底上为 207，深底（23）上为 67（40 % 时为 165 与 108）。Figma 两个 Tucked 变体的 Glass 内新增 Pill tone 层（变量 `glass/pill-tone`），组件说明同步。

### 已知差异

- Figma 不能渲染 Liquid Glass，以既有原生玻璃效果样式近似；分轴弹簧、内容延迟、按压与拉伸形变只在编排图中说明，原型每条连线用一组主弹簧。
- 实机合成后的玻璃外观（浅色、减弱透明度、增强对比度）未截图验证；120 Hz 未实测（最慢帧约 5 ms，在 8.3 ms 预算内）。
- 宿主经面板窗口事件入口合成的 8 次点击中，第 1 次没有执行（其余 7 次在松开后 4–16 ms 执行），原因未查明，实机是否会丢第一次点击未验证。小胶囊的点击已不经 SwiftUI 回放；胶囊按钮与命令行仍经回放。
- motion-v3 只在 1x 显示器上实测；Retina 上小胶囊仍为 6 pt（12 px），按同一采样规律不会盖不满像素块，但没有实机录制。主线程帧节奏用显示链接实测（60 Hz，两轮共 26 段动画，含全部带模糊的进出）：最长间隔 16.7 ms，没有超过 1.5 帧的间隔；模糊在 GPU 侧的开销没有单独测量，120 Hz 未测。

## 2026-10-06 自动化

依据 [自动化计划](plans/2026-10-06-automations.md) 的「管理界面」一节与同日实现（`apps/desktop/src/features/automations/`，代码为准）同步 Figma；文案按当前 `automations.json`（en）回读核对。本次只改 Figma 与本文档，未改代码。没有新建页面：组件放在 02 · App components 的新区块 32 · Automations (2026-10-06) (Figma `project/2336:138721`)，画面放在 01 · Product design 的新区块 AU · 自动化 · Automations (2026-10-06) (Figma `project/2365:119978`)。共享库未改动；Lucide 图标（zap、calendar-clock、folder-sync、workflow、play、ellipsis、circle-pause、loader-circle、timer-off、skip-forward、circle-check、circle-x、circle-minus、circle-stop、circle-slash、triangle-alert、circle-alert、history、check-check、message-square-text、command、folder、folder-x、folder-plus、square-arrow-out-up-right、pencil、copy、trash-2、x 等）以及 Item、Badge、Select、Input、Switch、Tabs、Dropdown Menu Item 都是共享库实例，没有分离或重绘。

| Figma 组件（节点）                                                                     | 代码对应                                                                                                                                          | 要点                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App / Automation status line · Rhea (Figma `project/2336:138737`)（`2336:138737`）     | `automation-row.tsx` 的 `useStatusLine`，`.automation-status-line`                                                                                | `Tone=Muted / Warning / Error`；12/16（App / Detail / Meta），可选 12px 图标。只显示第一条适用的状态：问题（Error，circle-alert）、运行中（loader-circle）、因多次失败已关闭（Warning，circle-pause）、一次性运行已完成、随全部自动化暂停；否则为「Next run … · Last run …: {结果}」，上次失败或超时整行为 Error，需要你时为 Warning                                                                                                                                                        |
| App / Automation row · Rhea (Figma `project/2341:139213`)（`2341:139213`）             | `automation-row.tsx`，`.automation-row*`，`open-row.css`                                                                                          | 与命令行同一行结构：Item sm outline，触发图标（calendar-clock / folder-sync / workflow）、名称与未读 Badge secondary「{n} new」、触发描述（单行 muted）、暴露的状态行；操作列固定为 Run now（Ghost icon-sm，play）、开关、More，间距 8。`State=Default / Hover / Focus` × `Layout=Wide / Narrow`（内容宽 ≤ 455 时操作换到第二行右对齐）× `Unread`。名称最大宽度绑定新集合 `App · Automation row` 的 `automation-row/name-max`，画框按窗口宽选模式（Settings 1280 / 1000 / 760 / 480 / 320） |
| App / Automation actions menu · Rhea (Figma `project/2342:138874`)（`2342:138874`）    | 行 More 的 `DropdownMenuContent align="end"`                                                                                                      | Edit（pencil）、Run history（history）、Duplicate（copy）、分隔线、Delete（trash-2，destructive，确认框为 App / Alert dialog · Rhea (Figma `project/1509:56033`)）；材质为 App / Popover surface · Rhea，每个菜单项是独立实例，宽 128（`w-max`，最小 8rem）                                                                                                                                                                                                                                 |
| App / Automation alert · Rhea (Figma `project/2343:138909`)（`2343:138909`）           | `packages/ui` 的 `Alert`；`automation-overview.tsx`、`status-notice.tsx`                                                                          | `Variant=Destructive`：概览上方的「Your automations couldn’t be read」及等宽细节，编辑页与运行记录上方的问题；`Variant=Default`：因多次失败已关闭（circle-pause）、一次性运行已完成（circle-check）                                                                                                                                                                                                                                                                                         |
| App / Automation run row · Rhea (Figma `project/2345:139252`)（`2345:139252`）         | `run-row.tsx`、`run-outcome.tsx`，`.automation-run-*`                                                                                             | `Tone=Progress / Warning / Error / Muted` × `Summary=Yes / No`；结果文字（Result ready、Needs you、Failed、Ran out of time、Skipped 等）后接 Badge outline「Late」与 primary「New」，回答开头两行截断，Reason、Detail、Files、Meta 为可选行；Open task 为 Small Outline，卡片窄时换到内容下方右对齐。布尔 `Show task deleted`：任务已被删除时，操作列显示「Task deleted」（12/16 muted），不显示 Open task                                                                                  |
| App / Automation kind tabs · Rhea (Figma `project/2346:139320`)（`2346:139320`）       | `trigger-fields.tsx`、`action-fields.tsx` 的 `Tabs`                                                                                               | `Selected=Schedule / Folder / Another automation / Prompt / Command`；页签是开启图标的 App / Tab trigger · Rhea                                                                                                                                                                                                                                                                                                                                                                             |
| App / Field error · Rhea (Figma `project/2349:139169`)（`2349:139169`）                | `features/commands/field-error.tsx`                                                                                                               | 16px circle-alert 与 13/20 destructive 文字，可换行；也用于保存失败和触发预览的问题                                                                                                                                                                                                                                                                                                                                                                                                         |
| App / Automation next runs · Rhea (Figma `project/2349:139180`)（`2349:139180`）       | `trigger-fields.tsx` 的 `TriggerOutlook`                                                                                                          | `State=List`（「Next runs」与最多五个时间，13/20）/ `None`（「No upcoming runs.」）；时间由服务计算                                                                                                                                                                                                                                                                                                                                                                                         |
| App / Automation folder choice · Rhea (Figma `project/2349:139236`)（`2349:139236`）   | `folder-trigger-fields.tsx` 的 `.automation-folder-choice`                                                                                        | `State=Chosen`（Change…）/ `None`（文字 muted，Choose folder…）/ `Unavailable`（folder-x 与「No longer available」为 destructive，Choose again…）                                                                                                                                                                                                                                                                                                                                           |
| App / Automation trigger section · Rhea (Figma `project/2353:140032`)（`2353:140032`） | `trigger-fields.tsx`、`schedule-fields.tsx`、`schedule-inputs.tsx`、`weekday-picker.tsx`、`folder-trigger-fields.tsx`、`chain-trigger-fields.tsx` | 「When it runs」：`Trigger=Once / Interval / Daily / Weekly / Monthly / Custom / Custom · problem / Folder / Folder · unavailable / Another automation / Once · in the past`。标题到页签 8、到面板 16，字段间 16，标签到控件 8；并列字段按 220px 最小列宽换行；其下为下次运行，或预览拒绝时的字段错误                                                                                                                                                                                       |
| App / Automation action section · Rhea (Figma `project/2354:139948`)（`2354:139948`）  | `action-fields.tsx`、`command-action-fields.tsx`                                                                                                  | `Action=Prompt`（提示词 Textarea 与说明；`Show prompt error`、`Show prompt note`）/ `Command`（命令 Select、输入文字与参数，参数用 App / Command field · Rhea）                                                                                                                                                                                                                                                                                                                             |
| App / Automation policy section · Rhea (Figma `project/2355:140182`)（`2355:140182`）  | `policy-fields.tsx`、`folder-list-field.tsx`                                                                                                      | 「How it runs」：权限档与说明、模型、Allowed tools 卡片（`Action=Prompt`）或「Runs use the command’s own tools.」（`Command`）、Use memory、Folders it can read、Stop after、Missed runs。布尔 `Folder unavailable` 显示已失效的文件夹行（folder-x 与标题为 destructive，Choose again… 在 Remove 之前，间距 8）和其下的字段错误，此时关闭 `Show folders note`                                                                                                                               |
| App / Automation results section · Rhea (Figma `project/2356:140052`)（`2356:140052`） | `delivery-fields.tsx`                                                                                                                             | Notify me 与说明（`Notify note`），以及「Pass on the previous result」开关行                                                                                                                                                                                                                                                                                                                                                                                                                |
| App / Automation editor fields · Rhea (Figma `project/2357:140072`)（`2357:140072`）   | `automation-editor.tsx`、`run-now-button.tsx`                                                                                                     | 编辑页滚动区的内容：状态提示、Name、四个分区（间距 24）与保存失败；`Show status notice`、`Show save failure`、`Show name error`。页脚沿用 App / Settings editor layout · Rhea：已保存且未改动时为 glass「Run now」，不能运行时为 50% 并用提示说明原因；有改动或新建时为「Save and run」；glass Cancel；实心「Save changes」或「Create automation」                                                                                                                                          |
| App / Automations list content · Rhea (Figma `project/2358:141629`)（`2358:141629`）   | `automation-overview.tsx`、`automation-list.tsx`                                                                                                  | 与应用列表相同的骨架：概览头部（搜索与「New automation」）、「Pause all automations」卡片、行列表；`State=List / Empty / Unreadable / No matches`                                                                                                                                                                                                                                                                                                                                           |
| App / Automation runs content · Rhea (Figma `project/2362:141348`)（`2362:141348`）    | `automation-runs.tsx`、`run-now-button.tsx`                                                                                                       | 二级页「Automations › {名称}」：标题为名称，描述为触发描述；工具栏 Edit、Mark all as read、Run now（不能运行时为 50% 加提示）；其下为状态提示、运行卡片与「The last 100 runs are kept.」；`State=Runs / Empty`                                                                                                                                                                                                                                                                              |
| App / Automation weekday menu · Rhea (Figma `project/2371:146698`)（`2371:146698`）    | `weekday-picker.tsx`                                                                                                                              | Weekdays / Weekends / Every day，分隔线后是按语言排序的七个勾选项                                                                                                                                                                                                                                                                                                                                                                                                                           |

已有组件的扩展：

- App / Settings sidebar (Figma `project/256:1024`)：所有变体在 Commands 之后加入 Automations（Lucide zap），文字绑定新变量 `Content/Settings navigation/Automations`（`VariableID:2334:118168`）；新增 6 个 `Tab=Automations` 变体（`2334:139488` 等）。顺序改为与 `settings-sections.ts` 一致，Apps 移到 Extensions 之前。Top 布局的 8 项在 640 宽时为 4 + 4，在 480 窗口中为 3 + 3 + 2，见 QA / Compact navigation 480 and 640 (Figma `project/1117:35920`)。
- App / Tab trigger · Rhea (Figma `project/1506:56298`)：新增 `Show icon`（默认关闭，现有实例不变）与 `Icon` 替换属性，16px 图标在标签之前。
- App / Task history row (Figma `project/1873:107460`)：新增 `Origin=Automation`（`2363:141286`，`task-origin-badge.tsx`），标题后为 Badge secondary（zap 与自动化名称）。
- App / History view menu · Rhea (Figma `project/1856:99653`)：分组新增「Started by」（`Group=Started by, Sort=Updated`，`2363:141131`，`history-view.ts`），分为 Automations、Apps、Started by you 三组。
- App / Command actions menu · Rhea (Figma `project/487:11060`)：Duplicate 之后新增「Automate…」（zap，`command-list.tsx`）与布尔 `Show automate`（默认开启；复用该菜单的记忆卡片菜单把它关闭）。

复用的项目组件：App / Settings window layout · Responsive（`1119:36110`）、App / Settings content header · Rhea（`1688:80719`）、App / Settings overview header · Rhea（`1181:38808`）、App / Settings editor layout · Rhea（`1093:34262`，含 App / Settings editor footer · Rhea `1093:34242`）、App / Settings card switch row · Rhea（`1968:113364`）、App / Settings action · Rhea（`907:17188`，含 Glass 与 Disabled）、App / Command field · Rhea（`410:1982`）、App / Textarea · Rhea（`352:1283`）、App / Icon button（`70:129`）、App / Popover surface · Rhea（`476:2600`）、App / Alert dialog · Rhea（`1509:56033`）、App / Empty（`1432:51204`）、App / Badge · Rhea（`2157:129211`）、App / Model config trigger · Rhea（`1545:58855`）。

画面（AU 区块，深色，英文）：

- AU1 设置 › 自动化：1280 (Figma `project/2365:119979`)、1000 (Figma `project/2365:120754`)、760 (Figma `project/2365:121170`)、480 (Figma `project/2365:121872`)、320 (Figma `project/2365:122532`)。内容宽 ≤ 455 时行切换为 Narrow，480 以下为抽屉。行覆盖下次运行、上次结果、运行中、因多次失败已关闭、问题、关闭、未读数与长名称。状态：More 菜单 (Figma `project/2368:146074`)、删除确认 (Figma `project/2368:146688`)、空状态 (Figma `project/2368:147248`)、无法读取 (Figma `project/2368:147473`)、无搜索结果 (Figma `project/2368:147703`)、320 抽屉打开 (Figma `project/2368:147944`)。
- AU2 编辑页：1280 (Figma `project/2370:123190`)、1000 (Figma `project/2370:124584`)、760 (Figma `project/2370:125229`)（456 以下字段堆叠）、480 (Figma `project/2370:125874`)、320 (Figma `project/2370:126485`)、760 × 480 短高 (Figma `project/2370:127352`)（正文滚动，页脚保留）。状态：新建 (Figma `project/2372:126320`)（默认每天 9:00 AM）、空字段错误 (Figma `project/2372:127351`)、Days 菜单 (Figma `project/2372:128099`)、文件夹触发与命令 (Figma `project/2372:128963`)、联动触发与因多次失败已关闭 (Figma `project/2372:130195`)、问题提示（模型不可用），Run now 不可用 (Figma `project/2372:131034`)、cron 过于频繁 (Figma `project/2372:131863`)、从命令新建 (Figma `project/2382:135809`)（Commands › More › Automate…，按 `draftFromCommand` 预填）、重新开启已结束的一次性自动化 (Figma `project/2389:135199`)（「That time has already passed.」，页脚为 Save and run 与 Save changes）。仅供评审：完整正文（每周） (Figma `project/2378:132365`)、完整正文（文件夹与命令） (Figma `project/2378:133206`)、全部触发变体 (Figma `project/2378:134220`)、可读文件夹已失效 (Figma `project/2387:134702`)（问题提示、Choose again…、Run now 不可用）。
- AU3 运行记录：1000 (Figma `project/2373:149920`)、760 (Figma `project/2373:150765`)、480 (Figma `project/2373:151342`)、320 (Figma `project/2373:151885`)（Open task 换到内容下方）、没有运行 (Figma `project/2373:152680`)、因多次失败已关闭 (Figma `project/2373:152949`)。运行行覆盖 Result ready（New）、Nothing new、Needs you（2 actions declined）、Failed（原因与细节）、Ran out of time（任务已删除）、Skipped（两种原因）与 Late。
- AU4 任务面板：自动化来源徽标 (Figma `project/2375:131938`)、排序与分组菜单 (Figma `project/2375:132366`)、按 Started by 分组 (Figma `project/2375:132169`)、320 (Figma `project/2375:132666`)。

原型：流程起点「AU · Automations: overview → editor, run history」设在 AU1.02。行打开编辑页，New automation 打开新建，More 打开菜单，菜单中 Edit、Run history、Delete 分别到编辑页、运行记录与删除确认；运行记录的 Edit 到编辑页；各页 Back 与 Cancel 回到概览；命令画面 06.07 (Figma `project/1152:32234`) 菜单中的 Automate… 到 AU2.14。

验证范围：

- 截图（常规尺寸）：状态行、行、操作菜单、提示、运行行、种类页签、触发、动作、运行策略、列表内容、运行记录内容与文件夹选择的组件集，以及 AU1.01–AU1.07、AU1.11、AU2.02、AU2.04–AU2.06、AU2.08、AU2.09、AU2.12–AU2.15、AU2.20–AU2.22、AU2.30、AU3.01、AU3.04、AU3.06、AU4.02、AU4.04；改动菜单后的现有命令画面（`1123:41994`、06.07）和 AP2 480（高度不变）。细节截图：失效文件夹行、文件夹选择三种状态、「Task deleted」行。
- 节点回读：AU 区块 6,791 个实例、组件区块 1,428 个实例，均没有丢失主组件；远程实例都来自共享 shadcn 库；没有分离实例，区块内没有重叠或残留节点。
- 代码在本轮同步期间又有修改，已按最新代码补齐：「Delivered」改为「Result ready」（组件，以及 5 个概览画面中的覆盖）、运行行「Task deleted」、失效文件夹行与字段错误、文件夹选择的颜色、编辑页 Run now 的不可用状态、AU2.15 与 AU2.22。
- 未核对：原生窗口与系统通知（未启动应用）、zh-CN、浅色外观。

已知差异：

- Figma 不能让自适应宽度的名称收缩：自动化行用 `automation-row/name-max` 按窗口宽近似；任务历史行的标题沿用 180 最大宽度，徽标不截断（代码中徽标最多占半行并截断）。
- 内容宽 456–640 时代码中行的间距为 8，Figma 只有 Wide（14）与 Narrow（8）两种。命令行在 Figma 中的操作间距为 4，这是既有差异，代码与自动化行为 8。
- 种类页签在 320 宽时被裁切，代码中可横向滚动；单列字段用 334 最大宽度近似 auto-fill 的一列。
- Days 字段画成 Select 外观（代码为外观相同的 ghost Button）；共享 Select 的值文字仍为 Geist；空状态的按钮沿用 Button - Nova 并覆盖圆角。
- 运行行的 Detail 画在 Reason 下一行，代码中接在原因之后、同一段落。
- 未画：浮动页脚的渐隐；toast（保存、开始运行、正在运行、任务已删除）；Run now 不可用时的提示气泡（只画了 50% 外观）；加载中与读取失败；运行中的运行行；存储无法读取时编辑页与运行记录中的 Run now；概览中「一次性运行已完成」的行，因此 AU2.15 没有来自行开关的原型链接；文件夹失效时概览中的触发描述；插件命令菜单里的 Automate…；权限请求范围「Save, delete or run an automation」（`tasks:permission.scope.automation`）；原生通知。
- 只画了英文与深色。导航文案变量只有 Default 模式，与 Apps 相同，中文「自动化」由渲染器提供。
- 既有问题，本次未改：窄宽度下设置概览头部的描述单行截断；抽屉布局子页面的面包屑显示为「…」；命令菜单没有 Remove shortcut 项。
- 往窗口布局的插槽里放内容时，要先在插槽外按目标宽度建好再放入，否则会留下旧的几何（裁切、重叠）。之后新增画面请沿用这个做法。

### 默认自动化「整理记忆」：Mac 空闲触发与整理记忆动作

用户决定（2026-10-06）：每个数据目录预置一个自动化「整理记忆 / Consolidate memory」，每天在 Mac 空闲时运行一次；随后用户更正为空闲 2 小时（`idleMinutes: 120`），新建的空闲触发仍默认 15 分钟。代码见 `trigger-fields.tsx`（第四个页签「Mac is idle」，在 Folder 与 Another automation 之间）、`idle-trigger-fields.tsx`、`action-fields.tsx`（「Consolidate memory」页签，Lucide brain）、`permission-fields.tsx`、`policy-fields.tsx`（空闲触发不显示 Missed runs）、`run-row.tsx`、`run-outcome.tsx`（空闲触发图标 Lucide monitor-pause）与服务的 `automations/defaults.ts`。文件中的编辑页已按分组显示（每组有标题与说明，Permissions 为独立分区 App / Automation permissions section · Rhea (Figma `project/2414:155702`)），新状态沿用这一结构。

组件（32 · Automations）：

| Figma 节点                                                                             | 改动                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App / Automation kind tabs · Rhea (Figma `project/2346:139320`)                        | 触发的三个变体在 Folder 后加入「Mac is idle」（monitor-pause），动作的两个变体在 Command 后加入「Consolidate memory」（brain），均为 App / Tab trigger · Rhea 实例；新增 `Selected=Mac is idle`（`2419:155764`）与 `Selected=Consolidate memory`（`2419:155805`） |
| Trigger=Mac is idle (Figma `project/2419:156259`)（`2419:156259`）                     | 「Idle for」（组件默认 15 minutes）与 Time zone 两个 Select 同行，其下为每天至多一次的说明；没有下次运行（服务无法预知空闲时间）                                                                                                                                  |
| Action=Consolidate memory (Figma `project/2419:156370`)（`2419:156370`）               | 说明改为「Runs work on your memory directly and don’t start a task.」，面板只有整理说明                                                                                                                                                                           |
| Permissions · Action=Consolidate memory (Figma `project/2419:156436`)（`2419:156436`） | 只有标题与「these settings don’t apply」说明，没有字段                                                                                                                                                                                                            |
| Run row · Tone=Progress, Summary=Full (Figma `project/2419:156472`)（`2419:156472`）   | 不开任务的运行（整理记忆）：摘要不截断，配合关闭 `Show open task` 使用；Meta 以来源开头（Mac idle、Run now）。memoryPaused 跳过用现有 `Tone=Muted, Summary=No` 加 Reason，图标覆盖为 skip-forward                                                                 |

另外：App / Automation row · Rhea 的 `Trigger icon` 对空闲触发用 Lucide / monitor-pause；How it runs 分区对空闲（与联动）触发关闭 `Show missed runs` 并把说明覆盖为「The model it uses and how long a run may take.」。以上组件说明已同步。为放下运行行的新列，运行行组件集加宽一列，其右侧的种类页签、Field error、下次运行与文件夹选择右移 760。Lucide brain（`3a08e847…`）与 monitor-pause（`bbfa5dd4…`）是共享库实例。

画面（AU 区块新增一行「AU5 · Default automation · Consolidate memory」，深色、英文，与现有画面一致）：

- AU5.01 概览 1000 (Figma `project/2419:156499`)：按名称排序，「Consolidate memory」排第一（monitor-pause，「Once a day, when the Mac has been idle for 2 hours」，开关打开，「Last run today 3:12 PM: Result ready」，无未读，整理的运行结算即已读）；其余行顺移一位，Run now 不可用状态随行移动。
- AU5 编辑页：1000 (Figma `project/2419:156507`)、480 (Figma `project/2419:156514`)、760 × 480 短高 (Figma `project/2419:156521`)、完整正文（仅供评审，1000 × 1460） (Figma `project/2419:156537`)。Idle for 为 2 hours；Permissions 只有说明；How it runs 无 Missed runs、Stop after 15 minutes；Results 为 When there’s something new，Pass on the previous result 关闭（与 `defaults.ts` 一致）。
- AU5.05 运行记录 1000 (Figma `project/2419:156528`)：Result ready（完整摘要，无 Open task）、Nothing new、Skipped（「Automatic learning is off, so memory wasn’t changed.」）、Ran out of time、Run now 触发的 Result ready、再一次 Skipped。
- 原型：AU5.01 第一行打开 AU5.02，AU5.02 的 Back/Cancel 与 AU5.05 的 Back 回到 AU5.01，AU5.05 的 Edit 到 AU5.02。

验证范围：截图检查新增的种类页签七个变体、三个分区变体、运行行 Full 变体、AU5 全部六个画面，以及受影响的既有画面 AU1.02、AU2.30（所有触发变体都显示四个页签）。回读 AU5 的 537 个实例与组件区块的实例，没有丢失主组件；远程实例来自共享 shadcn 库；AU5 内与 AU 区块边界内没有重叠。

已知差异：

- 默认项的 `apps/agent-service/src/automations/defaults.ts` 已同步为 `idleMinutes: 120`，与画面的 2 小时一致；新建空闲触发仍默认 15 分钟。
- 种类页签加宽后（触发 486、动作 391），除 320 外，480 与 760（内容宽 ≤ 445）的触发页签也被裁切；代码中可横向滚动。
- 只有一个 Stop after 时它占满整行，这是代码 `auto-fit` 网格的实际表现，Figma 照画。
- memoryPaused 跳过在代码中也有 `finishedAt`，Meta 显示「Took 0 sec」，Figma 照画。
- 未画：AU1 其余宽度与状态画面中的默认行；AU2.30 没有空闲触发列；中文画面（「整理记忆」「每天一次，在 Mac 空闲 2 小时后」）；Run now 的「Run started; its result shows in the run history.」toast；空闲触发的预览错误。
- 本轮期间文件中的 App / Automations list content · Rhea 被他人同时改动（「Pause all automations」改为页脚的药丸开关），AU5.01 随组件继承，未单独核对该改动。

## 2026-10-06 设置内容头部窄宽度下的标题截断

用户在浏览器渲染的设置窗口中发现：320 宽（抽屉布局）时，头部右端的语言选择器像是盖在面包屑上，「Permissions」「Automations」被切在药丸下面。

原因：几何上并不重叠，标题框止于 240px，语言控件从 244px 开始。分区名是 `li` 里的裸文字，而 `li` 是 flex 容器，`text-overflow: ellipsis` 管不到其中的匿名 flex 项，文字在 4px 间隙前被硬裁成半个字形，看上去像压在药丸下面；同时 320 宽时标题只剩 48px。

| 归属                          | 改动                                                                                                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings-content-header.tsx` | 分区名与子页标题一样包一层 `span`，由 `.settings-breadcrumb li > span` 在自身宽度内省略                                                                                                                    |
| `settings.css`                | 面包屑左右各 4px 外边距，与两侧控件相距 8px（同组控件间距的两倍）；抽屉布局（< 480px）的语言控件只保留图标，隐藏值与 `SelectTrigger` 追加的 chevron，成为 32px 正方形（保持触发器 32px 高），标题多出 32px |

Figma：App / Settings content header · Rhea (Figma `project/1688:80719`)（`1688:80719`）四个变体的 Breadcrumb 补上右侧 4px 内边距；两个 `Layout=Drawer` 变体里的共享 Select 实例隐藏 Right Decoration，左右内边距改绑与上下相同的 `spacing/out-of-scale/1,5`（6px），成为 32 × 32；顺带修复其右下角残留的 10px 圆角（解绑后重新绑定 `radius/control`，四角均为 18）。组件说明已同步。303 个实例（Default 121 + 131，Drawer 21 + 30）回读均已继承，没有覆盖阻断；320 宽的消费者（Permissions 抽屉关闭 `1420:50665`、AU1 320 `2365:122533`）中面包屑 x 188、宽 84，标题 76，语言控件 x 276、32 × 32，与代码测量一致。

验证范围：

- 代码：独立的 Vite harness（`apps/desktop/.artifacts/settings-header/`，端口 5293，桩出 `window.desktop`，不连接用户的 `pnpm dev` 与 Debug App），在 Chromium 与离屏的系统 WKWebView 中测量 320 / 400 / 479 宽的 en 与 zh-CN（Permissions、Automations），另测 320 子页（New automation／新建自动化）、480 与 760。均无重叠，头部 52px；英文 320 宽时标题 76px 并带省略号（「Permissi…」「Automati…」），400 与 479 完整显示；中文全部完整。焦点环、展开的语言列表、Escape 回焦，以及在抽屉里搜索「language」后高亮语言控件均正常。
- 定向 oxfmt 与 Oxlint、`pnpm --filter @atd/desktop typecheck`、渲染设置窗口的 4 个测试文件（30 个测试）通过。
- 未核对原生窗口合成：用户的 Debug App 正在运行，`pnpm dev` 会覆盖 `~/Applications/Atd Dev.app`，因此没有启动。本次只改页面布局，不涉及窗口材质。

已知差异：

- 英文长分区名在 320 宽时仍会截断（「Automations」需要 86px，可用 76px），完整名称见 `title` 提示与抽屉中的当前分区。
- 抽屉布局的子页面中，代码让分区名先收缩到 0；Figma 的 `Depth=Sub-page, Layout=Drawer` 仍以固定 14px 的「…」表示上级，所以 320 宽时子页标题在 Figma 中约 38px，代码中为 52px。

## 2026-10-06 自动化：用 AI 创建与编辑

用户要求「项目的自动化功能需要参考 command 功能，允许 ai 创建和编辑」。命令编辑页页脚的「Create with AI / Edit with AI」会在任务面板开一个由 `create-command` 技能预填的新会话；自动化此前只有 Agent 的 `automation` 工具，没有入口与技能。现在自动化编辑页提供同样的入口：面板新会话的草稿带 `create-automation` 技能芯片，编辑时再附「Update the automation "{名称}" (id: {id}): 」，Agent 用 `automation` 工具保存，每次保存仍由用户确认。

| 归属                                                                                                                        | 改动                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `automation-editor.tsx`、`automations.css`                                                                                  | 页脚前导组 `.automation-editor-tools`：glass「Create with AI」（新建）或「Edit with AI」（已保存，Lucide sparkles），其后为 Run now / Save and run；Cancel 与保存仍在尾部，放不下时换到右对齐的第二行 |
| `use-automation-ai-session.ts`、`native-settings.ts`、`native-host/index.ts`、`use-seeded-sessions.ts`、`extension-seed.ts` | 设置窗口用 `automationSession` 窗口消息把 `{ id, name }` 或 `null` 交给面板，面板据此预填草稿；会话工具为 read 与 command（查找自动化要运行的已保存命令）；技能在扩展中被关闭时只提示开启             |
| `tool-copy.ts`、`automation-call.ts`                                                                                        | 对话中 `automation` 工具的行按操作显示（List automations、Create automation、Turn on automation 等），图标为 zap，目标为保存时的名称，否则为自动化 id                                                 |
| 服务 `product-skills/create-automation`、`automations/tool.ts`                                                              | 新的内置技能；工具新增只读的 `context`（当前时间、Mac 的时区、本对话附加的文件夹及其 id），让 Agent 写得出计划与文件夹触发                                                                            |

Figma：

- App / Settings editor footer · Rhea (Figma `project/1093:34242`)（`1093:34242`）：新增布尔 `Show AI and leading action`（默认关闭，现有实例不变）与独立的「AI and leading action slot」（`2403:154940`）。槽内是两个暴露实例，均为 App / Settings action · Rhea Default Glass：「AI with leading action」（`2401:154880`，Lucide / sparkles，Edit with AI 或 Create with AI）与「Leading action with AI」（`2403:154941`，默认 Lucide / play「Run now」），间距 8。该槽与两个单按钮槽一样 Fill，最小宽 234（英文 Edit with AI + Run now），放不下时 Cancel/Primary 换到右对齐的第二行。Figma 不能在实例中覆盖最小宽度，而 144 的单按钮槽还供记忆页的 Delete memory 使用，所以另设此槽。组件说明已更新。
- AU2 的 18 个编辑页页脚改用新槽（关闭原 Leading action 槽），Run now / Save and run 的文字、图标、状态与 50% 不透明度原样迁移：已保存的 15 个为「Edit with AI」，新建的 AU2.07 (Figma `project/2372:126320`)、AU2.08、AU2.14 为「Create with AI」。480 (Figma `project/2370:125874`) 与 320 (Figma `project/2370:126485`) 换为两行（72 高），760 仍为一行。
- QA · Footer leading AI action (Figma `project/1573:61953`) 增加 700 与 424（换行）两例（glass Cancel、Save changes）；所在区块「09 · Shared settings layouts」向下扩展以容纳，与「10」区块相距 63px。

验证范围：

- Figma：截图 AU2.02 整帧，AU2.02、AU2.03、AU2.04、AU2.05、AU2.07、AU2.12 的页脚与 QA 面板。回读 168 个页脚实例：开启新属性的正好是这 18 个，且都没有同时开启 Hint、AI action 或 Leading action；其余实例的新槽隐藏，布局不变。
- 代码：独立的 Vite harness（`apps/desktop/.artifacts/automation-ai-session/`，端口 5294，桩出 `window.desktop`，不连接用户的 `pnpm dev` 与 Debug App），在浏览器中测量 1000 / 760 / 480 / 320 宽的英文与 1000 宽的中文。前导组 229、尾部组 198；1000、760、480 为一行，320 换为两行且尾部右对齐。点击 Edit with AI 交出 `{ id, name }`，Create with AI 交出 `null`，并提示已打开会话；技能关闭时只提示开启。面板侧的预填草稿、会话工具、目标校验与对话行文案在同一页面中按模块核对。
- 类型检查、Oxlint、桥 schema 检查、桌面 Vitest（16 个文件、77 个测试）与服务中自动化及文件夹相关的 19 个测试通过。
- 未核对：原生窗口，以及面板中真实的跨窗口会话（用户的 Debug App 正在运行，没有启动第二个实例）；浅色外观。

已知差异：

- 480 宽时 Figma 编辑页的内容宽为 424，代码为 448（既有内边距差异），所以 Figma 页脚换行而代码仍为一行。
- 槽的最小宽按英文「Edit with AI + Run now」（234）设定；「Create with AI + Save and run」为 283，新建页只画了 1000 宽，更窄时 Figma 会裁切而代码会换行。页脚组间距 Figma 为 8、代码为 12，是既有差异。
- 未画：面板中由 `create-automation` 预填的草稿，以及对话中 `automation` 工具的行（与命令、记忆相同，复用现有的输入框与活动行组件）；toast。

## 2026-10-06 欢迎指南：应用、自动化与迷你面板合并为「更多功能」

用户要求（2026-10-06）：把欢迎指南中的应用、自动化、迷你面板三个功能合成一个类似 features 的引导页；项目暂无用户，不考虑向后兼容；左侧内容区不能出现滚动条，文案可以减少，允许卡片布局。随后两次更正：卡片高度不一致，要用最佳方案优化；插图中迷你面板所在区域（窗口右侧单独漂浮的竖条）显得突兀。

代码：第 6 步由 `apps` 改为 `features`（`onboarding-types.ts` 的 `ONBOARDING_STEPS`：欢迎、快捷键、划词工具栏、截图、AI 提供商、更多功能、准备就绪，仍为 7 步）。这一步只做介绍，不在 `GOAL_STEPS` 中：主按钮为「继续」，有「返回」，没有「稍后」，不会创建应用或自动化，也不向模型发送任何内容。`step-apps.tsx`、`art-apps.tsx`、`art-apps.css`、`lights/apps.ts` 改为 `step-features.tsx`、`art-features.tsx`、`art-features.css`、`lights/features.ts`；文案键 `apps.*` 改为 `features.*`，步骤名为「更多功能 / More features」。共享库未改动，Lucide 图标都是共享库实例，没有分离或重绘。

| Figma 组件（节点）                                                                                                                                  | 代码对应                                                          | 要点                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App / Onboarding feature card (Figma `project/2426:162158`)（`2426:162158`，新增）                                                                  | `step-features.tsx`；`steps.css` 的 `.guide-features`             | 一张设置卡片（Card sm：圆角 24、`card/surface`、`card/ring` 描边、Rhea / Shadow sm）内一行 Item sm（内边距 12 / 14 加 1px 透明边框，间距 14）：16px 图标顶对齐并下移 2，标题 Rhea / Item title，描述 ATA/Body、`muted-foreground`。属性 Title、Description、Icon（实例替换）。                                                                                                                                                                                                                                                                                                          |
| App / Onboarding controls · Step=Features (Figma `project/2261:133432`)（`2261:133432`，原 Step=Apps）                                              | 同上；文案为 `locales/*/onboarding.json` 的 `features.*`          | 标题「Atd 不止于此」，描述「还有三种用法，随时都能派上用场。」；三张卡片间距 8：app-window「应用」、zap「自动化」、panel-right「迷你面板」，每张一句说明。代码中列表为 `grid-auto-rows: 1fr` 的网格，三张卡片总与最高的一张等高，内容顶对齐（标题距卡片顶 13），描述 `text-wrap: pretty`；Figma 没有网格自动布局，等高来自中文三行说明都只占一行。旧的「使用方式」标题、五行卡片与脚注已删除（`2263:133511`、`2261:133433`、`2263:133512`）。                                                                                                                                           |
| App / Onboarding hero · Step=Features (Figma `project/2273:132989`)（`2273:132989`，原 Step=Apps）                                                  | `art-features.tsx`、`art-features.css`；光效 `lights/features.ts` | 186 × 100u 的场景（u = 1.53 时 284.58 × 153）。应用窗口 146 × 80 位于 (9, 9)，圆角 9，清单左内边距 16；迷你面板胶囊 18 × 46 位于 (0, 34)，半压在窗口左边缘、居中于窗口正文，三个 7u 的 square-pen、camera、command（`muted-foreground`），无选中态；自动化卡片 60 × 50 位于 (126, 50)，圆角 13，14 的 `syntax/variable` 圆底 zap、名称与时间两条，时间线 34 × 2，三个 8 的刻度在 x 135 / 152 / 169，前两次运行已完成；sparkle 18 位于 (146, 0)。胶囊与卡片沿用原小组件的凸起面（`secondary`、`border`、内侧顶部高光与 0 / 4u / 12u 黑 45% 阴影）。原图表小组件已删除（`2276:132991`）。 |
| Onboarding · 6 More features · 1120×780 (Figma `project/2302:136857`)（`2302:136857`）、堆叠 720×780 (Figma `project/2302:137018`)（`2302:137018`） | `onboarding-steps.tsx` 的 `features` 分支                         | O1 中第 6 步的两张画面改名并换为 Features 变体：页码 Step=6，页脚为返回与「继续」，插图分别按 1.656 与 1.108 缩放，均不被裁切。                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

光效（只在代码中）：沿用应用窗口的描边光，sparkle 处分为暖、冷两半；胶囊与卡片为不透明面，光在其后熄灭，两者的边缘按所在半边的颜色略偏青白地亮起，光笔经过时变亮。`u_spark` [62, 41]、`u_window` [−11, 1, 73, 40]、`u_card` [63, −25, 30, 25]、`u_capsule` [−84, −7, 9, 23]（art 单位，自场景中心，y 向上）、`u_pass` [12, 40]。两段 CSS 循环：清单末行反复写出（6 s），自动化的下一次运行按时到来并完成（7.2 s）；减弱动态效果下为静帧（清单写完、两次运行完成、第三次待运行）。

验证范围：

- 左栏：在系统 WKWebView 中渲染真实的 `OnboardingCard`（桩出 `window.desktop`）并测量。1440 × 900、1280 × 800、1147 × 745、1024 × 665、1024 × 640 并排与 790 × 900 堆叠时，en 与 zh-CN 的正文溢出都为 0；三张卡片等高（69，英文在 1024 宽时说明换行为 89），标题距卡片顶都为 13。英文在 1024 × 600 与 1024 × 576 这类非标准尺寸下溢出 11 / 35，交给正文原有的滚动区；中文为 0。
- 插图：在全尺寸侧栏（633.6 × 764）、1024 × 640 的侧栏（541 × 512）与堆叠条（704 × 226）中检查过，包括减弱动态效果的静帧；光效 uniform 与 CSS 几何的偏差在 0.01u 以内。
- 检查：`pnpm --filter @atd/desktop typecheck`、渲染器 lint（含桥 schema 检查）、定向 oxfmt 与桌面 Vitest（16 个文件、79 个测试）通过。
- Figma：变体与两张画面都用 get_screenshot 核对；每张画面 35 个实例，没有缺失或分离，Lucide 实例都连接共享库。

已知差异：

- 卡片在 Figma 中高 70，代码中为 69：Rhea / Item title 的 19.25 行高在 Figma 中按 20 计，文件中其他 Item title 相同。
- 英文说明换行后的 89 高卡片没有画；卡片描边在 Figma 中画在内侧，代码的 ring 在外侧，与同节其他卡片相同。
- 代码中 zap 与 sparkle 为实心，共享库实例不分离就无法填充，Figma 保留轮廓；插图实例缩放时 1px 描边与 1.5px 圆环随之放大（并排约 1.66px），所有主视觉都如此。
- 窗口填充在 Figma 中用 `card/surface`（白 6%）对应代码的 `foreground` 6%；凸起面的阴影颜色按键帽与原小组件的先例写死。
- 只画了 zh-CN 与深色；光效、循环、第二段运行线与第三个刻度的填充只在代码中。

### 开场页流光文字：斜向级联与感知曲线

用户反馈（2026-10-06）：英文开场页的流光文字顺序错乱，没有从左到右，其他语言没有这个问题。原因：`hero-flow-text.tsx` 按字在文本中的序号排定出现时间。英文标题换成两行、描述换成多行，光写到行尾就跳回下一行左端；描述在 4.8 s 开始，早于标题在 5.5 s 写完，几行的左端交替亮起。中文字少、行短，同样的跳回不明显。第一版修复按字的横向位置排时，两行同时从左到右写出；用户认为两行同时太突兀，要求最佳曲线与方案。

现方案（时间轴 `INTRO.titleAt`、`titleFor`、`descriptionAt`、`descriptionFor` 不变）：

- 斜向级联：字体加载后测量每个字（字素）的位置，按顶边分行。每行从左到右写，下一行在上一行的光走过行宽 40% 时开始（`ROW_LAG`），整段像一道斜向的光从左上流到右下。描述在 4.8 s 开始时，标题第二行的光正好在约 40% 处，所以描述自然接上同一道斜线。
- 光的行进曲线：位置对时间为 CSS 的 `ease`（`TRAVEL_EASE` [0.25, 0.1, 0.25, 1]），起步速度为平均速度的 0.4，之后平稳减速落定；每个字的出现时刻是这条曲线的反函数。帧序列对比了三种：页面基准 `S`（正弦缓入缓出）起步过慢，首字独自停留约 0.3 s，再与每个字自身缓慢的出现叠加；`RISE_EASE`（减速三次）起步过快，前几个词几乎同时出现，结尾拖长；`ease` 两端都自然。
- 光晕随字落定：每个字仍按 `EMERGE_EASE` 用 0.5 s 出现，光晕在出现进行到 80% 时才开始消退（原为 40%，那时字只有约 4% 不透明，光晕在看见之前就褪了一大半），用 1.1 s 按新的 `FADE_EASE` 消退。`FADE_EASE`（`onboarding-motion.ts`）是 `EMERGE_EASE` 的镜像：黑底上不透明度为 a 的光被看作 a 的立方根，要沿 `S` 褪去，完成比例为 1 − (1 − S)^3，拟合为 [0.49, 0.44, 0.14, 1]（误差 0.035 以内；同一拟合方法复现 `EMERGE_EASE` 为 [0.86, 0, 0.51, 0.56]）。原来的 `easeOut` 与这条目标最多差 0.19，中途还剩 31% 的不透明度、看上去仍有 68% 亮，所以显得先拖后断。
- 光的颜色按字出现的时刻取，光一路由珊瑚经桃色冷却到边缘的青白。字在测量前保持隐藏；减弱动态效果下仍显示普通文本。开场页不在 Figma 中，没有需要同步的节点。

验证：在 1440 × 900 的 WKWebView 中每 100 ms 统计一次沿斜向路径的逆序字对（已出现的字在路径上位于未出现的字之后），英文与中文的标题、描述全程为 0；修复前按横向位置统计，英文标题最多 138、描述 1145，中文为 36 / 124。另以约 30 帧每秒、带真实时间戳的帧序列录制了中英文两段视频，并逐帧检查起步、两行交叠与结尾落定。
