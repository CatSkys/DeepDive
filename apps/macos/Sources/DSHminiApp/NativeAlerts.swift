import AppKit
import UserNotifications

/// Native notifications (SPEC-NOTIFICATIONS §1): UNUserNotificationCenter with
/// SEMANTICS §5 interruption levels — approval/question/Engine-failure carry
/// sound; turn-finished is silent. Front-gated (only when !NSApp.isActive),
/// toggled by DSHAppPrefs. Tapping a notification brings the app forward and
/// routes `navigateToSession` through the shell→frontend bridge.
enum NativeAlerts {
    private static var authorized = false
    /// Set when the first async authorization prompt is answered; until then
    /// the menu bar / bubble state dots are the fallback surface (§1.1 v2.1).
    private static var authorizationResolved = false

    /// Bound by AppDelegate: activate the app + focus the given session.
    static var onOpenSession: ((String?) -> Void)?

    static func install() {
        UNUserNotificationCenter.current().delegate = NotificationDelegate.shared
    }

    /// Authorization is requested at FIRST task dispatch, never at app boot
    /// (§1.1 v2). Asynchronous — early notifications fall back to the state
    /// dots until the user answers the prompt.
    static func requestAuthorizationIfNeeded() {
        guard !authorizationResolved else { return }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
            DispatchQueue.main.async {
                authorized = granted
                authorizationResolved = true
                EngineLog.shared.append("[alerts] authorization granted=\(granted)")
            }
        }
    }

    // MARK: - delivery (§1.1: post(id, title, body, silent))

    static func post(id: String, title: String, body: String, silent: Bool, sessionId: String? = nil) {
        guard authorizationResolved, authorized else {
            EngineLog.shared.append("[alerts] skip (not authorized): \(title)")
            return
        }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        if !silent {
            content.sound = .default
        }
        if let sessionId {
            content.userInfo = ["sessionId": sessionId]
        }
        let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    // MARK: - triggers (§1.2)

    static func notifyApprovalNeeded(toolName: String, sessionId: String?) {
        guard DSHAppPrefs.notifyAttention, !NSApp.isActive else { return }
        NSApp.requestUserAttention(.informationalRequest)
        post(id: "approval-\(UUID().uuidString)",
             title: "DSH 需要你的许可",
             body: "请求执行：\(toolName)",
             silent: false,
             sessionId: sessionId)
    }

    static func notifyQuestionNeeded(sessionId: String?) {
        guard DSHAppPrefs.notifyAttention, !NSApp.isActive else { return }
        NSApp.requestUserAttention(.informationalRequest)
        post(id: "question-\(UUID().uuidString)",
             title: "DSH 有问题要问你",
             body: "打开 DSHmini 查看并回答",
             silent: false,
             sessionId: sessionId)
    }

    /// Turn finished is a SILENT notification (SEMANTICS §5: 中打扰=静默通知).
    static func notifyTurnFinished(summary: String, sessionId: String?) {
        guard DSHAppPrefs.notifyTurnEnd, !NSApp.isActive else { return }
        post(id: "turn-\(UUID().uuidString)",
             title: "DSH 已完成",
             body: summary,
             silent: true,
             sessionId: sessionId)
    }

    /// Engine failure always surfaces (SEMANTICS §5 失败/引擎异常), sound on.
    static func notifyEngineFailed(reason: String) {
        let head = reason.split(separator: "\n").first.map(String.init) ?? "引擎异常"
        post(id: "engine-\(UUID().uuidString)",
             title: "引擎异常",
             body: head,
             silent: false,
             sessionId: nil)
    }

    // MARK: - foreground presentation (§1.1)

    static func presentationOptions(silent: Bool) -> UNNotificationPresentationOptions {
        var options: UNNotificationPresentationOptions = [.banner, .list]
        if !silent { options.insert(.sound) }
        return options
    }
}

/// Delegate: tap → activate + route to session; foreground → banner.
final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationDelegate()

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let sessionId = response.notification.request.content.userInfo["sessionId"] as? String
        DispatchQueue.main.async {
            NSApp.activate(ignoringOtherApps: true)
            NativeAlerts.onOpenSession?(sessionId)
        }
        completionHandler()
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let silent = notification.request.content.sound == nil
        completionHandler(NativeAlerts.presentationOptions(silent: silent))
    }
}
