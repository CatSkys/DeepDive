// 浏览器缩放：档位、上下限、**按站点记忆**与默认缩放。
//
// 参考实现（Search 的 `Tab.swift:255-270` / `520-535`）的两条做法照搬：
//   · 缩放是"页面按这个尺寸重新排版"（`pageZoom`），不是放大镜——所以它既影响观看也影响
//     站点排版，必须夹在 0.4…3 之间，再推没有意义（官方注释原话：as far as a page is worth
//     pushing in either direction）；
//   · 记忆在**页面提交时应用**（`didCommit` → `BrowserHost.applyRememberedZoom`，第一帧之前就
//     排好版），写入则发生在用户真的改了缩放那一刻（`BrowserHost.setZoom`）；值等于 1 时**删键**，
//     不留脏数据。反过来"每次提交都写一遍"会把每个访问过的站点钉死在当时的默认值上。
//
// 键：默认缩放 `deepdive.browser.zoom.default`；按站点 `deepdive.browser.zoom.site.<host>`。
// 读写都收一个 `UserDefaults`（缺省 `.standard`）：测试要拿独立 suite，别污染真机偏好。
import Foundation

enum BrowserZoom {
    static let range: ClosedRange<CGFloat> = 0.4...3

    /// 档位表：⌘+/⌘- 在相邻档之间跳，和浏览器一致（不是每次 ±10%）。
    static let steps: [CGFloat] = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

    private static let defaultKey = "deepdive.browser.zoom.default"
    private static let rememberKey = "deepdive.browser.zoom.rememberSite"

    /// 关掉"按站点记忆"后一律用默认缩放。
    static func remembersPerSite(_ defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: rememberKey) as? Bool ?? true
    }

    static func setRemembersPerSite(_ on: Bool, _ defaults: UserDefaults = .standard) {
        defaults.set(on, forKey: rememberKey)
    }

    static func defaultZoom(_ defaults: UserDefaults = .standard) -> CGFloat {
        clamp(CGFloat(defaults.object(forKey: defaultKey) as? Double ?? 1))
    }

    static func setDefaultZoom(_ zoom: CGFloat, _ defaults: UserDefaults = .standard) {
        let value = clamp(zoom)
        if value == 1 {
            defaults.removeObject(forKey: defaultKey)
        } else {
            defaults.set(Double(value), forKey: defaultKey)
        }
    }

    /// 这个站点该用的缩放。
    static func forHost(_ host: String?, _ defaults: UserDefaults = .standard) -> CGFloat {
        guard let host, !host.isEmpty else { return defaultZoom(defaults) }
        guard remembersPerSite(defaults) else { return defaultZoom(defaults) }
        guard let stored = defaults.object(forKey: siteKey(host)) as? Double else { return defaultZoom(defaults) }
        return clamp(CGFloat(stored))
    }

    /// 记住这个站点的缩放（1 就删键）。
    static func remember(_ zoom: CGFloat, host: String?, _ defaults: UserDefaults = .standard) {
        guard let host, !host.isEmpty, remembersPerSite(defaults) else { return }
        let value = clamp(zoom)
        if value == 1 {
            defaults.removeObject(forKey: siteKey(host))
        } else {
            defaults.set(Double(value), forKey: siteKey(host))
        }
    }

    /// `browser-zoom` 桥消息的解析结果。
    ///
    /// 单拎出来是因为它是**跨端契约**：键名/取值由前端决定（`frontend/src/prefs.ts` 的
    /// setBrowserZoomDefault/setBrowserZoomRememberSite、`sidebar-right/useNativeBrowser.ts`
    /// 的 zoomIn/zoomOut/zoomReset），拼错不会报错、只会静默不生效——所以解析要能单测。
    enum Command: Equatable {
        case step(up: Bool)
        case reset
        case set(CGFloat)
        case setDefault(CGFloat)
        case setRememberSite(Bool)
    }

    /// 解析一条 `browser-zoom`。字段优先级：设置页的两个键（default/rememberSite）→ 定值 →
    /// 动作；都不认识返回 nil（壳侧只留一条日志，不改任何状态）。
    ///
    /// 值都收 `as? Double`：桥把 JS number 交成 `NSNumber`，`as? Double` 对整数形态同样成立
    /// （下拉里 "100%" 是整数 1——这是 `NSNumber.intValue` 那条坑的反面，别改成 `as? Int`）。
    static func command(_ body: [String: Any]) -> Command? {
        if let wanted = body["default"] as? Double { return .setDefault(clamp(CGFloat(wanted))) }
        if let remember = body["rememberSite"] as? Bool { return .setRememberSite(remember) }
        if let value = body["value"] as? Double { return .set(clamp(CGFloat(value))) }
        switch body["action"] as? String {
        case "in": return .step(up: true)
        case "out": return .step(up: false)
        case "reset": return .reset
        default: return nil
        }
    }

    /// 上下跳一档（已经在最大/最小档时停在档位端点上）。
    static func stepped(from zoom: CGFloat, up: Bool) -> CGFloat {
        if up {
            return steps.first { $0 > zoom + 0.001 } ?? range.upperBound
        }
        return steps.last { $0 < zoom - 0.001 } ?? range.lowerBound
    }

    static func clamp(_ zoom: CGFloat) -> CGFloat {
        min(max(zoom, range.lowerBound), range.upperBound)
    }

    private static func siteKey(_ host: String) -> String { "deepdive.browser.zoom.site.\(host)" }
}
