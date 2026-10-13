import AppKit

/// `apps.pick`: the apps the user chooses to keep the selection toolbar out of, by bundle id
/// with the name Finder shows. A bundle without an identifier cannot be matched against the
/// frontmost app, so it is left out; so is a second pick of the same app.
enum ExcludedAppPicker {
  /// `AppsPickResult.apps.maxItems`.
  static let maxApps = 20

  static func pick(with panels: SystemPanels) async -> AppsPickResult {
    guard let urls = await panels.chooseApps() else { return AppsPickResult(apps: []) }
    var seen = Set<String>()
    var apps: [AppsPickResult.App] = []
    for url in urls where apps.count < maxApps {
      guard let bundleId = Bundle(url: url)?.bundleIdentifier, !bundleId.isEmpty,
        bundleId.count <= 255, seen.insert(bundleId).inserted
      else { continue }
      apps.append(.init(bundleId: bundleId, name: displayName(url, fallback: bundleId)))
    }
    return AppsPickResult(apps: apps)
  }

  /// Finder's name without the `.app` it may show.
  private static func displayName(_ url: URL, fallback: String) -> String {
    var name = FileManager.default.displayName(atPath: url.path(percentEncoded: false))
    if name.lowercased().hasSuffix(".app") { name = String(name.dropLast(4)) }
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? fallback : String(trimmed.prefix(255))
  }
}
