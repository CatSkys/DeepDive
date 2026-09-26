// 浏览器缩放与页内查找：`pageZoom` 的档位/按站点记忆（值与键见 BrowserZoom.swift）与
// `WKFindConfiguration` 页内查找。
//
// 单独一份的理由：BrowserHost.swift 是"谁在驱动这个视图"（导航命令、槽位、观察），
// 而这两块是"网页以什么方式显示"，拆开既过了架构门的 300 行，读起来也不混。
import AppKit
import WebKit

extension BrowserHost {
    // MARK: - 缩放

    /// 直接设定缩放（夹在 BrowserZoom.range）。这是**用户意图**的唯一入口（工具栏/⌘±／设置页），
    /// 所以"按站点记住"就写在这里——提交时再写会把每个访问过的站点钉死在当时的默认值上。
    func setZoom(_ zoom: CGFloat) {
        let value = BrowserZoom.clamp(zoom)
        if abs(view.pageZoom - value) > 0.001 { view.pageZoom = value }
        BrowserZoom.remember(value, host: view.url?.host)
        publish()
    }

    /// 上下跳一档。
    func stepZoom(up: Bool) {
        setZoom(BrowserZoom.stepped(from: view.pageZoom, up: up))
    }

    /// 回到该站点的默认缩放（⌘0）。
    func resetZoom() {
        setZoom(BrowserZoom.forHost(view.url?.host))
    }

    /// 当前页面提交时上记忆：参考实现写在 `didCommit`（第一帧之前），
    /// 放加载完之后会先按 1 排一次版再跳，闪一下。
    func applyRememberedZoom() {
        guard let host = view.url?.host else { return }
        let wanted = BrowserZoom.forHost(host)
        if abs(view.pageZoom - wanted) > 0.001 { view.pageZoom = wanted }
    }

    // MARK: - 页内查找

    /// 页内查找（`WKFindConfiguration`，wraps 环绕；空串 = 取消查找并清选区）。
    func find(_ text: String, forward: Bool, completion: @escaping (Bool) -> Void) {
        guard !text.isEmpty else {
            view.evaluateJavaScript("window.getSelection().removeAllRanges()") { _, _ in completion(false) }
            return
        }
        let config = WKFindConfiguration()
        config.backwards = !forward
        config.wraps = true
        config.caseSensitive = false
        view.find(text, configuration: config) { result in completion(result.matchFound) }
    }
}
