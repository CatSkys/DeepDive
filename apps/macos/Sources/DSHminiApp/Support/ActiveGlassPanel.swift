import AppKit

/// A panel whose Liquid Glass keeps its active look while the panel is not key. Glass in a
/// window without the active appearance drops its edge: the vibrant rim layer inside
/// `NSGlassEffectView` and SwiftUI's `glassEffect` fades out, leaving a flat, borderless
/// surface. The capture overlay becomes key and so shows the rim on its toolbar; a panel that
/// never takes the keyboard while another app stays active (the selection toolbar, its menus,
/// the glass HUD, the mini panel) would never show it, so it claims the active appearance here.
///
/// `_hasActiveAppearance` is the private `NSWindow` method AppKit asks for that appearance
/// (`_hasActiveAppearanceIgnoringKeyFocus` follows it); there is no public equivalent, as
/// `NSGlassEffectView` has no `state` like `NSVisualEffectView`'s. Overriding `isKeyWindow`
/// does not reach the glass. An AppKit that stops asking simply never calls this, and the glass
/// falls back to its inactive look.
class ActiveGlassPanel: NSPanel {
  @objc func _hasActiveAppearance() -> Bool { true }
}
