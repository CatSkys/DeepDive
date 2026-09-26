// 页面 → 壳的**拾取回话**（只有这一条是页面能主动发给壳的通道）。
//
// 为什么必须有这条路：按站隐藏的拾取要"人点页面上的元素"，而壳没有别的方式知道点中了什么——
// 页面里没有桥，只有一条 script message handler 能让它回话。
//
// 安全边界：这条通道**只在拾取模式开着时**认，而且只接受 {selector,label} 与 {cancel} 两种形状，
// 壳只能"记一条选择器"。所以页面伪造它的最大后果是"给自己藏一块元素"。通道挂在弱代理上
// （`WKUserContentController` 强持有 handler，挂宿主自己会成环，睡着的标签就回收不掉了）。
import WebKit

/// 页面 → 壳的拾取回话代理：弱持有宿主。
final class BrowserPickerProxy: NSObject, WKScriptMessageHandler {
    weak var host: BrowserHost?

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        host?.pickerReplied(message.body)
    }
}

extension BrowserHost {
    /// 进拾取模式：注入脚本、把状态推给 SPA（面板要显示"点页面上的元素…"）。
    func startPicking() {
        picking = true
        publish()
        evaluate(BrowserHidden.pickerScript) { [weak self] text in
            // 脚本没起来（页面拒绝执行/已在拾取）就退回原状，别让 SPA 显示在等点击
            if text != "picking" && text != "already" {
                self?.picking = false
                self?.publish()
            }
        }
    }

    func stopPicking() {
        guard picking else { return }
        picking = false
        publish()
        // 页面侧自己收摊（Esc/点完就已经收了；这里兜"从 SPA 取消"那一次）
        evaluate("(function(){if(window.__deepdivePicker){window.__deepdivePicker.stop();}return 'ok';})()") { _ in }
    }

    /// 拾取脚本回话（只认两种形状，且只在拾取模式开着时）。
    func pickerReplied(_ body: Any) {
        guard picking else { return }
        guard let payload = body as? [String: Any] else { return }
        if payload["cancel"] as? Bool == true {
            picking = false
            publish()
            onPickCancelled?()
            return
        }
        guard let selector = payload["selector"] as? String, !selector.isEmpty else { return }
        let label = payload["label"] as? String ?? selector
        picking = false
        publish()
        onPicked?(selector, label)
    }
}
