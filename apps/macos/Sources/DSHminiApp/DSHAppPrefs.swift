import Foundation

/// 品牌改名（BRANDING §5）一次性迁移：旧 com.dshmini.app 域里的 dsh.*
/// 偏好（通知开关/侧栏宽/外观/语言）搬到新域 deepdive.*。bundle id 变更
/// 意味着默认域换了 plist，不做这步用户的设置会全部回到默认。在进程早期
/// （main.swift）调用，早于任何 DSHAppPrefs/AppConfig 读取。
enum LegacyPrefsMigration {
    static func run() {
        guard !UserDefaults.standard.bool(forKey: "deepdive.prefsMigrated") else { return }
        if let old = UserDefaults(suiteName: "com.dshmini.app") {
            for (k, v) in old.dictionaryRepresentation() where k.hasPrefix("dsh.") {
                UserDefaults.standard.set(v, forKey: "deepdive." + k.dropFirst(4))
            }
        }
        UserDefaults.standard.set(true, forKey: "deepdive.prefsMigrated")
    }
}

/// App-wide toggle prefs for the native alert surface (SPEC-NOTIFICATIONS
/// §1.3, defaults on — aligned with the reference host's DSHAppPrefs).
enum DSHAppPrefs {
    static let notifyTurnEndKey = "deepdive.alerts.notifyTurnEnd"
    static let notifyAttentionKey = "deepdive.alerts.notifyAttention"
    static let menuBarKey = "deepdive.alerts.menuBar"
    static let dockIconKey = "deepdive.alerts.dockIcon"
    static let sidebarWidthKey = "deepdive.ui.sidebarWidth"
    static let appearanceKey = "deepdive.ui.appearance" // "system" | "light" | "dark"
    static let languageKey = "deepdive.ui.language"     // "zh" | "en"
    /// 应用内快捷键覆盖（前端 keybinds.ts 的 JSON 串；壳只存不解析）
    static let keybindsKey = "deepdive.keybinds"
    /// 全局热键（唤起面板）启用开关；关 = 系统级注销。
    static let hotkeyOnKey = "deepdive.hotkey.on"
    /// 桥监听端口：固定下来前端 origin 才稳（localStorage 按 origin 分家）。
    /// 0 = 还没定过（首次启动由内核分配，随后记下）。
    static let bridgePortKey = "deepdive.bridge.port"
    /// 模型菜单基准详情卡的显隐（前端模型菜单 ⓘ 开关，默认开）。
    static let modelDetailKey = "deepdive.ui.modelDetail"
    /// 快捷面板**置顶**（命令中心那一行，默认关）：开着时面板抬到浮动层级、失焦也不收起。
    /// 存壳不存 localStorage：窗口层级要在页面加载之前就按上次的设置摆好（同选区工具条），
    /// 而且这是「除非明确开启」的那一档——默认必须还是「点到别处就收」。
    static let quickPanelPinnedKey = "deepdive.quickPanel.pinned"
    /// 迷你面板「会话进行中」的动效形态（命令中心「更换进行中动效」那一行）：
    /// `"ring"` 环绕一圈（默认）| `"line"` 顶边一条。合法取值由前端 `prefs.ts` 的
    /// `MiniRunningGlowStyle` 定义，壳只存不解析。存壳不存 localStorage：面板页与
    /// 命令中心卡页是两块 webview、两份 store，只能靠壳推快照对齐（同 quickPanelPinned）。
    static let miniRunningGlowKey = "deepdive.ui.miniRunningGlow"
    /// 新手引导进度（JSON 串，结构由前端 `onboarding/useOnboarding.ts` 定义并解析，
    /// 壳只存不解析）。跨启动的 durable 状态走壳而不走 localStorage——后者随 origin
    /// 漂移（PITFALLS §4.17）。
    static let onboardingKey = "deepdive.onboarding"
    /// 选区工具条设置（JSON 串，结构 = 桥的 `selection-toolbar-set` 载荷，前端
    /// `settings/selectionToolbar.ts` 定义；壳解析成 `ToolbarSetParams` 消费）。
    /// 存壳不存 localStorage：工具条要在页面加载之前就按上次的设置工作。
    static let selectionToolbarKey = "deepdive.selectionToolbar"
    /// 划词命令目录（JSON 串，结构由前端 `settings/selectionCommands.ts` 定义并解析，
    /// 壳只存不解析）：胶囊按钮上的名字，与点下去要跑的提示词模板。空 = 还没编辑过，
    /// 前端每次启动从代码里重新种子。
    static let selectionCommandsKey = "deepdive.selectionCommands"
    /// 截图全局热键（"command+shift+2" 式 spec；空 = 用默认）。
    static let screenshotHotkeyKey = "deepdive.screenshot.hotkey"
    /// 截图全局热键启用开关。
    static let screenshotHotkeyOnKey = "deepdive.screenshot.hotkeyOn"
    /// 截图热键的出厂默认（Atd 同款 ⌘⇧2；系统占的是 ⌘⇧3/4/5）。
    static let defaultScreenshotHotkey = "command+shift+2"

    /// 侧栏拖拽边界。唯一事实源是 tokens.json 的 size.sidebar.min/max；
    /// 前端消费侧（frontend/src/store.tsx）为同值手工双写——改动必须三处
    /// 同步：tokens.json、此处、store.tsx（AUD-055）。
    static let sidebarWidthRange: ClosedRange<Double> = 200...320

    static var notifyTurnEnd: Bool { boolDefaultingTrue(notifyTurnEndKey) }
    static var notifyAttention: Bool { boolDefaultingTrue(notifyAttentionKey) }
    static var menuBar: Bool { boolDefaultingTrue(menuBarKey) }
    static var dockIcon: Bool { boolDefaultingTrue(dockIconKey) }

    /// Persisted sidebar width (px), clamped to `sidebarWidthRange`.
    static var sidebarWidth: Double {
        let raw = UserDefaults.standard.double(forKey: sidebarWidthKey)
        let v = raw == 0 ? 240 : raw
        return min(max(v, sidebarWidthRange.lowerBound), sidebarWidthRange.upperBound)
    }

    static func setNotifyTurnEnd(_ value: Bool) {
        UserDefaults.standard.set(value, forKey: notifyTurnEndKey)
    }

    static func setNotifyAttention(_ value: Bool) {
        UserDefaults.standard.set(value, forKey: notifyAttentionKey)
    }

    static func setMenuBar(_ value: Bool) {
        UserDefaults.standard.set(value, forKey: menuBarKey)
    }

    static func setDockIcon(_ value: Bool) {
        UserDefaults.standard.set(value, forKey: dockIconKey)
    }

    /// Appearance mode (frontend Settings → 外观). "system" clears the
    /// explicit appearance so the window tracks the OS, and the shell pushes
    /// effective light/dark to the web layer on change.
    static var appearance: String {
        let v = UserDefaults.standard.string(forKey: appearanceKey) ?? "dark"
        return ["system", "light", "dark"].contains(v) ? v : "dark"
    }

    static func setAppearance(_ value: String) {
        UserDefaults.standard.set(value, forKey: appearanceKey)
    }

    /// 应用内快捷键覆盖（JSON 串，结构由前端 keybinds.ts 定义与解析）。
    static var keybinds: String {
        UserDefaults.standard.string(forKey: keybindsKey) ?? ""
    }

    static func setKeybinds(_ value: String) {
        UserDefaults.standard.set(value, forKey: keybindsKey)
    }

    /// 新手引导进度（前端定义的 JSON 串；缺省 = 从未开始）。
    static var onboarding: String {
        UserDefaults.standard.string(forKey: onboardingKey) ?? ""
    }

    static func setOnboarding(_ value: String) {
        UserDefaults.standard.set(value, forKey: onboardingKey)
    }

    /// 选区工具条设置（JSON 串；缺省 = 空，页面首次推送即写入）。
    static var selectionToolbar: String {
        UserDefaults.standard.string(forKey: selectionToolbarKey) ?? ""
    }

    static func setSelectionToolbar(_ value: String) {
        UserDefaults.standard.set(value, forKey: selectionToolbarKey)
    }

    /// 划词命令目录（JSON 串；缺省 = 空，前端据此回内置种子）。
    static var selectionCommands: String {
        UserDefaults.standard.string(forKey: selectionCommandsKey) ?? ""
    }

    static func setSelectionCommands(_ value: String) {
        UserDefaults.standard.set(value, forKey: selectionCommandsKey)
    }

    /// 截图热键 spec；空 = 还没设置过，用出厂默认。
    static var screenshotHotkey: String {
        let raw = UserDefaults.standard.string(forKey: screenshotHotkeyKey) ?? ""
        return raw.isEmpty ? defaultScreenshotHotkey : raw
    }

    static func setScreenshotHotkey(_ value: String) {
        UserDefaults.standard.set(value, forKey: screenshotHotkeyKey)
    }

    static var screenshotHotkeyOn: Bool { boolDefaultingTrue(screenshotHotkeyOnKey) }

    static func setScreenshotHotkeyOn(_ value: Bool) {
        UserDefaults.standard.set(value, forKey: screenshotHotkeyOnKey)
    }

    static var hotkeyOn: Bool {
        UserDefaults.standard.object(forKey: hotkeyOnKey) == nil ? true : UserDefaults.standard.bool(forKey: hotkeyOnKey)
    }

    static func setHotkeyOn(_ value: Bool) {
        UserDefaults.standard.set(value, forKey: hotkeyOnKey)
    }

    /// 快捷面板是否置顶（默认关——「除非开启指定」那一档）。
    static var quickPanelPinned: Bool {
        UserDefaults.standard.object(forKey: quickPanelPinnedKey) == nil
            ? false
            : UserDefaults.standard.bool(forKey: quickPanelPinnedKey)
    }

    static func setQuickPanelPinned(_ value: Bool) {
        UserDefaults.standard.set(value, forKey: quickPanelPinnedKey)
    }

    /// 迷你面板进行中动效的形态；没存过或存了非法值一律回落默认的环绕一圈。
    static var miniRunningGlow: String {
        let v = UserDefaults.standard.string(forKey: miniRunningGlowKey) ?? ""
        return ["ring", "line"].contains(v) ? v : "ring"
    }

    static func setMiniRunningGlow(_ value: String) {
        UserDefaults.standard.set(value == "line" ? "line" : "ring", forKey: miniRunningGlowKey)
    }

    static var language: String {
        let v = UserDefaults.standard.string(forKey: languageKey) ?? "zh"
        return v == "en" ? "en" : "zh"
    }

    static func setLanguage(_ value: String) {
        UserDefaults.standard.set(value == "en" ? "en" : "zh", forKey: languageKey)
    }

    static var bridgePort: Int {
        UserDefaults.standard.integer(forKey: bridgePortKey)
    }


    static func setBridgePort(_ value: Int) {
        UserDefaults.standard.set(value, forKey: bridgePortKey)
    }

    static var modelDetail: Bool { boolDefaultingTrue(modelDetailKey) }

    static func setModelDetail(_ value: Bool) {
        UserDefaults.standard.set(value, forKey: modelDetailKey)
    }

    static func setSidebarWidth(_ value: Double) {
        let clamped = min(max(value, sidebarWidthRange.lowerBound), sidebarWidthRange.upperBound)
        UserDefaults.standard.set(clamped, forKey: sidebarWidthKey)
    }

    private static func boolDefaultingTrue(_ key: String) -> Bool {
        UserDefaults.standard.object(forKey: key) == nil ? true : UserDefaults.standard.bool(forKey: key)
    }
}
