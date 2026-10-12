import AppKit
import SwiftUI

/// Where a scrolling card's rows are, as its scroll view reports them. Only the thumb reads it, so
/// scrolling redraws the thumb alone.
@Observable
final class MiniPanelScrollMetrics {
  struct Geometry: Equatable {
    var offset = 0.0
    var content = 0.0
    var shown = 0.0

    init() {}

    init(_ geometry: ScrollGeometry) {
      offset = geometry.contentOffset.y
      content = geometry.contentSize.height
      shown = geometry.containerSize.height
    }
  }

  var geometry = Geometry()
}

/// A scrolling card's thumb (``MiniPanelScrollbar``): the card keeps the same padding on both
/// sides of its rows and the thumb shows in the trailing one, so it never covers a row. It
/// brightens under the pointer and while dragged, as the ScrollArea's does; the controller reads
/// the pointer and the drag (``MiniPanelController``'s scrollbar), and VoiceOver reads the rows.
struct MiniPanelScrollThumb: View {
  let model: MiniPanelModel
  let metrics: MiniPanelScrollMetrics
  /// The card's size at rest, which the thumb is drawn in.
  let size: CGSize

  var body: some View {
    let geometry = metrics.geometry
    let thumb = MiniPanelScrollbar(
      card: size, offset: geometry.offset, content: geometry.content, shown: geometry.shown
    ).thumb
    Capsule()
      .fill(Color.primary.opacity(Self.opacity(model.scroller)))
      .frame(width: thumb.width, height: thumb.height)
      .offset(x: thumb.minX, y: thumb.minY)
      .frame(width: size.width, height: size.height, alignment: .topLeading)
      .animation(.easeOut(duration: 0.12), value: model.scroller)
      .allowsHitTesting(false)
      .accessibilityHidden(true)
  }

  /// The glass's scroll thumb (`--ata-glass-scroll-thumb`, the label color at 28 %), brighter
  /// under the pointer and brighter still while dragged.
  static func opacity(_ state: MiniPanelScrollerState) -> Double {
    switch state {
    case .idle: 0.28
    case .hovered: 0.42
    case .dragging: 0.56
    }
  }
}
