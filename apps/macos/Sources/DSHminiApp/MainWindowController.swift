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

        // Semi-transparent dark glass: real vibrancy (behindWindow) + a dark
        // overlay at ~85% opaque. Content stays readable, the wallpaper still
        // ghosts through — the reference panel look. (0.42 washed out; a fully
        // opaque base killed the glass entirely.)
        effectView.material = .hudWindow
        effectView.blendingMode = .behindWindow
        effectView.state = .active
        let overlay = NSView()
        overlay.wantsLayer = true
        overlay.layer?.backgroundColor = NSColor(srgbRed: 16/255, green: 17/255, blue: 19/255, alpha: 0.85).cgColor
        // Liquid-glass specular arc across the window top (radial white falloff).
        let arc = CAGradientLayer()
        arc.colors = [
            NSColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.09).cgColor,
            NSColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.0).cgColor,
        ]
        arc.locations = [0.0, 0.28]
        arc.startPoint = CGPoint(x: 0.5, y: 0)
        arc.endPoint = CGPoint(x: 0.5, y: 1)
        arc.frame = NSRect(x: 0, y: 0, width: 1100, height: 220)
        overlay.layer?.addSublayer(arc)

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

        // Frame-based fullbleed layout (robust across window resize / autosave
        // restore; constraint re-layout was hanging behind some frames).
        window.contentView = effectView
        overlay.frame = effectView.bounds
        overlay.autoresizingMask = [.width, .height]
        effectView.addSubview(overlay)
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
