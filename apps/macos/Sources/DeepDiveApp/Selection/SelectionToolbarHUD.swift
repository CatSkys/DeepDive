import AppKit

/// The `toggle` mode's status HUD, a ``GlassHUD`` client: while the selection toolbar listens,
/// the capsule says so and names the keys that turn it off — the grip, the app's mark, the state,
/// the hint with its keys as keycaps, and a close button. Turning listening off, or the close
/// button, fades it out as it is. Turning listening off while the close button had hidden it
/// shows a brief off notice instead (``noticeDuration``: the mark and the off state alone,
/// nothing to move or close), since nothing on screen would otherwise answer the keys.
///
/// The close button hides it until listening next turns on. The page's `showHud` turns it off
/// altogether. While a command's progress HUD is up it yields the place (``setYielding(_:)``):
/// it leaves at once and comes back, as it would show now, once that HUD goes.
final class SelectionToolbarHUD: NSObject {
  /// How long the off notice stays before it exits.
  static let noticeDuration: Duration = .seconds(1.2)

  private let hud = GlassHUD()
  /// The page's `showHud`.
  private var enabled = true
  /// The combination as keycap symbols, for the hint.
  private var keys: [String] = []
  private var listening = false
  /// The close button hid it; cleared when listening turns off.
  private var dismissed = false
  private var yielding = false

  /// What the page pushed: whether the HUD may show, and the combination it names.
  func configure(enabled: Bool, keys: Set<SelectionActivation.Key>) {
    let symbols = Self.symbols(keys)
    let changed = enabled != self.enabled || symbols != self.keys
    self.enabled = enabled
    self.keys = symbols
    if !enabled {
      hud.hide()
    } else if changed, listening, !dismissed {
      show()
    }
  }

  /// Listening turned on or off.
  func setListening(_ on: Bool) {
    guard on != listening else { return }
    listening = on
    guard enabled else { return }
    if on {
      show()
    } else if dismissed {
      dismissed = false
      if !yielding { hud.show(lasting: Self.noticeDuration) { Self.offNotice() } }
    } else {
      hud.exit()
    }
  }

  /// Another HUD takes the place (true) or gives it back (false).
  func setYielding(_ yields: Bool) {
    guard yields != yielding else { return }
    yielding = yields
    if yields {
      hud.hide()
    } else if enabled, listening, !dismissed {
      show()
    }
  }

  private func show() {
    guard !yielding else { return }
    hud.show { [unowned self] in content() }
  }

  /// The HUD's row: grip, mark and state, the hint, the close button.
  private func content() -> GlassHUD.Content {
    let strings = ShellStrings.shared
    let close = GlassHUDPieces.close(
      label: strings.text(.selectionHudHide), target: self, action: #selector(closeClicked))
    let grip = GlassHUDPieces.grip()
    let title = strings.text(.selectionHudOn)
    let status = NSStackView(views: [
      GlassHUDPieces.mark(), GlassHUDPieces.text(title, primary: true),
    ])
    status.spacing = 6
    let hint = GlassHUDPieces.sentence(
      strings.text(.selectionHudHint, GlassHUDPieces.keysMarker), keys: keys)
    let body = NSStackView(views: [status, hint.view])
    body.spacing = 12
    body.edgeInsets = NSEdgeInsets(top: 0, left: 2, bottom: 0, right: 4)
    return GlassHUD.Content(
      views: [grip, body, close], label: title + ", " + hint.label, buttons: [close], grip: grip)
  }

  /// The off notice: the mark and the off state alone.
  private static func offNotice() -> GlassHUD.Content {
    let title = ShellStrings.shared.text(.selectionHudOff)
    let status = NSStackView(views: [
      GlassHUDPieces.mark(), GlassHUDPieces.text(title, primary: true),
    ])
    status.spacing = 6
    status.edgeInsets = NSEdgeInsets(top: 0, left: 8, bottom: 0, right: 10)
    status.heightAnchor.constraint(equalToConstant: AnnotationToolbarButton.side).isActive = true
    return GlassHUD.Content(views: [status], label: title, buttons: [], grip: nil)
  }

  @objc private func closeClicked() {
    dismissed = true
    hud.exit()
  }

  /// The combination as macOS draws it, in the order the app's shortcuts list modifiers.
  private static func symbols(_ keys: Set<SelectionActivation.Key>) -> [String] {
    let order: [(SelectionActivation.Key, String)] = [
      (.command, "⌘"), (.option, "⌥"), (.shift, "⇧"),
    ]
    return order.filter { keys.contains($0.0) }.map(\.1)
  }
}
