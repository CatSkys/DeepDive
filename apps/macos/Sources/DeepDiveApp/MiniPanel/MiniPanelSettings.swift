import Foundation

/// The mini panel's own settings in UserDefaults, shell-local like `panel.pinned`: whether it
/// shows (`miniPanel.shown`, on until turned off), its edge and height (`miniPanel.edge`,
/// `miniPanel.position`) and its display (`miniPanel.display`, a display UUID). While that display
/// is missing the panel shows on the main display at the same edge and height, and it goes back
/// once the display returns. How it opens is not a setting: the pointer resting in the hot zone
/// expands it (``MiniPanelHover``).
struct MiniPanelSettings {
  static let shownKey = "miniPanel.shown"
  static let edgeKey = "miniPanel.edge"
  static let positionKey = "miniPanel.position"
  static let displayKey = "miniPanel.display"

  let defaults: UserDefaults

  var shown: Bool { defaults.object(forKey: Self.shownKey) as? Bool ?? true }

  func setShown(_ shown: Bool) { defaults.set(shown, forKey: Self.shownKey) }

  var placement: MiniPanelPlacement {
    let edge = defaults.string(forKey: Self.edgeKey).flatMap(MiniPanelEdge.init(rawValue:))
    let position = defaults.object(forKey: Self.positionKey) as? Double
    return MiniPanelPlacement(
      edge: edge ?? MiniPanelPlacement.standard.edge,
      position: position ?? MiniPanelPlacement.standard.position)
  }

  /// The display the panel was last placed on; nil until it was first moved.
  var display: String? { defaults.string(forKey: Self.displayKey) }

  func save(_ placement: MiniPanelPlacement, display: String?) {
    defaults.set(placement.edge.rawValue, forKey: Self.edgeKey)
    defaults.set(placement.position, forKey: Self.positionKey)
    if let display { defaults.set(display, forKey: Self.displayKey) }
  }
}
