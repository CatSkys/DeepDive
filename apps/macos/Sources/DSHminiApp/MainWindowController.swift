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
/// CSS viewport coords, y-down — through the "deepdive" message handler
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

/// macOS 26 (Tahoe) draws two window-corner classes: titlebar-only windows
/// get the small radius (~16pt), windows with a VISIBLE toolbar get the large
/// official radius (~26pt — the same continuous-curvature shape as
/// Finder/Notes, applied and clipped by the WindowServer). This shell draws
/// its whole titlebar in the web layer, so the toolbar exists ONLY to select
/// the large-radius class: titlebarAppearsTransparent keeps it invisible,
/// zero items keep it non-interactive, and blank-strip clicks still fall
/// through to the drag machinery (hitTest verified identical on 26.5).
///
/// DO NOT remove it and DO NOT set isVisible = false — a hidden or missing
/// toolbar silently reverts the window to the small-radius class, and the
/// frontend radius scale is anchored at 26 (tokens.json radius.window;
/// theme.css concentric ladder).
private final class EmptyToolbarDelegate: NSObject, NSToolbarDelegate {
    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { [] }
    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { [] }
}

final class MainWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate {
    private let webView: WKWebView
    private let effectView = NSVisualEffectView()
    /// 暗色玻璃上叠的暗色 tint；亮色外观下随 applyAppearanceMode 换成浅 tint。
    private let tintView = NSView()
    private var themeEnabled: Bool

    /// Frontend asks the shell to act (SPEC-NOTIFICATIONS §3.1 前端→外壳):
    /// host-ready / restart-engine / rebind-hotkey / set-pref / set-theme /
    /// get-prefs / reveal-home / reveal-path / copy-log-path / open-host-doc /
    /// pick-workspace / dictation-start / dictation-stop. Routed to AppDelegate.
    var onHostMessage: (([String: Any]) -> Void)?
    /// Shell→frontend pending instruction: at most one, last-wins; flushed
    /// when the page finishes loading or the frontend reports `host-ready`.
    /// Staged host command with a staging deadline. A click intent is worth
    /// replaying only while it is still fresh: an undelivered
    /// `navigateToSession` that lingers across reloads (engine restarts,
    /// manual refresh) would otherwise yank the user into a stale session
    /// long after the click (user report: "an unknown session opens by
    /// itself"). Past the deadline the stage is dropped.
    private var pendingHostCommand: (cmd: String, payload: String, stagedAt: Date)?
    /// Feeds the window's visible-but-empty toolbar (see EmptyToolbarDelegate).
    /// NSToolbar.delegate is weak, so the controller must retain it.
    private let emptyToolbarDelegate = EmptyToolbarDelegate()
    /// Observes effectiveAppearance so appearance=system follows the OS live.
    private var appearanceObservation: NSKeyValueObservation?

    /// 暗色玻璃的 HUD 底 tint（恒暗）；亮色换成近白浅灰（主界面偏白）。
    private static let darkTint = NSColor(srgbRed: 16/255, green: 17/255, blue: 19/255, alpha: 0.85)
    private static let lightTint = NSColor(srgbRed: 244/255, green: 244/255, blue: 246/255, alpha: 0.88)

    init(themeEnabled: Bool) {
        self.themeEnabled = themeEnabled

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "DeepDive"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        // Tahoe large-corner class (see EmptyToolbarDelegate): an empty,
        // visible, transparent toolbar. Verified side effect on 26.5 — the
        // traffic lights' default center line moves 16 → 26pt, exactly our
        // headerCenterY, so alignTrafficLights() becomes a no-op there and
        // stays as the belt-and-suspenders for fullscreen/edge cases.
        let toolbar = NSToolbar(identifier: "DeepDiveTitlebar")
        toolbar.delegate = emptyToolbarDelegate
        window.toolbar = toolbar
        window.titlebarSeparatorStyle = .none
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 900, height: 560)
        window.setFrameAutosaveName("DeepDiveMain")
        window.appearance = themeEnabled ? NSAppearance(named: .darkAqua) : nil

        // Semi-transparent dark glass: vibrancy + dark overlay (~85% opaque).
        effectView.material = .hudWindow
        effectView.blendingMode = .behindWindow
        effectView.state = .active
        let overlay = tintView
        overlay.wantsLayer = true
        overlay.layer?.backgroundColor = Self.darkTint.cgColor

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
        // AUD-023（M5-23 备案）：add(_:name:) 对 self 强持有，控制器与窗口/
        // 应用同生命周期不释放——已知悉，勿"清理"。
        webView.configuration.userContentController.add(self, name: "deepdive")
        // Host-command channel (§3.1): frontend posts open-settings/host-ready.
        webView.configuration.userContentController.add(self, name: "deepdiveHost")

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

        // AppKit places the traffic lights after the window is first laid
        // out, so align async. Since the empty toolbar attaches, their
        // default center already sits on the 26pt header line.
        DispatchQueue.main.async { [weak self] in
            self?.alignTrafficLights()
            self?.applyAppearanceMode()
        }
    }

    // MARK: - traffic-light alignment

    /// Shared header center line: the geometric middle of the 52px drag strip
    /// (titlebar.ts STRIP_HEIGHT). The frontend header row is built to the
    /// same line — theme.css `.window-top` (top 9 + 34/2 buttons) and
    /// `.session-header`/`.hero-top` (padding 7 + line half) both center at 26.
    private static let headerCenterY: CGFloat = 26

    /// Shifts the three standard window buttons onto `headerCenterY`. The
    /// math is done in contentView coordinates (unflipped, y-up): target
    /// top-down CSS y → `height - y`. The delta is then applied in the
    /// button container's own coords, honoring its `isFlipped` — assuming a
    /// coordinate convention there instead of asking was exactly the bug
    /// this replaces (the lights jumped to the window's top edge).
    private func alignTrafficLights() {
        guard let window, !window.styleMask.contains(.fullScreen),
              let content = window.contentView else { return }
        let targetY = content.bounds.height - Self.headerCenterY
        for kind: NSWindow.ButtonType in [.closeButton, .miniaturizeButton, .zoomButton] {
            guard let button = window.standardWindowButton(kind), let container = button.superview else { continue }
            let center = button.convert(CGPoint(x: button.bounds.midX, y: button.bounds.midY), to: content)
            let delta = targetY - center.y
            guard delta != 0 else { continue }
            var frame = button.frame
            frame.origin.y += container.isFlipped ? -delta : delta
            button.setFrameOrigin(frame.origin)
        }
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

    // MARK: - appearance（跟随系统 / 亮 / 暗）

    /// Applies DSHAppPrefs.appearance to window + web view and pushes the
    /// effective scheme to the frontend. "system" clears the explicit
    /// appearance (inherits the OS) and the KVO below re-pushes on change.
    func applyAppearanceMode() {
        let mode = DSHAppPrefs.appearance
        // 跟随系统时看"生效外观"决定材质/tint（hudWindow 恒暗，亮系统必须换浅材质）
        let light = mode == "light" || (mode == "system" && NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .aqua)
        let appearance: NSAppearance? = mode == "system" ? nil : NSAppearance(named: light ? .aqua : .darkAqua)
        window?.appearance = appearance
        webView.appearance = appearance
        effectView.material = light ? .sidebar : .hudWindow
        tintView.layer?.backgroundColor = (light ? Self.lightTint : Self.darkTint).cgColor
        pushScheme()
        if appearanceObservation == nil {
            appearanceObservation = window?.observe(\.effectiveAppearance, options: [.new]) { [weak self] _, _ in
                // 系统明暗翻转（appearance=system）：材质/tint/页面主题一起重应用
                self?.applyAppearanceMode()
            }
        }
    }

    var isEffectiveDark: Bool {
        let effective = window?.effectiveAppearance ?? NSApp.effectiveAppearance
        return effective.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
    }

    private func pushScheme() {
        pushHostCommand("themeChanged", payload: AppDelegate.jsonPayload(["dark": isEffectiveDark]))
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
        pushHostCommand("themeChanged", payload: AppDelegate.jsonPayload(["dark": enabled]))
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

    /// Pushes one instruction to `window.__deepDiveHost.dispatch(cmd, payload)`.
    /// If the host hook is not mounted (cold start / reload in progress) the
    /// command is staged as pending (single, last-wins) and flushed after the
    /// next page load — a click intent is never silently dropped (§3.1 v2.1).
    /// Staged commands expire (see `pendingHostCommand`): a click only stays
    /// meaningful while it is fresh.
    func pushHostCommand(_ cmd: String, payload: String) {
        dispatchHostCommand(cmd, payload: payload) { [weak self] delivered in
            if !delivered {
                self?.pendingHostCommand = (cmd, payload, Date())
            }
        }
    }

    private func dispatchHostCommand(_ cmd: String, payload: String, completion: @escaping (Bool) -> Void) {
        guard webView.url != nil else {
            completion(false)
            return
        }
        let js = "window.__deepDiveHost ? (window.__deepDiveHost.dispatch('\(cmd)', \(payload)), 'ok') : 'no-host'"
        webView.evaluateJavaScript(js) { result, _ in
            completion((result as? String) == "ok")
        }
    }

    /// A staged click is replayed only within 15s of staging; an older one is
    /// dropped — replaying a stale navigateToSession would fling the user into
    /// a session they no longer expect.
    private static let stagedCommandLifetime: TimeInterval = 15

    private func flushPendingHostCommand() {
        guard let (cmd, payload, stagedAt) = pendingHostCommand else { return }
        pendingHostCommand = nil
        guard Date().timeIntervalSince(stagedAt) <= Self.stagedCommandLifetime else {
            EngineLog.shared.append("[bridge] dropped stale staged host command \(cmd)")
            return
        }
        dispatchHostCommand(cmd, payload: payload) { [weak self] delivered in
            if !delivered {
                self?.pendingHostCommand = (cmd, payload, Date())
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

    /// 面板可见意图（AUD-080）：hide 动画的完成回调凭它识别"动画窗内又发生
    /// 了 show"——完成回调无脑 orderOut 会把刚唤起的窗口盖掉。
    private var panelVisibleIntent = false

    func showPanel() {
        guard let window else { return }
        panelVisibleIntent = true
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
        panelVisibleIntent = false
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.10
            window.animator().alphaValue = 0
        }, completionHandler: {
            // 动画期间若又 show（意图已翻回可见），放弃收尾，交给后到的动画
            guard self.panelVisibleIntent == false else { return }
            window.orderOut(nil)
            window.alphaValue = 1
        })
    }

    // MARK: - NSWindowDelegate

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        hidePanel()
        return false
    }

    func windowDidResize(_ notification: Notification) {
        alignTrafficLights()
    }

    func windowDidBecomeKey(_ notification: Notification) {
        alignTrafficLights()
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
        if message.name == "deepdive" {
            handleTitlebarRects(message)
            return
        }
        if message.name == "deepdiveHost" {
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
        alert.messageText = "DeepDive"
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
        alert.messageText = "DeepDive"
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
        alert.messageText = "DeepDive"
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
