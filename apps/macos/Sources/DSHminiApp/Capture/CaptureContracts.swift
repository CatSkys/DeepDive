import AppKit
import CoreGraphics

// The seams of a capture session (`screenshot.capture`). The session owns the frozen displays,
// the overlay windows and the selection; element detection and annotation plug in through the
// protocols below. Every rect is in points unless a name says pixels. "Quartz" points are global
// with the origin at the top-left of the primary display and y down (AX, CGWindowList and
// ScreenCaptureKit use them); "view" points are an overlay view's flipped coordinates, which equal
// Quartz points minus the display's Quartz origin.

/// One display frozen at the start of a session.
nonisolated struct FrozenDisplay {
  let displayID: CGDirectDisplayID
  /// The display's bounds in Quartz points (`CGDisplayBounds`); may have a negative origin.
  let quartzFrame: CGRect
  /// The display's pixels with the app's own windows excluded, origin top-left.
  let image: CGImage

  /// Image pixels per point on this display.
  var pixelScale: CGFloat { CGFloat(image.width) / quartzFrame.width }
}

/// A window on screen when the session started, front to back. Taken before any overlay
/// appears, so the session decides which app is under a point (AX hit-testing cannot: it would
/// answer with the overlay).
nonisolated struct CaptureWindow: Equatable, Sendable {
  let windowID: CGWindowID
  let pid: pid_t
  /// Window bounds in Quartz points.
  let quartzFrame: CGRect
  /// `kCGWindowLayer`.
  let layer: Int
}

/// What element detection can offer for this session.
nonisolated enum ElementDetection: Equatable, Sendable {
  /// Accessibility is trusted: elements inside windows are detected.
  case elements
  /// Accessibility is not trusted: only whole windows are offered, and the overlay shows the
  /// `capture.hint.accessibility` hint.
  case windowsOnly
}

/// What Accessibility says about one detected interface element, for the screen-context
/// attachment. Strings are as the app reports them, trimmed; empty ones are nil.
nonisolated struct ElementDescription: Equatable, Sendable {
  /// The AX role, e.g. `AXButton`.
  let role: String
  /// `AXTitle`, else `AXDescription`.
  let title: String?
  /// `AXValue` when it is text or a number, bounded.
  let value: String?
  /// `AXHelp`.
  let help: String?
}

/// Candidate areas under the pointer. Implementations run their Accessibility work off the main
/// actor and hand back plain rects only.
nonisolated protocol ElementTargeting: Sendable {
  /// Starts a session over `windows` (front to back, the app's own windows already removed).
  func begin(windows: [CaptureWindow]) async -> ElementDetection
  /// The areas containing `point` (Quartz), smallest first and ending with the window; empty
  /// when no window is there (the session then offers the display). Each rect lies within its
  /// window and display. A call may be superseded by a later one: callers keep the latest answer.
  func targets(at point: CGPoint) async -> [CGRect]
  /// The element among `targets(at: point)` whose frame is `frame` (Quartz), described; nil for
  /// a window, the display, or when Accessibility cannot tell. Called once, when the selection is
  /// confirmed, for a selection committed from a detected element.
  func describe(at point: CGPoint, frame: CGRect) async -> ElementDescription?
  /// Ends the session and restores any state it changed in other apps.
  func end() async
}

/// The annotation step on a committed selection, hosted by the overlay view of the selection's
/// display. The selection stays adjustable the whole time (its handles and edge band always
/// belong to the session), so annotation geometry is in the host overlay view's points: an
/// annotation stays where it was drawn on the screen while the selection moves or resizes, and
/// the selection only decides what is exported.
protocol AnnotationEditing: AnyObject {
  /// The user confirmed (toolbar or a shortcut the editor handles while it has focus).
  var onConfirm: (() -> Void)? { get set }
  /// The user cancelled from the toolbar.
  var onCancel: (() -> Void)? { get set }
  /// The user asked to copy the result instead of attaching it (toolbar or ⌘C).
  var onCopy: (() -> Void)? { get set }
  /// The user sent a message with this capture (the toolbar's ask button opens
  /// ``AnnotationChatBar``): the session ends with the selection and that message.
  var onAsk: ((String) -> Void)? { get set }
  /// True while a tool is chosen: presses inside the selection (away from its handles and edge
  /// band) go to the editor. False: they move the selection. Called on every change.
  var onInteriorClaimChange: ((Bool) -> Void)? { get set }
  /// Whether anything is drawn; a right-click clears the selection back to idle only when not.
  var hasAnnotations: Bool { get }
  /// Set by the session before ``show(in:selection:display:)``: the detected areas containing a
  /// point (view points of the host, smallest first, each within the display), for tools that
  /// snap a shape to an interface element. Answers may come late; callers keep the latest.
  var elementTargets: ((CGPoint) async -> [CGRect])? { get set }
  /// Adds the canvas (over `selection`, view points) and the bars beside it to `host`.
  func show(in host: NSView, selection: CGRect, display: FrozenDisplay)
  /// The selection moved or was resized at any time; annotations stay put, the canvas and the
  /// bars follow the selection.
  func selectionDidChange(_ selection: CGRect)
  /// Removes the canvas and the bars; annotations are discarded.
  func hide()
  /// A scroll-wheel event anywhere over the selection's overlay; true when the editor used it
  /// (to resize what the style bar targets), false to leave it to the session.
  func scroll(_ event: NSEvent) -> Bool
  /// The annotations in selection-local points (origin at the selection's top-left), for
  /// reopening this capture later (`screenshot.edit`).
  var document: AnnotationDocument { get }
  /// Replaces the annotations with `document` (selection-local points, as ``document`` gives
  /// them), placed on the current selection; one state, not an undo step. Called after `show`.
  func restore(_ document: AnnotationDocument)
  /// Draws the annotations inside the selection into `context`, which already holds the
  /// selection's pixels with the origin at the selection's top-left and one unit per pixel;
  /// `scale` is pixels per point. Mosaics sample the frozen display image the editor was shown
  /// with, so they read pixels beyond the selection's edge too.
  func render(into context: CGContext, scale: CGFloat)
}
