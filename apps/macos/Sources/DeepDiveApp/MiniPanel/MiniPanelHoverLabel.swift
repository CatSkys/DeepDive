import CoreGraphics

/// The hover label's timing (hover-label-v1), like a tooltip's warm-up but faster. Atd stays
/// inactive while the mini panel is used and AppKit delays or drops an inactive app's tooltips,
/// so the panel draws its own label from the pointer it already reads.
public enum MiniPanelLabelTiming {
  /// The pointer rests on a control this long before the first label shows.
  public static let warmUp = 0.35
  /// Once a label has shown, labels follow the pointer at once until it has been off every
  /// control this long.
  public static let coolDown = 0.5
  /// A label stays this long after the pointer leaves its control, so crossing the 4 pt gap to
  /// the next one glides the label there instead of hiding and showing it again.
  public static let linger = 0.1
}

/// Which control's label shows, read on every display frame with the control under the pointer.
/// Items are the panel's controls (or their rows), compared by value.
public struct MiniPanelLabelTimer<Item: Equatable & Sendable>: Equatable, Sendable {
  public private(set) var shown: Item?
  /// The control the pointer rests on while the label warms up, and since when.
  private var candidate: Item?
  private var candidateSince = 0.0
  /// A label showed recently, so the next one needs no warm-up.
  private var warm = false
  /// When the pointer left every control, while it stays off them.
  private var offSince: Double?
  /// A press, a drag or a closing panel hid the label over this control; it stays hidden there
  /// until the pointer leaves it, as a tooltip does after a click.
  private var consumed: Item?

  public init() {}

  /// One frame: `item` under the pointer, nil off every control. `suppressed` hides the label at
  /// once: a press, a drag, the panel closing, the commands card opening over it, a drag session.
  /// Returns the item whose label shows.
  public mutating func update(item: Item?, suppressed: Bool, at now: Double) -> Item? {
    if suppressed {
      consumed = item ?? shown
      shown = nil
      candidate = nil
      warm = false
      offSince = nil
      return nil
    }
    if let consumed, item != consumed { self.consumed = nil }
    guard let item, item != consumed else { return leave(at: now) }
    offSince = nil
    if !warm {
      if candidate != item {
        candidate = item
        candidateSince = now
      }
      guard now - candidateSince >= MiniPanelLabelTiming.warmUp else { return nil }
      warm = true
    }
    candidate = nil
    shown = item
    return shown
  }

  /// The pointer is off every control: the label lingers briefly, then the warmth runs out.
  /// Off every control with no warmth left there is nothing to time, so the frames may pause.
  private mutating func leave(at now: Double) -> Item? {
    candidate = nil
    // A label shows only once warm, so without warmth none shows either.
    guard warm else {
      offSince = nil
      return nil
    }
    let since = offSince ?? now
    offSince = since
    if shown != nil, now - since >= MiniPanelLabelTiming.linger { shown = nil }
    if now - since >= MiniPanelLabelTiming.coolDown {
      warm = false
      offSince = nil
    }
    return shown
  }

  /// A warm-up, a linger or a cool-down is being timed, so the frames must keep coming.
  public var isTiming: Bool { candidate != nil || offSince != nil }
}

extension MiniPanelLayout {
  /// The hover label beside `shape` (the capsule, or the commands card for a row's label), toward
  /// the screen's interior and ``MiniPanelMetrics/labelGap`` from its side, vertically centered
  /// on `centerY` (the hovered control's middle). `width` fits the text and is capped at
  /// ``MiniPanelMetrics/labelMaxWidth``; the label stays ``MiniPanelMetrics/margin`` inside the
  /// work area like every other shape.
  public func hoverLabel(beside shape: ScreenRect, centerY: Double, width: Double) -> ScreenRect {
    typealias Metrics = MiniPanelMetrics
    let width = min(max(width, Metrics.labelHeight), Metrics.labelMaxWidth)
    let x = edge == .right ? shape.x - Metrics.labelGap - width : shape.maxX + Metrics.labelGap
    let inner = workArea.outset(by: -Metrics.margin)
    return ScreenRect(
      x: inner.width >= width ? min(max(x, inner.x), inner.maxX - width) : x,
      y: Self.origin(centeredOn: centerY, length: Metrics.labelHeight, in: workArea),
      width: width, height: Metrics.labelHeight)
  }
}
