// 同源 React portal 的原生载体；只管理浮层的合成层级与命中区域，不复制菜单业务。
import AppKit
import WebKit

final class BrowserPopupView: WKWebView {
    var interactiveRects: [NSRect] = []

    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        guard interactiveRects.contains(where: { $0.contains(local) }) else { return nil }
        return super.hitTest(point)
    }
}

final class BrowserPopupHost: NSObject, WKUIDelegate {
    let view: BrowserPopupView
    private var monitor: Any?

    init(configuration: WKWebViewConfiguration, source: WKWebView) {
        view = BrowserPopupView(frame: source.frame, configuration: configuration)
        super.init()
        view.setValue(false, forKey: "drawsBackground")
        view.underPageBackgroundColor = .clear
        view.pageZoom = source.pageZoom
        view.autoresizingMask = [.width, .height]
        view.uiDelegate = self
        source.superview?.addSubview(view, positioned: .above, relativeTo: nil)
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .keyDown]) { [weak self] event in
            guard let self, event.window === self.view.window else { return event }
            if event.type == .keyDown {
                if event.keyCode == 53 { self.dismiss() }
            } else {
                let point = self.view.convert(event.locationInWindow, from: nil)
                if !self.view.interactiveRects.contains(where: { $0.contains(point) }) { self.dismiss() }
            }
            return event
        }
    }

    deinit {
        if let monitor { NSEvent.removeMonitor(monitor) }
    }

    func setRects(_ rects: [NSRect]) {
        let zoom = view.pageZoom
        view.interactiveRects = rects.map {
            NSRect(x: $0.minX * zoom, y: $0.minY * zoom, width: $0.width * zoom, height: $0.height * zoom)
        }
    }

    private func dismiss() {
        view.evaluateJavaScript("window.dispatchEvent(new Event('deepdive-popup-dismiss'))", completionHandler: nil)
    }

    func webViewDidClose(_ webView: WKWebView) {
        view.removeFromSuperview()
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }
}
