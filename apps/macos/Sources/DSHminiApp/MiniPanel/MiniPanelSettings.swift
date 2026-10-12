import Foundation

/// The mini panel's own settings in UserDefaults, shell-local like `panel.pinned`: whether it
/// shows (`miniPanel.shown`, on until turned off), how it opens (`miniPanel.openOn`, on a click
/// until set to hover), its edge and height (`miniPanel.edge`, `miniPanel.position`) and its
/// display (`miniPanel.display`, a display UUID). While that display is missing the panel shows on
/// the main display at the same edge and height, and it goes back once the display returns.
struct MiniPanelSettings {
  static let shownKey = "miniPanel.shown"
  static let openOnKey = "miniPanel.openOn"
  static let edgeKey = "miniPanel.edge"
  static let positionKey = "miniPanel.position"
  static let displayKey = "miniPanel.display"

  let defaults: UserDefaults

  var shown: Bool { defaults.object(forKey: Self.shownKey) as? Bool ?? true }

  func setShown(_ shown: Bool) { defaults.set(shown, forKey: Self.shownKey) }

  var openOn: MiniPanelOpenOn {
    defaults.string(forKey: Self.openOnKey).flatMap(MiniPanelOpenOn.init(rawValue:)) ?? .click
  }

  func setOpenOn(_ openOn: MiniPanelOpenOn) {
    defaults.set(openOn.rawValue, forKey: Self.openOnKey)
  }

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
