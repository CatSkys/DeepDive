import AppKit

/// Dark-glass monochrome theme over the official DSH web UI.
///
/// Implementation note (reviewed against official docs):
/// The Browser client owns theme state through `ctx.theme`
/// (`register()` / `overrideTokens()`), and all colors come from the
/// `--dsw-alias-*` semantic tokens. The official client-plugin path (a
/// `dsh.client` bundle calling `ctx.theme.overrideTokens`) is the P2 target;
/// v1 injects overrides of the same token names — physically the same
/// composition, different carrier. The official UI's own dark palette is
/// engaged via the window appearance (darkAqua → `prefers-color-scheme`),
/// so this file only has to restyle, not re-theme.
///
/// Contract (UI-SPEC v0.3): black & white only — no brand color, no colored
/// status; symbols + brightness carry meaning. Content-layer diff colors are
/// left to the official markdown/diff tokens.
enum WebViewTheme {
    static let css = """
    html, body { background: transparent !important; color-scheme: dark; }

    /* ── surfaces: dark glass (vibrancy shows through the web view) ── */
    :root {
      --dsw-alias-bg-base: rgba(14,14,16,.55) !important;
      --dsw-alias-bg-module-platform: rgba(255,255,255,.03) !important;
      --dsw-alias-bg-layer-1: rgba(255,255,255,.04) !important;
      --dsw-alias-bg-layer-2: rgba(255,255,255,.06) !important;
      --dsw-alias-bg-layer-3: rgba(255,255,255,.09) !important;
      --dsw-alias-bg-overlay: rgba(18,18,22,.88) !important;
      --dsw-alias-bg-mask-1: rgba(0,0,0,.40) !important;
      --dsw-alias-bg-mask-2: rgba(0,0,0,.30) !important;
      --dsw-alias-bg-mask-3: rgba(0,0,0,.20) !important;
      --dsw-alias-bg-mask-drop: rgba(0,0,0,.55) !important;
      --dsw-alias-bg-multi-select: rgba(255,255,255,.10) !important;
      --dsw-alias-bg-skeleton: rgba(255,255,255,.08) !important;
      --dsw-alias-toast-bg: rgba(30,30,34,.92) !important;
      --dsw-alias-tooltip-bg: rgba(34,34,38,.95) !important;

      /* ── brand → monochrome ── */
      --dsw-alias-brand-primary: #F2F2F3 !important;
      --dsw-alias-brand-primary-invert: #141416 !important;
      --dsw-alias-brand-text: #F2F2F3 !important;
      --dsw-alias-label-primary-bluish: #F2F2F3 !important;
      --dsw-alias-button-primary-fill: #F2F2F3 !important;
      --dsw-alias-button-primary-hover: #FFFFFF !important;
      --dsw-alias-button-primary-dimmed: rgba(255,255,255,.55) !important;
      --dsw-alias-button-contrast-fill: #141416 !important;
      --dsw-alias-button-elevated-fill: rgba(255,255,255,.10) !important;
      --dsw-alias-button-floating-fill: rgba(40,40,44,.85) !important;
      --dsw-alias-button-floating-hover: rgba(52,52,56,.90) !important;
      --dsw-alias-button-info-fill: rgba(255,255,255,.90) !important;
      --dsw-alias-button-info-hover: #FFFFFF !important;
      --dsw-alias-button-tool-bar-fill: rgba(255,255,255,.06) !important;
      --dsw-alias-button-tool-bar-fill-invisible: transparent !important;
      --dsw-alias-button-tool-bar-hover: rgba(255,255,255,.12) !important;
      --dsw-alias-interactive-bg-hover-accent: rgba(255,255,255,.12) !important;
      --dsw-alias-interactive-bg-hover: rgba(255,255,255,.06) !important;
      --dsw-alias-interactive-bg-hover-danger: rgba(255,255,255,.10) !important;
      --dsw-alias-interactive-bg-hover-solid: rgba(255,255,255,.12) !important;
      --dsw-alias-interactive-bg-active: rgba(255,255,255,.10) !important;

      /* ── status semantics: symbols + brightness (monochrome) ── */
      --dsw-alias-state-warn-primary: #F2F2F3 !important;
      --dsw-alias-state-warn-secondary: rgba(255,255,255,.60) !important;
      --dsw-alias-state-warn-tertiary: rgba(255,255,255,.35) !important;
      --dsw-alias-state-warn-label: #F2F2F3 !important;
      --dsw-alias-state-error-primary: #F2F2F3 !important;
      --dsw-alias-state-error-secondary: rgba(255,255,255,.70) !important;
      --dsw-alias-state-success-primary: #ABABB0 !important;
      --dsw-alias-state-success-secondary: rgba(255,255,255,.50) !important;
      --dsw-alias-state-success-tertiary: rgba(255,255,255,.30) !important;
      --dsw-alias-state-business-primary: #F2F2F3 !important;
      --dsw-alias-state-business-tertiary: rgba(255,255,255,.60) !important;
      --dsw-alias-label-error: #F2F2F3 !important;
    }

    /* ── platform conventions ── */
    *, a, button, [role="button"], .cursor-pointer { cursor: default !important; }
    input, textarea, [contenteditable="true"], [contenteditable=""] { cursor: text !important; }

    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
    ::-webkit-scrollbar-thumb {
      background-color: rgba(128,128,128,.22); border-radius: 5px;
      border: 2px solid transparent; background-clip: content-box;
    }
    ::-webkit-scrollbar-thumb:hover { background-color: rgba(128,128,128,.35); }

    ::selection { background-color: rgba(255,255,255,.25); }
    * { -webkit-tap-highlight-color: transparent; }
    """
}
