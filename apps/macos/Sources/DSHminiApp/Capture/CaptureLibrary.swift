import AppKit

/// Turns confirmed captures into files the page can attach, and keeps what reopening them needs.
/// A capture is written as its image plus, when anything is known about the screen around it, a
/// `… context.md` file beside it. The raw pixels, scale and annotations of the last ``capacity``
/// captures stay in memory for this app run, keyed by the image's path; an image no longer in
/// memory is reopened from the file itself (its annotations are then already drawn in).
///
/// Atd imports the two files through its service and hands the page resource ids; this app's page
/// uploads by path (`upload-path`), so a capture is left on disk under ``folder`` and the page
/// gets the paths.
final class CaptureLibrary {
  /// One stored capture: the image file and its screen context, when the shell had anything to
  /// write about the screen around it.
  struct Captured {
    let image: URL
    let context: URL?
    let capturedAt: Date
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

  /// Stores `capture` under ``folder`` and archives it for reopening. Text recognition runs while
  /// the image is encoded; a context that cannot be written is left out without failing the
  /// capture.
  func store(_ capture: CaptureConfirmation, capturedAt: Date, snapshot: WindowSnapshot?) async throws(BridgeError)
    -> Captured
  {
    do {
      try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
    } catch {
      throw BridgeError(ShellStrings.shared.text(.screenshotNotPrepared))
    }
    let raw = capture.raw
    async let recognized = snapshot == nil ? [] : ScreenText.lines(in: raw)
    let image: URL
    do {
      image = try await CaptureExport.store(capture.image, capturedAt: capturedAt, in: Self.folder)
    } catch let failure as ImageExportFailure {
      switch failure {
      case .tooLarge: throw BridgeError(ShellStrings.shared.text(.screenshotTooLarge))
      case .unwritable: throw BridgeError(ShellStrings.shared.text(.screenshotUnwritable))
      case .unencodable: throw BridgeError(ShellStrings.shared.text(.screenshotUnencodable))
      }
    }
    var context: URL?
    if let snapshot {
      let centre = CaptureCoordinates.quartzPoint(
        CGPoint(x: capture.selection.midX, y: capture.selection.midY),
        display: capture.displayFrame)
      let window = snapshot.describe(at: centre)
      let screenContext = ScreenContext(
        app: window.app, window: window.window, element: capture.element.map(Self.element),
        lines: await recognized)
      if let markdown = screenContext.markdown,
        let file = await Self.write(
          markdown,
          to: Self.folder.appendingPathComponent(
            ScreenshotRules.contextFileName(capturedAt: capturedAt)))
      {
        context = file
      }
    }
    archive.insert(
      ReopenBase(image: capture.raw, scale: capture.pixelScale, document: capture.document),
      for: image.path)
    Self.prune()
    return Captured(image: image, context: context, capturedAt: capturedAt)
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

  /// Keeps the newest ``keepOnDisk`` images (and their context files) in the folder.
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

  private static func element(_ description: ElementDescription) -> ScreenContext.Element {
    ScreenContext.Element(
      role: description.role, title: description.title, value: description.value,
      help: description.help)
  }

  /// Writes the context file off the main actor; nil when it could not be written.
  @concurrent
  private nonisolated static func write(_ markdown: String, to file: URL) async -> URL? {
    do {
      try Data(markdown.utf8).write(to: file)
      return file
    } catch {
      return nil
    }
  }
}
