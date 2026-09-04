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

    /// Sidebar drag-resize bounds — keep in sync with tokens.json
    /// size.sidebarMin / size.sidebarMax (the frontend clamps too).
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

    static var language: String {
        let v = UserDefaults.standard.string(forKey: languageKey) ?? "zh"
        return v == "en" ? "en" : "zh"
    }

    static func setLanguage(_ value: String) {
        UserDefaults.standard.set(value == "en" ? "en" : "zh", forKey: languageKey)
    }

    static func setSidebarWidth(_ value: Double) {
        let clamped = min(max(value, sidebarWidthRange.lowerBound), sidebarWidthRange.upperBound)
        UserDefaults.standard.set(clamped, forKey: sidebarWidthKey)
    }

    private static func boolDefaultingTrue(_ key: String) -> Bool {
        UserDefaults.standard.object(forKey: key) == nil ? true : UserDefaults.standard.bool(forKey: key)
    }
}
