import AppKit

/// Turns confirmed captures into the file the page attaches, and keeps what reopening them needs.
/// A capture is written as its image alone; the page imports that one file. The raw pixels, scale
/// and annotations of the last ``capacity`` captures stay in memory for this app run, keyed by the
/// image's path; an image no longer in memory is reopened from the file itself (its annotations
/// are then already drawn in).
///
/// Atd imports the file through its service and hands the page a resource id; this app's page
/// uploads by path (`upload-path`), so a capture is left on disk under ``folder`` and the page
/// gets the path.
final class CaptureLibrary {
  /// One stored capture: the image file the page attaches.
  struct Captured {
    let image: URL
  }

  static let capacity = 10
  /// How many stored captures the folder keeps; older ones are dropped after each store.
  static let keepOnDisk = 40

  /// Where captures live: under the app's support directory, so a capture survives until the page
  /// uploads it, and can be reopened later.
  static var folder: URL {
    AppPaths.supportDir.appendingPathComponent("screenshots", isDirectory: true)
  }

  private var archive = RecentValues<ReopenBase>(capacity: capacity)

  /// Stores `capture` under ``folder`` and archives it for reopening.
  func store(_ capture: CaptureConfirmation, capturedAt: Date) async throws(BridgeError)
    -> Captured
  {
    do {
      try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
    } catch {
      throw BridgeError(ShellStrings.shared.text(.screenshotNotPrepared))
    }
    // `CaptureExport.store` 自己把编码/写盘的失败折成带文案的 BridgeError，这里不再分支。
    let image = try await CaptureExport.store(
      capture.image, capturedAt: capturedAt, in: Self.folder)
    archive.insert(
      ReopenBase(image: capture.raw, scale: capture.pixelScale, document: capture.document),
      for: image.path)
    Self.prune()
    return Captured(image: image)
  }

  /// What `screenshot.edit` opens for `path`: the archived capture when it can keep its size on
  /// the screen under the pointer (its annotations are in points), otherwise the stored image
  /// itself — annotations then already drawn in.
  func base(for path: String) async throws(BridgeError) -> ReopenBase {
    let screen =
      NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) }
      ?? NSScreen.main
    if let archived = archive.value(for: path), let screen,
      archived.opens(onScreen: screen.frame.size, scale: screen.backingScaleFactor)
    {
      return archived
    }
    let url = URL(fileURLWithPath: path)
    guard let data = try? Data(contentsOf: url), let decoded = await ReopenBase.decode(data) else {
      throw BridgeError(ShellStrings.shared.text(.screenshotImageOnly))
    }
    return decoded
  }

  /// Keeps the newest ``keepOnDisk`` images in the folder.
  private static func prune() {
    let keys: [URLResourceKey] = [.contentModificationDateKey]
    guard let entries = try? FileManager.default.contentsOfDirectory(
      at: folder, includingPropertiesForKeys: keys)
    else { return }
    let sorted = entries.sorted {
      let lhs =
        (try? $0.resourceValues(forKeys: Set(keys)))?.contentModificationDate ?? .distantPast
      let rhs =
        (try? $1.resourceValues(forKeys: Set(keys)))?.contentModificationDate ?? .distantPast
      return lhs > rhs
    }
    for url in sorted.dropFirst(keepOnDisk) { try? FileManager.default.removeItem(at: url) }
  }
}
