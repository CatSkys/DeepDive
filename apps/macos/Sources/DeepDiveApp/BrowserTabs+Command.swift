// `browser-tabs` 桥消息（SPA → 壳）的命令解析。单拎一个文件，因为它是**跨端契约**：
// 键名/取值由前端决定（`sidebar-right/BrowserTabStrip.tsx` 的动作、`frontend/src/prefs.ts`
// 的休眠分钟数），拼错不报错、只会静默不生效——所以解析要能单测。
import Foundation

// MARK: - 桥消息（SPA → 壳）

extension BrowserTabs {
    /// `browser-tabs` 桥消息的解析结果。
    ///
    /// 单拎出来是因为它是**跨端契约**：键名/取值由前端决定（`sidebar-right/BrowserTabStrip.tsx`
    /// 的三个动作、`frontend/src/prefs.ts` 的休眠分钟数），拼错不报错、只会静默不生效——所以解析要能单测。
    enum Command: Equatable {
        case newTab(String?)
        case select(String)
        case close(String)
        case mute(String, Bool)
        case setSleepMinutes(Int)
    }

    /// 解析一条 `browser-tabs`：设置页的休眠门槛优先，其次按动作分发；都不认识返回 nil。
    ///
    /// `sleepMinutes` 收 `as? Double`：桥把 JS number 交成 `NSNumber`（下拉里的 30 也是
    /// 整数值的 NSNumber，`as? Int` 在这种形态下同样成立，但别赌——见 BrowserZoom.command 的同一注解）。
    static func command(_ body: [String: Any]) -> Command? {
        if let minutes = body["sleepMinutes"] as? Double { return .setSleepMinutes(Int(minutes)) }
        switch body["action"] as? String {
        case "new": return .newTab(body["url"] as? String)
        case "select": return (body["id"] as? String).map(Command.select)
        case "close": return (body["id"] as? String).map(Command.close)
        case "mute":
            guard let id = body["id"] as? String else { return nil }
            // muted 收 `as? Bool`：桥把 JS boolean 交成 NSNumber，这里 `as? Bool` 成立
            return .mute(id, body["muted"] as? Bool ?? true)
        default: return nil
        }
    }
}
