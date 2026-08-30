import AppKit
import WebKit

/// The single glass window hosting the official DSH web UI.
/// Anti-flicker contract (UI-SPEC §4): stage via alphaValue, keep the
/// occlusion detection off, animate in only after the view settled.
final class MainWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate {
    private let webView: WKWebView
    private let effectView = NSVisualEffectView()
    private var themeEnabled: Bool
    private var pendingURL: URL?

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
        // Forces the official web UI's `prefers-color-scheme: dark` media
        // query (dark-glass reference style); nil lets the system decide.
        window.appearance = themeEnabled ? NSAppearance(named: .darkAqua) : nil

        // Glass: real vibrancy behind a translucent web view. A light dark
        // tint keeps it near-black over any wallpaper while the effect view
        // still blurs what is behind the window (reference-style depth). The
        // page's own translucent layers do the rest of the glass work.
        effectView.material = .hudWindow
        effectView.blendingMode = .behindWindow
        effectView.state = .active
        effectView.wantsLayer = true
        effectView.layer?.backgroundColor = NSColor(srgbRed: 14/255, green: 14/255, blue: 16/255, alpha: 0.42).cgColor

        // WKWebView tuned for a launcher-style surface.
        let config = WKWebViewConfiguration()
        config.userContentController = WKUserContentController()
        let wv = WKWebView(frame: .zero, configuration: config)
        wv.setValue(false, forKey: "drawsBackground")
        wv.underPageBackgroundColor = .clear
        wv.allowsMagnification = false
        wv.isInspectable = true
        // prefers-color-scheme follows the web view's own appearance, not the
        // window's; pin it so the SPA always renders the dark glass palette.
        wv.appearance = themeEnabled ? NSAppearance(named: .darkAqua) : nil
        webView = wv

        super.init(window: window)

        window.contentView = effectView
        effectView.addSubview(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: effectView.topAnchor),
            webView.bottomAnchor.constraint(equalTo: effectView.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: effectView.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: effectView.trailingAnchor),
        ])

        webView.navigationDelegate = self
        window.delegate = self
        applyTheme()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    // MARK: - URL

    func load(url: URL) {
        pendingURL = nil
        applyTheme()
        webView.load(URLRequest(url: url))
    }

    func setTheme(_ enabled: Bool) {
        themeEnabled = enabled
        applyTheme()
        // The official UI reads `prefers-color-scheme`; on = dark glass.
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
        // Wait one runloop turn; WebKit had a frame to draw while alpha = 0.
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
