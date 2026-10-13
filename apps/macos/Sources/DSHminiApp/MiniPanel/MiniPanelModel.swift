import AppKit
import Observation
import SwiftUI

/// The mini panel's state machine (spec v1, States). ``MiniPanelController`` owns it; the commands
/// card is a sub-state of `expanded` (``MiniPanelModel/flyoutOpen``).
enum MiniPanelPhase: String {
  /// Off, or withdrawn for a capture session or a system open or save panel: no window.
  case hidden
  /// At rest: the pill against the edge.
  case tucked
  /// The capsule of quick actions.
  case expanded
  /// The capsule, lifted, following the pointer.
  case dragging
  /// The pill, lifted, following the pointer: a drag that begins tucked stays tucked.
  case draggingPill
  /// A drag with something to take is under way somewhere on screen.
  case invite
  /// The dragged item is over the invite: the drop card.
  case target
  /// The drop card taking a drop in, before it tucks away.
  case absorbing

  /// Whether the panel follows the pointer, as the capsule or as the pill.
  var isDragging: Bool { self == .dragging || self == .draggingPill }
}

/// One of the mini panel's controls. Nonisolated, so the pure hover-label timer can hold it.
nonisolated enum MiniPanelControl: Hashable, Sendable {
  /// The Atd mark, which shows or hides the task panel.
  case mark
  case newTask
  case ask
  case screenshot
  case commands
  /// A row of the commands card, by its index in the pushed list.
  case row(Int)

  /// The capsule's buttons from the top, as ``MiniPanelLayout/buttons`` lays them out.
  static func buttons(hasCommands: Bool) -> [MiniPanelControl] {
    [.mark, .newTask, .ask, .screenshot] + (hasCommands ? [.commands] : [])
  }

  /// The stable accessibility identifier, which runtime checks read; never shown.
  var identifier: String {
    switch self {
    case .mark: "miniPanel.action.open"
    case .newTask: "miniPanel.action.newTask"
    case .ask: "miniPanel.action.ask"
    case .screenshot: "miniPanel.action.screenshot"
    case .commands: "miniPanel.action.commands"
    case .row(let index): "miniPanel.flyout.row.\(index)"
    }
  }
}

/// Content that shows inside one of the glass shapes. Each stays in place while it arrives and
/// leaves on its own (motion-v2), so no state swaps one view for another.
nonisolated enum MiniPanelContent: Hashable, Sendable, CaseIterable {
  /// The capsule's controls.
  case capsule
  /// The invite's drop glyph.
  case invite
  /// The drop card's glyph and call to action.
  case card
  /// The commands card's rows.
  case rows
  /// The hover label's text.
  case labelText
}

/// Whether content shows, and how it gets there (motion-v3: opacity and blur; its size follows its
/// shape). The views animate from this with scoped animations, so content keeps its own curves
/// whichever change redraws it, and nothing is written while it moves.
struct MiniPanelPresence: Equatable {
  var shown = false
  var motion = MiniPanelChoreography.content(.expand)
}

/// The body glass: where its shape rests in the glass container (y down) with its corner radius,
/// and the animation it moves there on, which runs its thickness (across the docked edge) and its
/// length (along it) on their own springs (``MiniPanelAxisAnimation``), so the shape swells
/// before it stretches with no frame written by the controller; nil for a jump.
struct MiniPanelBodyShape: Equatable {
  var frame = CGRect.zero
  var corner = 0.0
  /// The animation of the shape's last change: its morph, or the factors drawn into it
  /// (``MiniPanelBodyFactors``), each on its own.
  var animation: Animation?

  /// The shape with `factors` drawn into it, about its middle.
  func drawn(_ factors: MiniPanelBodyFactors) -> CGRect {
    let width = frame.width * factors.scale * factors.deform.width
    let height = frame.height * factors.scale * factors.deform.height
    return CGRect(
      x: frame.midX - width / 2, y: frame.midY - height / 2, width: width, height: height)
  }
}

/// What moves and scales the body beyond its shape: the press's squish and the drag's lift, which
/// scale its content too (`scale`), the release's stretch and the drop's squash, which deform the
/// glass only (`deform`), both drawn into the shape on the animation of their last change
/// (``MiniPanelBodyShape/animation``), and the snap's shift, glass and content together, from
/// where the body was drawn as it was released to where its shape rests in the new canvas
/// (`shift`), on its own.
struct MiniPanelBodyFactors: Equatable {
  var scale = 1.0
  var deform = CGSize(width: 1, height: 1)
  var shift = CGSize.zero
  var shiftAnimation: Animation?
}

/// The commands card's glass: closed, it has shrunk to nothing in the Commands button's middle,
/// and it grows out of there to the card. Its glass stays on, shrunk to nothing, since switching a
/// shape's glass off or on makes the glass container rebuild itself at once (measured: 4 to 12 ms
/// of main thread, and dropped frames), while an empty shape costs next to nothing.
struct MiniPanelCardShape: Equatable {
  var frame = CGRect.zero
  var animation: Animation?
}

/// The hover label (hover-label-v2), in the glass container: where it rests, the control's middle
/// it grows out of and draws back into, and how far out it is (``MiniPanelLabelPath``), drawn in
/// a fixed lane that holds every label beside its shape. Its text rides inside it, centered and
/// sized with it, and shows through its own presence. Like the card's, its glass stays on: drawn
/// in, it is empty.
struct MiniPanelLabelShape: Equatable {
  var text = ""
  var rest = CGRect.zero
  var point = CGPoint.zero
  var lane = CGRect.zero
  var progress = 0.0
  /// Out, or still drawing back: a label for another control glides from it, never grows anew.
  var drawn = false
  var animation: Animation?
}

/// A scrolling commands card's scrollbar under the pointer: at rest, hovered, or its thumb
/// dragged (or its track pressed), which its thumb shows.
enum MiniPanelScrollerState: Equatable {
  case idle
  case hovered
  case dragging
}

/// Where a drag's release lands on the panel rather than the app below, with a hole where the
/// body's glass is drawn, so nothing lies under the glass.
struct MiniPanelDropZone: Equatable {
  var zone = CGRect.zero
  var hole = CGRect.zero
  var corner = 0.0
}

/// The panel's copy in the current shell language, read again when it changes. Command names are
/// user data and never pass through here.
struct MiniPanelLabels: Equatable {
  var panel = ""
  var open = ""
  var hidePanel = ""
  var newTask = ""
  var ask = ""
  var screenshot = ""
  var commands = ""
  var drop = ""

  static func current() -> MiniPanelLabels {
    let strings = ShellStrings.shared
    return MiniPanelLabels(
      panel: strings.text(.miniPanelLabel), open: strings.text(.miniPanelOpen),
      hidePanel: strings.text(.miniPanelHidePanel), newTask: strings.text(.miniPanelNewTask),
      ask: strings.text(.miniPanelAsk), screenshot: strings.text(.miniPanelScreenshot),
      commands: strings.text(.miniPanelCommands), drop: strings.text(.miniPanelDrop))
  }
}

/// What the mini panel's SwiftUI content draws (``MiniPanelView``). ``MiniPanelController`` is
/// its only writer, except for the card's scroll offset, which the content reports back for
/// the pointer's row. Frames are in the canvas, y down, as the controller computed them from
/// ``MiniPanelLayout``, so what is drawn and what the pointer tracking hits agree.
@Observable
final class MiniPanelModel {
  var phase = MiniPanelPhase.hidden
  var canvas = CGSize.zero
  var edge = MiniPanelEdge.right
  /// The glass container in the canvas: only where glass can be, never the whole canvas.
  var glassFrame = CGRect.zero
  var body = MiniPanelBodyShape()
  /// Where the body is drawn: every shape it takes, with room for its springs.
  var bodyLane = CGRect.zero
  var bodyFactors = MiniPanelBodyFactors()
  /// Where each content lays out: the shape it belongs to, at rest, in the glass container.
  var contentFrames: [MiniPanelContent: CGRect] = [:]
  /// Each content's presence, observed apart, so one arriving or leaving redraws it alone.
  private var capsulePresence = MiniPanelPresence()
  private var invitePresence = MiniPanelPresence()
  private var cardPresence = MiniPanelPresence()
  private var rowsPresence = MiniPanelPresence()
  private var labelTextPresence = MiniPanelPresence()
  /// The body content the phase shows: the only one clicks reach and VoiceOver reads.
  var activeContent: MiniPanelContent?
  var flyoutOpen = false
  var card = MiniPanelCardShape()
  /// Where the card is drawn: its open frame and every body shape it closes into.
  var cardLane = CGRect.zero
  var commands: [MiniPanelSetCommandsParams.Command] = []
  var scroller = MiniPanelScrollerState.idle
  /// Where a drag on the card's scrollbar, or a press on its track, scrolls the rows to; nil
  /// while none does. The card's scroll view applies it.
  var flyoutScrollTarget: Double?
  var label = MiniPanelLabelShape()
  var dropZone: MiniPanelDropZone?
  /// Where a click opens the tucked pill, the pill and the space around it out to the screen
  /// edge (the hot zone), in the glass container; nil while the panel opens on hover.
  var clickZone: CGRect?
  /// The control under the pointer, which shows its wash.
  var hovered: MiniPanelControl?
  /// The control being pressed, which shows its press until the release.
  var pressed: MiniPanelControl?
  /// Reduce Motion, followed live: no bounce, scale or deformation.
  var reduceMotion = false
  var labels = MiniPanelLabels()
  /// The task panel has the keyboard, so the Atd mark hides it rather than showing it.
  var panelIsKey = false

  /// The card's scroll offset in points, which the content reports.
  @ObservationIgnored var flyoutScroll = 0.0
  /// Runs a control's action: a click passed through to the content, or VoiceOver's press.
  @ObservationIgnored var perform: (MiniPanelControl) -> Void = { _ in }
  /// A click on the pill, or VoiceOver's press on it, opens the capsule.
  @ObservationIgnored var expand: () -> Void = {}
  /// VoiceOver's escape on the open capsule.
  @ObservationIgnored var collapse: () -> Void = {}

  /// The Atd mark's label: what a click on it does now.
  var markLabel: String { panelIsKey ? labels.hidePanel : labels.open }

  func presence(_ content: MiniPanelContent) -> MiniPanelPresence {
    switch content {
    case .capsule: capsulePresence
    case .invite: invitePresence
    case .card: cardPresence
    case .rows: rowsPresence
    case .labelText: labelTextPresence
    }
  }

  func setPresence(_ content: MiniPanelContent, _ presence: MiniPanelPresence) {
    switch content {
    case .capsule: capsulePresence = presence
    case .invite: invitePresence = presence
    case .card: cardPresence = presence
    case .rows: rowsPresence = presence
    case .labelText: labelTextPresence = presence
    }
  }

  func frame(_ content: MiniPanelContent) -> CGRect { contentFrames[content] ?? .zero }
}
