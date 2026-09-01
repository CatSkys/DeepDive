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

    /// Frontend asks the shell to act (SPEC-NOTIFICATIONS §3.1 前端→外壳):
    /// host-ready / restart-engine / rebind-hotkey / set-pref / set-theme /
    /// get-prefs / reveal-home / open-host-doc. Routed to AppDelegate.
    var onHostMessage: (([String: Any]) -> Void)?
    /// Shell→frontend pending instruction: at most one, last-wins; flushed
    /// when the page finishes loading or the frontend reports `host-ready`.
    private var pendingHostCommand: (cmd: String, payload: String)?

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
        // Host-command channel (§3.1): frontend posts open-settings/host-ready.
        webView.configuration.userContentController.add(self, name: "dshminiHost")

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
        // JS alert()/confirm()/prompt() need a WKUIDelegate; without one they
        // are silent no-ops (the ctx-menu rename used window.prompt and just
        // did nothing).
        webView.uiDelegate = self
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
        // §3.1 联动指令：reload 已同步主题；再推一次 themeChanged 供前端钩子
        // 做 data-theme 切换（未就绪时经 pending 在新页面加载后投递）。
        pushHostCommand("themeChanged", payload: #"{"dark":\#(enabled ? "true" : "false")}"#)
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

    // MARK: - shell → frontend bridge (SPEC-NOTIFICATIONS §3.1)

    /// Pushes one instruction to `window.__dshminiHost.dispatch(cmd, payload)`.
    /// If the host hook is not mounted (cold start / reload in progress) the
    /// command is staged as pending (single, last-wins) and flushed after the
    /// next page load — a click intent is never silently dropped (§3.1 v2.1).
    func pushHostCommand(_ cmd: String, payload: String) {
        dispatchHostCommand(cmd, payload: payload) { [weak self] delivered in
            if !delivered {
                self?.pendingHostCommand = (cmd, payload)
            }
        }
    }

    private func dispatchHostCommand(_ cmd: String, payload: String, completion: @escaping (Bool) -> Void) {
        guard webView.url != nil else {
            completion(false)
            return
        }
        let js = "window.__dshminiHost ? (window.__dshminiHost.dispatch('\(cmd)', \(payload)), 'ok') : 'no-host'"
        webView.evaluateJavaScript(js) { result, _ in
            completion((result as? String) == "ok")
        }
    }

    private func flushPendingHostCommand() {
        guard let (cmd, payload) = pendingHostCommand else { return }
        pendingHostCommand = nil
        dispatchHostCommand(cmd, payload: payload) { [weak self] delivered in
            if !delivered {
                self?.pendingHostCommand = (cmd, payload)
            } else {
                EngineLog.shared.append("[bridge] flushed pending host command \(cmd)")
            }
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
        // Backup flush for the `host-ready` signal (handler may fire before
        // React mounts the hook; if it is still missing the command re-stages).
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.flushPendingHostCommand()
        }
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
        if message.name == "dshmini" {
            handleTitlebarRects(message)
            return
        }
        if message.name == "dshminiHost" {
            handleHostMessage(message)
            return
        }
    }

    private func handleTitlebarRects(_ message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
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

    private func handleHostMessage(_ message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }
        EngineLog.shared.append("[bridge] host message: \(type)")
        onHostMessage?(body)
    }
}

// MARK: - WKUIDelegate (JS alert / confirm / prompt panels)

extension MainWindowController: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "DSHmini"
        alert.informativeText = message
        alert.addButton(withTitle: "好")
        alert.runModal()
        completionHandler()
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "DSHmini"
        alert.informativeText = message
        alert.addButton(withTitle: "好")
        alert.addButton(withTitle: "取消")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "DSHmini"
        alert.informativeText = prompt
        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        input.stringValue = defaultText ?? ""
        alert.accessoryView = input
        alert.addButton(withTitle: "好")
        alert.addButton(withTitle: "取消")
        alert.window.initialFirstResponder = input
        let ok = alert.runModal() == .alertFirstButtonReturn
        completionHandler(ok ? input.stringValue : nil)
    }
}
