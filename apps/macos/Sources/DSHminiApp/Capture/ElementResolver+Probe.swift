import ApplicationServices
import CoreGraphics
import Dispatch

/// A bound on the Accessibility work one hover may do. A hung or enormous app (a browser with a
/// huge page) must not hold the resolver: past either limit the walk stops with what it has.
nonisolated struct AccessibilityBudget {
  private let deadline: UInt64
  private var calls: Int

  init(milliseconds: UInt64, calls: Int) {
    deadline = DispatchTime.now().uptimeNanoseconds + milliseconds * 1_000_000
    self.calls = calls
  }

  /// Takes one Accessibility call from the budget; false once it is spent.
  mutating func spend() -> Bool {
    guard calls > 0, DispatchTime.now().uptimeNanoseconds < deadline else { return false }
    calls -= 1
    return true
  }
}

/// The Accessibility reads the resolver needs. Nothing here is isolated: every function runs on
/// the resolver's executor, because `AXUIElement` is not `Sendable` and the calls block on the
/// target app.
nonisolated enum AccessibilityProbe {
  /// Per-reference reply timeout. Long enough for a cold first message (about 20 to 50 ms), short
  /// enough that a hung app costs one hover a fraction of a frame.
  static let messagingTimeout: Float = 0.08
  /// Parents walked from the deepest element before giving up on reaching the window. Web trees
  /// stack dozens of generic groups, so this is far above a native app's depth.
  static let maximumDepth = 64
  /// The descent below the hit-test result: levels, and children examined per level.
  static let maximumRefinementDepth = 8
  static let maximumChildrenExamined = 48

  /// The attribute Electron and Chromium honour to build their web tree for assistive tools,
  /// without the window side effects of `AXEnhancedUserInterface`.
  private static let manualAccessibility = "AXManualAccessibility"

  static func application(pid: pid_t) -> AXUIElement {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, messagingTimeout)
    return app
  }

  /// Sets (`seconds` > 0) or resets (0) the process-wide default, which references obtained
  /// from a hit-test inherit.
  static func setDefaultTimeout(_ seconds: Float) {
    AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), seconds)
  }

  /// The element `app` shows at `point` (Quartz), looking through other apps' windows; nil when
  /// the app does not answer or has nothing there.
  static func element(at point: CGPoint, in app: AXUIElement) -> AXUIElement? {
    var element: AXUIElement?
    let error = AXUIElementCopyElementAtPosition(app, Float(point.x), Float(point.y), &element)
    return error == .success ? element : nil
  }

  /// The ancestor chain from `element` to its window, deepest first, as roles and frames.
  /// Elements without a role or a frame are skipped; the walk ends at the window, the
  /// application, the depth limit or the end of `budget`.
  static func chain(from element: AXUIElement, budget: inout AccessibilityBudget)
    -> [ElementChain.Node]
  {
    elements(from: element, budget: &budget).map(\.node)
  }

  /// ``chain(from:budget:)`` with each node's element, for reading more than its frame.
  static func elements(from element: AXUIElement, budget: inout AccessibilityBudget)
    -> [(element: AXUIElement, node: ElementChain.Node)]
  {
    var nodes: [(element: AXUIElement, node: ElementChain.Node)] = []
    var current: AXUIElement? = element
    for _ in 0..<maximumDepth {
      guard let node = current, budget.spend(), let step = step(at: node) else { break }
      if step.role == "AXApplication" { break }
      if let frame = step.frame {
        nodes.append((node, ElementChain.Node(role: step.role, frame: frame)))
      }
      if step.role == "AXWindow" { break }
      current = step.parent
    }
    return nodes
  }

  /// Descends from `element` towards the smallest child under `point`. Some apps (Chromium
  /// trees in particular) answer the hit-test with a container; the real target is a child.
  static func deepest(
    below element: AXUIElement, at point: CGPoint, budget: inout AccessibilityBudget
  ) -> AXUIElement {
    var current = element
    for _ in 0..<maximumRefinementDepth {
      guard budget.spend(),
        let children: [AXUIElement] = copy(current, kAXChildrenAttribute)
      else { break }
      var best: (element: AXUIElement, area: CGFloat)?
      for child in children.prefix(maximumChildrenExamined) {
        guard budget.spend(), let frame = frame(of: child), frame.contains(point) else {
          continue
        }
        let area = frame.width * frame.height
        if area > 0, area < (best?.area ?? .infinity) { best = (child, area) }
      }
      guard let best else { break }
      current = best.element
    }
    return current
  }

  /// Turns Electron/Chromium's accessibility tree on for `app` when it supports the switch and
  /// it is off. True when this call changed it, so the caller can restore it; apps that do not
  /// have the attribute, or already have it on, are left alone.
  static func enableManualAccessibility(on app: AXUIElement) -> Bool {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app, manualAccessibility as CFString, &value) == .success,
      let enabled = value as? Bool, !enabled
    else { return false }
    return AXUIElementSetAttributeValue(app, manualAccessibility as CFString, kCFBooleanTrue)
      == .success
  }

  static func disableManualAccessibility(on app: AXUIElement) {
    _ = AXUIElementSetAttributeValue(app, manualAccessibility as CFString, kCFBooleanFalse)
  }

  /// An element's role, frame and parent in one round trip; nil without a role. The frame is
  /// nil when the element has none.
  private static func step(at element: AXUIElement)
    -> (role: String, frame: CGRect?, parent: AXUIElement?)?
  {
    let names = [kAXRoleAttribute, "AXFrame", kAXParentAttribute] as CFArray
    var values: CFArray?
    guard
      AXUIElementCopyMultipleAttributeValues(
        element, names, AXCopyMultipleAttributeOptions(), &values)
        == .success,
      let values = values as? [CFTypeRef], values.count == 3,
      let role = values[0] as? String
    else { return nil }
    // An attribute that failed comes back as an `AXValue` of type error, not as an absent entry.
    let frame =
      isType(values[1], AXValueGetTypeID()).flatMap {
        rect(of: unsafeDowncast($0, to: AXValue.self))
      }
      ?? frame(of: element)
    let parent = isType(values[2], AXUIElementGetTypeID()).map {
      unsafeDowncast($0, to: AXUIElement.self)
    }
    return (role, frame, parent)
  }

  private static func isType(_ value: CFTypeRef, _ type: CFTypeID) -> CFTypeRef? {
    CFGetTypeID(value) == type ? value : nil
  }

  /// `AXFrame` when the element has it, otherwise position plus size; Quartz points.
  private static func frame(of element: AXUIElement) -> CGRect? {
    if let value: AXValue = copy(element, "AXFrame"), let rect = rect(of: value) {
      return rect
    }
    guard let position: AXValue = copy(element, kAXPositionAttribute),
      let size: AXValue = copy(element, kAXSizeAttribute)
    else { return nil }
    var origin = CGPoint.zero
    var extent = CGSize.zero
    guard AXValueGetValue(position, .cgPoint, &origin), AXValueGetValue(size, .cgSize, &extent)
    else { return nil }
    return CGRect(origin: origin, size: extent)
  }

  private static func rect(of value: AXValue) -> CGRect? {
    var rect = CGRect.zero
    return AXValueGetValue(value, .cgRect, &rect) ? rect : nil
  }

  private static func copy<T>(_ element: AXUIElement, _ attribute: String) -> T? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success
    else { return nil }
    return value as? T
  }
}
