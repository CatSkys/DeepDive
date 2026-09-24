// 侧栏浏览器的 agent 控制面：MCP server（随包分发的 Node 脚本，暴露单个 `js` 工具）把
// 命令 POST 到桥的 /browser-control，这里落到壳里的同一个 BrowserHost。
//
// 分层照 ZCode：**高层语义（快照/ref/点击/输入）在 JS 侧**（随包的 browser-client SDK
// 拼页面脚本），壳只提供原语——导航、观察、截图、执行 JS、轮询等待。所以壳不认识 ref、
// 不认识选择器，也不会因为 SDK 换代而改。
//
// 鉴权：boot 级随机 token（EngineSupervisor 随 env 交给 MCP server），Authorization 头带它。
// 桥的 Origin 全等闸不动——回环上的非浏览器客户端本就不带 Origin。

import Foundation

enum BrowserControl {
    /// 本次 boot 的控制 token（进程内随机，不落盘）。
    static let token = UUID().uuidString.replacingOccurrences(of: "-", with: "")

    /// 取当前窗口的浏览器宿主：桥是单例、窗口控制器不是，所以由窗口控制器装这个口子
    /// （弱捕获，窗口没了就回 nil）。
    static var hostProvider: (() -> BrowserHost?)?

    /// 轮询等待的硬上限：SDK 会给 timeoutMs，这里再兜一层，免得一个坏请求把线程占住。
    private static let maxWaitMs = 30_000

    /// 处理一次控制请求（同步；MiniHTTPServer 每个连接一个线程）。
    static func handle(_ request: MiniHTTPServer.Request) -> MiniHTTPServer.Response {
        guard request.headers["authorization"] == "Bearer \(token)" else {
            return .init(status: 403, body: Data("forbidden".utf8))
        }
        guard let command = (try? JSONSerialization.jsonObject(with: request.body)) as? [String: Any],
              let method = command["method"] as? String else {
            return json(["ok": false, "error": "malformed command"])
        }
        let semaphore = DispatchSemaphore(value: 0)
        var result: [String: Any] = ["ok": false, "error": "no browser"]
        DispatchQueue.main.async {
            result = execute(method: method, command: command, host: hostProvider?())
            semaphore.signal()
        }
        // 等待必须在主线程之外（execute 自己也在主线程跑），否则死锁
        if semaphore.wait(timeout: .now() + .milliseconds(maxWaitMs + 5_000)) == .timedOut {
            return json(["ok": false, "error": "timeout"])
        }
        return json(result)
    }

    /// 主线程上的命令分发。
    private static func execute(method: String, command: [String: Any], host: BrowserHost?) -> [String: Any] {
        guard let host else { return ["ok": false, "error": "no browser host"] }
        switch method {
        case "navigate":
            guard let url = command["url"] as? String, let parsed = URL(string: url), BrowserHost.allowed(parsed) else {
                return ["ok": false, "error": "navigation_blocked: only http/https/about:blank are allowed"]
            }
            host.load(url)
            return ["ok": true]
        case "back": host.goBack(); return ["ok": true]
        case "forward": host.goForward(); return ["ok": true]
        case "reload": host.reload(); return ["ok": true]
        case "get_state": return state(host)
        case "screenshot":
            var out: [String: Any] = ["ok": false, "error": "snapshot failed"]
            host.screenshot { base64 in
                guard let base64 else { return }
                out = ["ok": true, "image": ["base64": base64, "mimeType": "image/png"]]
            }
            // takeSnapshot 的回调在异步派发，这里用 runloop 泵到它回来（上限 10s）
            pumpUntil(timeout: 10) { out["ok"] as? Bool == true }
            return out
        case "evaluate":
            guard let script = command["script"] as? String else {
                return ["ok": false, "error": "evaluate needs a script"]
            }
            var out: [String: Any] = ["ok": false, "error": "evaluate timed out"]
            host.evaluate(script) { text in out = ["ok": true, "result": text] }
            pumpUntil(timeout: 10) { out["ok"] as? Bool == true }
            return out
        case "wait_for":
            guard let script = command["script"] as? String else {
                return ["ok": false, "error": "wait_for needs a script"]
            }
            return waitFor(host: host, script: script, timeoutMs: command["timeoutMs"] as? Int ?? 3_000)
        default:
            return ["ok": false, "error": "unknown method: \(method)"]
        }
    }

    private static func state(_ host: BrowserHost) -> [String: Any] {
        let view = host.view
        return [
            "ok": true,
            "state": [
                "url": view.url?.absoluteString ?? "",
                "title": view.title ?? "",
                "loading": view.isLoading,
                "canGoBack": view.canGoBack,
                "canGoForward": view.canGoForward,
            ],
        ]
    }

    /// 轮询执行一段返回真值的页面脚本（ZCode 的 waitFor 语义：可观察状态优先，不睡固定时长）。
    private static func waitFor(host: BrowserHost, script: String, timeoutMs: Int) -> [String: Any] {
        let deadline = Date().addingTimeInterval(Double(min(timeoutMs, maxWaitMs)) / 1000)
        var last = "false"
        while Date() < deadline {
            var out: [String: Any] = ["ok": false]
            host.evaluate(script) { text in out = ["ok": true, "result": text] }
            pumpUntil(timeout: 5) { out["ok"] as? Bool == true }
            last = out["result"] as? String ?? last
            if last == "true" { return ["ok": true, "result": "true"] }
            RunLoop.current.run(until: Date().addingTimeInterval(0.15))
        }
        return ["ok": false, "error": "timeout waiting for condition (last: \(last))"]
    }

    /// 在主线程上泵 runloop 直到条件成立或超时（WKWebView 的回调都是主线程派发的）。
    private static func pumpUntil(timeout: TimeInterval, _ done: () -> Bool) {
        let deadline = Date().addingTimeInterval(timeout)
        while !done() && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.02))
        }
    }

    private static func json(_ object: [String: Any]) -> MiniHTTPServer.Response {
        let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
        return .init(status: 200, headers: ["content-type": "application/json"], body: data)
    }
}
