import AppKit

/// v0.1 monochrome glass theme over the official DSH web UI.
/// Contract (UI-SPEC v0.3): black & white only, no pointer cursor, no web
/// hover conventions, neutral scrollbars/selection, transparent body so the
/// NSVisualEffectView vibrancy shows through. Never restructures the official
/// UI's information architecture.
enum WebViewTheme {
    static let css = """
    html, body { background: transparent !important; }

    /* Platform convention: interactive controls never show a pointer. */
    *, a, button, [role="button"], .cursor-pointer { cursor: default !important; }
    input, textarea, [contenteditable="true"], [contenteditable=""] { cursor: text !important; }

    /* Neutral, quiet scrollbars. */
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
    ::-webkit-scrollbar-thumb { background-color: rgba(128,128,128,.22); border-radius: 5px; border: 2px solid transparent; background-clip: content-box; }
    ::-webkit-scrollbar-thumb:hover { background-color: rgba(128,128,128,.35); }

    /* Monochrome selection. */
    ::selection { background-color: rgba(255,255,255,.25); }
    * { -webkit-tap-highlight-color: transparent; }

    /* Soft glass corners for big surfaces. */
    .tippy-box, [class*="popover"], [role="dialog"] { border-radius: 16px !important; }
    """
}
