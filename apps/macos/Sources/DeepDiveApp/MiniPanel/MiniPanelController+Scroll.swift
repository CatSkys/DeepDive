import AppKit

/// A scrolling commands card's scrollbar (``MiniPanelScrollbar``), as the shared ScrollArea's
/// works: its thumb follows a drag, and a press on its track jumps the thumb's middle to the
/// press before following on. The window holds the press as it holds every other
/// (``MiniPanelPress/scroller``) and reports where it goes; the rows scroll to match through the
/// card's scroll position (``MiniPanelModel/flyoutScrollTarget``).
extension MiniPanelController {
  /// The open card's scrollbar as it stands; nil while the card is closed or its list fits.
  var scrollbar: MiniPanelScrollbar? {
    guard model.flyoutOpen, commands.count > MiniPanelMetrics.maxVisibleRows,
      let card = layout?.flyout
    else { return nil }
    return MiniPanelScrollbar(
      card: CGSize(width: card.width, height: card.height), offset: model.flyoutScroll,
      content: Double(commands.count) * MiniPanelMetrics.rowHeight,
      shown: Double(MiniPanelMetrics.maxVisibleRows) * MiniPanelMetrics.rowHeight)
  }

  /// Whether `point` (global) is on the open card's scrollbar, where no row is.
  func isOnScrollbar(_ point: CGPoint) -> Bool {
    guard snap == nil, let bar = scrollbar, let local = inCard(point) else { return false }
    return bar.lane.contains(local)
  }

  /// The scrollbar's look: dragged while a press holds it, hovered under the pointer.
  func trackScrollbar(_ pointer: CGPoint) {
    let state: MiniPanelScrollerState =
      scrollerGrab != nil ? .dragging : isOnScrollbar(pointer) ? .hovered : .idle
    if state != model.scroller { model.scroller = state }
  }

  /// A press on the scrollbar went down, moved or came back up.
  func scroller(_ phase: MiniPanelScrollerPhase) {
    switch phase {
    case .began(let point):
      guard let bar = scrollbar, let local = inCard(point) else { return }
      let thumb = bar.thumb
      let onThumb = local.y >= thumb.minY && local.y <= thumb.maxY
      // The thumb holds where it was taken; a press on the track takes it by its middle.
      let grab = onThumb ? local.y - thumb.minY : bar.thumbLength / 2
      scrollerGrab = grab
      model.flyoutScrollTarget = nil
      model.scroller = .dragging
      if !onThumb { scroll(to: bar.offset(thumbTop: local.y - grab)) }
    case .moved(let point):
      guard let grab = scrollerGrab, let bar = scrollbar, let local = inCard(point) else {
        return
      }
      scroll(to: bar.offset(thumbTop: local.y - grab))
    case .ended:
      scrollerGrab = nil
      model.flyoutScrollTarget = nil
      trackScrollbar(NSEvent.mouseLocation)
    }
  }

  private func scroll(to offset: Double) {
    if offset != model.flyoutScrollTarget { model.flyoutScrollTarget = offset }
  }

  /// `point` (global, y up) in the open card at rest, y down from its top.
  private func inCard(_ point: CGPoint) -> CGPoint? {
    guard let card = layout?.flyout else { return nil }
    return CGPoint(x: point.x - card.x, y: card.maxY - point.y)
  }
}
