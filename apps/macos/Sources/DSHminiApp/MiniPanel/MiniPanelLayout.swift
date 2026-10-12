import CoreGraphics

/// Where each of the mini panel's shapes sits for one placement, in AppKit's y-up global points
/// on the display's work area (`visibleFrame`); displays left of or below the primary one have
/// negative origins and work like any other. Every shape stays ``MiniPanelMetrics/margin``
/// inside the work area: the open capsule is centered on the pill and shifted inward when the
/// pill rests near the top or the bottom, and so are the invite and the drop card.
///
/// The window is one transparent ``canvas`` that holds every state, so states morph inside it
/// without the window changing size. It is centered on the anchor (the capsule column's center
/// line, at the height of a full capsule centered on the pill), then moved to stay inside the
/// display: with Displays have separate Spaces on (the system default), a window that reaches
/// into the next display belongs to one of them only, and macOS moves it there whole, taking the
/// pill off its edge. It depends on the placement only, never on the command list, so the canvas
/// moves only when the panel does.
public struct MiniPanelLayout: Equatable, Sendable {
  public let edge: MiniPanelEdge
  public let workArea: ScreenRect
  public let pill: ScreenRect
  /// The pill swollen as the pointer enters the hot zone: the same edge and middle.
  public let swell: ScreenRect
  public let capsule: ScreenRect
  /// The capsule's controls from the top: the Atd mark, New task, Ask about selection,
  /// Screenshot, and Commands while the command list is not empty.
  public let buttons: [ScreenRect]
  public let hairline: ScreenRect
  /// The commands card; nil without commands.
  public let flyout: ScreenRect?
  public let invite: ScreenRect
  public let target: ScreenRect
  /// Where the pointer opens the panel: from the work-area edge inward
  /// ``MiniPanelMetrics/hotZoneDepth``, spanning the pill's height plus
  /// ``MiniPanelMetrics/hotZoneSlop`` above and below.
  public let hotZone: ScreenRect
  public let canvas: ScreenRect
  /// Where any glass can be for this placement, whatever the command list (``glassRegion``).
  public let glassRegion: ScreenRect
  /// Where the body glass can be for this placement, whatever the command list: every shape it
  /// takes, with ``MiniPanelMetrics/overshootRoom`` for its springs. The fixed lane it is drawn
  /// in, so its frames lay nothing out again.
  public let bodyRegion: ScreenRect

  /// - Parameters:
  ///   - displayFrame: the display's full frame, which the canvas stays inside vertically.
  ///   - commands: how many commands the pushed list holds.
  ///   - flyoutWidth: the card's width (``MiniPanelMetrics/flyoutWidth(textWidth:)``).
  ///   - backingScale: the display's device pixels per point, which can widen the pill
  ///     (``MiniPanelMetrics/pillWidth(backingScale:)``); Retina's unless given.
  public init(
    placement: MiniPanelPlacement, workArea: ScreenRect, displayFrame: ScreenRect,
    commands: Int, flyoutWidth: Double, backingScale: Double = 2
  ) {
    typealias Metrics = MiniPanelMetrics
    let right = placement.edge == .right
    edge = placement.edge
    self.workArea = workArea
    let pillCenter = Self.pillCenterY(position: placement.position, in: workArea)
    let pillWidth = Metrics.pillWidth(backingScale: backingScale)
    pill = ScreenRect(
      x: right ? workArea.maxX - Metrics.pillInset - pillWidth : workArea.x + Metrics.pillInset,
      y: pillCenter - Metrics.pillHeight / 2, width: pillWidth, height: Metrics.pillHeight)
    // The swell keeps its growth over a widened pill.
    let swellWidth = pillWidth + Metrics.swellWidth - Metrics.pillWidth
    let swellLength = Metrics.pillHeight + Metrics.swellGrowth
    swell = ScreenRect(
      x: right ? pill.maxX - swellWidth : pill.x, y: pillCenter - swellLength / 2,
      width: swellWidth, height: swellLength)
    let column =
      right
      ? workArea.maxX - Metrics.capsuleInset - Metrics.capsuleWidth
      : workArea.x + Metrics.capsuleInset
    let height = Metrics.capsuleHeight(hasCommands: commands > 0)
    capsule = ScreenRect(
      x: column, y: Self.origin(centeredOn: pillCenter, length: height, in: workArea),
      width: Metrics.capsuleWidth, height: height)
    (buttons, hairline) = Self.controls(in: capsule, hasCommands: commands > 0)
    flyout = Self.flyout(
      beside: capsule, commandsButton: commands > 0 ? buttons.last : nil, rows: commands,
      width: flyoutWidth, right: right, in: workArea)
    let invite = Metrics.inviteSize
    self.invite = ScreenRect(
      x: column, y: Self.origin(centeredOn: pillCenter, length: invite.height, in: workArea),
      width: invite.width, height: invite.height)
    let target = Metrics.targetSize
    self.target = ScreenRect(
      x: right
        ? workArea.maxX - Metrics.capsuleInset - target.width
        : workArea.x + Metrics.capsuleInset,
      y: Self.origin(centeredOn: pillCenter, length: target.height, in: workArea),
      width: target.width, height: target.height)
    hotZone = ScreenRect(
      x: right ? workArea.maxX - Metrics.hotZoneDepth : workArea.x,
      y: pill.y - Metrics.hotZoneSlop, width: Metrics.hotZoneDepth,
      height: pill.height + Metrics.hotZoneSlop * 2)
    canvas = Self.canvas(
      columnCenter: column + Metrics.capsuleWidth / 2, pillCenter: pillCenter,
      workArea: workArea, displayFrame: displayFrame)
    // The tallest capsule and the largest card, so the region holds whatever the list becomes.
    let full = Metrics.capsuleHeight(hasCommands: true)
    let tallest = ScreenRect(
      x: column, y: Self.origin(centeredOn: pillCenter, length: full, in: workArea),
      width: Metrics.capsuleWidth, height: full)
    let largest = Self.flyout(
      beside: tallest, commandsButton: Self.controls(in: tallest, hasCommands: true).0.last,
      rows: Metrics.maxVisibleRows, width: Metrics.flyoutMaxWidth, right: right, in: workArea)
    glassRegion = Self.glassRegion(
      edge: placement.edge,
      shapes: [pill, swell, tallest, self.invite, self.target] + [largest].compactMap { $0 },
      beside: [tallest] + [largest].compactMap { $0 }, invite: self.invite, target: self.target,
      canvas: canvas)
    bodyRegion = ScreenRect.bounds(of: [pill, swell, tallest, self.invite, self.target])
      .outset(by: Metrics.overshootRoom)
  }

  // MARK: The body

  /// The body glass's shape in each state it shows. The body morphs between them per axis: its
  /// thickness across the docked edge (x) and its length along it (y), each anchored where the
  /// shapes are: the edge side of the column, and the pill's middle unless the work area pushes a
  /// longer shape inward.
  public func rect(of shape: MiniPanelShape) -> ScreenRect {
    switch shape {
    case .pill: pill
    case .swell: swell
    case .capsule: capsule
    case .invite: invite
    case .target: target
    }
  }

  /// A capsule for the pill, the swell, the capsule and the invite (half their thickness); the
  /// card's own radius for the drop card.
  public func cornerRadius(of shape: MiniPanelShape) -> Double {
    shape == .target ? MiniPanelMetrics.cardRadius : rect(of: shape).width / 2
  }

  /// Every shape, the widest hover labels beside the capsule and the card, and a drag session's
  /// drop zones, with room for the glass's shadow, inside the canvas: the glass container covers
  /// this rather than the whole canvas.
  private static func glassRegion(
    edge: MiniPanelEdge, shapes: [ScreenRect], beside: [ScreenRect], invite: ScreenRect,
    target: ScreenRect, canvas: ScreenRect
  ) -> ScreenRect {
    typealias Metrics = MiniPanelMetrics
    var shapes = shapes
    let reach = Metrics.labelGap + Metrics.labelMaxWidth
    for shape in beside {
      shapes.append(
        ScreenRect(
          x: edge == .right ? shape.x - reach : shape.maxX, y: shape.y - Metrics.labelHeight,
          width: reach, height: shape.height + Metrics.labelHeight * 2))
    }
    shapes.append(target.outset(by: MiniPanelMagnet.holdMargin))
    shapes.append(invite.outset(by: MiniPanelMagnet.enterMargin))
    let all = ScreenRect.bounds(of: shapes).outset(by: Metrics.shadowRoom)
    let (minX, minY) = (max(all.x, canvas.x), max(all.y, canvas.y))
    let (maxX, maxY) = (min(all.maxX, canvas.maxX), min(all.maxY, canvas.maxY))
    return ScreenRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
  }

  // MARK: The pointer

  public func isInHotZone(_ point: CGPoint) -> Bool { hotZone.contains(point) }

  /// Whether the pointer is close enough to the open capsule, and to its card while that is
  /// open, to keep them open.
  public func keepsOpen(_ point: CGPoint, flyoutOpen: Bool) -> Bool {
    let shapes = [capsule] + (flyoutOpen ? [flyout].compactMap { $0 } : [])
    return shapes.contains { $0.outset(by: MiniPanelMetrics.collapseMargin).contains(point) }
  }

  /// Whether `point` is close enough to `shapes` (or the hot zone) to keep reading the pointer
  /// on every frame.
  public func isNear(_ point: CGPoint, shapes: [ScreenRect]) -> Bool {
    (shapes + [hotZone]).contains {
      $0.outset(by: MiniPanelMetrics.nearMargin).contains(point)
    }
  }

  /// The button under `point`, as an index into ``buttons``.
  public func button(at point: CGPoint) -> Int? {
    buttons.firstIndex { $0.contains(point) }
  }

  /// The command row under `point` while the card shows `count` rows scrolled by `scroll`
  /// points; nil outside the card's rows.
  public func row(at point: CGPoint, scroll: Double, count: Int) -> Int? {
    guard let flyout, count > 0 else { return nil }
    let rows = flyout.outset(by: -MiniPanelMetrics.cardPadding)
    guard rows.contains(point) else { return nil }
    let index = Int(
      ((rows.maxY - Double(point.y) + scroll) / MiniPanelMetrics.rowHeight).rounded(.down))
    return (0..<count).contains(index) ? index : nil
  }

  // MARK: Placement

  /// The pill center for `position`, kept so the pill stays ``MiniPanelMetrics/margin`` inside
  /// the work area.
  public static func pillCenterY(position: Double, in workArea: ScreenRect) -> Double {
    clampedPillCenter(workArea.maxY - position * workArea.height, in: workArea)
  }

  /// The position a pill centered at `y` takes, the inverse of ``pillCenterY(position:in:)``
  /// once `y` is kept inside the work area.
  public static func position(ofPillCenterY y: Double, in workArea: ScreenRect) -> Double {
    guard workArea.height > 0 else { return MiniPanelPlacement.standard.position }
    return (workArea.maxY - clampedPillCenter(y, in: workArea)) / workArea.height
  }

  private static func clampedPillCenter(_ y: Double, in workArea: ScreenRect) -> Double {
    let half = MiniPanelMetrics.pillHeight / 2 + MiniPanelMetrics.margin
    let (low, high) = (workArea.y + half, workArea.maxY - half)
    return low <= high ? min(max(y, low), high) : workArea.midY
  }

  /// The origin of a shape `length` long centered on `center`, moved inward to stay
  /// ``MiniPanelMetrics/margin`` inside the work area; centered when it cannot fit.
  static func origin(centeredOn center: Double, length: Double, in workArea: ScreenRect)
    -> Double
  {
    let (low, high) = (
      workArea.y + MiniPanelMetrics.margin, workArea.maxY - MiniPanelMetrics.margin - length
    )
    guard low <= high else { return workArea.midY - length / 2 }
    return min(max(center - length / 2, low), high)
  }

  /// The controls from the top of `capsule`, and the hairline under the mark.
  private static func controls(in capsule: ScreenRect, hasCommands: Bool)
    -> ([ScreenRect], ScreenRect)
  {
    typealias Metrics = MiniPanelMetrics
    var top = capsule.maxY - Metrics.padding
    func next(gap: Double) -> ScreenRect {
      top -= gap + Metrics.buttonSide
      return ScreenRect(
        x: capsule.x + Metrics.padding, y: top, width: Metrics.buttonSide,
        height: Metrics.buttonSide)
    }
    var buttons = [next(gap: 0)]
    let hairline = ScreenRect(
      x: capsule.x + Metrics.hairlineInset, y: top - Metrics.hairlineMargin - Metrics.hairline,
      width: capsule.width - Metrics.hairlineInset * 2, height: Metrics.hairline)
    buttons.append(next(gap: Metrics.hairlineMargin * 2 + Metrics.hairline))
    for _ in 0..<(hasCommands ? 3 : 2) { buttons.append(next(gap: Metrics.buttonGap)) }
    return (buttons, hairline)
  }

  /// The card beside the capsule toward the screen's interior, ``MiniPanelMetrics/flyoutGap``
  /// away, its last visible row level with the Commands button so it rises out of it.
  private static func flyout(
    beside capsule: ScreenRect, commandsButton: ScreenRect?, rows: Int, width: Double,
    right: Bool, in workArea: ScreenRect
  ) -> ScreenRect? {
    typealias Metrics = MiniPanelMetrics
    guard let commandsButton else { return nil }
    let width = min(max(width, Metrics.flyoutMinWidth), Metrics.flyoutMaxWidth)
    let height = Metrics.flyoutHeight(rows: rows)
    let bottom = commandsButton.midY - Metrics.rowHeight / 2 - Metrics.cardPadding
    let (low, high) = (workArea.y + Metrics.margin, workArea.maxY - Metrics.margin - height)
    return ScreenRect(
      x: right ? capsule.x - Metrics.flyoutGap - width : capsule.maxX + Metrics.flyoutGap,
      y: low <= high ? min(max(bottom, low), high) : workArea.midY - height / 2,
      width: width, height: height)
  }

  /// ``MiniPanelMetrics/canvasSize`` centered on the anchor, moved along each axis to stay on
  /// the display when the display is large enough on that axis.
  private static func canvas(
    columnCenter: Double, pillCenter: Double, workArea: ScreenRect, displayFrame: ScreenRect
  ) -> ScreenRect {
    let size = MiniPanelMetrics.canvasSize
    let full = MiniPanelMetrics.capsuleHeight(hasCommands: true)
    let anchor = origin(centeredOn: pillCenter, length: full, in: workArea) + full / 2
    var x = columnCenter - size.width / 2
    if displayFrame.width >= size.width {
      x = min(max(x, displayFrame.x), displayFrame.maxX - size.width)
    }
    var y = anchor - size.height / 2
    if displayFrame.height >= size.height {
      y = min(max(y, displayFrame.y), displayFrame.maxY - size.height)
    }
    return ScreenRect(x: x, y: y, width: size.width, height: size.height)
  }
}

/// The body glass's shapes, one for each state that shows it: one living shape that morphs from
/// one to the next (motion-v2), never a cross-fade between two.
public enum MiniPanelShape: CaseIterable, Sendable {
  case pill
  /// The pill answering a pointer in the hot zone, before it opens.
  case swell
  case capsule
  case invite
  /// The drop card.
  case target
}
