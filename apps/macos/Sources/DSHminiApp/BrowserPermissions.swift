// 按站权限记忆：网页申请摄像头/麦克风时，WebKit 把决定权交给壳（`requestMediaCapturePermissionFor`）。
// 这一支把它记住——**按站 + 按种类**（"每周都要接的那通电话只问一次"，参考实现同一条）。
//
// 问一次走应用自己的弹窗（经桥推给 SPA，SPA 用 DialogHost；壳不弹系统框）：桥那边没人及时回答
// 就拒绝（30s 上限）——页面被 WebKit 挂着等这个决定，不能永远挂着。
//
// 一次只问一个：上一个还没答，新的直接拒（参考实现同一条；排队会让第二个页面莫名其妙地等）。
import Foundation
import WebKit

enum BrowserPermissions {
    private static let prefix = "deepdive.browser.capture."

    /// 还没回答的那一个（页面正被 WebKit 挂着等它）。
    private static var pending: (host: String, kind: String, handler: (WKPermissionDecision) -> Void)?
    private static var expiry: Timer?

    /// 网页申请权限：记过的直接照记忆答，没记过的问一次。
    /// - Parameters:
    ///   - ask: 请 SPA 弹窗（host、kind 的中文名由 SPA 组文案）
    ///   - handler: WebKit 的决定回调
    static func request(host: String, type: WKMediaCaptureType,
                        defaults: UserDefaults = .standard,
                        ask: (_ host: String, _ kind: String) -> Void,
                        handler: @escaping (WKPermissionDecision) -> Void) {
        let kind = name(for: type)
        if let remembered = remembered(host: host, kind: kind, defaults) {
            handler(remembered ? .grant : .deny)
            return
        }
        guard pending == nil else {
            handler(.deny)
            return
        }
        pending = (host, kind, handler)
        ask(host, kind)
        expiry = Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { _ in
            // 没人回答（面板关着 / 用户走开了）：拒绝，并把 handler 放掉
            resolve(host: host, kind: kind, allow: false, defaults)
        }
    }

    /// SPA 的回答（`browser-permission` 桥消息）。
    static func resolve(host: String, kind: String, allow: Bool, _ defaults: UserDefaults = .standard) {
        guard let pending, pending.host == host, pending.kind == kind else { return }
        self.pending = nil
        expiry?.invalidate()
        expiry = nil
        remember(allow, host: host, kind: kind, defaults)
        pending.handler(allow ? .grant : .deny)
    }

    /// 记过几条（设置页那行显示它）。读写都收一个 `UserDefaults`（测试拿独立 suite）。
    static func rememberedCount(_ defaults: UserDefaults = .standard) -> Int {
        defaults.dictionaryRepresentation().keys.filter { $0.hasPrefix(prefix) }.count
    }

    static func forgetAll(_ defaults: UserDefaults = .standard) {
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(prefix) {
            defaults.removeObject(forKey: key)
        }
    }

    static func remembered(host: String, kind: String, _ defaults: UserDefaults = .standard) -> Bool? {
        defaults.object(forKey: prefix + host + "|" + kind) as? Bool
    }

    static func remember(_ allow: Bool, host: String, kind: String, _ defaults: UserDefaults = .standard) {
        defaults.set(allow, forKey: prefix + host + "|" + kind)
    }

    /// 种类的短名（进键、进桥，不给人看）。
    static func name(for type: WKMediaCaptureType) -> String {
        switch type {
        case .camera: return "camera"
        case .microphone: return "microphone"
        case .cameraAndMicrophone: return "cameraAndMicrophone"
        @unknown default: return "cameraAndMicrophone"
        }
    }
}

// MARK: - 桥消息（SPA → 壳）

extension BrowserPermissions {
    /// `browser-permission` 桥消息的解析结果。
    enum Command: Equatable {
        case answer(host: String, kind: String, allow: Bool)
        case forgetAll
    }

    /// 回答要三个字段都在（host/kind/allow）；`{action:"forgetAll"}` 清记忆。
    static func command(_ body: [String: Any]) -> Command? {
        if body["action"] as? String == "forgetAll" { return .forgetAll }
        guard let host = body["host"] as? String, !host.isEmpty,
              let kind = body["kind"] as? String, !kind.isEmpty,
              let allow = body["allow"] as? Bool else { return nil }
        return .answer(host: host, kind: kind, allow: allow)
    }
}
