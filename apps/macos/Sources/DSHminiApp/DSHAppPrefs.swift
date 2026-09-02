import Foundation

/// App-wide toggle prefs for the native alert surface (SPEC-NOTIFICATIONS
/// §1.3, defaults on — aligned with the reference host's DSHAppPrefs).
enum DSHAppPrefs {
    static let notifyTurnEndKey = "dsh.alerts.notifyTurnEnd"
    static let notifyAttentionKey = "dsh.alerts.notifyAttention"
    static let sidebarWidthKey = "dsh.ui.sidebarWidth"
    static let appearanceKey = "dsh.ui.appearance" // "system" | "light" | "dark"
    static let languageKey = "dsh.ui.language"     // "zh" | "en"

    /// Sidebar drag-resize bounds — keep in sync with tokens.json
    /// size.sidebarMin / size.sidebarMax (the frontend clamps too).
    static let sidebarWidthRange: ClosedRange<Double> = 200...320

    static var notifyTurnEnd: Bool { boolDefaultingTrue(notifyTurnEndKey) }
    static var notifyAttention: Bool { boolDefaultingTrue(notifyAttentionKey) }

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
