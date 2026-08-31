import AppKit

/// Shell-level CSS injected into the web view (「黑白主题」toggle reload).
///
/// Since the self-built SPA (frontend/src) owns its full stylesheet
/// (frontend/src/theme.css — dark glass, monochrome), this file is a thin
/// fallback for the two properties the page itself must not own: the
/// transparent html/body that lets the NSVisualEffectView vibrancy through
/// (the WKWebView is `drawsBackground = false`) and the forced dark
/// color-scheme. Do NOT grow token/catalog overrides here — the era of
/// restyling the official `dsh web` UI is gone; style the SPA in theme.css.
enum WebViewTheme {
    static let css = """
    html, body { background: transparent !important; color-scheme: dark; }
    """
}
