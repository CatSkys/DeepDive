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
    /// 参数是（选择器数组, 属性名数组, 完成回调），**异步**回调一段 JSON 文本
    /// （原生事实 + 节点列表）；回调 nil = 取不到（窗口没了、脚本拼不出来、
    /// webview 不应答），按失败回。
    ///
    /// 必须是异步的：WKWebView 的 evaluateJavaScript 回调只在主线程跑，而量界面
    /// 本身也得在主线程——在主线程上等它就是自锁（曾如此，每请求恒定超时）。
    static var measureProvider: ((_ selectors: [String], _ props: [String], _ points: [[Double]], _ done: @escaping (String?) -> Void) -> Void)?

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

    /// 是不是探针请求？是就把处理结果一并给出（桥那边只留一行钩子）。
    /// 放在静态兜底与 engineBase 闸之前——引擎挂掉期间恰恰最需要看界面。
    static func responds(to request: MiniHTTPServer.Request) -> MiniHTTPServer.Response? {
        guard request.method == "POST", request.path == "/__probe" else { return nil }
        return handle(request)
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
        let points = (body["points"] as? [[Double]] ?? []).prefix(maxSelectors).map { $0 }
        guard !selectors.isEmpty || !points.isEmpty else {
            return json(["ok": false, "error": "no selectors"])
        }
        // 主线程发起量测、连接线程等结果：等待绝不能发生在主线程。provider 自身
        // 是异步的（见其注释），所以派发块立刻就返回，主线程不会被占住。
        // 桥的每个连接一个线程，这里等满 timeout 也不会拖累界面。
        var payload: String?
        let done = DispatchSemaphore(value: 0)
        DispatchQueue.main.async {
            measure(Array(selectors), props, Array(points)) { text in
                payload = text
                done.signal()
            }
        }
        // 超时按失败回：宁可报超时，也不把一个挂死的 webview 变成永久占住的连接。
        guard done.wait(timeout: .now() + .milliseconds(timeoutMs)) != .timedOut,
              let text = payload,
              let data = text.data(using: .utf8) else {
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
    static func script(selectors: [String], props: [String], points: [[Double]] = []) -> String? {
        guard let sel = jsonLiteral(selectors), let pr = jsonLiteral(props), let pts = jsonLiteral(points) else { return nil }
        return """
        (function () {
          var sels = \(sel), props = \(pr), out = [];
          for (var i = 0; i < sels.length; i++) {
            var el = document.querySelector(sels[i]);
            if (!el) { out.push({ selector: sels[i], missing: true }); continue; }
            var r = el.getBoundingClientRect(), cs = getComputedStyle(el), st = {};
            for (var j = 0; j < props.length; j++) st[props[j]] = cs.getPropertyValue(props[j]);
            st.scrollWidth = el.scrollWidth; st.scrollHeight = el.scrollHeight;
            st.clientWidth = el.clientWidth; st.clientHeight = el.clientHeight;
            st.scrollTop = el.scrollTop; st.scrollLeft = el.scrollLeft;
            st.childElementCount = el.childElementCount;
            out.push({
              selector: sels[i],
              rect: { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) },
              styles: st,
            });
          }
          var pts = \(pts);
          for (var k = 0; k < pts.length; k++) {
            var hits = [], el = document.elementFromPoint(pts[k][0], pts[k][1]);
            for (var d = 0; el && d < 8; d++) {
              var r = el.getBoundingClientRect();
              hits.push({ tag: el.tagName, cls: String(el.className && el.className.baseVal !== undefined ? "" : el.className || ""),
                          id: el.id || "", rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) } });
              el = el.parentElement;
            }
            out.push({ point: pts[k], hits: hits });
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

    private static func jsonLiteral(_ values: [[Double]]) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: values),
              let text = String(data: data, encoding: .utf8) else { return nil }
        return text
    }
}
