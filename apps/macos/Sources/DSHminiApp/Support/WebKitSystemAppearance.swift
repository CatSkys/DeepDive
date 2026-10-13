import WebKit

/// 打开 WebKit 的 `useSystemAppearance`（私有 setter `WKWebView._setUseSystemAppearance:`）。
///
/// 为什么非开不可：CSS 属性 `-apple-visual-effect`——网页内容里唯一能拿到**系统材质**
/// （液态玻璃）的入口，本仓输入胶囊的材质层就靠它——在 WebKit 里带
/// `settings-flag: useSystemAppearance`，而该 flag **默认 false**。关着时属性连解析器都
/// 不认识：`CSS.supports("-apple-visual-effect", …)` 全 false、写进 `style.cssText` 的声明
/// 被直接丢弃。WebKit 给 UA 样式表强制打开了它（Apple 自家媒体控制条因此能用），宿主
/// 必须自己开，网页里那一档才存在。（实测：本机 macOS 27 打开后同一段 CSS 的 computed
/// 值从 "" 变成 `-apple-system-glass-material-media-controls`。）
///
/// 代价与前提：这是私有 API。App Store 审核只认公开 API（App Review 2.5.1），本应用是
/// Developer ID 自行分发（scripts/build-release.sh → make package），与仓内已有的
/// `drawsBackground`、`_setPageMuted:` 属同一类用法。
/// setter 不在的机器只静默降级：CSS 那一侧本来就是 `@supports` 三档（系统材质 →
/// backdrop-filter 模糊 → 底色），属性不生效就落回模糊，不会变成"没有玻璃"。
///
/// 只给**渲染本应用界面**的 webview 开（主窗 / 迷你面板 / 悬浮输入框）：浏览器页是别人的
/// 内容，不用它去改人家网页的渲染。
enum WebKitSystemAppearance {
  static func enable(_ webView: WKWebView) {
    let selector = NSSelectorFromString("_setUseSystemAppearance:")
    guard webView.responds(to: selector), let implementation = webView.method(for: selector) else { return }
    typealias Setter = @convention(c) (NSObject, Selector, Bool) -> Void
    unsafeBitCast(implementation, to: Setter.self)(webView, selector, true)
  }
}
