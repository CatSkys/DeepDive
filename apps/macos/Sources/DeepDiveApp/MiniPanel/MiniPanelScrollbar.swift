import CoreGraphics

/// A scrolling commands card's scrollbar, in the look of the shared ScrollArea whose bar floats
/// in the content's padding: the thumb sits in the card's trailing padding, 1 pt clear of the
/// rows and of the card's edge, and runs along the card's straight side only, between its
/// rounded corners; its length is the share of the list that shows. It is dragged, or pressed on
/// its track to jump there, as the ScrollArea's is. Everything is in the card's own coordinates
/// at rest, y down from its top.
public struct MiniPanelScrollbar: Equatable, Sendable {
  /// The shortest the thumb gets, as the ScrollArea's.
  public static let minThumb = 18.0
  /// How far the bar's lane reaches past the card's padding into the rows' own (8 pt), so the
  /// pointer finds a bar as wide as the ScrollArea's (10 pt) without reaching any row's name.
  public static let laneReach = 4.0

  public let card: CGSize
  /// How far the rows are scrolled.
  public let offset: Double
  /// How tall the rows are, all of them and the part that shows.
  public let content: Double
  public let shown: Double

  public init(card: CGSize, offset: Double, content: Double, shown: Double) {
    self.card = card
    self.offset = offset
    self.content = content
    self.shown = shown
  }

  /// How far the rows scroll.
  public var range: Double { max(content - shown, 0) }

  private var trackTop: Double { MiniPanelMetrics.cardRadius }
  private var trackLength: Double { max(Double(card.height) - MiniPanelMetrics.cardRadius * 2, 0) }

  public var thumbLength: Double {
    let share = content > 0 ? min(shown / content, 1) : 1
    return min(max(trackLength * share, Self.minThumb), trackLength)
  }

  /// The thumb at the current offset, held at the track's ends while the list bounces past them.
  public var thumb: CGRect {
    let progress = range > 0 ? min(max(offset / range, 0), 1) : 0
    return CGRect(
      x: Double(card.width) - MiniPanelMetrics.cardPadding + 1,
      y: trackTop + (trackLength - thumbLength) * progress,
      width: MiniPanelMetrics.cardPadding - 2, height: thumbLength)
  }

  /// Where the pointer finds the bar: the trailing padding and the reach into the rows', along
  /// the track.
  public var lane: CGRect {
    let width = MiniPanelMetrics.cardPadding + Self.laneReach
    return CGRect(
      x: Double(card.width) - width, y: trackTop, width: width, height: trackLength)
  }

  /// The offset that puts the thumb's top at `top`, within the list's range.
  public func offset(thumbTop top: Double) -> Double {
    let travel = trackLength - thumbLength
    guard travel > 0 else { return 0 }
    return min(max((top - trackTop) / travel, 0), 1) * range
  }
}
