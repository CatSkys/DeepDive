import AppKit

// The capture overlay's cursors (decision D15) in one place. The session sets the selection's
// (``CaptureSession``'s `overlay(_:cursorAt:)`): frame-resize over its handles and edge band,
// an open hand inside it before a tool is chosen (closed while moving), the arrow outside it.
// Over the bars, the arrow on a control and an open hand on the surface that drags them (closed
// while dragging). The annotation canvas sets its own over the interior a tool claimed:
//
// | Under the pointer (or the gesture running)       | Cursor                        |
// | ------------------------------------------------ | ----------------------------- |
// | grip of the selected box shape, or resizing it   | frame-resize for that grip    |
// | end of the selected arrow or line, or dragging it | crosshair                    |
// | an annotation a press would select or drag       | open hand                     |
// | dragging an annotation                           | closed hand                   |
// | text the text tool would open                    | I-beam                        |
// | empty canvas: select / text / drawing tools      | arrow / I-beam / crosshair    |

extension SelectionHandle {
  /// The system's frame-resize cursor for this handle.
  var cursor: NSCursor {
    let position: NSCursor.FrameResizePosition =
      switch self {
      case .topLeft: .topLeft
      case .top: .top
      case .topRight: .topRight
      case .right: .right
      case .bottomRight: .bottomRight
      case .bottom: .bottom
      case .bottomLeft: .bottomLeft
      case .left: .left
      }
    return .frameResize(position: position, directions: .all)
  }
}

extension AnnotationHandle {
  /// A box grip resizes like the selection's handle at the same place; a line end moves a
  /// point freely, for which the system has no resize cursor.
  var cursor: NSCursor { boxHandle?.cursor ?? .crosshair }
}

extension AnnotationInteraction {
  /// The cursor for the pointer at `point` (canvas, that is view, points): the running
  /// gesture's, else what a press there would do; nil before a tool is chosen.
  func cursor(at point: CGPoint) -> NSCursor? {
    guard let tool else { return nil }
    switch gesture {
    case .drawing: return Self.canvasCursor(tool)
    case .moving: return .closedHand
    case .resizing(_, let handle): return handle.cursor
    case .idle: break
    }
    switch target(at: point) {
    case .grip(let handle): return handle.cursor
    case .annotation: return .openHand
    case .text: return .iBeam
    case .canvas, nil: return Self.canvasCursor(tool)
    }
  }

  private static func canvasCursor(_ tool: AnnotationTool) -> NSCursor {
    switch tool {
    case .select: .arrow
    case .text: .iBeam
    case .rectangle, .ellipse, .arrow, .line, .pen, .highlighter, .mosaic, .spotlight, .step:
      .crosshair
    }
  }
}
