# SETTINGS-WINDOW — 设置 spec（P2 · v3 改内置方案）

> **状态（2026-09-03）：已实现**（v3.1 全量落地后又经 f53f2a5 重构）。现行实现：`frontend/src/components/SettingsPage.tsx` + `settings/controls.tsx` + `settings/SettingsRows.module.css`，与主界面同源（--ink/--line/--fill 语义变量 + 统一弹出配方），分类为 通用/模型/Agent 预设/插件/快捷键/已归档的聊天/数据。下文提到的 `SettingsRoot.module.css`、`settings/models/`（mux 传输层）已在重构中删除——mux/wire 逻辑并入 `api.ts`（`callRaw`/`probeMethod`）。本文保留为数据层契约（describe/mutate/credentials、revision 围栏、冲突两选一、能力探测降级）。
> 工程流 B。目标：提供模型/审批/快捷键/外观/通知/数据六分区设置。
> **v3 形态变更（用户拍板 2026-08-31）**：独立原生 AppKit 窗口方案（v1/v2）试作后废弃——面板风格与主界面割裂、不可收敛。现行形态为 **WebView 内浮层**：复用官方 dsh `ui-settings-general` 的面板外壳（mask + 800px panel + nav rail，CSS 原样拷贝于 `frontend/src/settings/SettingsRoot.module.css`）与 `ui-settings-models` 的行/卡片/按钮类（`SettingsRows.module.css`），token 驱动自动继承主窗暗玻璃；数据层走前端 same-origin RPC（`settings.describe/update/mutate`、`credentials.*`、能力探测），revision 围栏与两选一冲突恢复保留。
> 原生侧职责收缩为桥指令（§3.1）：`restart-engine`/`rebind-hotkey`（录制窗）/`set-pref`/`set-theme`/`get-prefs`/`reveal-home`/`open-host-doc`，及 `prefs`/`hotkeyChanged` 回推；原生设置窗口三文件已删除。
> 快捷键/通知/悬浮球等纯原生开关经桥读写 UserDefaults（DSHAppPrefs/FloatingBubbleManager）；凭据配置后 `restart-engine` 保持 §4.4 冷启动闭环。
> **v3.1 分区扩展（2026-08-31，对齐官方全功能）**：分区在六分区基础上增加 **预设**（Agent 预设列表+设为默认；复制/删除按引擎端点探测降级）与 **插件**（inventory 端点探测，不可用则明示）；模型分区完整移植官方 `ui-settings-models`（自定义 Provider 增删改/协议选择/模型发现/DeepSeek 多模型编辑/Key 管理，`frontend/src/settings/models/`），并保留 SPEC §4.2 降级——rc.2 无目录端点时自动回退"默认模型+目录点选+Key"精简页；数据分区提供**任意命名空间原始 JSON 编辑**（§3.2 diff→ops + revision 围栏 + 冲突两选一）。
> **wire 移植说明**：前端 `api.ts` 统一按 Typert 描述符参数名打包（`settings/models/wire-params.json`，自 pinned 引擎描述符提取，26 方法），HTTP（斜杠 endpoint + `{args}`）与 mux 双传输自动探测。预设分区接官方端点 `agentPreset/list|copy|deletePreset`（探测降级）；插件分区接 `pluginInventory/list`（真实清单，只读）。
> **会话历史移植**：alpha.2 移除 `session/history`/`events.mux`，会话视图改接 **`session/follow` 流**（首帧 snapshot=历史+cursor，后续帧=实时事件）与 **`session/page` 翻页**（`session/models`/`llm/models` 同批移除，模型选择统一走 `session/modelCatalog`）。实现：`settings/models/mux.ts` 的 `sessionFollow/sessionHistoryPage`，SessionView 数据源切换。

---

## 1. 形态

- **独立原生窗口**（不是 modal/侧栏）：新增 `SettingsWindowController`（AppKit），或 SwiftUI `SettingsView` 承载于原生窗口。尺寸 480×600；左导航 160 + 右内容。
- 内容渲染：两种可选，按"是否复用 @dshmini/design React 组件"取舍：
  - **A. WKWebView 渲染设置入口 SPA**（复用 React 设计系统；黑白 token 直接复用）。
  - **B. 原生 AppKit/SwiftUI 控件**（对齐 `UI-SPEC §5`“原生侧仅系统控件 + NSVisualEffectView”）。
  - 推荐：**原生窗口 + 原生控件（B）** 为主，符合 spec；引擎动态数据（模型/凭据/命名空间）经设置 RPC 读取。若某分区复杂度高（模型目录、provider 增删）再考虑 WKWebView 局部渲染。
- 窗口外观：`NSVisualEffectView`（material `.sidebar`/`.hudWindow`，`.behindWindow`）透明玻璃；黑白。

## 2. 左导航分区（UI-SPEC 6 分区全做）

| 分区 | 数据来源 | 内容要点 |
|---|---|---|
| **模型** | 引擎 `llm-deepseek`/`llm-pi-ai` + `credentials` + `llm.models`/`llm.discoverModels`/`llm.providers` | **折叠卡片式**（2026-09 定稿）：按提供方聚类的可折叠分组（单色反白 logo），模型行内联 Meta 胶囊（推理/模态/上下文窗口）；增删改走 `ModelDialog` 弹窗（提供商 + Key + 模型三段渐进表单，**模型留空 = 按 API 自动发现全部支持模型**，无目录的自定义新提供方由引擎拒绝并内联提示）；行内「测试连通」（pi 走发现探测、DeepSeek 无发现路由退化为密钥状态检查）。实现：`settings/ModelsManage.tsx` + `settings/ModelDialog.tsx`（旧 `settings/models/` 平铺编辑器已删除） |
| **审批** | 引擎 `permission.defaultPreset` + 审批/交互 | 默认权限与当前会话权限分别管理；完整访问需确认（对齐参考项目/`D5` 原生审批） |
| **快捷键** | DSHmini 原生 `HotKeyManager` + `UI-SPEC §2.3` | 分两类：**全局热键可修改**（现状仅 1 个：唤起面板 `⌥Space`，经 `HotKeyManager` 注册/注销重注册）；**应用内快捷键仅展示、不可改**（`⌘,`/`Esc`/`Enter`/`@`/`/`/`Tab`，清单以设置页与 `UI-SPEC §2.3` 为准、未实现的键一律不列，不提供自定义——三套机制混改无收益） |
| **外观** | 外壳偏好 `deepdive.ui.appearance`（跟随系统/亮/暗）+ 外壳 `themeEnabled` | 三态联动：外壳刷新 `NSAppearance`/材质；**WebView 侧联动走 `SPEC-NOTIFICATIONS §3.1` 外壳→前端通道**（`themeChanged` 指令）；黑白 token 统一 |
| **通知** | DSHmini 原生（`UNUserNotificationCenter` 开关） | 回合完成提醒 / 待审批·提问提醒（默认开）；悬浮球开关（默认开，`SPEC-NOTIFICATIONS §2.4`，开关仅显隐、状态图标不受影响）；菜单栏状态图标不受开关影响 | 
| **数据** | 引擎 会话/工作区 + `settings.openDocument` | 打开 `settings.yaml`、存储位置（`DSH_HOME`）、会话管理（归档/删除需确认） |

## 3. 通用编辑机制（一切命名空间）

### 3.1 读取
- `settings.describe`（`redactSecrets`）：得到每个命名空间的 `schema/value/base/user/revision/secrets`。UI 只渲染 `value`（已脱敏，`role('secret')` 字段已被结构移除，仅以 `secrets:[{path,set}]` 枚举）。
- **namespace 清单动态渲染、不写死**：分区 UI 以 `describe` 返回的 `namespaces`/`schema` 驱动；本 spec 提到的 `llm-deepseek`/`agent-default-model`/`llm-pi-ai`/`web-search-deepseek`/`ui-theme.preference`/`permission.defaultPreset` 等名均为引脚版本实测值（`PITFALLS §7.3`），引擎升级后以 `describe` 实际返回为准（配合 `SPEC-ENGINE-RUNTIME §4.2` 能力探测）。

### 3.2 编辑与保存（diff → path ops）
- 编辑器把某个命名空间的当前 `value` 作为可编辑 JSON 文本显示。
- 保存时**diff 编辑结果 vs 打开时快照**，只提交用户改到的路径集，作为**带 `expectedRevision` 的 `settings.mutate` ops**（`set`/`unset`）。
- `role('secret')` 字段在 diff 中**永远不出现**（两端都无），所以根本不会写回，避免误删密钥；密钥写入走 `credentials`（见 3.3），不作为普通设置字段明文写。

### 3.3 凭据
- `credentials.describe(refs)` 读取某引用（如 `DEEPSEEK_API_KEY`）是否已配置（`configured`/`source`/`writable`）。
- `credentials.set(ref, value)` / `credentials.unset(ref)` 写/删。UI 给"只写输入 + 已配置状态点"（不读回密钥明文）。
- **冷启动闭环**：配置成功时若引擎因缺凭据处于 `failed`，触发 `EngineSupervisor.start()` 自动重启引擎——接通 `SPEC-ENGINE-RUNTIME §4.4`，替代"手动复制 `.credentials.yaml`"的老路径。

### 3.4 冲突恢复
- 保存收到 `settings/conflict`（revision 已前进）：两选一——"放弃修改，载入最新" / "保留修改，基于最新版本重试"（对齐参考项目）。绝不静默覆盖。

## 4. 入口

- 侧栏底部「设置」行改 `<button>`，`onClick` 打开设置窗口。
- 菜单栏 `StatusItemController` 增加「设置…」；`⌘,` 唤起（对应 `UI-SPEC §2.3` 键盘映射）；`SPEC-SEMANTICS §7` 引导卡折叠进设置窗口。

## 5. 文档一致性说明

- `UI-SPEC §3.3` 6 分区（模型/审批/快捷键/外观/通知/数据）为准；`SPEC-SEMANTICS §6/§8` 的"附件路由/审批策略/角色名单"并入对应分区（模型/审批）或作子项，不单列分区。

## 6. 文件变更（实现起参考）

| 文件 | 变更 |
|---|---|
| `apps/macos/Sources/DSHminiApp/SettingsWindowController.swift` | 新增（原生窗口壳） |
| `apps/macos/Sources/DSHminiApp/...`（原生设置控件/视图） | 各分区视图 + 命名空间编辑器 + 凭据区 |
| `apps/macos/Sources/DSHminiApp/AppDelegate.swift` / `StatusItemController.swift` | 接入设置入口 |
| `apps/macos/Sources/DSHminiApp/MainWindowController.swift` | WebView 挂 `__deepDiveHost` 钩子 + `evaluateJavaScript` 注入（`themeChanged` 等，见 `SPEC-NOTIFICATIONS §3.1`） |
| `frontend/src/api.ts` | 加 settings/credentials 通道 + 能力探测（若设置内容部分走 WebView） |
| `frontend/src/components/Settings*.tsx` | 如需 WebView 渲染则新增设置入口 |
| `frontend/src/theme.css`（+tokens） | 设置样式 + 明/暗（若走 WebView） |

> 不加 `.cursor:pointer`、不加 hover 高亮、无强调色；键盘焦点黑白 2px 环（`UI-SPEC §4`）。
