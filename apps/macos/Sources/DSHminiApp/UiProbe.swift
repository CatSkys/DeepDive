import Foundation

/// 量化探针：样式与布局的取数口（TODO §19）。
///
/// 存在的理由是 WORKING-AGREEMENTS §2 那条纪律——"改样式/布局类问题必须用可量化的
/// 方式确认，把数字摆出来"。此前取数全靠临时 evaluateJavaScript，用完就还原；这里
/// 给一条常驻通道，顺带覆盖 JS 量不到的那半边：原生层的尺寸（窗口、WKWebView、
/// 侧栏浏览器的原生视图都在壳这一侧）。
///
/// 分层照 BrowserControl：壳只提供原语（量节点、报原生尺寸），口径与判定留给调用方。
/// 三条纪律：
/// ① **只回数据**：请求只能是「一组选择器 + 一组 CSS 属性名」，壳把它们喂给一段
///    **写死的**内联脚本（getBoundingClientRect + getComputedStyle）。不接受任意 JS——
///    回环上任何能连到桥的进程都不该借它执行代码。
/// ② **boot 级 token**：与 /browser-control 同一套 Authorization 闸。token 只活本次
///    进程（不落盘），桥起时写一份 <support>/probe.json（0600）给命令行工具读；
///    应用没开或换了一次进程，文件里的 token 即失效（403）。
/// ③ 引擎挂掉期间照样可用——这时恰恰最需要看界面（与 /__deepdive_error 同理）。
///
/// 命令行入口：scripts/probe.py（用法见该文件头部）。
enum UiProbe {
    /// 本次 boot 的 token（进程内随机，与 BrowserControl.token 同一口径）。
    static let token = UUID().uuidString.replacingOccurrences(of: "-", with: "")

    /// 由窗口控制器装：桥是单例、窗口控制器不是（与 BrowserControl.tabsProvider 同理）。
    /// 参数是（选择器数组, 属性名数组），返回一段 JSON 文本（原生事实 + 节点列表）；
    /// 返回 nil = 取不到（窗口没了、脚本拼不出来、webview 不应答），按失败回。
    static var measureProvider: ((_ selectors: [String], _ props: [String]) -> String?)?

    /// 单次请求的选择器上限：这是量界面的口，不是批处理口。
    private static let maxSelectors = 32
    /// evaluateJavaScript 的硬上限（与 BrowserControl 同量级；超时按失败回）。
    private static let timeoutMs = 5_000

    /// 不给属性时的默认集：排版与盒模型里最常被拿来对数的那几个。
    static let defaultProps = [
        "width", "height", "padding", "margin", "border-radius", "border", "background-color",
        "color", "opacity", "box-shadow", "font-size", "line-height", "font-weight",
        "letter-spacing", "transform", "transition", "display", "position", "overflow",
    ]

    /// 桥起时把端口与 token 写给命令行工具（0600，只当前用户可读）。
    static func publishEndpoint(port: UInt16) {
        let payload: [String: Any] = ["port": Int(port), "token": token]
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        let url = AppPaths.supportDir.appendingPathComponent("probe.json")
        try? data.write(to: url, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    /// 处理一次探针请求（同步：MiniHTTPServer 一个连接一个线程）。
    /// 形状与 BrowserControl.handle 一致，便于对照。
    static func handle(_ request: MiniHTTPServer.Request) -> MiniHTTPServer.Response {
        guard request.headers["authorization"] == "Bearer \(token)" else {
            return .init(status: 403, body: Data("forbidden".utf8))
        }
        guard let measure = measureProvider else {
            return json(["ok": false, "error": "no window"], status: 503)
        }
        guard let body = (try? JSONSerialization.jsonObject(with: request.body)) as? [String: Any] else {
            return json(["ok": false, "error": "malformed body"])
        }
        let selectors = (body["selectors"] as? [String] ?? []).prefix(maxSelectors).map { $0 }
        let props = body["props"] as? [String] ?? defaultProps
        guard !selectors.isEmpty else {
            return json(["ok": false, "error": "no selectors"])
        }
        // 必须在主线程量（webView 只能在主线程动），但等待绝不能发生在主线程——
        // 那会与派发互锁，只能等满超时白跑一趟。桥的连接线程天然满足；主线程直接
        // 调进来时（单测宿主就是这样）就地同步量，不派发。
        var payload: String?
        if Thread.isMainThread {
            payload = measure(Array(selectors), props)
        } else {
            let done = DispatchSemaphore(value: 0)
            DispatchQueue.main.async {
                payload = measure(Array(selectors), props)
                done.signal()
            }
            // 超时按失败回：宁可报超时，也不把一个挂死的 webview 变成永久占住的连接。
            guard done.wait(timeout: .now() + .milliseconds(timeoutMs)) != .timedOut else {
                return json(["ok": false, "error": "timeout"])
            }
        }
        guard let text = payload, let data = text.data(using: .utf8) else {
            return json(["ok": false, "error": "timeout"])
        }
        return .init(status: 200, body: data)
    }

    /// 错误也走 JSON 体：调用方（scripts/probe.py）只需要认一种形状。
    private static func json(_ object: [String: Any], status: Int = 200) -> MiniHTTPServer.Response {
        let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
        return .init(status: status, body: data)
    }

    /// 写死的取数脚本：只量不改——除 rect 与 computed style 外不取任何东西，
    /// 也不碰 DOM（没有赋值、没有点击、没有导航）。
    /// 选择器与属性名以 JSON 字面量内联（JSONSerialization 已转义引号与反斜杠）。
    static func script(selectors: [String], props: [String]) -> String? {
        guard let sel = jsonLiteral(selectors), let pr = jsonLiteral(props) else { return nil }
        return """
        (function () {
          var sels = \(sel), props = \(pr), out = [];
          for (var i = 0; i < sels.length; i++) {
            var el = document.querySelector(sels[i]);
            if (!el) { out.push({ selector: sels[i], missing: true }); continue; }
            var r = el.getBoundingClientRect(), cs = getComputedStyle(el), st = {};
            for (var j = 0; j < props.length; j++) st[props[j]] = cs.getPropertyValue(props[j]);
            out.push({
              selector: sels[i],
              rect: { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) },
              styles: st,
            });
          }
          return JSON.stringify(out);
        })()
        """
    }

    private static func jsonLiteral(_ values: [String]) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: values),
              let text = String(data: data, encoding: .utf8) else { return nil }
        return text
    }
}
