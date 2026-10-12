import AppKit

/// Notices drag sessions anywhere on screen, so the mini panel can invite the drop (spec v1,
/// States: invite). A press anywhere notes the drag pasteboard's change count; when the pointer
/// then drags and the count has moved, a session began, and the pasteboard's types say what it
/// carries (``MiniPanelDragOffer``). Only a session with something the panel takes, from another
/// app, begins (``onBegin``); a press in Atd's own windows (a pin drag, a drag out of the panel,
/// the mini panel itself) never does, nor does a pin drag's private type. The session ends with
/// the button's release (``onEnd``).
///
/// Global monitors see the other apps' events and local ones Atd's own. The pasteboard is
/// checked at most every ``checkInterval`` while a press drags, and not again once its press has
/// been decided.
final class MiniPanelDragWatch {
  static let checkInterval = 0.05

  var onBegin: ((MiniPanelDragOffer) -> Void)?
  /// The pointer dragged during a session.
  var onMove: (() -> Void)?
  /// The session ended with the button's release, at this point (AppKit's global coordinates).
  var onEnd: ((CGPoint) -> Void)?

  /// The session under way, if one began.
  private(set) var session: MiniPanelDragOffer?
  private var monitors: [Any] = []
  /// The drag pasteboard's change count at the latest press, until its drag is decided.
  private var pressCount: Int?
  private var pressedInAtd = false
  private var lastCheck = 0.0

  func start() {
    guard monitors.isEmpty else { return }
    let mask: NSEvent.EventTypeMask = [.leftMouseDown, .leftMouseDragged, .leftMouseUp]
    if let global = NSEvent.addGlobalMonitorForEvents(
      matching: mask,
      handler: { [weak self] event in
        let type = event.type
        MainActor.assumeIsolated { self?.handle(type, inAtd: false) }
      })
    {
      monitors.append(global)
    }
    if let local = NSEvent.addLocalMonitorForEvents(
      matching: mask,
      handler: { [weak self] event in
        MainActor.assumeIsolated { self?.handle(event.type, inAtd: true) }
        return event
      })
    {
      monitors.append(local)
    }
  }

  /// Stops watching; a session under way ends without ``onEnd``.
  func stop() {
    for monitor in monitors { NSEvent.removeMonitor(monitor) }
    monitors = []
    pressCount = nil
    session = nil
  }

  private func handle(_ type: NSEvent.EventType, inAtd: Bool) {
    switch type {
    case .leftMouseDown:
      pressCount = NSPasteboard(name: .drag).changeCount
      pressedInAtd = inAtd
      lastCheck = 0
    case .leftMouseDragged:
      if session != nil {
        onMove?()
      } else {
        check()
      }
    case .leftMouseUp:
      pressCount = nil
      guard session != nil else { return }
      session = nil
      onEnd?(NSEvent.mouseLocation)
    default:
      break
    }
  }

  private func check() {
    guard let pressCount, !pressedInAtd else { return }
    let now = ProcessInfo.processInfo.systemUptime
    guard now - lastCheck >= Self.checkInterval else { return }
    lastCheck = now
    let board = NSPasteboard(name: .drag)
    guard board.changeCount != pressCount else { return }
    self.pressCount = nil
    let types = board.types ?? []
    let offer = MiniPanelDragOffer(types: types)
    let names = types.map(\.rawValue).joined(separator: ", ")
    MiniPanelController.log.debug(
      """
      Mini panel drag session: \(offer.isAcceptable ? "invited" : "ignored", privacy: .public); \
      types \(names, privacy: .public)
      """)
    guard offer.isAcceptable else { return }
    session = offer
    onBegin?(offer)
  }
}

extension MiniPanelDragOffer {
  static let jpeg = NSPasteboard.PasteboardType("public.jpeg")
  /// Every type a drop on the panel reads, which its view registers for.
  static var draggedTypes: [NSPasteboard.PasteboardType] {
    [.fileURL, .URL, .string, .png, .tiff, jpeg]
      + NSFilePromiseReceiver.readableDraggedTypes.map { NSPasteboard.PasteboardType($0) }
  }

  /// What a drag pasteboard offering `types` carries: a pin drag's private type marks Atd's own.
  init(types: [NSPasteboard.PasteboardType]) {
    let offered = Set(types)
    let promised = Set(
      NSFilePromiseReceiver.readableDraggedTypes.map { NSPasteboard.PasteboardType($0) })
    self.init(
      files: offered.contains(.fileURL), promises: !offered.isDisjoint(with: promised),
      image: !offered.isDisjoint(with: [.png, .tiff, Self.jpeg]),
      text: offered.contains(.string) || offered.contains(.URL),
      fromAtd: offered.contains(DeepDiveDrag.pasteboardType))
  }
}
