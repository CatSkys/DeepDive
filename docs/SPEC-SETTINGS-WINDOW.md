# SETTINGS-WINDOW — 原生设置窗口 spec（P2 · 待确认）

> 工程流 B。目标：落实 `UI-SPEC §3.3` 的**独立原生 480×600 设置窗口**，左导航 160，6 分区全做，黑白灰阶、token 单一来源。
> 参考：`luochenw/deepseek-harness-macos` 的 `DSHSettingsView.swift`（左导航+右内容）、`DSHSettingsEditor.swift`（命名空间通用编辑 + revision 冲突恢复）、`DSHSettingsMutate.swift`（path ops）、`DSHHostProtocol`（settings/credentials 端点）。

---

## 1. 形态

- **独立原生窗口**（不是 modal/侧栏）：新增 `SettingsWindowController`（AppKit），或 SwiftUI `SettingsView` 承载于原生窗口。尺寸 480×600；左导航 160 + 右内容。
- 内容渲染：两种可选，按"是否复用 @dshmini/design React 组件"取舍：
  - **A. WKWebView 渲染设置入口 SPA**（复用 React 设计系统；黑白 token 直接复用）。
  - **B. 原生 AppKit/SwiftUI 控件 + `Tokens.swift`**（对齐 `UI-SPEC §5`“原生侧仅系统控件 + Tokens.swift + NSVisualEffectView”）。
  - 推荐：**原生窗口 + 原生控件（B）** 为主，符合 spec；引擎动态数据（模型/凭据/命名空间）经设置 RPC 读取。若某分区复杂度高（模型目录、provider 增删）再考虑 WKWebView 局部渲染。
- 窗口外观：`NSVisualEffectView`（material `.sidebar`/`.hudWindow`，`.behindWindow`）透明玻璃；黑白。

## 2. 左导航分区（UI-SPEC 6 分区全做）

| 分区 | 数据来源 | 内容要点 |
|---|---|---|
| **模型** | 引擎 `llm-deepseek`/`agent-default-model`/`llm-pi-ai`/`web-search-deepseek` + `credentials` | 官方/自定义分区、各管各的 key 与模型；当前使用摘要；点某模型即选用；添加/删除 provider（**能力探测 `llm.listProviders` 可用才显示**） |
| **审批** | 引擎 `permission.defaultPreset` + 审批/交互 | 默认权限与当前会话权限分别管理；完整访问需确认（对齐参考项目/`D5` 原生审批） |
| **快捷键** | DSHmini 原生 `HotKeyManager` | 展示/修改全局热键（`⌥Space` 唤起面板、`⌘,` 设置、`⌘T` 轨迹等） |
| **外观** | 引擎 `ui-theme.preference` + 外壳 `themeEnabled` | 明/暗联动：写 `ui-theme` + 通知外壳刷新 `NSAppearance`/`data-theme`；黑白 token 统一 |
| **通知** | DSHmini 原生（`UNUserNotificationCenter` 开关） | 回合完成提醒 / 待审批·提问提醒（默认开）；菜单栏状态图标不受开关影响 | 
| **数据** | 引擎 会话/工作区 + `settings.openDocument` | 打开 `settings.yaml`、存储位置（`DSH_HOME`）、会话管理（归档/删除需确认） |

## 3. 通用编辑机制（一切命名空间）

### 3.1 读取
- `settings.describe`（`redactSecrets`）：得到每个命名空间的 `schema/value/base/user/revision/secrets`。UI 只渲染 `value`（已脱敏，`role('secret')` 字段已被结构移除，仅以 `secrets:[{path,set}]` 枚举）。

### 3.2 编辑与保存（diff → path ops）
- 编辑器把某个命名空间的当前 `value` 作为可编辑 JSON 文本显示。
- 保存时**diff 编辑结果 vs 打开时快照**，只提交用户改到的路径集，作为**带 `expectedRevision` 的 `settings.mutate` ops**（`set`/`unset`）。
- `role('secret')` 字段在 diff 中**永远不出现**（两端都无），所以根本不会写回，避免误删密钥；密钥写入走 `credentials`（见 3.3），不作为普通设置字段明文写。

### 3.3 凭据
- `credentials.describe(refs)` 读取某引用（如 `DEEPSEEK_API_KEY`）是否已配置（`configured`/`source`/`writable`）。
- `credentials.set(ref, value)` / `credentials.unset(ref)` 写/删。UI 给"只写输入 + 已配置状态点"（不读回密钥明文）。

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
| `frontend/src/api.ts` | 加 settings/credentials 通道 + 能力探测（若设置内容部分走 WebView） |
| `frontend/src/components/Settings*.tsx` | 如需 WebView 渲染则新增设置入口 |
| `frontend/src/theme.css`（+tokens） | 设置样式 + 明/暗（若走 WebView） |

> 不加 `.cursor:pointer`、不加 hover 高亮、无强调色；键盘焦点黑白 2px 环（`UI-SPEC §4`）。
