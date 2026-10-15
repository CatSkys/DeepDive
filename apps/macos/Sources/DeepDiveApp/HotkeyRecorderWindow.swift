import AppKit
import Carbon.HIToolbox

/// Tiny modal-less window for rebinding the global hotkey from the built-in
/// settings page: while visible it captures the next local key combo (the
/// settings page lives in the WebView, whose key events a local monitor
/// would never see), then hands the spec string back. Esc cancels.
final class HotkeyRecorderWindow: NSObject, NSWindowDelegate {
    private let window: NSWindow
    private let label: NSTextField
    private var monitor: Any?
    /// Receives the new "option+space" style spec, or nil on cancel.
    var onResult: ((String?) -> Void)?

    override init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 300, height: 90),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "录制全局热键"
        window.isReleasedWhenClosed = false
        window.center()
        let label = NSTextField(labelWithString: "按下新的组合键（Esc 取消）")
        label.font = .systemFont(ofSize: 13)
        label.translatesAutoresizingMaskIntoConstraints = false
        window.contentView?.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: window.contentView!.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: window.contentView!.centerYAnchor),
        ])
        self.window = window
        self.label = label
        super.init()
        window.delegate = self
    }

    func showRecorder() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        armMonitor()
    }

    /// (Re)install the local key monitor. Idempotent — any previous monitor is
    /// removed first, so re-arming after an unusable combo and the window's
    /// red close button can never stack leaked monitors (AUD-032).
    private func armMonitor() {
        if let m = monitor { NSEvent.removeMonitor(m) }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, event.window === self.window else { return event }
            if let m = self.monitor { NSEvent.removeMonitor(m) }
            self.monitor = nil
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            if event.keyCode == UInt16(kVK_Escape) {
                self.onResult?(nil)
                self.window.orderOut(nil)
                return nil
            }
            guard let spec = Self.hotkeySpec(keyCode: event.keyCode, flags: flags) else {
                self.label.stringValue = "该组合键不可用，请重试（Esc 取消）"
                // Keep recording: re-arm a fresh monitor.
                self.armMonitor()
                return nil
            }
            self.onResult?(spec)
            self.window.orderOut(nil)
            return nil
        }
    }

    /// Red close button: take the monitor down with the window — and report the
    /// cancellation (nil), or the settings page's chip stays stuck on
    /// "recording" with no way back.
    func windowWillClose(_ notification: Notification) {
        if let m = monitor { NSEvent.removeMonitor(m) }
        monitor = nil
        onResult?(nil)
    }

    /// NSEvent → "option+space" style spec. Key names come from
    /// HotKeyManager's real Carbon keycode table, so the recorded string
    /// names the physical key that was pressed.
    static func hotkeySpec(keyCode: UInt16, flags: NSEvent.ModifierFlags) -> String? {
        guard let k = HotKeyManager.keyNameByCode[UInt32(keyCode)] else { return nil }
        var parts: [String] = []
        if flags.contains(.command) { parts.append("command") }
        if flags.contains(.control) { parts.append("control") }
        if flags.contains(.option) { parts.append("option") }
        if flags.contains(.shift) { parts.append("shift") }
        guard !parts.isEmpty else { return nil }
        return (parts + [k]).joined(separator: "+")
    }
}
