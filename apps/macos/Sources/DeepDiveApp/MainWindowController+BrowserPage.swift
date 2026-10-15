// 主窗口的浏览器接线之三：**页面改造**这一族——阅读模式（`browser-reader`），
// 以及按站隐藏（`browser-hidden`，见 BrowserHidden）。
//
// 与另外两份同一份理由：`MainWindowController+Browser.swift` 管槽位/导航/标签/查找/快捷键，
// `+BrowserPrivacy.swift` 管拦截与权限，这一份管"把页面本身改成另一版"。

import AppKit
import WebKit

extension MainWindowController {
    /// SPA 发来的阅读模式（`browser-reader`）：进 = 在页面里就地换成只有正文的那一版，
    /// 退 = 重新加载（页面已经被换过，没有"原来的 DOM"可回）。
    func handleBrowserReader(_ body: [String: Any]) {
        switch body["action"] as? String {
        case "enter":
            BrowserReader.enter(browserTabs.activeHost) { [weak self] result in
                guard let self else { return }
                // 找不到正文要说出来（参考实现也是这一条）：不能假装换好了
                if result != "read" { self.pushHostCommand("browserReaderFailed", payload: AppDelegate.jsonPayload([:])) }
            }
        case "exit":
            BrowserReader.exit(browserTabs.activeHost)
        default:
            EngineLog.shared.append("[browser] unknown reader command")
        }
    }

    /// SPA 发来的按站隐藏（`browser-hidden`）：进/退拾取模式、恢复一项、恢复本站全部、全部忘记。
    /// host 由壳自己从当前标签的地址取（SPA 不必也不该猜一个站点）。
    func handleBrowserHidden(_ body: [String: Any]) {
        let host = URL(string: browserTabs.active.url)?.host ?? ""
        switch body["action"] as? String {
        case "pick":
            browserTabs.activeHost.startPicking()
        case "cancelPick":
            browserTabs.activeHost.stopPicking()
        case "restore":
            guard let selector = body["selector"] as? String, !host.isEmpty else { return }
            BrowserHidden.shared.restore(selector: selector, host: host)
            BrowserHidden.shared.apply(browserTabs.activeHost, for: host)
            pushVeils()
        case "restoreAll":
            guard !host.isEmpty else { return }
            BrowserHidden.shared.restoreAll(host: host)
            BrowserHidden.shared.apply(browserTabs.activeHost, for: host)
            pushVeils()
        case "forgetAll":
            BrowserHidden.shared.forgetAll()
            BrowserHidden.shared.apply(browserTabs.activeHost, for: host)
            pushVeils()
        default:
            EngineLog.shared.append("[browser] unknown hidden command")
        }
    }

    /// 拾取回来了：记下、对当前页面立刻生效、告诉 SPA。
    func hiddenPicked(selector: String, label: String) {
        let host = URL(string: browserTabs.active.url)?.host ?? ""
        guard !host.isEmpty else { return }
        BrowserHidden.shared.hide(selector: selector, label: label, host: host)
        BrowserHidden.shared.apply(browserTabs.activeHost, for: host)
        pushVeils()
    }

    /// 隐藏的记忆变了：设置页那几行读的是 `browserShield` 这条推送（隐私状态一份），
    /// 面板菜单读的是当前标签的观察（"这一站藏了几项"），所以两条都要重推。
    func pushVeils() {
        pushShield()
        browserTabs.resync()
    }
}
