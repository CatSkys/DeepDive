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
    /// 自进化（实验能力，默认关）：开着应用才会采集/复盘/校验，装配层也才写那行
    /// 「可以提经验」的指路（晚一拍：装配在启动时读，见 SPEC-SELF-EVOLUTION §8）。
    static let evolutionEnabledKey = "deepdive.evolution.enabled"
    /// 桥监听端口：固定下来前端 origin 才稳（localStorage 按 origin 分家）。
    /// 0 = 还没定过（首次启动由内核分配，随后记下）。
    static let bridgePortKey = "deepdive.bridge.port"

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

    static var hotkeyOn: Bool {
        UserDefaults.standard.object(forKey: hotkeyOnKey) == nil ? true : UserDefaults.standard.bool(forKey: hotkeyOnKey)
    }

    static func setHotkeyOn(_ value: Bool) {
        UserDefaults.standard.set(value, forKey: hotkeyOnKey)
    }

    static var language: String {
        let v = UserDefaults.standard.string(forKey: languageKey) ?? "zh"
        return v == "en" ? "en" : "zh"
    }

    static func setLanguage(_ value: String) {
        UserDefaults.standard.set(value == "en" ? "en" : "zh", forKey: languageKey)
    }

    static var evolutionEnabled: Bool {
        UserDefaults.standard.bool(forKey: evolutionEnabledKey)
    }

    /// 会话记忆（实验能力，默认关）：开着引擎装配才挂笔记插件、新会话才有
    /// memory 工具（晚一拍：装配在启动时读）。
    static let sessionMemoryEnabledKey = "deepdive.sessionMemory.enabled"

    static var sessionMemoryEnabled: Bool {
        UserDefaults.standard.bool(forKey: sessionMemoryEnabledKey)
    }

    static func setSessionMemoryEnabled(_ value: Bool) {
        UserDefaults.standard.set(value, forKey: sessionMemoryEnabledKey)
        // 用户自己再打开＝一次自觉的重试：清掉上次的自动隔离记录
        if value { setSessionMemoryQuarantineReason(nil) }
    }

    /// 自动隔离原因（连续启动失败时由自愈写下）：挂在引擎 patch 之外，**不动用户
    /// 的开关值**——旧实现直接把开关改成 false，用户下次打开设置页只看到"关着"，
    /// 没有任何解释。设置页读它显示"已自动停用：<原因>"，用户点开关即重试。
    static let sessionMemoryQuarantineKey = "deepdive.sessionMemory.quarantineReason"

    static var sessionMemoryQuarantineReason: String? {
        UserDefaults.standard.string(forKey: sessionMemoryQuarantineKey)
    }

    static func setSessionMemoryQuarantineReason(_ value: String?) {
        if let value { UserDefaults.standard.set(value, forKey: sessionMemoryQuarantineKey) }
        else { UserDefaults.standard.removeObject(forKey: sessionMemoryQuarantineKey) }
    }

    /// 本次启动"想挂但挂不上"的原因（依赖自检不过）：每次启动重写，条件好了自动清。
    static let sessionMemoryMountNoteKey = "deepdive.sessionMemory.mountNote"

    static var sessionMemoryMountNote: String? {
        UserDefaults.standard.string(forKey: sessionMemoryMountNoteKey)
    }

    static func setSessionMemoryMountNote(_ value: String?) {
        if let value { UserDefaults.standard.set(value, forKey: sessionMemoryMountNoteKey) }
        else { UserDefaults.standard.removeObject(forKey: sessionMemoryMountNoteKey) }
    }

    /// 设置页要看的那一句：为什么打开着却没生效（隔离原因优先于本次自检结果）。
    static var sessionMemoryBlockedReason: String? {
        sessionMemoryQuarantineReason ?? sessionMemoryMountNote
    }

    static func setEvolutionEnabled(_ value: Bool) {
        UserDefaults.standard.set(value, forKey: evolutionEnabledKey)
    }

    static var bridgePort: Int {
        UserDefaults.standard.integer(forKey: bridgePortKey)
    }


    static func setBridgePort(_ value: Int) {
        UserDefaults.standard.set(value, forKey: bridgePortKey)
    }

    static func setSidebarWidth(_ value: Double) {
        let clamped = min(max(value, sidebarWidthRange.lowerBound), sidebarWidthRange.upperBound)
        UserDefaults.standard.set(clamped, forKey: sidebarWidthKey)
    }

    private static func boolDefaultingTrue(_ key: String) -> Bool {
        UserDefaults.standard.object(forKey: key) == nil ? true : UserDefaults.standard.bool(forKey: key)
    }
}
