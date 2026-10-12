import AppKit

/// A drop's one route and what it takes, read from its pasteboard (``MiniPanelDropRoute``): the
/// pasteboard's types decide the route first, and only that route's contents are read, so a
/// file or a promise drop never reads image data. A route whose contents turn out empty gives
/// way to the next.
enum MiniPanelDropPayload {
  case files([URL])
  case promises([NSFilePromiseReceiver])
  case image(Data)
  case quote(String)
  case textFile(String)

  /// The drop's payload; nil when it carries nothing the panel takes (whitespace included) or
  /// came from Atd itself.
  static func read(_ board: NSPasteboard) -> MiniPanelDropPayload? {
    let offer = MiniPanelDragOffer(types: board.types ?? [])
    guard offer.isAcceptable else { return nil }
    if offer.files {
      let options: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
      let files = board.readObjects(forClasses: [NSURL.self], options: options) as? [URL] ?? []
      if !files.isEmpty { return .files(files) }
    }
    if offer.promises {
      let receivers =
        board.readObjects(forClasses: [NSFilePromiseReceiver.self], options: nil)
        as? [NSFilePromiseReceiver] ?? []
      if !receivers.isEmpty { return .promises(receivers) }
    }
    if offer.image, let image = image(on: board) { return .image(image) }
    guard offer.text else { return nil }
    let urls = board.readObjects(forClasses: [NSURL.self], options: nil) as? [URL] ?? []
    let text = board.string(forType: .string) ?? urls.first { !$0.isFileURL }?.absoluteString
    let textOnly = MiniPanelDragOffer(
      files: false, promises: false, image: false, text: true, fromAtd: false)
    switch MiniPanelDropRoute.route(for: textOnly, text: text) {
    case .quote(let text): return .quote(text)
    case .textFile(let text): return .textFile(text)
    case .files, .promises, .image, nil: return nil
    }
  }

  /// The pasteboard's bitmap in the first format offered: PNG, TIFF, then JPEG.
  static func image(on board: NSPasteboard) -> Data? {
    [NSPasteboard.PasteboardType.png, .tiff, MiniPanelDragOffer.jpeg].lazy
      .compactMap { board.data(forType: $0) }.first
  }

  /// The route's name for the log.
  var logName: String {
    switch self {
    case .files: MiniPanelDropRoute.files.logName
    case .promises: MiniPanelDropRoute.promises.logName
    case .image: MiniPanelDropRoute.image.logName
    case .quote(let text): MiniPanelDropRoute.quote(text).logName
    case .textFile(let text): MiniPanelDropRoute.textFile(text).logName
    }
  }

  /// How many items it takes, for the log: never the content.
  var count: Int {
    switch self {
    case .files(let files): files.count
    case .promises(let receivers): MiniPanelPromises.expected(receivers)
    case .image, .quote, .textFile: 1
    }
  }
}

/// Receives a drop's promised files (Photos, a browser's images, Mail's attachments) into a
/// folder of its own. Each promiser writes on a background queue and calls back per file; the
/// files that arrive are handed on in batches, each a short ``batchDelay`` after the first file
/// in it, so a drop of several becomes one import, and files arriving late (after the others,
/// after the wait ran out, or more than the promisers announced) still go in. The wait settles
/// once every announced file has called back or after ``timeout``, with how many arrived and the
/// names of those that failed or never came (``Settled``), never the files' contents.
enum MiniPanelPromises {
  static let timeout: Duration = .seconds(60)
  static let batchDelay: Duration = .milliseconds(300)

  /// The wait's end: the files that arrived so far, how many were announced, and the names of
  /// those that failed or never came (fewer than the failures when a promiser gave no names).
  struct Settled {
    let received: Int
    let expected: Int
    let failed: Int
    let missingNames: [String]
  }

  /// The files the promisers announced: one per promised type, or one for a promiser that
  /// announced none; a promiser may still write more.
  static func expected(_ receivers: [NSFilePromiseReceiver]) -> Int {
    receivers.reduce(0) { $0 + max($1.fileTypes.count, 1) }
  }

  static func receive(
    _ receivers: [NSFilePromiseReceiver], into folder: URL,
    deliver: @escaping ([URL]) -> Void, settled: @escaping (Settled) -> Void
  ) {
    let queue = OperationQueue()
    let collector = Collector(
      receivers: receivers, queue: queue, deliver: deliver, settled: settled)
    for receiver in receivers {
      receiver.receivePromisedFiles(atDestination: folder, options: [:], operationQueue: queue) {
        @Sendable url, error in
        let failure = error.map { error in
          let error = error as NSError
          return "\(error.domain) \(error.code)"
        }
        Task { @MainActor in
          if let failure {
            collector.fail(url, reason: failure)
          } else {
            collector.add(url)
          }
        }
      }
    }
    Task {
      try? await Task.sleep(for: timeout)
      collector.settle()
    }
  }

  private final class Collector {
    private let receivers: [NSFilePromiseReceiver]
    private let expected: Int
    private let deliver: ([URL]) -> Void
    private var settled: ((Settled) -> Void)?
    /// Kept while files may still arrive, so the promisers' callbacks have their queue.
    private let queue: OperationQueue
    private var batch: [URL] = []
    private var received: [URL] = []
    private var failed: [(name: String, reason: String)] = []

    init(
      receivers: [NSFilePromiseReceiver], queue: OperationQueue,
      deliver: @escaping ([URL]) -> Void, settled: @escaping (Settled) -> Void
    ) {
      self.receivers = receivers
      expected = MiniPanelPromises.expected(receivers)
      self.queue = queue
      self.deliver = deliver
      self.settled = settled
    }

    func add(_ url: URL) {
      received.append(url)
      batch.append(url)
      if batch.count == 1 {
        Task { [self] in
          try? await Task.sleep(for: MiniPanelPromises.batchDelay)
          flush()
        }
      }
      if received.count + failed.count >= expected { settle() }
    }

    func fail(_ url: URL, reason: String) {
      failed.append((url.lastPathComponent, reason))
      if received.count + failed.count >= expected { settle() }
    }

    private func flush() {
      guard !batch.isEmpty else { return }
      let files = batch
      batch = []
      deliver(files)
    }

    /// The wait is over: reports once what came of it. Files that arrive later still go in.
    func settle() {
      guard let settled else { return }
      self.settled = nil
      let arrived = Set(received.map(\.lastPathComponent) + failed.map(\.name))
      let promised = receivers.flatMap(\.fileNames).filter { !arrived.contains($0) }
      let reasons = failed.map(\.reason).joined(separator: ", ")
      MiniPanelController.log.info(
        """
        Mini panel drop: received \(self.received.count, privacy: .public) of \
        \(self.expected, privacy: .public) promised file(s); failures: \
        \(reasons.isEmpty ? "none" : reasons, privacy: .public)
        """)
      settled(
        Settled(
          received: received.count, expected: expected, failed: failed.count,
          missingNames: failed.map(\.name) + promised))
    }
  }
}

/// The app's own folder for what a drop on the mini panel brings without a file of its own:
/// promised files and long dropped text, each drop in a folder of its own
/// (`~/Library/Application Support/<bundle id>/mini-panel-drops/<uuid>/`).
///
/// The service copies an imported file into its own store (`/v1/resources/import` reads the
/// bytes, apps/agent-service/src/resources/import.ts) but registers a folder by its path, and an
/// import from outside the panel waits while the service is unreachable
/// (``AttachmentImporter/importOpened(_:)``). So received files stay for ``retention`` before
/// ``prune(_:now:)`` removes them, and received folders stay, since a folder reference keeps
/// pointing at them.
struct MiniPanelDropFolder {
  nonisolated static let retention: TimeInterval = 24 * 60 * 60

  let root: URL

  static func forMainBundle() -> MiniPanelDropFolder {
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
    let base = support.first ?? URL(filePath: NSTemporaryDirectory())
    return MiniPanelDropFolder(
      root: base.appending(path: Bundle.main.bundleIdentifier ?? "com.junerdd.ai")
        .appending(path: "mini-panel-drops"))
  }

  /// A new, empty folder for one drop.
  func makeDropFolder() throws -> URL {
    let folder = root.appending(path: UUID().uuidString, directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    return folder
  }

  /// Long dropped text as `Dropped text <date>.txt`, UTF-8, in a new drop folder.
  func write(text: String, droppedAt date: Date) throws -> URL {
    let file = try makeDropFolder().appending(
      path: MiniPanelDroppedText.fileName(droppedAt: date))
    try Data(text.utf8).write(to: file, options: .atomic)
    return file
  }

  /// ``prune(_:now:)`` off the main actor.
  func pruneInBackground() {
    let root = root
    Task.detached(priority: .background) { Self.prune(root, now: .now) }
  }

  /// Removes the files of drops older than ``retention``, and their folders once empty.
  nonisolated static func prune(_ root: URL, now: Date) {
    let manager = FileManager.default
    guard
      let drops = try? manager.contentsOfDirectory(
        at: root, includingPropertiesForKeys: [.creationDateKey])
    else { return }
    for drop in drops {
      guard let created = try? drop.resourceValues(forKeys: [.creationDateKey]).creationDate,
        now.timeIntervalSince(created) > retention
      else { continue }
      let items =
        (try? manager.contentsOfDirectory(at: drop, includingPropertiesForKeys: [.isDirectoryKey]))
        ?? []
      for item in items
      where (try? item.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory
        != true
      {
        try? manager.removeItem(at: item)
      }
      if (try? manager.contentsOfDirectory(at: drop, includingPropertiesForKeys: nil))?.isEmpty
        == true
      {
        try? manager.removeItem(at: drop)
      }
    }
  }
}
