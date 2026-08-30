import AppKit
import WebKit

/// The single glass window hosting the DSHmini SPA.
/// Anti-flicker contract (UI-SPEC §4): stage via alphaValue, animate in after
/// the view settled; layout is frame-based fullbleed.
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
        let wv = WKWebView(frame: .zero, configuration: config)
        wv.setValue(false, forKey: "drawsBackground")
        wv.underPageBackgroundColor = .clear
        wv.allowsMagnification = false
        wv.isInspectable = true
        wv.appearance = themeEnabled ? NSAppearance(named: .darkAqua) : nil
        webView = wv

        super.init(window: window)

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
        applyTheme()
        webView.load(URLRequest(url: url))
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
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
            webView.evaluateJavaScript(
                "(() => { const out = []; for (const el of document.querySelectorAll('.flow *')) { const cs = getComputedStyle(el); const bg = cs.backgroundImage + '|' + cs.backgroundColor; if (el.classList.length && (bg.includes('gradient') || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent'))) out.push(el.className + ' :: ' + bg.slice(0,90)); } return JSON.stringify(out.slice(0, 12)); })()"
            ) { result, _ in
                if let r = result { EngineLog.shared.append("[bg] \(r)") }
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        EngineLog.shared.append("[web] didFail \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        EngineLog.shared.append("[web] provisionalFail \(error.localizedDescription)")
    }
}
