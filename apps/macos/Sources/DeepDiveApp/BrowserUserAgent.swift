// 内置浏览器视图的 UA 身份（只这一件事）。
//
// WKWebView 的默认 UA 是
// `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)`
// —— 只有引擎与系统，**没有 `Version/x.y` 也没有 `Safari/605.1.15`**（App 内嵌 WebView 的
// 默认形态）。按 UA 认浏览器的站点据此把我们判成"未知/过旧浏览器"：B 站首页直接跳到
// `blackboard/fe/activity-….html` 的"您的浏览器版本过低哦"（实测补上任一
// `Version/x.y Safari/605.1.15` 即恢复正常，17.0 也过——站点要的是身份标记，不是版本阈值）。
//
// 所以这里**只补身份尾巴**：引擎与系统版本仍由 WebKit 自己报，不伪造引擎。
// 事故与复核方式见 docs/PITFALLS.md §4.22。

import Foundation

enum BrowserUserAgent {
    /// 追加到 WebKit 默认 UA 之后的 Safari 身份片段。
    ///
    /// 版本号取**本机 Safari 的真实版本**，不写死：Safari 版本号与 macOS 版本号并不总是同号
    /// （本机 27.0 同号，历史上 macOS 15 对应 Safari 18），写死会随系统升级漂移。
    static let safariIdentity: String = {
        let candidates = [
            "/Applications/Safari.app/Contents/Info.plist",
            "/System/Applications/Safari.app/Contents/Info.plist",
        ]
        for path in candidates {
            if let dict = NSDictionary(contentsOfFile: path),
               let version = dict["CFBundleShortVersionString"] as? String, !version.isEmpty {
                return "Version/\(version) Safari/605.1.15"
            }
        }
        // 读不到就退回系统大版本（同量级的事实值，站点只做量级比较）
        return "Version/\(ProcessInfo.processInfo.operatingSystemVersion.majorVersion).0 Safari/605.1.15"
    }()
}
