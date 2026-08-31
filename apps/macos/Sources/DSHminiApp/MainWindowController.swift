import AppKit
import WebKit

/// Drag handle sitting BELOW the webview. The webview returns nil from
/// hitTest on blank titlebar-strip space, so mouseDown lands here and drags;
/// everything the strip keeps (buttons, inputs) is hit by the webview itself.
private final class TitlebarDragView: NSView {
    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}

/// WKWebView that turns blank space in the top strip into a window drag while
/// keeping real controls clickable. The frontend (frontend/src/titlebar.ts)
/// pushes a rect table of every interactive element intersecting the strip —
/// CSS viewport coords, y-down — through the "dshmini" message handler
/// whenever layout changes (resize, sidebar slide, menus). Rects are matched
/// against the live bounds height at hit time, so no cached height can go
/// stale. Until the first table arrives the view behaves like a plain
/// WKWebView (fail-open: no drag, no swallowed clicks).
private final class TitlebarAwareWebView: WKWebView {
    static let dragStripHeight: CGFloat = 52 // keep in sync with titlebar.ts
    /// Near-miss clicks around a control land on the control, not a drag.
    static let rectPadding: CGFloat = 6
    private var controlRects: [NSRect] = [] // CSS viewport coords (y-down)

    func setTitlebarControlRects(_ rects: [NSRect]) {
        if rects.count != controlRects.count {
            EngineLog.shared.append("[titlebar] control rects -> \(rects.count)")
        }
        controlRects = rects
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        let hit = super.hitTest(point)
        guard hit != nil else { return nil }
        guard !controlRects.isEmpty else { return hit }
        // Strip = top dragStripHeight points (AppKit y-up).
        guard point.y >= bounds.height - Self.dragStripHeight else { return hit }
        // The same point in CSS viewport coords (y-down from the top).
        let viewportPoint = NSPoint(x: point.x, y: bounds.height - point.y)
        for r in controlRects
        where r.insetBy(dx: -Self.rectPadding, dy: -Self.rectPadding).contains(viewportPoint) {
            return hit
        }
        return nil
    }
}

final class MainWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate {
    private let webView: WKWebView
    private let effectView = NSVisualEffectView()
    private var themeEnabled: Bool

    init(themeEnabled: Bool) {
        self.themeEnabled = themeEnabled

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "DSHmini"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 900, height: 560)
        window.setFrameAutosaveName("DSHminiMain")
        window.appearance = themeEnabled ? NSAppearance(named: .darkAqua) : nil

        // Semi-transparent dark glass: vibrancy + dark overlay (~85% opaque).
        effectView.material = .hudWindow
        effectView.blendingMode = .behindWindow
        effectView.state = .active
        let overlay = NSView()
        overlay.wantsLayer = true
        overlay.layer?.backgroundColor = NSColor(srgbRed: 16/255, green: 17/255, blue: 19/255, alpha: 0.85).cgColor

        let config = WKWebViewConfiguration()
        config.userContentController = WKUserContentController()
        let wv = TitlebarAwareWebView(frame: .zero, configuration: config)
        wv.setValue(false, forKey: "drawsBackground")
        wv.underPageBackgroundColor = .clear
        wv.allowsMagnification = false
        wv.isInspectable = true
        wv.appearance = themeEnabled ? NSAppearance(named: .darkAqua) : nil
        webView = wv

        super.init(window: window)

        // Rect-table channel from frontend/src/titlebar.ts; register before
        // any page load so the first push is never dropped.
        webView.configuration.userContentController.add(self, name: "dshmini")

        window.contentView = effectView
        overlay.frame = effectView.bounds
        overlay.autoresizingMask = [.width, .height]
        effectView.addSubview(overlay)
        // Full-bleed handle UNDER the webview: it only receives events the
        // webview lets fall through (blank strip space).
        let dragView = TitlebarDragView()
        dragView.frame = effectView.bounds
        dragView.autoresizingMask = [.width, .height]
        effectView.addSubview(dragView)
        webView.frame = effectView.bounds
        webView.autoresizingMask = [.width, .height]
        effectView.addSubview(webView)

        webView.navigationDelegate = self
        window.delegate = self

        applyTheme()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    // MARK: - URL

    func load(url: URL) {
        applyTheme()
        webView.load(URLRequest(url: url))
    }

    func reloadWeb() {
        if webView.url != nil {
            webView.reload()
            EngineLog.shared.append("[web] manual reload")
        }
    }

    func setTheme(_ enabled: Bool) {
        themeEnabled = enabled
        applyTheme()
        window?.appearance = enabled ? NSAppearance(named: .darkAqua) : nil
        if let url = webView.url {
            webView.load(URLRequest(url: url))
        }
    }

    private func applyTheme() {
        let controller = webView.configuration.userContentController
        controller.removeAllUserScripts()
        if themeEnabled {
            controller.addUserScript(WKUserScript(
                source: WebViewTheme.css,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true
            ))
        }
    }

    // MARK: - show / hide (anti-flicker panel)

    func togglePanel() {
        guard let window else { return }
        if window.isVisible && window.isKeyWindow {
            hidePanel()
        } else {
            showPanel()
        }
    }

    func showPanel() {
        guard let window else { return }
        showWindow(nil)
        window.alphaValue = 0
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.main.async {
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = 0.12
                window.animator().alphaValue = 1
            }
        }
    }

    func hidePanel() {
        guard let window, window.isVisible else { return }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.10
            window.animator().alphaValue = 0
        }, completionHandler: {
            window.orderOut(nil)
            window.alphaValue = 1
        })
    }

    // MARK: - NSWindowDelegate

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        hidePanel()
        return false
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        EngineLog.shared.append("[web] didFinish \(webView.url?.absoluteString ?? "")")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        EngineLog.shared.append("[web] didFail \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        EngineLog.shared.append("[web] provisionalFail \(error.localizedDescription)")
    }
}

// MARK: - WKScriptMessageHandler (titlebar rect table)

extension MainWindowController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "dshmini",
              let body = message.body as? [String: Any],
              body["type"] as? String == "titlebar-rects" else { return }
        let rects: [NSRect] = ((body["rects"] as? [[String: Any]]) ?? []).map { d in
            NSRect(
                x: d["x"] as? Double ?? 0,
                y: d["y"] as? Double ?? 0,
                width: d["w"] as? Double ?? 0,
                height: d["h"] as? Double ?? 0
            )
        }
        (webView as? TitlebarAwareWebView)?.setTitlebarControlRects(rects)
    }
}
