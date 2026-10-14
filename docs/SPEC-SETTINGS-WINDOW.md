# SETTINGS — 设置 spec（P2）

> **状态（2026-09-03 落地；2026-10-13 按现状态重写）**：已实现。**形态是主窗内的一块浮层页**，不是独立窗口；分区清单以代码里的 `SETTINGS_SECTIONS` 为唯一事实源（§2）；本文拥有的是**数据层契约**（§3：describe/mutate/credentials、revision 围栏、冲突两选一、能力探测降级）与入口（§4）。

## 1. 形态

- **主窗内浮层页**（`frontend/src/components/SettingsPage.tsx`）：与主界面同一套 `.sidebar` / `.main` 底板与语义变量；左导航 + 主区内容，黑白。
- 曾经试作过的**独立原生 AppKit 窗口**（480×600、左导航 160、原生控件）已废弃——面板风格与主界面割裂、不可收敛。原生设置窗口那几个文件已删；**原生侧只剩桥指令**：`restart-engine` / `rebind-hotkey`（录制窗）/ `set-pref` / `set-theme` / `get-prefs` / `reveal-home` / `open-host-doc`，以及 `prefs` / `hotkeyChanged` 回推。
- 设置族**弹出面**（模型弹窗 / 导入弹窗 / 机器人管理 / 划词命令 / 新建·编辑项目）统一走 `components/Modal.tsx`（遮罩、居中、圆角描边投影、材质层、Esc 与点遮罩关闭、进出场都归它），各自只补几何（`SettingsRows.module.css` 的 `.modal` 只剩宽高与滚动）——圆角/材质/动效的取法见 `UI-SPEC §1.4bis` 与 §2.2ter，本文不重述。
- 快捷键 / 通知等纯原生开关经桥读写 UserDefaults（`DSHAppPrefs`）；凭据配置成功后触发 `restart-engine` 走 `SPEC-ENGINE-RUNTIME §4.4` 的冷启动闭环。

## 2. 分区

**清单与分组的唯一事实源是 `SettingsPage.tsx` 的 `SETTINGS_SECTIONS`**（侧栏导航与命令面板搜索同一份）；现为 13 项分三组：

| 组 | 分区 |
|---|---|
| 基础设置 | 通用（外观 / 语言 / 归档 / Enter 行为 / 通知 / 默认会话模式）· 模型 · 审批 · 快捷键 · 划词与截图 · 浏览器 |
| Agent 能力 | 自动化 · 插件（插件 / MCP / 技能 三 tab）· 移动端远程控制 · 导入 |
| 数据与统计 | 已归档的聊天 · 使用统计 · 关于（版本号与应用更新） |

各分区的行为细节归各自的家，本文不抄第二份：

| 分区 | 家 |
|---|---|
| 模型 | `settings/ModelsManage.tsx` + `settings/ModelDialog.tsx` + `settings/piProtocols.ts`；快速添加 + 折叠卡片（2026-09 定稿）：一家一张卡，有 Token Plan 指套餐端点、否则指国内端点；「自定义」＝手写一条路由。已保存模型按提供方聚成可折叠分组（单色反白 logo），行内联 Meta 胶囊（推理 / 额外输入模态 / 上下文窗口）。**模型名称留空 = 按 API 自动发现全部支持模型**；高级配置＝提供方 ID（留空按接口地址主机名派生）+ 协议（枚举读 `llm-pi-ai` 自己的 schema）+ 视觉（写 pi 的 `input` / DeepSeek 的 `inputModalities`，改目录里的模型走 `modelOverrides`，避免 `models` 整条替换挤掉目录其余模型）。行内「测试连通」：pi 走发现探测、DeepSeek 无发现路由退化为密钥状态检查 |
| 快捷键 | 三档：**全局热键**（`HotKeyManager`）· **应用快捷键**（`KEYBIND_DEFS`，可改可停用，录制时拒绝裸键 / 系统占用 / 撞车）· **固定键位**（`FIXED_KEYBINDS`）。两表由设置页直接渲染，清单不另抄（`UI-SPEC §2.3`） |
| 审批 | `settings/permissionPreset.ts` 是权限名与说明的唯一本地化表（会话设置 / 设置页审批 / 新建项目表单共用；wire 上的 `name` 是裸预设键，不直接摆给用户） |
| 划词与截图 | `SPEC-SEMANTICS §6.2`；实现 `settings/SelectionToolbarSection.tsx` + `settings/SelectionCommandDialog.tsx` |
| 浏览器 | `SPEC-BROWSER-USE.md`；实现 `settings/BrowserSection.tsx`（+ `BrowserLibrary` / `BrowserLoginData` / `BrowserPrivacy`） |
| 自动化 | `SPEC-AUTOMATION.md`；实现 `automation/` |
| 插件 | `frontend/src/plugins/`；契约与实测证据见 `PITFALLS §7.6` |
| 移动端远程控制 | `SPEC-MOBILE-REMOTE.md`；实现 `mobile/RemoteControlSection.tsx` |
| 使用统计 | `stats/usageStats.ts`（数据编码色见 `tokens.json` 的 color.chart） |
| 关于 | `settings/AboutSection.tsx`（版本号 + 检查更新 / 重启以安装）。版本与「有没有待装的一份」都来自壳的 `AppUpdater.swift`，经桥事件 `updateState`；更新源与发布链见 `scripts/publish-release.sh` |
| 通用 · 已归档 · 导入 | `components/SettingsPage.tsx` 内的对应 section |

## 3. 通用编辑机制（一切命名空间）

### 3.1 读取
- `settings.describe`（`redactSecrets`）：得到每个命名空间的 `schema/value/base/user/revision/secrets`。UI 只渲染 `value`（已脱敏，`role('secret')` 字段已被结构移除，仅以 `secrets:[{path,set}]` 枚举）。
- **namespace 清单动态渲染、不写死**：分区 UI 以 `describe` 返回的 `namespaces`/`schema` 驱动；引擎升级后以 `describe` 实际返回为准（配合 `SPEC-ENGINE-RUNTIME §4.2` 能力探测）。

### 3.2 编辑与保存（diff → path ops）
- 编辑器把某个命名空间的当前 `value` 作为可编辑 JSON 文本显示。
- 保存时**diff 编辑结果 vs 打开时快照**，只提交用户改到的路径集，作为**带 `expectedRevision` 的 `settings.mutate` ops**（`set`/`unset`）。
- `role('secret')` 字段在 diff 中**永远不出现**（两端都无），所以根本不会写回，避免误删密钥；密钥写入走 `credentials`（见 3.3），不作为普通设置字段明文写。

### 3.3 凭据
- `credentials.describe(refs)` 读取某引用（如 `DEEPSEEK_API_KEY`）是否已配置（`configured`/`source`/`writable`）。
- `credentials.set(ref, value)` / `credentials.unset(ref)` 写/删。UI 给"只写输入 + 已配置状态点"（不读回密钥明文）。
- **冷启动闭环**：配置成功时若引擎因缺凭据处于 `failed`，触发 `EngineSupervisor.start()` 自动重启引擎——接通 `SPEC-ENGINE-RUNTIME §4.4`，替代"手动复制 `.credentials.yaml`"的老路径。

### 3.4 冲突恢复
- 保存收到 `settings/conflict`（revision 已前进）：两选一——"放弃修改，载入最新" / "保留修改，基于最新版本重试"。绝不静默覆盖。

## 4. 入口

- 侧栏底部「设置」行（`onClick` 打开设置页）。
- 菜单栏 `StatusItemController` 的「设置…」；`⌘,`（对应 `UI-SPEC §2.3` 键盘映射）；`SPEC-SEMANTICS §7` 引导卡完成后落在设置页。

## 5. 文件地图

| 文件 | 管什么 |
|---|---|
| `frontend/src/components/SettingsPage.tsx` | 页面外壳 + `SETTINGS_SECTIONS`（分区清单事实源）+ 通用/审批/已归档三个内联 section |
| `frontend/src/settings/SettingsRows.module.css` | 行/卡片/按钮/弹窗/下拉的类（行规范与材质归 `UI-SPEC §2.4`） |
| `frontend/src/settings/*.ts(x)` | 各分区组件与数据 helper（见 §2 的家一列） |
| `frontend/src/api.ts` | settings / credentials 通道 + 能力探测 |

> 不加 `.cursor:pointer`、不加 hover 高亮、无强调色；键盘焦点黑白 2px 环（`UI-SPEC §4`）。
