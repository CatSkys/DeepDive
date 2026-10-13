import AppKit

/// The style bar's size slider, from smallest (left) to largest (right), like PixPin's. A drag
/// sends its action as the knob moves and once more with the value it is let go at, all with the
/// same ``burst``, so the owner commits the whole drag as one undo step. A scroll over it goes on
/// to the overlay, which adjusts the size the same way the wheel does anywhere else.
final class AnnotationSizeSlider: NSSlider {
  /// The drag in progress; nil between drags.
  private(set) var burst: UUID?

  init() {
    super.init(frame: .zero)
    minValue = 0
    maxValue = 1
    isContinuous = true
    controlSize = .small
    translatesAutoresizingMaskIntoConstraints = false
    widthAnchor.constraint(equalToConstant: 112).isActive = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  /// The overlay panel never becomes key, so the first click must work.
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  /// AppKit runs the drag inside `super.mouseDown`, which returns once the button is up.
  override func mouseDown(with event: NSEvent) {
    burst = UUID()
    super.mouseDown(with: event)
    sendAction(action, to: target)
    burst = nil
  }

  /// Not handled here: a slider of its own would make one undo step per tick.
  override func scrollWheel(with event: NSEvent) {
    nextResponder?.scrollWheel(with: event)
  }

  override func resetCursorRects() {
    addCursorRect(bounds, cursor: .arrow)
  }
}
