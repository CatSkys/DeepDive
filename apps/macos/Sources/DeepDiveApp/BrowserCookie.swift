// 一个要写进浏览器 store 的 cookie。三种来源（Chromium 系 / Firefox / Safari）读出来都归到
// 这个形状，写进去只有一条路（`BrowserCookieImport`）。
import Foundation

struct BrowserCookie {
    var name: String
    var value: String
    var domain: String
    var path: String
    var secure: Bool
    var httpOnly: Bool
    /// nil = 会话 cookie（关掉浏览器就没了）
    var expires: Date?

    /// 转成 WebKit 收的那种 cookie。
    ///
    /// `HttpOnly` 不在 `NSHTTPCookie` 的公开属性里：属性字典里给自定义键 "HttpOnly" 是
    /// CFNetwork 认的那条路（实测 `isHTTPOnly` 跟着变，`BrowserCookieTests` 钉着它）。
    /// 域前面那个点表示"子域也带上"，与浏览器库里的写法同义，原样传。
    var httpCookie: HTTPCookie? {
        var properties: [HTTPCookiePropertyKey: Any] = [
            .name: name,
            .value: value,
            .domain: domain,
            .path: path.isEmpty ? "/" : path,
        ]
        if secure { properties[.secure] = "TRUE" }
        if httpOnly { properties[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
        if let expires { properties[.expires] = expires }
        return HTTPCookie(properties: properties)
    }
}
