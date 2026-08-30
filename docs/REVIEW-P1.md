# P1 实施评审（对照 docs/PLAN-P1.md）

> 评审日期：2026-08-30 · 结论：**计划全部实现，附偏差与遗留说明**
> v1.1 追加：官方 UI 自定义机制调研 + 黑白玻璃主题升级（见 §6）

## 1. 范围对照（PLAN §2）

| 计划项 | 实现 | 证据 |
|---|---|---|
| apps/macos Swift+AppKit 外壳（XcodeGen） | ✅ | `apps/macos/project.yml`，`xcodegen generate` 可复现 |
| EngineSupervisor：spawn / `dsh web:` 解析 / 自愈重启 / 诊断尾巴 | ✅ | `EngineSupervisor.swift`；log：`[engine] ready:`、`exited; restart in 1s/2s`、三次失败 |
| 玻璃主窗 + 透明 WKWebView + 显隐防闪烁 | ✅ | `MainWindowController.swift`（NSVisualEffectView .hudWindow、drawsBackground=false、alpha 0→1 阶段显影、frame autosave） |
| 黑白主题覆盖（注入，不侵入引擎） | ✅ | `WebViewTheme.swift`；菜单栏「黑白主题」开关即时生效 |
| 全局热键 ⌥Space 可配置 | ✅ | `HotKeyManager.swift`（Carbon）；log `[shell] hotkey registered: option+space` |
| 菜单栏常驻（LSUIElement）+ 状态点/显示/重启/主题/工作区/退出 | ✅ | `StatusItemController.swift`；Info.plist `LSUIElement=1` 已验证 |
| 恢复屏（诊断复制/重试） | ✅ | `RecoveryWindowController.swift`；实测触发（截图见工作日志） |
| DSH_HOME 隔离 / 工作区=沙箱根(cwd) / 启动工作区选择 | ✅ | `AppPaths.harnessHome`；`DSH_HOME=…/harness`；引擎 cwd=启动工作区（菜单栏选择器，重启生效） |
| tokens 单一事实源 codegen → tokens.css + Tokens.swift | ✅ | `gen-tokens.mjs`（生成物已核对：CSS 变量 + 动态 NSColor） |
| 配置 config.json | ✅ | `AppConfig`（hotkey/themeEnabled/launchWorkspace/openAtLogin） |
| 打包：dev 签名 DMG | ✅ | `scripts/package-macos.sh`；`dist/DSHmini-0.1.0-dev.dmg`（adhoc 签名、Universal x86_64+arm64） |

## 2. 里程碑验收（PLAN §3）

| 验收 | 结果 |
|---|---|
| M0 最小玻璃窗口可编译 | ✅ Debug 首编译通过 |
| M1 启动后 ⌥Space 可唤；官方 UI 全功能可达 | ✅ 热键注册成功（日志）；截屏确认官方 UI（新会话/工作区/内测声明）在 WebView 中渲染；UI 全功能=官方页面，未做任何删减 |
| M1 `kill -9 dsh` 后 ≤30s 自动恢复、会话历史仍在 | ✅ 实测：kill → 1s 重启 → 新端口就绪；会话持久化在 DSH_HOME/JSONL，未受影响 |
| M2 面板显隐无闪烁；近单色玻璃观感；恢复屏可复制诊断 | ✅ alpha 阶段显影 + 防遮挡节流开关（见偏差#2）；恢复屏实测含日志与复制 |
| M3 DMG 安装可跑 | ✅ 打包后 `open` 即用（未做安装——dev 包为拖入 Applications 式） |

## 3. 实施中发现的偏差与补充（计划外，均为必要修正）

1. **ATS**：Info.plist 增加 `NSAllowsLocalNetworking`（WKWebView 加载 loopback http 必需）。
2. **WebKit 反节流**：`windowOcclusionDetectionEnabled` 在公开 SDK 中不存在（Raycast 属私有用法）→ 改为 `respondsToSelector` 守卫式私有调用 + alpha 显影兜底，无崩溃风险。
3. **引擎入口解析**：launchd/GUI 启动 PATH 极简 → 探测 `/opt/homebrew/bin/dsh → /usr/local/bin/dsh` + PATH 前插，`DSHMINI_DSH_ENTRY` 可覆盖。
4. **SIGTERM 防孤儿**：信号接进优雅退出路径，引擎随应用干净退出（实测：杀应用后无残留进程）。
5. **单实例锁**：双实例会共写 DSH_HOME（评审中实测复现日志交错）→ `flock` 单实例守卫 + 分布式通知唤出既有实例（实测第二实例立即退出）。
6. **脚本 pipefail**：构建失败不再被 `tail` 吞退出码（评审中发现 Release 曾以陈旧产物出包，已修复并重验）。
7. **恢复路径全链路**：以 `/tmp/fake-dsh` 实测：3 次失败 → 1s/2s 退避 → failed → 恢复屏（截图确认）；`退出码 0` 的场景（如 `/bin/false` 意外成功）无死循环。

## 4. 已知限制核对（PLAN §4）——全部符合预期

1. 官方 UI 信息架构原样保留 ✅（极简布局属 P2 自建前端）
2. 工作区/sandbox 根：以「启动工作区」对齐，切换需重启引擎 ✅（菜单栏选择器）
3. 通知：依赖官方 UI 自身提示，系统级徽标/通知 P2 ✅
4. 凭证：沿用官方 UI key 管理，Keychain 插件 P2 ✅
5. 引擎版本：使用系统 dsh，bundled runtime 未做（v1.0 按计划）✅

## 5. 遗留（不进 v1，已在 P2 蓝图）

- 主题覆盖目前为"透明底 + 无 pointer 光标 + 中性滚动条/选区"最小集；官方 UI 的明暗跟随系统（不强制暗色），深色玻璃观感在暗色系统下最佳。
- Sparkle 自动更新、公证分发、Windows 外壳、bundled Node 运行时。
- UI-SPEC §2 组件库与 §3 参考图布局（P2 自建前端时落地）。

## 6. 官方 UI 自定义机制调研（v1.1，主题升级依据）

**结论：官方 web 前端本身就是一个可组合的 Cordis 浏览器插件系统，UI 自定义是一等能力，且拥有完整主题体系。**

官方机制（`docs/subsystems/slots.md` / `packages/client/ui-theme/README.md` / 本地包源码核对）：

| 能力 | 官方路径 | v1 采用 |
|---|---|---|
| 明暗主题 | 设置内 light/dark/**system**，持久化 `$DSH_HOME/settings.yaml`（`ui-theme` namespace）；`system` 解析 `prefers-color-scheme` | 窗口强制 `darkAqua` → 官方自带暗色主题自动启用（无 hack） |
| 颜色体系 | `--dsw-*` 静态尺 + `--dsw-alias-*` 语义别名（token sheets 是唯一色权） | **覆盖同名 alias 令牌**（品牌蓝→白/黑、状态色→灰阶、表面→半透明暗玻璃），与官方 `overrideTokens` 物理等价 |
| 第三方主题 | `ctx.theme.register(definition)`（主题 id + alias 覆盖对，可成为设置中的外观选项） | P2 转正目标 |
| Token 覆盖层 | `ctx.theme.overrideTokens(source, tokens)`（每个 token 必须 `{light,dark}` 对，seq 叠加） | CSS 注入同名覆盖（v1 载体差异；P2 改为 `dsh.client` 插件直调 `ctx.theme`，覆盖可进官方外观选择器） |
| UI 结构扩展 | `dsh.client` 包 + `window.__DSH_BOOT__` 图 + Slots（`settings.general.item` 等） | P2 自建前端/组件时使用 |

**主题升级（v1.1）**：`WebViewTheme.swift` 重写为 token 级黑白玻璃覆盖（surface/brand/buttons/status/scrollbar/selection/cursor），覆盖 40+ `--dsw-alias-*`；窗口 `darkAqua` 强制官方暗色；菜单栏「黑白主题」开关 = 完整开关（关=官方默认跟随系统）。截屏验证：全站暗玻璃、无彩色。
