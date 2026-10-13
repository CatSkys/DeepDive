import AppKit
import Carbon.HIToolbox

/// The selection toolbar over text selected in other apps (grill decisions Q4–Q8).
///
/// While it is on (the page's `toolbar.set`) and the app is trusted for Accessibility, a global
/// monitor watches mouse-ups in other apps. One that may have ended a selection (a drag, a
/// double or triple click, a shift-click: ``SelectionGesture``) and that the activation admits
/// (``SelectionActivation``: always, the key combination held at the press or the release, or
/// while the `toggle` mode listens, ``SelectionToolbarListening``) is checked — unless
/// ``SelectionToolbarRules`` rules it out (excluded app, secure input, this app) — by asking
/// Accessibility off the main thread whether the focused element has a selection
/// (``SelectionPresence``, never the text). A selection shows the toolbar beside it. A drag or
/// shift-click is asked at once and, finding nothing, once more after ``debounce`` (web content
/// updates its selection late); a double click waits ``debounce`` first, so one that becomes a
/// triple asks once.
///
/// While the `toggle` mode listens, ``SelectionToolbarHUD`` says so near the bottom of the
/// screen (unless the page turned it off).
///
/// The toolbar goes on any key (Escape included), scroll or click elsewhere, and when another
/// app activates, and its More menu (``SelectionToolbarMenu``, which never takes the keyboard
/// either) goes with it; the pointer wandering off never closes either, so the menu can reach
/// as far from the capsule as it needs. A newer press or key makes any check still running
/// stale. Only presses are watched all the time; keys, scrolls and other buttons are watched
/// while a check is pending or the toolbar shows, so typing and scrolling elsewhere never wake
/// the app. Without the setting or the trust, no monitor is installed.
///
/// The welcome guide's practice area shows the same toolbar over text selected in the guide
/// itself (``showPractice(selection:text:)``), which the global monitors never see: the guide's
/// page drives it, hiding it as its selection goes, so no dismissal monitor watches it; the
/// activation gates it by the combination held as it arrives or the listening state, and
/// its Ask Atd hands on the practice text, which no Accessibility read would find. The guide never
/// spends tokens, so a practice toolbar's commands only hide it; Ask Atd quotes the text into the
/// panel's draft and sends nothing.
final class SelectionToolbarController {
  /// Ask Atd was clicked, with the practice text when the toolbar was the guide's (nil for a
  /// selection in another app); the toolbar is already hidden.
  var onAsk: ((String?) -> Void)?
  /// A command button or a row of the More menu was clicked on a toolbar over another app's
  /// selection; the toolbar and the menu are already hidden. A practice toolbar's commands never
  /// get here: they would run.
  var onCommand: ((String) -> Void)?

  static let debounce: Duration = .milliseconds(150)

  private let trust: AccessibilityTrust
  private let panel = SelectionToolbarPanel()
  /// Nil until the page first pushes the setting.
  private var settings: SelectionToolbarSettings?
  private var monitor: Any?
  /// Keys, scrolls and other buttons, watched only while a check is pending or the toolbar
  /// shows: each makes a check stale or hides the toolbar.
  private var interruptMonitor: Any?
  /// Pointer moves over other apps, watched only while the toolbar shows: hover tracking pauses
  /// while the pointer rests away from the toolbar and its menu, and needs a move to resume.
  private var moveMonitor: Any?
  private var activationObserver: NSObjectProtocol?
  private var pressedAt: CGPoint?
  /// The activation key combination was down when the last press went down.
  private var heldAtPress = false
  private let listening = SelectionToolbarListening()
  private let hud = SelectionToolbarHUD()
  /// Bumped by every press, key, scroll and app switch, so a check that started before one is
  /// dropped.
  private var generation = 0
  private var pending: Task<Void, Never>?
  /// The guide's practice selection while the toolbar shows for it.
  private var practiceText: String?
  /// Pointer moves over this app's own windows, watched while the practice toolbar shows: the
  /// global monitors see only other apps, and hover tracking needs a move to resume.
  private var practiceMoveMonitor: Any?

  init(trust: AccessibilityTrust) {
    self.trust = trust
    panel.onAsk = { [weak self] in
      let text = self?.practiceText
      self?.dismiss()
      self?.onAsk?(text)
    }
    panel.onCommand = { [weak self] id in
      let practice = self?.practiceText != nil
      self?.dismiss()
      if !practice { self?.onCommand?(id) }
    }
    listening.onChange = { [weak self] on in
      self?.hud.setListening(on)
      if !on { self?.dismiss() }
    }
  }

  /// Whether the `toggle` mode listens for selections, or nil while it is not in effect.
  var isListening: Bool? { listening.isArmed ? listening.isOn : nil }

  /// The status menu's way to turn the `toggle` mode's listening on or off.
  func setListening(_ on: Bool) { listening.set(on) }

  /// The page's `toolbar.set`.
  func apply(_ settings: SelectionToolbarSettings) {
    self.settings = settings
    panel.setCommands(settings.commands)
    hud.configure(enabled: settings.showHud, keys: settings.activation.keys)
    update()
  }

  /// Installs the monitors exactly while the toolbar is on and trusted, and arms the `toggle`
  /// mode's listening only then.
  func update() {
    let active = settings?.enabled == true && trust.isTrusted
    if active, monitor == nil {
      install()
    } else if !active, monitor != nil {
      uninstall()
    }
    let activation = settings?.activation
    listening.arm(active && activation?.mode == .toggle ? activation?.keys : nil)
  }

  // MARK: Practice

  /// Shows the toolbar beside the guide's practice selection (`selection` in Cocoa global
  /// points) when the real one would show at all: the setting is on and the app is trusted.
  /// Otherwise any practice toolbar hides.
  func showPractice(selection: CGRect, text: String) {
    guard let settings, settings.enabled, trust.isTrusted else { return hidePractice() }
    let held = settings.activation.isHeld(in: NSEvent.modifierFlags)
    guard
      settings.activation.admits(heldAtPress: held, heldAtRelease: held, listening: listening.isOn)
    else { return hidePractice() }
    dismiss()
    practiceText = text
    let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
    // The panel takes Quartz bounds, as Accessibility reports them.
    panel.show(
      selection: CaptureCoordinates.flip(selection, primaryHeight: primaryHeight),
      pointer: CGPoint(x: selection.midX, y: selection.midY))
    practiceMoveMonitor = NSEvent.addLocalMonitorForEvents(
      matching: [.mouseMoved, .leftMouseDragged]
    ) { [weak self] event in
      MainActor.assumeIsolated { self?.panel.pointerMoved() }
      return event
    }
  }

  /// Hides a practice toolbar; a toolbar over another app's selection stays.
  func hidePractice() {
    if practiceText != nil { dismiss() }
  }

  // MARK: Monitoring

  private func install() {
    monitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .leftMouseUp]) {
      [weak self] event in
      MainActor.assumeIsolated { self?.handle(event) }
    }
    activationObserver = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
    ) { [weak self] note in
      // `Notification` is not Sendable, so only the pid crosses into the main-actor handler.
      let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
      let pid = app?.processIdentifier
      MainActor.assumeIsolated { self?.appActivated(pid: pid) }
    }
  }

  /// Another app came forward: the toolbar over the last one goes, and an Electron app the
  /// toolbar would probe starts building its web accessibility tree now, so it has one by the
  /// time something is selected in it.
  private func appActivated(pid: pid_t?) {
    dismiss()
    guard let settings, let pid, let app = NSRunningApplication(processIdentifier: pid),
      SelectionToolbarRules.shouldProbe(context(of: app, settings))
    else { return }
    SelectionPresence.prepare(pid: pid, bundleURL: app.bundleURL)
  }

  private func context(of app: NSRunningApplication, _ settings: SelectionToolbarSettings)
    -> SelectionToolbarContext
  {
    SelectionToolbarContext(
      enabled: settings.enabled, trusted: trust.isTrusted,
      frontmostBundleId: app.bundleIdentifier, ownBundleId: Bundle.main.bundleIdentifier,
      excludedBundleIds: settings.excludedBundleIds, secureInput: IsSecureEventInputEnabled())
  }

  private func uninstall() {
    if let monitor { NSEvent.removeMonitor(monitor) }
    monitor = nil
    if let activationObserver {
      NSWorkspace.shared.notificationCenter.removeObserver(activationObserver)
    }
    activationObserver = nil
    dismiss()
  }

  private func handle(_ event: NSEvent) {
    let pointer = NSEvent.mouseLocation
    switch event.type {
    case .leftMouseDown:
      dismiss()
      pressedAt = pointer
      heldAtPress = held(in: event)
    case .leftMouseUp:
      let selected = SelectionGesture.mayHaveSelected(
        down: pressedAt, up: pointer, clickCount: event.clickCount,
        shift: event.modifierFlags.contains(.shift))
      let admitted = settings?.activation.admits(
        heldAtPress: heldAtPress, heldAtRelease: held(in: event), listening: listening.isOn)
      pressedAt = nil
      heldAtPress = false
      if selected, admitted == true { schedule(at: pointer, immediately: event.clickCount < 2) }
    default:
      dismiss()
    }
  }

  /// Whether the activation key combination was down during `event`.
  private func held(in event: NSEvent) -> Bool {
    settings?.activation.isHeld(in: event.modifierFlags) ?? false
  }

  private func schedule(at pointer: CGPoint, immediately: Bool) {
    pending?.cancel()
    watchInterruptions()
    let token = generation
    pending = Task { [weak self] in
      if immediately, await self?.check(pointer: pointer, token: token) == true { return }
      try? await Task.sleep(for: Self.debounce)
      guard !Task.isCancelled else { return }
      let shown = await self?.check(pointer: pointer, token: token) == true
      if !shown, token == self?.generation { self?.stopWatchingInterruptions() }
    }
  }

  private func watchInterruptions() {
    guard interruptMonitor == nil else { return }
    let mask: NSEvent.EventTypeMask = [.rightMouseDown, .otherMouseDown, .keyDown, .scrollWheel]
    interruptMonitor = NSEvent.addGlobalMonitorForEvents(matching: mask) { [weak self] _ in
      MainActor.assumeIsolated { self?.dismiss() }
    }
  }

  private func stopWatchingInterruptions() {
    if let interruptMonitor { NSEvent.removeMonitor(interruptMonitor) }
    interruptMonitor = nil
  }

  /// The rules first, then Accessibility, then the toolbar if nothing newer happened meanwhile.
  /// True when the toolbar showed.
  @discardableResult
  private func check(pointer: CGPoint, token: Int) async -> Bool {
    guard token == generation, let settings,
      let app = NSWorkspace.shared.frontmostApplication
    else { return false }
    guard SelectionToolbarRules.shouldProbe(context(of: app, settings)) else { return false }
    let probe = await SelectionPresence.check(pid: app.processIdentifier)
    guard token == generation, monitor != nil,
      NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier,
      SelectionToolbarRules.shows(probe)
    else { return false }
    var bounds: CGRect?
    if case .selected(_, let rect) = probe { bounds = rect }
    panel.show(selection: bounds, pointer: pointer)
    watchPointer()
    return true
  }

  // MARK: Dismissal

  /// Wakes hover tracking on pointer moves over other apps; the pointer's distance from the
  /// toolbar never dismisses it.
  private func watchPointer() {
    guard moveMonitor == nil else { return }
    moveMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) {
      [weak self] _ in
      MainActor.assumeIsolated { self?.panel.pointerMoved() }
    }
  }

  /// Hides the toolbar and drops any check still running.
  private func dismiss() {
    generation += 1
    pending?.cancel()
    pending = nil
    if let moveMonitor { NSEvent.removeMonitor(moveMonitor) }
    moveMonitor = nil
    if let practiceMoveMonitor { NSEvent.removeMonitor(practiceMoveMonitor) }
    practiceMoveMonitor = nil
    practiceText = nil
    stopWatchingInterruptions()
    panel.hide()
  }
}
