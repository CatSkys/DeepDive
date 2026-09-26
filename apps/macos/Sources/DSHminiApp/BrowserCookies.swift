// cookie 导入这一块的桥契约与来源清单：设置页发 `browser-cookies`（列来源 / 导一个 / 清数据），
// 壳回 `browserCookieSources` 与 `browserCookieResult`。
//
// 解析单拎出来是因为它是**跨端契约**：键名/取值由前端决定（`settings/useBrowserCookies.ts`），
// 拼错不报错、只会静默不生效——所以解析要能单测。
import Foundation

enum BrowserCookies {
    enum Command: Equatable {
        case sources
        case importSource(String)
        case clear
    }

    static func command(_ body: [String: Any]) -> Command? {
        switch body["action"] as? String {
        case "sources": return .sources
        case "import": return (body["source"] as? String).map(Command.importSource)
        case "clear": return .clear
        default: return nil
        }
    }

    /// 这台机器上可导入的来源（设置页那张表）。
    ///
    /// 根目录可以被 `DSHMINI_BROWSER_IMPORT_ROOT` 覆盖：真机上验一遍导入的完整链路要么读别人的
    /// keychain（要用户输密码）、要么要完全磁盘访问权限，所以得能栽一份假档案进去
    /// （与 `DSHMINI_SUPPORT_DIR` 同一条思路：只在开发/自检时设）。
    static func installed() -> [BrowserCookieSource] {
        let override = ProcessInfo.processInfo.environment["DSHMINI_BROWSER_IMPORT_ROOT"] ?? ""
        if !override.isEmpty {
            let base = URL(fileURLWithPath: override)
            return BrowserCookieSource.installed(home: base, applicationSupport: base.appendingPathComponent("Application Support"))
        }
        return BrowserCookieSource.installed(
            home: FileManager.default.homeDirectoryForCurrentUser,
            applicationSupport: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        )
    }

    /// 来源清单的一行。`blocked` = 数据目录列不出来（被系统挡着）：先说清楚，别等人点了导入才
    /// 报错——macOS 14 起"别的应用的数据"是独立一道 TCC 闸（实测 Chrome / Edge / Brave 就是这种）。
    static func entries(_ sources: [BrowserCookieSource]) -> [[String: Any]] {
        sources.map { source in
            var entry: [String: Any] = ["id": source.id, "name": source.name]
            if (try? source.cookieFiles()) == nil { entry["blocked"] = true }
            return entry
        }
    }

    /// 来源清单的桥载荷（设置页用）。
    static func payload(_ sources: [BrowserCookieSource]) -> [String: Any] {
        ["sources": entries(sources)]
    }
}
