import Foundation

/// App-wide toggle prefs for the native alert surface (SPEC-NOTIFICATIONS
/// §1.3, defaults on — aligned with the reference host's DSHAppPrefs).
enum DSHAppPrefs {
    static let notifyTurnEndKey = "dsh.alerts.notifyTurnEnd"
    static let notifyAttentionKey = "dsh.alerts.notifyAttention"

    static var notifyTurnEnd: Bool { boolDefaultingTrue(notifyTurnEndKey) }
    static var notifyAttention: Bool { boolDefaultingTrue(notifyAttentionKey) }

    static func setNotifyTurnEnd(_ value: Bool) {
        UserDefaults.standard.set(value, forKey: notifyTurnEndKey)
    }

    static func setNotifyAttention(_ value: Bool) {
        UserDefaults.standard.set(value, forKey: notifyAttentionKey)
    }

    private static func boolDefaultingTrue(_ key: String) -> Bool {
        UserDefaults.standard.object(forKey: key) == nil ? true : UserDefaults.standard.bool(forKey: key)
    }
}
