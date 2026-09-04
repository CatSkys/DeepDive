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

    // MARK: - delivery (§1.1: post(id, title, subtitle, body, silent))
    //
    // 文案按任务类型区分（§1.2）：title = 任务类型（短动词短语），subtitle =
    // 会话标题（哪个任务），body = 该类型携带的真实内容（工具名/提问文本）。
    // 品牌归属交给通知左侧的 App 图标，标题不再挂 "DSH" 前缀。

    static func post(id: String, title: String, subtitle: String = "", body: String, silent: Bool, sessionId: String? = nil) {
        guard authorizationResolved, authorized else {
            EngineLog.shared.append("[alerts] skip (not authorized): \(title)")
            return
        }
        var userInfo: [String: Any] = [:]
        if let sessionId {
            userInfo["sessionId"] = sessionId
        }
        let content = UNMutableNotificationContent()
        content.title = title
        content.subtitle = subtitle
        content.body = body
        if !silent {
            content.sound = .default
        }
        if !userInfo.isEmpty {
            content.userInfo = userInfo
        }
        let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    /// 提问正文可能很长；横幅只展示两三行，显式截断保持列表整洁。
    private static func truncated(_ text: String, to max: Int = 120) -> String {
        text.count <= max ? text : text.prefix(max) + "…"
    }

    // MARK: - triggers (§1.2)

    static func notifyApprovalNeeded(toolName: String, sessionTitle: String, sessionId: String?) {
        guard DSHAppPrefs.notifyAttention, !NSApp.isActive else { return }
        NSApp.requestUserAttention(.informationalRequest)
        post(id: "approval-\(UUID().uuidString)",
             title: "需要你的许可",
             subtitle: sessionTitle,
             body: "请求执行：\(toolName)",
             silent: false,
             sessionId: sessionId)
    }

    static func notifyQuestionNeeded(questionText: String, sessionTitle: String, sessionId: String?) {
        guard DSHAppPrefs.notifyAttention, !NSApp.isActive else { return }
        NSApp.requestUserAttention(.informationalRequest)
        post(id: "question-\(UUID().uuidString)",
             title: "有问题要问你",
             subtitle: sessionTitle,
             body: truncated(questionText),
             silent: false,
             sessionId: sessionId)
    }

    /// Turn finished is a SILENT notification (SEMANTICS §5: 中打扰=静默通知).
    static func notifyTurnFinished(sessionTitle: String, sessionId: String?) {
        guard DSHAppPrefs.notifyTurnEnd, !NSApp.isActive else { return }
        post(id: "turn-\(UUID().uuidString)",
             title: "回合已完成",
             subtitle: sessionTitle,
             body: "",
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
